import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';

// Serving for /illustrations and /uploads (#237, decisions 1 and 6 stage 1).
// Ports the assertions from the deleted illustrationRedirect.test.ts: the
// Location is now a presigned URL, not R2_PUBLIC_BASE_URL/<key>. Nothing
// reaches R2: S3Client and getSignedUrl are mocked.

const { getSignedUrl } = vi.hoisted(() => ({ getSignedUrl: vi.fn() }));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl }));
vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(public input: Record<string, unknown>) {}
  }
  return {
    S3Client: class {
      send = vi.fn();
    },
    PutObjectCommand: class extends Command {},
    GetObjectCommand: class GetObjectCommand extends Command {},
    HeadObjectCommand: class extends Command {},
    ListObjectsV2Command: class extends Command {},
    DeleteObjectsCommand: class extends Command {},
  };
});

const {
  mountMedia,
  getLenientMediaCount,
  __resetLenientMediaCountForTests,
  resolveMediaRateLimit,
  DEFAULT_MEDIA_RATE_LIMIT_PER_MINUTE,
  MEDIA_RATE_LIMIT_ERROR,
} = await import('../media');
const { signMediaPath, mediaWindow, __resetMediaConfigForTests, getMediaConfig } = await import('../../lib/mediaUrl');
const { __resetStorageForTests, ILLUSTRATIONS_DIR, UPLOADS_DIR } = await import('../../services/storage');

const PRESIGNED = 'https://acct.r2.cloudflarestorage.com/bucket/signed-object?X-Amz-Signature=mock';
const R2_ENV = {
  STORAGE_BACKEND: 'r2',
  R2_ACCOUNT_ID: 'acct',
  R2_BUCKET: 'bucket',
  R2_ACCESS_KEY_ID: 'akid',
  R2_SECRET_ACCESS_KEY: 'placeholder-not-a-secret',
};
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const TAG = `media-test-${process.pid}`;
const ILL_PATH = `/illustrations/${TAG}/page-1-v1.png`;
const UP_PATH = `/uploads/${TAG}/ref.png`;

function buildApp() {
  const app = express();
  mountMedia(app);
  return app;
}

function setMode(mode: string | undefined, backend: 'local' | 'r2' = 'local') {
  vi.stubEnv('MEDIA_URL_MODE', mode ?? '');
  vi.stubEnv('STORAGE_BACKEND', '');
  if (backend === 'r2') for (const [k, v] of Object.entries(R2_ENV)) vi.stubEnv(k, v);
  __resetMediaConfigForTests();
  __resetStorageForTests();
}

const maxAgeOf = (cc: string | undefined) => Number(/max-age=(\d+)/.exec(cc ?? '')?.[1]);

beforeEach(async () => {
  await mkdir(join(ILLUSTRATIONS_DIR, TAG), { recursive: true });
  await writeFile(join(ILLUSTRATIONS_DIR, TAG, 'page-1-v1.png'), PNG_BYTES);
  await mkdir(join(UPLOADS_DIR, TAG), { recursive: true });
  await writeFile(join(UPLOADS_DIR, TAG, 'ref.png'), PNG_BYTES);
  getSignedUrl.mockReset();
  getSignedUrl.mockResolvedValue(PRESIGNED);
  __resetLenientMediaCountForTests();
});

afterEach(async () => {
  await rm(join(ILLUSTRATIONS_DIR, TAG), { recursive: true, force: true });
  await rm(join(UPLOADS_DIR, TAG), { recursive: true, force: true });
  vi.useRealTimers();
  vi.unstubAllEnvs();
  __resetMediaConfigForTests();
  __resetStorageForTests();
});

