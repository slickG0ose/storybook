import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import prisma from '../../db/prisma';
import { resetDatabase } from '../../__tests__/setup';
import {
  generateIllustration,
  generateCover,
  isImageGenConfigured,
  generateCharacterPortrait,
  listCharacterPortraitVersions,
} from '../illustrations';
import { FalImageGenerator } from '../providers/fal';

// generateIllustration writes a real file to public/illustrations/<bookId>/
// during the test. We clean that directory up afterwards so we don't pollute
// the dev server's filesystem. The DB row is what we actually assert on.
const TEST_BOOK_ID = 'luna-star-garden';
const ILLUSTRATIONS_DIR = join(import.meta.dirname, '../../../public/illustrations', TEST_BOOK_ID);

// A 1x1 transparent PNG, base64-encoded — minimal valid image bytes to
// satisfy the writeFile call without depending on a real OpenAI response.
const FAKE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('generateIllustration service', () => {
  let originalFetch: typeof fetch;
  let originalApiKey: string | undefined;
  let originalProvider: string | undefined;

  beforeEach(async () => {
    await resetDatabase();
    originalFetch = globalThis.fetch;
    originalApiKey = process.env.OPENAI_API_KEY;
    originalProvider = process.env.IMAGE_PROVIDER;
    // Pin the provider to openai so the OpenAI path runs; the service default
    // is now 'fal' (which gates on FAL_KEY).
    process.env.IMAGE_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';

    // Mock the OpenAI image generation HTTP call. The service expects a JSON
    // response shaped like { data: [{ b64_json }] }.
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ b64_json: FAKE_PNG_B64 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
    if (originalProvider === undefined) {
      delete process.env.IMAGE_PROVIDER;
    } else {
      process.env.IMAGE_PROVIDER = originalProvider;
    }
    // Clean up any files the test wrote.
    try {
      await rm(ILLUSTRATIONS_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('writes an IllustrationVersion row when generation succeeds', async () => {
    const url = await generateIllustration(
      TEST_BOOK_ID,
      1,
      'A purple cat under the moon',
      'make the moon bigger',
      null,
      [],
    );

    expect(url).toMatch(/^\/illustrations\/luna-star-garden\/page-1(-v\d+)?\.png$/);

    const rows = await prisma.illustrationVersion.findMany({
      where: { book_id: TEST_BOOK_ID, page_number: 1 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(1);
    expect(rows[0].url).toBe(url);
    expect(rows[0].feedback).toBe('make the moon bigger');
  });
});

// Provider-parity check: with IMAGE_PROVIDER=fal the public service functions
// must write the SAME illustrationVersion row + return the SAME /illustrations/
// URL contract as the OpenAI path above. The provider difference (Fal's
// two-leg { images: [{ url }] } -> bytes-download flow vs OpenAI's
// { data: [{ b64_json }] }) is invisible to the persistence layer — that is
// the contract this block pins. The OpenAI test above stays the regression
// oracle and is intentionally left untouched.
describe('generateIllustration service (Fal provider)', () => {
  let originalFetch: typeof fetch;
  let originalFalKey: string | undefined;
  let originalProvider: string | undefined;

  beforeEach(async () => {
    await resetDatabase();
    originalFetch = globalThis.fetch;
    originalFalKey = process.env.FAL_KEY;
    originalProvider = process.env.IMAGE_PROVIDER;
    process.env.IMAGE_PROVIDER = 'fal';
    process.env.FAL_KEY = 'fal-test';

    // Mock the two-leg Fal flow: (1) the synchronous run returns a Fal-shaped
    // JSON body { images: [{ url }] }; (2) downloading that url returns the
    // fake PNG bytes. Reuses the same FAKE_PNG_B64 the OpenAI path uses.
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ images: [{ url: 'https://fal.example/img.png' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(Buffer.from(FAKE_PNG_B64, 'base64'), { status: 200 }),
      ) as unknown as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (originalFalKey === undefined) {
      delete process.env.FAL_KEY;
    } else {
      process.env.FAL_KEY = originalFalKey;
    }
    if (originalProvider === undefined) {
      delete process.env.IMAGE_PROVIDER;
    } else {
      process.env.IMAGE_PROVIDER = originalProvider;
    }
    try {
      await rm(ILLUSTRATIONS_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('writes the same IllustrationVersion row + URL contract as the OpenAI path', async () => {
    const url = await generateIllustration(
      TEST_BOOK_ID,
      1,
      'A purple cat under the moon',
      'make the moon bigger',
      null,
      [],
    );

    expect(url).toMatch(/^\/illustrations\/luna-star-garden\/page-1(-v\d+)?\.png$/);

    const rows = await prisma.illustrationVersion.findMany({
      where: { book_id: TEST_BOOK_ID, page_number: 1 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(1);
    expect(rows[0].url).toBe(url);
    expect(rows[0].feedback).toBe('make the moon bigger');
  });

  it('generateCover writes the PNG + returns the cover URL but writes NO version row', async () => {
    const url = await generateCover(
      TEST_BOOK_ID,
      'Luna and the Star Garden',
      'A purple cat tending a garden of stars',
      null,
      [],
    );

    expect(url).toBe(`/illustrations/${TEST_BOOK_ID}/cover.png`);

    // Asymmetry preserved: cover generation does NOT write an
    // illustrationVersion row (only generateIllustration does).
    const rows = await prisma.illustrationVersion.findMany({
      where: { book_id: TEST_BOOK_ID },
    });
    expect(rows).toHaveLength(0);
  });
});

describe('isImageGenConfigured', () => {
  let originalProvider: string | undefined;
  let originalOpenAiKey: string | undefined;
  let originalFalKey: string | undefined;

  beforeEach(() => {
    originalProvider = process.env.IMAGE_PROVIDER;
    originalOpenAiKey = process.env.OPENAI_API_KEY;
    originalFalKey = process.env.FAL_KEY;
    delete process.env.IMAGE_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.FAL_KEY;
  });

  afterEach(() => {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('IMAGE_PROVIDER', originalProvider);
    restore('OPENAI_API_KEY', originalOpenAiKey);
    restore('FAL_KEY', originalFalKey);
  });

  it('gates on FAL_KEY when provider defaults to fal', () => {
    // No IMAGE_PROVIDER set -> default 'fal'.
    expect(isImageGenConfigured()).toBe(false);
    process.env.OPENAI_API_KEY = 'sk-test'; // wrong provider's key — ignored
    expect(isImageGenConfigured()).toBe(false);
    process.env.FAL_KEY = 'fal-test';
    expect(isImageGenConfigured()).toBe(true);
  });

  it('gates on FAL_KEY when provider is explicitly fal', () => {
    process.env.IMAGE_PROVIDER = 'fal';
    expect(isImageGenConfigured()).toBe(false);
    process.env.FAL_KEY = 'fal-test';
    expect(isImageGenConfigured()).toBe(true);
  });

  it('gates on OPENAI_API_KEY when provider is openai', () => {
    process.env.IMAGE_PROVIDER = 'openai';
    expect(isImageGenConfigured()).toBe(false);
    process.env.FAL_KEY = 'fal-test'; // wrong provider's key — ignored
    expect(isImageGenConfigured()).toBe(false);
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(isImageGenConfigured()).toBe(true);
  });
});

// IV2 Phase 2: when referenceImages are present, FalImageGenerator routes to
// FLUX Kontext instead of Flux Pro 1.1 — single ref -> fal-ai/flux-pro/kontext
// with an inlined image_url; 2+ refs -> fal-ai/flux-pro/kontext/multi with an
// image_urls array. References travel inline as base64 data URIs (option b), so
// these tests write a real fixture portrait to the illustrations base on disk.
// The no-reference Flux Pro 1.1 path stays byte-identical (covered by the
// provider-parity block above, intentionally left untouched).
describe('FalImageGenerator Kontext reference path', () => {
  const BOOK_ID = 'kontext-fixture-book';
  const BASE_DIR = join(import.meta.dirname, '../../../public/illustrations', BOOK_ID);
  const PORTRAIT_0 = `/illustrations/${BOOK_ID}/portrait-1000.png`;
  const PORTRAIT_1 = `/illustrations/${BOOK_ID}/portrait-1001.png`;

  let originalFetch: typeof fetch;
  let originalFalKey: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    originalFalKey = process.env.FAL_KEY;
    process.env.FAL_KEY = 'fal-test';

    // Write real fixture portraits so the data-URI resolver can read them.
    await mkdir(BASE_DIR, { recursive: true });
    await writeFile(join(BASE_DIR, 'portrait-1000.png'), Buffer.from(FAKE_PNG_B64, 'base64'));
    await writeFile(join(BASE_DIR, 'portrait-1001.png'), Buffer.from(FAKE_PNG_B64, 'base64'));

    // Two-leg Fal flow: run -> { images: [{ url }] }; download -> PNG bytes.
    fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ images: [{ url: 'https://fal.example/out.png' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(Buffer.from(FAKE_PNG_B64, 'base64'), { status: 200 }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (originalFalKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = originalFalKey;
    try {
      await rm(BASE_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('routes a single reference to fal-ai/flux-pro/kontext with an inlined image_url', async () => {
    const buf = await new FalImageGenerator().generate('a hero on a hill', {
      referenceImages: [PORTRAIT_0],
    });

    expect(Buffer.isBuffer(buf)).toBe(true);

    // First fetch leg = the Kontext run call.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://fal.run/fal-ai/flux-pro/kontext');
    const body = JSON.parse(init.body);
    expect(body.prompt).toBe('a hero on a hill');
    expect(typeof body.image_url).toBe('string');
    expect(body.image_url).toMatch(/^data:image\/png;base64,/);
    expect(body.image_urls).toBeUndefined();
  });

  it('routes 2+ references to fal-ai/flux-pro/kontext/multi with an image_urls array', async () => {
    await new FalImageGenerator().generate('two heroes', {
      referenceImages: [PORTRAIT_0, PORTRAIT_1],
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://fal.run/fal-ai/flux-pro/kontext/multi');
    const body = JSON.parse(init.body);
    expect(body.prompt).toBe('two heroes');
    expect(Array.isArray(body.image_urls)).toBe(true);
    expect(body.image_urls).toHaveLength(2);
    for (const u of body.image_urls) {
      expect(u).toMatch(/^data:image\/png;base64,/);
    }
    expect(body.image_url).toBeUndefined();
  });

  it('throws a clear error when a reference file is missing on disk', async () => {
    await expect(
      new FalImageGenerator().generate('prompt', {
        referenceImages: [`/illustrations/${BOOK_ID}/portrait-9999.png`],
      }),
    ).rejects.toThrow(/Reference image not found on disk/);
    // No HTTP call should have been made — resolution fails before the fetch.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// IV2 Phase 2: generateCharacterPortrait generates ONE character's canonical
// portrait, prompt-only on the current provider (Flux Pro 1.1 — NOT Kontext,
// since the portrait IS the reference). It writes portrait-<slot>.png and an
// IllustrationVersion row keyed on the sentinel portrait slot
// (PORTRAIT_SLOT_BASE + characterIndex = 1000 + index), giving free per-
// character version numbering off the existing @@unique constraint. Uses the
// seeded book so the IllustrationVersion FK is satisfied.
describe('generateCharacterPortrait service', () => {
  const BOOK_ID = 'luna-star-garden';
  const BASE_DIR = join(import.meta.dirname, '../../../public/illustrations', BOOK_ID);
  // characterIndex 0 -> slot 1000; characterIndex 1 -> slot 1001.
  const SLOT_0 = 1000;
  const SLOT_1 = 1001;

  let originalFetch: typeof fetch;
  let originalFalKey: string | undefined;
  let originalProvider: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await resetDatabase();
    originalFetch = globalThis.fetch;
    originalFalKey = process.env.FAL_KEY;
    originalProvider = process.env.IMAGE_PROVIDER;
    process.env.IMAGE_PROVIDER = 'fal';
    process.env.FAL_KEY = 'fal-test';

    // Two-leg Fal flow per call: run -> { images: [{ url }] }; download -> bytes.
    // Default mock returns the run body on odd calls, bytes on even calls.
    fetchMock = vi.fn(async (input: unknown) => {
      const u = typeof input === 'string' ? input : String(input);
      if (u.startsWith('https://fal.run/')) {
        return new Response(JSON.stringify({ images: [{ url: 'https://fal.example/out.png' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(Buffer.from(FAKE_PNG_B64, 'base64'), { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (originalFalKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = originalFalKey;
    if (originalProvider === undefined) delete process.env.IMAGE_PROVIDER;
    else process.env.IMAGE_PROVIDER = originalProvider;
    try {
      await rm(BASE_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('writes a portrait file + sentinel-slot IllustrationVersion row and returns the URL', async () => {
    const url = await generateCharacterPortrait(
      BOOK_ID,
      0,
      'Luna',
      'a curious purple cat',
      undefined,
      null,
    );

    expect(url).toBe(`/illustrations/${BOOK_ID}/portrait-${SLOT_0}.png`);

    const rows = await prisma.illustrationVersion.findMany({
      where: { book_id: BOOK_ID, page_number: SLOT_0 },
      orderBy: { version: 'asc' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].page_number).toBe(SLOT_0);
    expect(rows[0].version).toBe(1);
    expect(rows[0].url).toBe(url);
    expect(rows[0].feedback).toBeNull();
  });

  it('generates the portrait prompt-only (Flux Pro 1.1), NOT the Kontext reference path', async () => {
    await generateCharacterPortrait(BOOK_ID, 0, 'Luna', 'a curious purple cat', undefined, null);

    // First fetch leg = the Fal run call. Must be the prompt-only model, and the
    // body must carry NO reference image fields.
    const [runUrl, init] = fetchMock.mock.calls[0];
    expect(runUrl).toBe('https://fal.run/fal-ai/flux-pro/v1.1');
    const body = JSON.parse((init as { body: string }).body);
    expect(body.prompt).toContain('Luna');
    expect(body.image_url).toBeUndefined();
    expect(body.image_urls).toBeUndefined();
  });

  it('regenerate-with-feedback bumps to version 2 in the same slot and persists feedback', async () => {
    const v1 = await generateCharacterPortrait(BOOK_ID, 0, 'Luna', 'a curious purple cat', undefined, null);
    expect(v1).toBe(`/illustrations/${BOOK_ID}/portrait-${SLOT_0}.png`);

    const v2 = await generateCharacterPortrait(
      BOOK_ID,
      0,
      'Luna',
      'a curious purple cat',
      'make the fur brighter',
      null,
    );
    expect(v2).toBe(`/illustrations/${BOOK_ID}/portrait-${SLOT_0}-v2.png`);

    const rows = await prisma.illustrationVersion.findMany({
      where: { book_id: BOOK_ID, page_number: SLOT_0 },
      orderBy: { version: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.version)).toEqual([1, 2]);
    expect(rows[1].url).toBe(v2);
    expect(rows[1].feedback).toBe('make the fur brighter');
  });

  it('listCharacterPortraitVersions returns the slot history ascending and is isolated from real pages + other slots', async () => {
    // A real page illustration row (page 1) for the same book — must NOT leak
    // into the portrait history.
    await generateIllustration(BOOK_ID, 1, 'a page scene', undefined, null, []);
    // A second character's portrait (slot 1001) — must NOT leak into slot 1000.
    await generateCharacterPortrait(BOOK_ID, 1, 'Comet', 'a star dog', undefined, null);

    // Two versions for character 0 (slot 1000).
    await generateCharacterPortrait(BOOK_ID, 0, 'Luna', 'a curious purple cat', undefined, null);
    await generateCharacterPortrait(BOOK_ID, 0, 'Luna', 'a curious purple cat', 'brighter', null);

    const history = await listCharacterPortraitVersions(BOOK_ID, 0);
    expect(history.map(h => h.version)).toEqual([1, 2]);
    expect(history[0]).toMatchObject({
      url: `/illustrations/${BOOK_ID}/portrait-${SLOT_0}.png`,
      version: 1,
      feedback: null,
    });
    expect(history[1]).toMatchObject({
      url: `/illustrations/${BOOK_ID}/portrait-${SLOT_0}-v2.png`,
      version: 2,
      feedback: 'brighter',
    });
    expect(typeof history[0].created_at).toBe('string');

    // Slot isolation: every returned url is for slot 1000, never page-1 or slot 1001.
    for (const h of history) {
      expect(h.url).toContain(`portrait-${SLOT_0}`);
      expect(h.url).not.toContain(`portrait-${SLOT_1}`);
      expect(h.url).not.toContain('page-1');
    }
  });
});

// IV2 Phase 2: with references present, OpenAIImageGenerator uses the
// gpt-image-1 edit endpoint (multipart) rather than the generations endpoint.
// Exercised through generateIllustration with IMAGE_PROVIDER=openai so the
// provider switch + reference plumbing are covered together.
describe('OpenAIImageGenerator image-input reference path', () => {
  // Reuse the seeded book so the IllustrationVersion FK is satisfied — this
  // test asserts the request shape (edit endpoint + multipart), and the DB
  // write rides along through generateIllustration.
  const BOOK_ID = 'luna-star-garden';
  const BASE_DIR = join(import.meta.dirname, '../../../public/illustrations', BOOK_ID);
  const PORTRAIT = `/illustrations/${BOOK_ID}/portrait-1000.png`;

  let originalFetch: typeof fetch;
  let originalApiKey: string | undefined;
  let originalProvider: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await resetDatabase();
    originalFetch = globalThis.fetch;
    originalApiKey = process.env.OPENAI_API_KEY;
    originalProvider = process.env.IMAGE_PROVIDER;
    process.env.IMAGE_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';

    await mkdir(BASE_DIR, { recursive: true });
    await writeFile(join(BASE_DIR, 'portrait-1000.png'), Buffer.from(FAKE_PNG_B64, 'base64'));

    fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ b64_json: FAKE_PNG_B64 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    if (originalProvider === undefined) delete process.env.IMAGE_PROVIDER;
    else process.env.IMAGE_PROVIDER = originalProvider;
    try {
      await rm(BASE_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('hits the gpt-image-1 edit endpoint with multipart form-data when references are present', async () => {
    await generateIllustration(BOOK_ID, 1, 'a scene', undefined, null, [], [PORTRAIT]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/images/edits');
    expect(init.body).toBeInstanceOf(FormData);
    // The image-input path must NOT set Content-Type (FormData sets the
    // multipart boundary itself).
    expect(init.headers['Content-Type']).toBeUndefined();
  });
});
