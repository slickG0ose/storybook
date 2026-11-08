import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FalKokoroSynthesizer, wavDurationMs } from '../falKokoro';
import { NarrationSynthesisError, isNarrationConfigured, getNarrationSynthesizer } from '../synthesizer';

// No live fal call anywhere: fetch is stubbed per test. Green here proves the
// wiring of the pinned contract, not that Kokoro responds this way today.

const FIXTURE = readFileSync(join(__dirname, 'fixtures', 'silence-100ms.wav'));
const KEY = 'fal-secret-key-123';
const AUDIO_URL = 'https://v3.fal.media/files/abc/clip.wav';

function runResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** fetch stub: leg 1 returns `run`, leg 2 returns `download`. */
function stubFetch(run: Response, download?: Response) {
  const mock = vi.fn().mockResolvedValueOnce(run);
  if (download) mock.mockResolvedValueOnce(download);
  vi.stubGlobal('fetch', mock);
  return mock;
}

async function expectSynthError(p: Promise<unknown>, pattern?: RegExp): Promise<NarrationSynthesisError> {
  const err = await p.then(
    () => { throw new Error('expected rejection'); },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(NarrationSynthesisError);
  const e = err as NarrationSynthesisError;
  expect(e.message).not.toContain(KEY);
  if (pattern) expect(e.message).toMatch(pattern);
  return e;
}

describe('FalKokoroSynthesizer', () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.FAL_KEY;
    process.env.FAL_KEY = KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = originalKey;
  });

  it('pins the request contract and returns the downloaded WAV bytes', async () => {
    const mock = stubFetch(runResponse({ audio: { url: AUDIO_URL } }), new Response(FIXTURE));

    const bytes = await new FalKokoroSynthesizer().synthesize('Once upon a time.', 'af_heart');

    expect(bytes.equals(FIXTURE)).toBe(true);
    expect(mock).toHaveBeenCalledTimes(2);

    const [url, init] = mock.mock.calls[0];
    expect(url).toBe('https://fal.run/fal-ai/kokoro/american-english');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Authorization': `Key ${KEY}`,
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: 'Once upon a time.',
      voice: 'af_heart',
      speed: 1,
    });

    const [dlUrl, dlInit] = mock.mock.calls[1];
    expect(dlUrl).toBe(AUDIO_URL);
    // The key never travels to the vendor-supplied download URL.
    expect(dlInit?.headers).toBeUndefined();
    expect(dlInit?.redirect).toBe('error');
  });

  it('accepts the bare fal.media host', async () => {
    stubFetch(runResponse({ audio: { url: 'https://fal.media/files/x.wav' } }), new Response(FIXTURE));
    const bytes = await new FalKokoroSynthesizer().synthesize('Hi.', 'am_michael');
    expect(bytes.equals(FIXTURE)).toBe(true);
  });

  it('maps a non-2xx run to NarrationSynthesisError without leaking the key', async () => {
    stubFetch(new Response(`bad key ${KEY}`, { status: 401 }));
    await expectSynthError(new FalKokoroSynthesizer().synthesize('x', 'af_heart'), /401/);
  });

  it('maps a missing audio.url to NarrationSynthesisError', async () => {
    stubFetch(runResponse({ audio: {} }));
    await expectSynthError(new FalKokoroSynthesizer().synthesize('x', 'af_heart'), /audio\.url/);
  });

  it('refuses a non-fal download host', async () => {
    const mock = stubFetch(runResponse({ audio: { url: 'https://evil.example/fal.media/x.wav' } }));
    await expectSynthError(new FalKokoroSynthesizer().synthesize('x', 'af_heart'), /host/);
    // A lookalike suffix is not a subdomain.
    mock.mockResolvedValueOnce(runResponse({ audio: { url: 'https://notfal.media/x.wav' } }));
    await expectSynthError(new FalKokoroSynthesizer().synthesize('x', 'af_heart'), /host/);
    expect(mock).toHaveBeenCalledTimes(2); // never downloaded either
  });

  it('refuses an http: download URL', async () => {
    const mock = stubFetch(runResponse({ audio: { url: 'http://v3.fal.media/x.wav' } }));
    await expectSynthError(new FalKokoroSynthesizer().synthesize('x', 'af_heart'), /https/);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('refuses an oversize body (streamed, no content-length)', async () => {
    stubFetch(runResponse({ audio: { url: AUDIO_URL } }), new Response(FIXTURE));
    await expectSynthError(
      new FalKokoroSynthesizer({ maxBytes: 1000 }).synthesize('x', 'af_heart'),
      /exceeds 1000 bytes/,
    );
  });

  it('refuses an oversize body declared by content-length', async () => {
    stubFetch(
      runResponse({ audio: { url: AUDIO_URL } }),
      new Response(FIXTURE, { headers: { 'Content-Length': String(6 * 1024 * 1024) } }),
    );
    await expectSynthError(new FalKokoroSynthesizer().synthesize('x', 'af_heart'), /exceeds/);
  });

  it('refuses non-WAV bytes', async () => {
    stubFetch(runResponse({ audio: { url: AUDIO_URL } }), new Response('<html>nope</html>'));
    await expectSynthError(new FalKokoroSynthesizer().synthesize('x', 'af_heart'), /RIFF\/WAVE/);
  });

  it('maps a hung leg to a timeout NarrationSynthesisError', async () => {
    // fetch that only settles when aborted, the way undici behaves.
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => {
          reject(Object.assign(new Error(`aborted ${KEY}`), { name: 'AbortError' }));
        });
      }),
    ));
    await expectSynthError(
      new FalKokoroSynthesizer({ timeoutMs: 20 }).synthesize('x', 'af_heart'),
      /run timed out/,
    );
  });

  it('maps a network error to NarrationSynthesisError with the key redacted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`connect failed Key ${KEY}`)));
    const err = await expectSynthError(new FalKokoroSynthesizer().synthesize('x', 'af_heart'));
    expect(err.message).toContain('[redacted]');
  });

  it('fails without calling fetch when FAL_KEY is unset', async () => {
    delete process.env.FAL_KEY;
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    await expect(new FalKokoroSynthesizer().synthesize('x', 'af_heart'))
      .rejects.toBeInstanceOf(NarrationSynthesisError);
    expect(mock).not.toHaveBeenCalled();
  });

  it('getNarrationSynthesizer returns the fal adapter', () => {
    expect(getNarrationSynthesizer()).toBeInstanceOf(FalKokoroSynthesizer);
  });
});

