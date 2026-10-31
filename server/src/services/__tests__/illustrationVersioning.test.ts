import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { StorageBackend } from '../storage';

// Under STORAGE_BACKEND=r2, list() is a network call. If a transient listing
// failure were mapped to "version 1", the next put() would silently overwrite
// page-N.png / portrait-N.png — the wrong-answer failure ADR-027 chose the SDK
// to avoid. These tests pin that a listing failure propagates and nothing is
// written. A fake backend stands in for R2; no network, no credential.
const fake = {
  put: vi.fn<StorageBackend['put']>(),
  get: vi.fn<StorageBackend['get']>(),
  head: vi.fn<StorageBackend['head']>(),
  list: vi.fn<StorageBackend['list']>(),
  remove: vi.fn<StorageBackend['remove']>(),
};

vi.mock('../storage', async importOriginal => ({
  ...(await importOriginal<typeof import('../storage')>()),
  getStorage: () => fake,
}));

const { generateIllustration, generateCharacterPortrait } = await import('../illustrations');

const FAKE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('version numbering when the storage listing fails', () => {
  let originalFetch: typeof fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    Object.values(fake).forEach(fn => fn.mockReset());
    fake.list.mockRejectedValue(Object.assign(new Error('socket hang up'), { name: 'TimeoutError' }));
    originalFetch = globalThis.fetch;
    process.env.IMAGE_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ b64_json: FAKE_PNG_B64 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it('a page regenerate rejects instead of overwriting page-N.png', async () => {
    await expect(generateIllustration('book-x', 2, 'a fox in the snow')).rejects.toThrow('socket hang up');
    expect(fake.put).not.toHaveBeenCalled();
  });

  it('a portrait regenerate rejects instead of overwriting portrait-N.png', async () => {
    await expect(
      generateCharacterPortrait('book-x', 0, 'Luna', 'a curious purple cat'),
    ).rejects.toThrow('socket hang up');
    expect(fake.put).not.toHaveBeenCalled();
  });

  it('a missing book prefix (empty listing) still yields version 1', async () => {
    fake.list.mockResolvedValue([]);
    fake.put.mockResolvedValue();
    // The DB write after put() may fail for an unknown book; only the key matters here.
    await generateIllustration('book-x', 2, 'a fox in the snow').catch(() => {});
    expect(fake.put).toHaveBeenCalledWith('book-x/page-2.png', expect.any(Buffer), 'image/png');
  });
});
