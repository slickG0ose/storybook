import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import prisma from '../../db/prisma';
import { resetDatabase } from '../../__tests__/setup';
import {
  generateIllustration,
  generateCover,
  isImageGenConfigured,
  isUsableApiKey,
  getImageGenerator,
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

  // Pin-aware overload. The no-argument form above is the regression oracle and
  // is left untouched; these cover the explicit-provider form the 409 gate needs
  // (Task 5) to tell "nothing configured" from "not THIS book's provider".
  it('gates on the NAMED provider key when given an argument, ignoring IMAGE_PROVIDER', () => {
    process.env.IMAGE_PROVIDER = 'fal';
    process.env.FAL_KEY = 'fal-test';

    expect(isImageGenConfigured('fal')).toBe(true);
    expect(isImageGenConfigured('openai')).toBe(false);
    // ...and the env default is unaffected by asking about another provider.
    expect(isImageGenConfigured()).toBe(true);

    process.env.OPENAI_API_KEY = 'sk-test';
    expect(isImageGenConfigured('openai')).toBe(true);

    delete process.env.FAL_KEY;
    expect(isImageGenConfigured('fal')).toBe(false);
    expect(isImageGenConfigured('openai')).toBe(true);
    expect(isImageGenConfigured()).toBe(false); // env default is still fal
  });
});

// Presence is not usability. `.env.example` ships `OPENAI_API_KEY=your-api-key-here`
// and a `.env` copied without editing counts as "configured" under a `!!` check,
// so the 409 that ADR-013 dec 5 promises never fires and the caller gets a 500
// with a raw provider stack trace instead.
describe('isUsableApiKey', () => {
  it('rejects missing, empty, and whitespace-only values', () => {
    expect(isUsableApiKey(undefined)).toBe(false);
    expect(isUsableApiKey(null)).toBe(false);
    expect(isUsableApiKey('')).toBe(false);
    expect(isUsableApiKey('   ')).toBe(false);
    expect(isUsableApiKey('\t\n ')).toBe(false);
  });

  it('rejects the .env.example literal in every casing and separator it appears as', () => {
    expect(isUsableApiKey('your-api-key-here')).toBe(false);
    expect(isUsableApiKey('YOUR-API-KEY-HERE')).toBe(false);
    expect(isUsableApiKey('your_api_key_here')).toBe(false);
    expect(isUsableApiKey('  your-api-key-here  ')).toBe(false);
  });

  it('rejects the common placeholder families', () => {
    // your-*-key
    expect(isUsableApiKey('your-key')).toBe(false);
    expect(isUsableApiKey('your-api-key')).toBe(false);
    expect(isUsableApiKey('your-openai-key')).toBe(false);
    expect(isUsableApiKey('your-fal-key-here')).toBe(false);
    // changeme
    expect(isUsableApiKey('changeme')).toBe(false);
    expect(isUsableApiKey('change-me')).toBe(false);
    expect(isUsableApiKey('CHANGEME')).toBe(false);
    // all-x
    expect(isUsableApiKey('xxx')).toBe(false);
    expect(isUsableApiKey('xxxxxxxxxxxxxxxx')).toBe(false);
    // angle brackets
    expect(isUsableApiKey('<your-api-key>')).toBe(false);
    expect(isUsableApiKey('<paste key here>')).toBe(false);
    // misc template filler
    expect(isUsableApiKey('placeholder')).toBe(false);
    expect(isUsableApiKey('TODO')).toBe(false);
  });

  // The fence that matters most. A false positive here locks a user out of a
  // provider whose key is genuinely fine — strictly worse than the bug this
  // predicate fixes — so it matches whole-value placeholder SHAPES only and
  // deliberately validates no vendor key format (no `sk-` requirement, no
  // length floor, no charset rule).
  it('accepts genuine keys, including ones that merely CONTAIN placeholder words', () => {
    expect(isUsableApiKey('sk-test')).toBe(true);
    expect(isUsableApiKey('fal-test')).toBe(true);
    expect(isUsableApiKey('sk-proj-1a2B3c4D5e6F7g8H9i0J')).toBe(true);
    // Fal's uuid:hex shape.
    expect(isUsableApiKey('9f8e7d6c-1234-4abc-8def-0123456789ab:abcdef0123456789')).toBe(true);
    // Substring matches must NOT trip the guard.
    expect(isUsableApiKey('sk-changeme123')).toBe(true);
    expect(isUsableApiKey('sk-your-api-key-here-but-actually-real')).toBe(true);
    expect(isUsableApiKey('sk-xxxxQ7')).toBe(true);
    expect(isUsableApiKey('placeholder-9f8e7d6c')).toBe(true);
    // No format rule: a key that looks nothing like today's vendor prefixes is
    // still usable, because vendor prefixes change and this must not guess.
    expect(isUsableApiKey('abc')).toBe(true);
    expect(isUsableApiKey('1234567890')).toBe(true);
  });
});

