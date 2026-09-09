import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, resetDatabase, allowEmail } from '../../__tests__/setup';
import prisma from '../../db/prisma';
import { currentImagePin } from '../../services/imagePin';

// Mock the Anthropic SDK the same way books.test.ts does. The point of most
// assertions below is that mockCreate is NEVER reached — an unauthenticated
// caller must not be able to spend the project's API budget.
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: (...args: unknown[]) => mockCreate(...args) };
  }
  return { default: MockAnthropic };
});

// Stub illustrations so cover/full preview modes can't reach a paid image API.
// isImageGenConfigured is a mock rather than a hard `() => false` so the
// pinning test below can let the (mocked) image path actually run; it defaults
// to false in beforeEach, which is what every other test in this file assumes.
const mockGenerateCover = vi.fn();
const mockGenerateIllustration = vi.fn();
const mockIsImageGenConfigured = vi.fn((..._args: unknown[]) => false);
vi.mock('../../services/illustrations', async () => {
  const actual = await vi.importActual<typeof import('../../services/illustrations')>(
    '../../services/illustrations',
  );
  return {
    ...actual,
    generateCover: (...args: unknown[]) => mockGenerateCover(...args),
    generateIllustration: (...args: unknown[]) => mockGenerateIllustration(...args),
    isImageGenConfigured: (...args: unknown[]) => mockIsImageGenConfigured(...args),
  };
});

// '5-9' is canonical (#172). It was '5-7' before POST /api/generate had a
// validate(); '5-7' is off-vocabulary now and 400s. Both bucket 'developing',
// so no typography assertion in this file moved with the sweep.
const VALID_BODY = {
  theme: 'space',
  ageRange: '5-9',
  characterName: 'Luna',
};

async function createUserAndGetToken(app: Express): Promise<string> {
  const email = `gen-${Date.now()}@example.com`;
  await allowEmail(email);
  const res = await request(app).post('/api/auth/register').send({
    email,
    name: 'Gen Tester',
    password: 'test-password',
  });
  return res.body.token as string;
}