describe('wavDurationMs', () => {
  it('reads 100 ms from the committed fixture', () => {
    expect(wavDurationMs(FIXTURE)).toBe(100);
  });

  it('clamps a streaming-writer data size to the bytes present', () => {
    const copy = Buffer.from(FIXTURE);
    copy.writeUInt32LE(0xffffffff, 40);
    expect(wavDurationMs(copy)).toBe(100);
  });

  it('throws NarrationSynthesisError on non-WAV bytes', () => {
    expect(() => wavDurationMs(Buffer.from('not a wav'))).toThrow(NarrationSynthesisError);
  });
});

describe('isNarrationConfigured', () => {
  const saved = {
    FAL_KEY: process.env.FAL_KEY,
    NODE_ENV: process.env.NODE_ENV,
    STORAGE_BACKEND: process.env.STORAGE_BACKEND,
  };

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function set(key: string | undefined, nodeEnv: string, backend: string | undefined) {
    if (key === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = key;
    process.env.NODE_ENV = nodeEnv;
    if (backend === undefined) delete process.env.STORAGE_BACKEND;
    else process.env.STORAGE_BACKEND = backend;
  }

  it('no usable key → false (absent or template filler)', () => {
    set(undefined, 'development', undefined);
    expect(isNarrationConfigured()).toBe(false);
    set('your-api-key-here', 'development', undefined);
    expect(isNarrationConfigured()).toBe(false);
  });

  it('key + non-production → true on local storage', () => {
    set(KEY, 'development', undefined);
    expect(isNarrationConfigured()).toBe(true);
  });

  it('key + production + local storage → false', () => {
    set(KEY, 'production', 'local');
    expect(isNarrationConfigured()).toBe(false);
  });

  it('key + production + r2 → true', () => {
    set(KEY, 'production', 'r2');
    expect(isNarrationConfigured()).toBe(true);
  });

  it('key + production + invalid STORAGE_BACKEND → false, not a throw', () => {
    set(KEY, 'production', 'bogus');
    expect(isNarrationConfigured()).toBe(false);
  });
});