// The gate composed with the predicate above: a placeholder key must read as
// UNCONFIGURED for that provider, which is what turns the observed 500 into the
// 409/501 pair the routes already implement.
describe('isImageGenConfigured with placeholder keys', () => {
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

  it('treats a placeholder OPENAI_API_KEY as unconfigured', () => {
    process.env.OPENAI_API_KEY = 'your-api-key-here';
    expect(isImageGenConfigured('openai')).toBe(false);
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(isImageGenConfigured('openai')).toBe(true);
  });

  it('treats a placeholder FAL_KEY as unconfigured, including via the env default', () => {
    process.env.FAL_KEY = 'your-api-key-here';
    expect(isImageGenConfigured('fal')).toBe(false);
    expect(isImageGenConfigured()).toBe(false); // default provider is fal
    process.env.FAL_KEY = '   ';
    expect(isImageGenConfigured()).toBe(false);
    process.env.FAL_KEY = 'fal-test';
    expect(isImageGenConfigured()).toBe(true);
  });

  // The 409-vs-501 distinction depends on exactly this: one provider usable,
  // the other only *present*.
  it('reports a placeholder-keyed provider as unconfigured while a real-keyed one stays configured', () => {
    process.env.IMAGE_PROVIDER = 'fal';
    process.env.FAL_KEY = 'fal-test';
    process.env.OPENAI_API_KEY = 'your-api-key-here';

    expect(isImageGenConfigured('openai')).toBe(false);
    expect(isImageGenConfigured('fal')).toBe(true);
    expect(isImageGenConfigured()).toBe(true);
  });
});

