import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { illustrationRedirect } from '../illustrationRedirect';
import { __resetStorageForTests } from '../../services/storage';

// Spec §Verification 3 / ADR-026: /illustrations serves from disk first and,
// under STORAGE_BACKEND=r2, 302s a disk miss to R2_PUBLIC_BASE_URL. The handler
// never constructs an S3 client, so no network and no credential is involved —
// the R2_* values below are placeholders that only satisfy readR2Config().

const PUBLIC_BASE = 'https://pub-test.r2.dev';
const R2_ENV = {
  STORAGE_BACKEND: 'r2',
  R2_ACCOUNT_ID: 'acct',
  R2_BUCKET: 'bucket',
  R2_ACCESS_KEY_ID: 'akid',
  R2_SECRET_ACCESS_KEY: 'placeholder-not-a-secret',
  R2_PUBLIC_BASE_URL: `${PUBLIC_BASE}/`, // trailing slash is stripped by readR2Config
};

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let root: string;

// Mirrors the index.ts mount: static first, redirect fallback second.
function buildApp() {
  const app = express();
  app.use('/illustrations', express.static(root), illustrationRedirect);
  return app;
}

function stubEnv(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  __resetStorageForTests();
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'illustration-redirect-'));
  await mkdir(join(root, 'book-on-disk'), { recursive: true });
  await writeFile(join(root, 'book-on-disk', 'page-1-v1.png'), PNG_BYTES);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  __resetStorageForTests();
});

describe('/illustrations under STORAGE_BACKEND=r2', () => {
  beforeEach(() => stubEnv(R2_ENV));

  it('a key absent from disk answers 302 to R2_PUBLIC_BASE_URL/<key>', async () => {
    const res = await request(buildApp()).get('/illustrations/book-in-r2/page-4-v2.png');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${PUBLIC_BASE}/book-in-r2/page-4-v2.png`);
  });

  it('a key present on disk still answers 200 with the bytes', async () => {
    const res = await request(buildApp()).get('/illustrations/book-on-disk/page-1-v1.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(res.body as Buffer, PNG_BYTES)).toBe(0);
  });

  it('percent-encodes each segment and never leaves the R2 host', async () => {
    const res = await request(buildApp()).get('/illustrations/book%20x/a%3Fb%23c.png');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${PUBLIC_BASE}/book%20x/a%3Fb%23c.png`);

    // A path that tries to look like a scheme-relative URL stays on the R2 host.
    const sneaky = await request(buildApp()).get('/illustrations/%2F%2Fevil.example/x.png');
    expect(sneaky.status).toBe(404);
  });

  it.each([
    '/illustrations/..%2F..%2Fetc%2Fpasswd',
    '/illustrations/book%5C..%5Cx.png',
    '/illustrations/%E0%A4%A', // malformed escape
    '/illustrations/',
  ])('an invalid key %s is a 404, never a redirect', async url => {
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(404);
    expect(res.headers.location).toBeUndefined();
  });

  it('non-GET methods are not redirected', async () => {
    const res = await request(buildApp()).post('/illustrations/book-in-r2/page-4-v2.png');
    expect(res.status).toBe(404);
    expect(res.headers.location).toBeUndefined();
  });
});

describe('/illustrations under the default local backend', () => {
  beforeEach(() => {
    vi.stubEnv('STORAGE_BACKEND', '');
    __resetStorageForTests();
  });

  it('a disk miss is a plain 404 — unchanged from before the seam', async () => {
    const res = await request(buildApp()).get('/illustrations/book-in-r2/page-4-v2.png');
    expect(res.status).toBe(404);
    expect(res.headers.location).toBeUndefined();
  });

  it('a disk hit is a 200 with the bytes', async () => {
    const res = await request(buildApp()).get('/illustrations/book-on-disk/page-1-v1.png');
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, PNG_BYTES)).toBe(0);
  });
});
