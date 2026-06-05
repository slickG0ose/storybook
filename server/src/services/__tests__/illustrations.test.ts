import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm } from 'fs/promises';
import { join } from 'path';
import prisma from '../../db/prisma';
import { resetDatabase } from '../../__tests__/setup';
import { generateIllustration, generateCover, isImageGenConfigured } from '../illustrations';

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