describe('POST /api/generate — auth gate', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
    mockCreate.mockReset();
    mockGenerateCover.mockReset();
    mockGenerateIllustration.mockReset();
    mockIsImageGenConfigured.mockReset();
    mockIsImageGenConfigured.mockReturnValue(false);
    // The handler 500s on a missing key before it ever constructs the client.
    // Stub one so the authed case actually exercises the path past the gate —
    // the SDK itself is mocked, so nothing leaves the process.
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(app).post('/api/generate').send(VALID_BODY);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Not authenticated');
  });

  it('does NOT call the Anthropic API when unauthenticated', async () => {
    // The regression this pins: the handler used to call Claude before
    // touching the DB, so an anonymous request cost real money even when the
    // database was down. The gate must short-circuit before any paid call.
    await request(app).post('/api/generate').send(VALID_BODY);

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does not spend on a full-book request from an anonymous caller', async () => {
    // previewMode 'full' with a high pageCount is the most expensive shape the
    // route accepts — cover plus one image per page on top of the story call.
    await request(app)
      .post('/api/generate')
      .send({ ...VALID_BODY, previewMode: 'full', pageCount: 15 });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects a malformed Bearer token with 401', async () => {
    const res = await request(app)
      .post('/api/generate')
      .set('Authorization', 'Bearer not-a-real-token')
      .send(VALID_BODY);

    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('lets an authenticated caller through the gate', async () => {
    // Proves the gate isn't simply blocking everyone. We assert the request
    // gets PAST auth — validation of the body happens after, so a 401 here
    // would mean the gate is wrong; anything else means it passed.
    const token = await createUserAndGetToken(app);
    mockCreate.mockRejectedValueOnce(new Error('stop before real work'));

    const res = await request(app)
      .post('/api/generate')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_BODY);

    expect(res.status).not.toBe(401);
    expect(mockCreate).toHaveBeenCalled();
  });

  it('still validates the body for authenticated callers', async () => {
    const token = await createUserAndGetToken(app);

    const res = await request(app)
      .post('/api/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'space' }); // missing ageRange + character

    // The message is Zod's now (`Invalid request body: ageRange: ...`) rather
    // than the handler's sentence — validate() rejects the missing ageRange
    // before the handler's cross-field check runs. Status and envelope shape
    // are what the client depends on, so those are what this pins.
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.any(String) });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/generate — image pin on a new book', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
    mockCreate.mockReset();
    mockGenerateCover.mockReset();
    mockGenerateIllustration.mockReset();
    mockIsImageGenConfigured.mockReset();
    mockIsImageGenConfigured.mockReturnValue(true);
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function mockStory(pageCount: number) {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            title: 'Luna and the Test Suite',
            description: 'A story about assertions.',
            coverEmoji: '⭐',
            coverColor: '#7c3aed',
            coverDescription: 'Luna under a sky of green checkmarks.',
            pages: Array.from({ length: pageCount }, (_, i) => ({
              text: `Page ${i + 1} text`,
              illustrationDescription: `Illustration ${i + 1}`,
            })),
          }),
        },
      ],
    });
  }

  it('pins a full-preview book to the current environment default on the first image', async () => {
    // A new book has no art, so its pin is simply today's default — but it is
    // written on the first successful IMAGE, not at row-create time, so a
    // text-only book stays unpinned until something actually draws it.
    const token = await createUserAndGetToken(app);
    mockStory(3);
    mockGenerateCover.mockResolvedValue('/illustrations/new-book/cover.png');
    mockGenerateIllustration.mockResolvedValue('/illustrations/new-book/page.png');

    const res = await request(app)
      .post('/api/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_BODY, previewMode: 'full', pageCount: 3 });

    expect(res.status).toBe(200);
    const pin = currentImagePin();
    expect(res.body).toMatchObject({
      id: expect.any(String),
      image_provider: pin.provider,
      image_model: pin.model,
      // Ships on the wire because the handler spreads the whole Book row.
      // VALID_BODY's ageRange '5-9' buckets to 'developing'.
      font_family: 'fredoka',
      text_size: 'standard',
    });

    const book = await prisma.book.findUnique({ where: { id: res.body.id } });
    expect(book?.image_provider).toBe(pin.provider);
    expect(book?.image_model).toBe(pin.model);

    // The pin also rides into the generator, so the image that establishes it is
    // drawn by the provider it names.
    expect(mockGenerateCover.mock.calls[0][6]).toMatchObject({ pin });
    expect(mockGenerateIllustration.mock.calls[0][7]).toMatchObject({ pin });
  });

  it('leaves a quick-preview book unpinned — the pin records art, not intent', async () => {
    const token = await createUserAndGetToken(app);
    mockStory(3);

    const res = await request(app)
      .post('/api/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_BODY, previewMode: 'quick', pageCount: 3 });

    expect(res.status).toBe(200);
    expect(res.body.image_provider).toBeNull();
    const book = await prisma.book.findUnique({ where: { id: res.body.id } });
    expect(book?.image_provider).toBeNull();
    expect(mockGenerateCover).not.toHaveBeenCalled();
  });
});