describe('enforce, local backend', () => {
  beforeEach(() => setMode('enforce'));

  it('a signed illustration is 200 with the bytes and a private, bounded max-age', async () => {
    const res = await request(buildApp()).get(signMediaPath(ILL_PATH));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(res.body as Buffer, PNG_BYTES)).toBe(0);
    expect(res.headers['cache-control']).toMatch(/^private, max-age=\d+$/);
    const age = maxAgeOf(res.headers['cache-control']);
    expect(age).toBeGreaterThan(0);
    expect(age).toBeLessThanOrEqual(2 * getMediaConfig().ttlMinutes * 60);
  });

  it('a signed upload is 200 the same way', async () => {
    const res = await request(buildApp()).get(signMediaPath(UP_PATH));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/^private, max-age=\d+$/);
  });

  it('an unsigned request is 403 with no-store and an error envelope', async () => {
    const res = await request(buildApp()).get(ILL_PATH);
    expect(res.status).toBe(403);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it('an expired link is 403', async () => {
    const old = new Date(Date.now() - 3 * 3600 * 1000);
    const res = await request(buildApp()).get(signMediaPath(ILL_PATH, old));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it('a link is bound to its root and key', async () => {
    const signed = signMediaPath(ILL_PATH);
    const asUpload = signed.replace('/illustrations/', '/uploads/');
    expect((await request(buildApp()).get(asUpload)).status).toBe(403);
    const otherKey = signed.replace('page-1-v1', 'page-2-v1');
    expect((await request(buildApp()).get(otherKey)).status).toBe(403);
    const tampered = signed.replace(/s=./, 's=A');
    expect((await request(buildApp()).get(tampered)).status).toBe(403);
  });

  it('HEAD works on a signed link', async () => {
    const res = await request(buildApp()).head(signMediaPath(ILL_PATH));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
  });

  it('a Range request is served from disk as 206', async () => {
    const res = await request(buildApp()).get(signMediaPath(ILL_PATH)).set('Range', 'bytes=0-3');
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-3/${PNG_BYTES.length}`);
  });

  it('a signed disk miss is a plain 404 under the local backend', async () => {
    const res = await request(buildApp()).get(signMediaPath(`/illustrations/${TAG}/absent.png`));
    expect(res.status).toBe(404);
    expect(res.headers.location).toBeUndefined();
  });

  it('uploads/ is refused under /illustrations (never signed, never served)', async () => {
    expect(signMediaPath(`/illustrations/uploads/${TAG}/ref.png`)).toBe(`/illustrations/uploads/${TAG}/ref.png`);
    const res = await request(buildApp()).get(`/illustrations/uploads/${TAG}/ref.png`);
    expect(res.status).toBe(403);
  });

  it('non-GET methods fall through to the default 404', async () => {
    const res = await request(buildApp()).post(signMediaPath(ILL_PATH));
    expect(res.status).toBe(404);
  });

  it('an unset MEDIA_URL_MODE is enforce', async () => {
    setMode(undefined);
    expect((await request(buildApp()).get(ILL_PATH)).status).toBe(403);
  });
});

describe('lenient, local backend', () => {
  beforeEach(() => setMode('lenient'));

  it('an unsigned illustration is 200 with the bytes and the default cache header', async () => {
    const res = await request(buildApp()).get(ILL_PATH);
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, PNG_BYTES)).toBe(0);
    expect(res.headers['cache-control']).not.toMatch(/private/);
  });

  it('an unsigned upload is 200', async () => {
    expect((await request(buildApp()).get(UP_PATH)).status).toBe(200);
  });

  it('counts each unsigned or invalid request, and not a valid one', async () => {
    await request(buildApp()).get(ILL_PATH);
    await request(buildApp()).get(`${ILL_PATH}?e=1&s=junk`);
    await request(buildApp()).get(signMediaPath(ILL_PATH));
    expect(getLenientMediaCount()).toBe(2);
  });

  it('a signed request is still 200 with a private max-age', async () => {
    const res = await request(buildApp()).get(signMediaPath(ILL_PATH));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/^private, max-age=\d+$/);
  });

  it('a disk miss is a plain 404 under the local backend, unchanged from before', async () => {
    const res = await request(buildApp()).get(`/illustrations/${TAG}/absent.png`);
    expect(res.status).toBe(404);
    expect(res.headers.location).toBeUndefined();
  });
});

describe('r2 backend, lenient (rollout stage 1: unsigned disk miss redirects)', () => {
  beforeEach(() => setMode('lenient', 'r2'));

  it('a key absent from disk is 302 to the presigned URL, with the current window', async () => {
    const now = new Date('2026-11-16T10:30:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const res = await request(buildApp()).get('/illustrations/book-in-r2/page-4-v2.png');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(PRESIGNED);
    const w = mediaWindow(now, getMediaConfig().ttlMinutes);
    const [, command, opts] = getSignedUrl.mock.calls[0];
    expect((command as { input: unknown }).input).toEqual({ Bucket: 'bucket', Key: 'book-in-r2/page-4-v2.png' });
    expect(opts).toEqual({ signingDate: w.windowStart, expiresIn: 2 * 3600 });
    expect(res.headers['cache-control']).toBeUndefined();
  });

  it('a key present on disk is still 200 and never presigned', async () => {
    const res = await request(buildApp()).get(ILL_PATH);
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, PNG_BYTES)).toBe(0);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('presigns each decoded key (the signer encodes), and the Location is only ever the signer output', async () => {
    const res = await request(buildApp()).get('/illustrations/book%20x/a%3Fb%23c.png');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(PRESIGNED);
    expect((getSignedUrl.mock.calls[0][1] as { input: { Key: string } }).input.Key).toBe('book x/a?b#c.png');

    const sneaky = await request(buildApp()).get('/illustrations/%2F%2Fevil.example/x.png');
    expect(sneaky.status).toBe(404);
    expect(sneaky.headers.location).toBeUndefined();
  });

  it.each([
    '/illustrations/..%2F..%2Fetc%2Fpasswd',
    '/illustrations/book%5C..%5Cx.png',
    '/illustrations/%E0%A4%A', // malformed escape
    '/illustrations/',
    '/uploads/..%2Fsecret.png',
  ])('an invalid key %s is a 404, never a redirect', async url => {
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(404);
    expect(res.headers.location).toBeUndefined();
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('an uploads/ key under /illustrations is never presigned', async () => {
    const res = await request(buildApp()).get('/illustrations/uploads/someone/ref.png');
    expect(res.status).toBe(404);
    expect(res.headers.location).toBeUndefined();
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('/uploads presigns with the uploads/ prefix on the key', async () => {
    const res = await request(buildApp()).get('/uploads/style-refs/gone.png');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(PRESIGNED);
    expect((getSignedUrl.mock.calls[0][1] as { input: { Key: string } }).input.Key).toBe('uploads/style-refs/gone.png');
  });

  it('non-GET methods are not redirected', async () => {
    const res = await request(buildApp()).post('/illustrations/book-in-r2/page-4-v2.png');
    expect(res.status).toBe(404);
    expect(res.headers.location).toBeUndefined();
  });

  it('HEAD redirects too', async () => {
    const res = await request(buildApp()).head('/illustrations/book-in-r2/page-4-v2.png');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(PRESIGNED);
  });
});

describe('r2 backend, enforce', () => {
  beforeEach(() => setMode('enforce', 'r2'));

  it('a signed disk miss is 302 expiring exactly when the link does, with a matching max-age', async () => {
    const now = new Date('2026-11-16T10:30:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    // Signed in the previous window: e = start(09:00) + 2h = 11:00; the current window starts 10:00.
    const earlier = new Date('2026-11-16T09:30:00Z');
    const signed = signMediaPath('/illustrations/book-in-r2/page-4-v2.png', earlier);
    const res = await request(buildApp()).get(signed);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(PRESIGNED);
    const e = Number(/e=(\d+)/.exec(signed)![1]);
    const w = mediaWindow(now, getMediaConfig().ttlMinutes);
    const opts = getSignedUrl.mock.calls[0][2];
    expect(opts).toEqual({ signingDate: w.windowStart, expiresIn: e - w.windowStart.getTime() / 1000 });
    expect(opts.expiresIn).toBe(3600);
    expect(res.headers['cache-control']).toBe(`private, max-age=${e - now.getTime() / 1000}`);
  });

  it('an unsigned disk miss is 403 and never presigned', async () => {
    const res = await request(buildApp()).get('/illustrations/book-in-r2/page-4-v2.png');
    expect(res.status).toBe(403);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers.location).toBeUndefined();
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('a signed /uploads miss presigns uploads/<key>', async () => {
    const res = await request(buildApp()).get(signMediaPath('/uploads/style-refs/gone.png'));
    expect(res.status).toBe(302);
    expect((getSignedUrl.mock.calls[0][1] as { input: { Key: string } }).input.Key).toBe('uploads/style-refs/gone.png');
  });

  it('an invalid key is 403 and never a redirect', async () => {
    const res = await request(buildApp()).get('/illustrations/..%2F..%2Fetc%2Fpasswd');
    expect(res.status).toBe(403);
    expect(res.headers.location).toBeUndefined();
    expect(getSignedUrl).not.toHaveBeenCalled();
  });
});

describe('per-IP rate limit (spec amendment 2026-11-17, CodeQL alert #41)', () => {
  beforeEach(() => setMode('enforce'));

  it('answers 429 with no-store and the error envelope once the budget is spent', async () => {
    vi.stubEnv('MEDIA_RATE_LIMIT_PER_MINUTE', '60');
    const app = buildApp();
    const url = signMediaPath(ILL_PATH);
    for (let i = 0; i < 60; i++) expect((await request(app).get(url)).status).toBe(200);
    const res = await request(app).get(url);
    expect(res.status).toBe(429);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ error: MEDIA_RATE_LIMIT_ERROR });
    expect(res.headers['ratelimit-policy']).toBeDefined();
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('is one budget across /illustrations and /uploads', async () => {
    vi.stubEnv('MEDIA_RATE_LIMIT_PER_MINUTE', '60');
    const app = buildApp();
    for (let i = 0; i < 60; i++) expect((await request(app).get(signMediaPath(ILL_PATH))).status).toBe(200);
    expect((await request(app).get(signMediaPath(UP_PATH))).status).toBe(429);
  });

  it('counts requests before the signature gate, so bad links spend the budget too', async () => {
    vi.stubEnv('MEDIA_RATE_LIMIT_PER_MINUTE', '60');
    const app = buildApp();
    for (let i = 0; i < 60; i++) expect((await request(app).get(ILL_PATH)).status).toBe(403);
    expect((await request(app).get(signMediaPath(ILL_PATH))).status).toBe(429);
  });

  it('defaults to 600 and falls back to it, with one warning naming the variable, on a bad value', () => {
    expect(resolveMediaRateLimit({})).toBe(DEFAULT_MEDIA_RATE_LIMIT_PER_MINUTE);
    expect(DEFAULT_MEDIA_RATE_LIMIT_PER_MINUTE).toBe(600);
    expect(resolveMediaRateLimit({ MEDIA_RATE_LIMIT_PER_MINUTE: ' 1200 ' })).toBe(1200);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const bad of ['59', '100001', '0', '-5', '1.5', 'abc', '600/min']) {
      expect(resolveMediaRateLimit({ MEDIA_RATE_LIMIT_PER_MINUTE: bad })).toBe(600);
    }
    expect(warn).toHaveBeenCalledTimes(7);
    for (const [msg] of warn.mock.calls) expect(String(msg)).toContain('MEDIA_RATE_LIMIT_PER_MINUTE');
    warn.mockRestore();
  });
});