// Re-roll style consistency: the BOOK's pin decides which provider serves it,
// not IMAGE_PROVIDER. A book drawn on gpt-image-1 before the 2026-06-05 Fal
// cutover must keep re-rolling on gpt-image-1 even though the environment now
// defaults to Fal — that silent provider swap is the reported bug.
describe('pin-aware provider selection', () => {
  const BOOK_ID = 'luna-star-garden';
  const BASE_DIR = join(import.meta.dirname, '../../../public/illustrations', BOOK_ID);
  const ENV_KEYS = [
    'IMAGE_PROVIDER',
    'OPENAI_API_KEY',
    'FAL_KEY',
    'OPENAI_IMAGE_MODEL',
    'FAL_IMAGE_MODEL',
  ] as const;

  let originalFetch: typeof fetch;
  let originalEnv: Record<string, string | undefined>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await resetDatabase();
    originalFetch = globalThis.fetch;
    originalEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];

    // The environment default is Fal, with BOTH keys present: so if a pinned
    // book routed to the env default rather than its pin, the call would
    // succeed against the wrong provider instead of failing loudly.
    process.env.IMAGE_PROVIDER = 'fal';
    process.env.FAL_KEY = 'fal-test';
    process.env.OPENAI_API_KEY = 'sk-test';

    // Serve both provider response shapes off one mock, keyed on the URL.
    fetchMock = vi.fn(async (input: unknown) => {
      const u = typeof input === 'string' ? input : String(input);
      if (u.startsWith('https://api.openai.com/')) {
        return new Response(JSON.stringify({ data: [{ b64_json: FAKE_PNG_B64 }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
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
    for (const k of ENV_KEYS) {
      const v = originalEnv[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      await rm(BASE_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('getImageGenerator returns the pinned provider, overriding IMAGE_PROVIDER', () => {
    expect(getImageGenerator().name).toBe('fal');
    expect(getImageGenerator({ provider: 'openai', model: 'gpt-image-1' }).name).toBe('openai');
    expect(getImageGenerator({ provider: 'fal', model: 'fal-ai/flux-pro/v1.1' }).name).toBe('fal');
  });

  it('generates a pinned-openai book through the OpenAI endpoint with the pinned model', async () => {
    // The env model override points elsewhere: the pin must beat it, or a legacy
    // book would re-roll on whatever model the server is configured for today.
    process.env.OPENAI_IMAGE_MODEL = 'gpt-image-9';

    const url = await generateIllustration(
      BOOK_ID, 1, 'a scene', undefined, null, [], undefined,
      { pin: { provider: 'openai', model: 'gpt-image-1' } },
    );

    expect(url).toMatch(/^\/illustrations\/luna-star-garden\/page-1(-v\d+)?\.png$/);

    const [requestUrl, init] = fetchMock.mock.calls[0];
    expect(requestUrl).toBe('https://api.openai.com/v1/images/generations');
    const body = JSON.parse((init as { body: string }).body);
    expect(body.model).toBe('gpt-image-1');
    // Nothing was sent to Fal, despite IMAGE_PROVIDER=fal and FAL_KEY being set.
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain('fal.run');
    }
  });

  it('returns null without calling any provider when the PINNED provider is unconfigured', async () => {
    // Fal is configured and is the env default — the pre-pin code would have
    // happily generated here, on the wrong model. That is the bug.
    delete process.env.OPENAI_API_KEY;

    const url = await generateIllustration(
      BOOK_ID, 1, 'a scene', undefined, null, [], undefined,
      { pin: { provider: 'openai', model: 'gpt-image-1' } },
    );

    expect(url).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('threads the pin through generateCover and generateCharacterPortrait too', async () => {
    const pin = { provider: 'openai' as const, model: 'gpt-image-1' };

    await generateCover(BOOK_ID, 'Luna', 'a cover scene', null, [], undefined, { pin });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.openai.com/v1/images/generations');

    fetchMock.mockClear();
    await generateCharacterPortrait(BOOK_ID, 0, 'Luna', 'a purple cat', undefined, null, { pin });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.openai.com/v1/images/generations');
  });
});

// The pin carries a base model, and on the prompt-only path Fal must use it
// instead of FAL_IMAGE_MODEL. The reference-bearing path is deliberately NOT
// pin-driven: Kontext is the only Fal model that accepts an input image
// (ADR-007 dec 4), so the pin selects the provider family and the reference
// count still selects the model within it.
describe('FalImageGenerator base model from the pin', () => {
  const BOOK_ID = 'fal-pin-fixture-book';
  const BASE_DIR = join(import.meta.dirname, '../../../public/illustrations', BOOK_ID);
  const PORTRAIT = `/illustrations/${BOOK_ID}/portrait-1000.png`;
  const PINNED_MODEL = 'fal-ai/flux-pro/v1.1-ultra';

  let originalFetch: typeof fetch;
  let originalFalKey: string | undefined;
  let originalFalModel: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    originalFalKey = process.env.FAL_KEY;
    originalFalModel = process.env.FAL_IMAGE_MODEL;
    process.env.FAL_KEY = 'fal-test';
    delete process.env.FAL_IMAGE_MODEL;

    await mkdir(BASE_DIR, { recursive: true });
    await writeFile(join(BASE_DIR, 'portrait-1000.png'), Buffer.from(FAKE_PNG_B64, 'base64'));

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
    if (originalFalModel === undefined) delete process.env.FAL_IMAGE_MODEL;
    else process.env.FAL_IMAGE_MODEL = originalFalModel;
    try {
      await rm(BASE_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('posts to the constructor base model on the prompt-only path', async () => {
    await new FalImageGenerator(PINNED_MODEL).generate('a purple cat under the moon');

    expect(fetchMock.mock.calls[0][0]).toBe(`https://fal.run/${PINNED_MODEL}`);
  });

  it('beats FAL_IMAGE_MODEL when both are set', async () => {
    process.env.FAL_IMAGE_MODEL = 'fal-ai/flux-pro/v1.1';

    await new FalImageGenerator(PINNED_MODEL).generate('a purple cat under the moon');

    expect(fetchMock.mock.calls[0][0]).toBe(`https://fal.run/${PINNED_MODEL}`);
  });

  it('still routes to Kontext with exactly one reference, base model notwithstanding', async () => {
    await new FalImageGenerator(PINNED_MODEL).generate('a hero on a hill', {
      referenceImages: [PORTRAIT],
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://fal.run/fal-ai/flux-pro/kontext');
    const body = JSON.parse((init as { body: string }).body);
    expect(body.image_url).toMatch(/^data:image\/png;base64,/);
  });

  it('falls back to FAL_IMAGE_MODEL then the default when no base model is pinned', async () => {
    // Unpinned construction is exactly today's behaviour — this is the
    // regression guard for callers that pass no pin at all.
    await new FalImageGenerator().generate('a purple cat under the moon');

    expect(fetchMock.mock.calls[0][0]).toBe('https://fal.run/fal-ai/flux-pro/v1.1');
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