// Typography is seeded at creation time from the book's age range and never
// re-derived afterwards (spec §Ruling 4). These pin the seeding half; the
// "never re-derived" half is enforced by the columns being non-null with DB
// defaults, so nothing downstream has a fallback branch to get wrong.
//
// Since #172 the route DOES validate ageRange against the canonical enum, so
// every row below is a canonical value. ageBucketFor()'s tolerance for
// off-vocabulary strings is still real — legacy and restored rows carry them —
// but it is no longer reachable through this route, so it is unit-tested in
// server/src/lib/__tests__/typography.test.ts instead of here.
describe('POST /api/generate — creation-time typography defaults', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
    mockCreate.mockReset();
    mockGenerateCover.mockReset();
    mockGenerateIllustration.mockReset();
    mockIsImageGenConfigured.mockReset();
    mockIsImageGenConfigured.mockReturnValue(false);
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function mockStory(pageCount: number) {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            title: 'Luna and the Typography Suite',
            description: 'A story about letterforms.',
            coverEmoji: '\u2b50',
            coverColor: '#7c3aed',
            coverDescription: 'Luna reading in a very legible font.',
            pages: Array.from({ length: pageCount }, (_, i) => ({
              text: `Page ${i + 1} text`,
              illustrationDescription: `Illustration ${i + 1}`,
            })),
          }),
        },
      ],
    });
  }

  it.each([
    // ageRange, font_family, text_size, why — canonical values only, because
    // anything else 400s at validate() now.
    ['2-5', 'fredoka', 'large', 'lower bound 2 is the early band'],
    ['3-6', 'fredoka', 'large', 'lower bound 3 is the early band'],
    ['4-8', 'fredoka', 'large', 'lower bound 4 is still the early band'],
    ['5-9', 'fredoka', 'standard', 'lower bound 5 is the developing band'],
    // No row for 'independent' (nunito/cozy): the canonical vocabulary tops out
    // at 5-9 and that bucket needs a lower bound >= 8, so no book this route
    // can produce reaches it. Deliberately deferred, not missing — see
    // .code-captain/specs/age-range-vocabulary/spec.md §ADR-worthy decisions,
    // the `Deferred:` item. It stays unit-tested in lib/__tests__/typography.test.ts.
  ])('persists %s as %s/%s (%s)', async (ageRange, fontFamily, textSize) => {
    const token = await createUserAndGetToken(app);
    mockStory(3);

    const res = await request(app)
      .post('/api/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_BODY, ageRange, pageCount: 3 });

    expect(res.status).toBe(200);
    const book = await prisma.book.findUnique({ where: { id: res.body.id } });
    expect(book).toMatchObject({
      age_range: ageRange, // untouched by this feature — still free text
      font_family: fontFamily,
      text_size: textSize,
    });
  });

  it('400s instead of creating a book when ageRange is unrecognised', async () => {
    // This test used to assert 'all ages' created a book at the safe middle.
    // Since #172 the value never reaches the handler: validate() rejects it, so
    // no typography decision is made at all. ageBucketFor('all ages') still
    // returns 'developing' — that tolerance is asserted in
    // server/src/lib/__tests__/typography.test.ts, where it now lives alone.
    const token = await createUserAndGetToken(app);

    const res = await request(app)
      .post('/api/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_BODY, ageRange: 'all ages', pageCount: 3 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.any(String) });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// POST /api/generate gained its first validate() in #172 — the canonical
// AgeRangeSchema on `ageRange`, mounted requireAuth -> validate -> spendGate so
// a malformed body never touches quota accounting. These pin both halves: what
// the schema now rejects, and — more importantly — what it must NOT strip.
describe('POST /api/generate — request validation (#172)', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
    mockCreate.mockReset();
    mockGenerateCover.mockReset();
    mockGenerateIllustration.mockReset();
    mockIsImageGenConfigured.mockReset();
    mockIsImageGenConfigured.mockReturnValue(false);
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function mockStory(pageCount: number) {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            title: 'Luna and the Full-Fat Body',
            description: 'A story about every optional field.',
            coverEmoji: '\u2b50',
            coverColor: '#7c3aed',
            coverDescription: 'Luna surrounded by populated fields.',
            pages: Array.from({ length: pageCount }, (_, i) => ({
              text: `Page ${i + 1} text`,
              illustrationDescription: `Illustration ${i + 1}`,
            })),
          }),
        },
      ],
    });
  }

  it.each([
    ['6-10', 'a retired CreateBook.tsx value'],
    ['2-4', 'the other retired CreateBook.tsx value'],
    ['all ages', 'free text that never was in either list'],
  ])('rejects ageRange %s (%s) with 400 and persists nothing', async (ageRange) => {
    const token = await createUserAndGetToken(app);
    const booksBefore = await prisma.book.count();

    const res = await request(app)
      .post('/api/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_BODY, ageRange });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.any(String) });
    // validate() sits before spendGate and before the Anthropic call, so a bad
    // body costs neither a row nor a cent.
    expect(await prisma.book.count()).toBe(booksBefore);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(await prisma.usageLog.count()).toBe(0);
  });

  it('does not strip any field the handler reads from a full-fat body', async () => {
    // The strip guard. `z.object` drops unknown keys and validate() REPLACES
    // req.body with the parsed value, so a field missing from
    // GenerateRequestSchema disappears silently — style references would just
    // stop working, with every existing test still green. This posts every
    // optional field at once and asserts each one survived the round trip.
    const token = await createUserAndGetToken(app);
    mockStory(4);
    mockIsImageGenConfigured.mockReturnValue(true);
    mockGenerateCover.mockResolvedValue('/illustrations/full-fat/cover.png');

    const res = await request(app)
      .post('/api/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        theme: 'deep sea',
        ageRange: '4-8',
        additionalDetails: 'Set aboard a very small submarine.',
        characterName: 'Ignored When characters Is Present',
        characters: [
          { role: 'primary', name: 'Luna', descriptor: 'a curious fox', relationship: 'daughter' },
          { role: 'supporting', name: 'Pip', descriptor: 'a dented robot' },
          // Junk role: must survive PARSING (loose object) so
          // normalizeCharacters() can drop it, rather than 400ing the request.
          { role: 'sidekick', name: 'Dropped' },
        ],
        styleDescriptor: 'soft watercolour',
        styleReferenceUrl: '/uploads/style-ref.png',
        previewMode: 'cover',
        pageCount: 4,
      });

    expect(res.status).toBe(200);

    const book = await prisma.book.findUnique({
      where: { id: res.body.id },
      include: { pages: true },
    });
    expect(book).toMatchObject({
      age_range: '4-8',
      theme: 'deep sea',
      style_descriptor: 'soft watercolour',
      style_reference_url: '/uploads/style-ref.png',
      // previewMode 'cover' survived: the cover path ran at all.
      cover_url: '/illustrations/full-fat/cover.png',
    });
    // pageCount survived (4, not the DEFAULT_PAGES 5).
    expect(book?.pages).toHaveLength(4);
    // characters survived with descriptor + relationship intact, and the junk
    // role was filtered by the handler rather than rejected by the schema.
    expect(JSON.parse(book!.characters_json as string)).toEqual([
      { role: 'primary', name: 'Luna', descriptor: 'a curious fox', relationship: 'daughter' },
      { role: 'supporting', name: 'Pip', descriptor: 'a dented robot' },
    ]);
    // additionalDetails survived — it only ever reaches the prompt.
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('Set aboard a very small submarine.');
  });
});

