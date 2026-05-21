import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm } from 'fs/promises';
import { join } from 'path';
import prisma from '../../db/prisma';
import { resetDatabase } from '../../__tests__/setup';
import { generateIllustration } from '../illustrations';

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

  beforeEach(async () => {
    await resetDatabase();
    originalFetch = globalThis.fetch;
    originalApiKey = process.env.OPENAI_API_KEY;
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
