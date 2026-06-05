import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FalImageGenerator } from '../fal';

// A 1x1 transparent PNG, base64-encoded — minimal valid image bytes that stand
// in for what Fal's image-download leg returns.
const FAKE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('FalImageGenerator', () => {
  let originalFetch: typeof fetch;
  let originalFalKey: string | undefined;
  let originalModel: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalFalKey = process.env.FAL_KEY;
    originalModel = process.env.FAL_IMAGE_MODEL;
    process.env.FAL_KEY = 'fal-test';
    delete process.env.FAL_IMAGE_MODEL; // exercise the default model id
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('FAL_KEY', originalFalKey);
    restore('FAL_IMAGE_MODEL', originalModel);
  });

  it('returns the downloaded image bytes from images[0].url', async () => {
    const expected = Buffer.from(FAKE_PNG_B64, 'base64');
    const fetchMock = vi.fn()
      // 1st call: the synchronous Fal run -> Fal-shaped JSON.
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ images: [{ url: 'https://fal.example/img.png' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      // 2nd call: download the image URL -> raw bytes.
      .mockResolvedValueOnce(new Response(expected, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const buffer = await new FalImageGenerator().generate('a purple cat under the moon');

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.equals(expected)).toBe(true);

    // Pins the request contract: fal.run + default model id, Key auth header,
    // prompt + square size in the body.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://fal.run/fal-ai/flux-pro/v1.1');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Key fal-test');
    const body = JSON.parse(init.body as string);
    expect(body.prompt).toBe('a purple cat under the moon');
    expect(body.image_size).toBe('square_hd');
    // 2nd fetch downloads the parsed url.
    expect(fetchMock.mock.calls[1][0]).toBe('https://fal.example/img.png');
  });

  it('honors FAL_IMAGE_MODEL override in the request URL', async () => {
    process.env.FAL_IMAGE_MODEL = 'fal-ai/flux-pro/v1.1-ultra';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ images: [{ url: 'https://fal.example/img.png' }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(Buffer.from(FAKE_PNG_B64, 'base64'), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await new FalImageGenerator().generate('prompt');

    expect(fetchMock.mock.calls[0][0]).toBe('https://fal.run/fal-ai/flux-pro/v1.1-ultra');
  });

  it('throws with status + snippet on a non-ok run response', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }),
    ) as unknown as typeof fetch;

    await expect(new FalImageGenerator().generate('prompt')).rejects.toThrow(
      /Fal image API returned 429.*rate limited/,
    );
  });

  it('throws when the response has no images', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ images: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    await expect(new FalImageGenerator().generate('prompt')).rejects.toThrow(
      /no images entries/,
    );
  });

  it('throws when the first image has no url', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ images: [{}] }), { status: 200 }),
    ) as unknown as typeof fetch;

    await expect(new FalImageGenerator().generate('prompt')).rejects.toThrow(
      /no image url/,
    );
  });

  it('throws when the image download fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ images: [{ url: 'https://fal.example/img.png' }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('nope', { status: 404, statusText: 'Not Found' }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(new FalImageGenerator().generate('prompt')).rejects.toThrow(
      /Failed to download generated image: 404/,
    );
  });
});