// A `.env` copied from `.env.example` used to ship
// ANTHROPIC_API_KEY=your-api-key-here. The handler's guard was `if (!apiKey)`,
// so a placeholder counted as configured: the request reached Anthropic, came
// back 401, and the caller got an opaque 500 with a vendor stack trace instead
// of the honest "not configured". These pin the two halves of the fix — a
// placeholder fails EXACTLY like an unset key, and a real-looking key still
// gets through untouched.
describe('POST /api/generate — ANTHROPIC_API_KEY config gate', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
    mockCreate.mockReset();
    mockGenerateCover.mockReset();
    mockGenerateIllustration.mockReset();
    mockIsImageGenConfigured.mockReset();
    mockIsImageGenConfigured.mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('500s with the not-configured envelope when the key is unset (the oracle)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', undefined);
    const token = await createUserAndGetToken(app);

    const res = await request(app)
      .post('/api/generate')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_BODY);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: 'ANTHROPIC_API_KEY not configured' });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['your-api-key-here', 'the .env.example literal'],
    ['YOUR_API_KEY_HERE', 'the same literal shouted'],
    ['<your-anthropic-key>', 'still in angle brackets'],
    ['changeme', 'the other common filler'],
  ])('treats a placeholder key (%s — %s) exactly like an unset one', async (key) => {
    vi.stubEnv('ANTHROPIC_API_KEY', key);
    const token = await createUserAndGetToken(app);

    const res = await request(app)
      .post('/api/generate')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_BODY);

    // Same status, same message as the unset case above — and, critically, the
    // paid call never happens, so there is no 401 to leak as a 500.
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: 'ANTHROPIC_API_KEY not configured' });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(await prisma.usageLog.count()).toBe(0);
  });

  it('lets a real-looking key through to the Anthropic call', async () => {
    // The false-positive guard: a key that merely CONTAINS a filler word is
    // still a key. If this ever fails, the predicate has started locking people
    // out of working credentials, which is worse than the bug it fixes.
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-changeme123');
    const token = await createUserAndGetToken(app);
    mockCreate.mockRejectedValueOnce(new Error('stop before real work'));

    const res = await request(app)
      .post('/api/generate')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_BODY);

    expect(res.body.error).not.toBe('ANTHROPIC_API_KEY not configured');
    expect(mockCreate).toHaveBeenCalled();
  });
});
