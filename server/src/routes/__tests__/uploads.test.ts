import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { rm } from 'fs/promises';
import { join } from 'path';
import { createTestApp } from '../../__tests__/setup';

// Stub the Anthropic SDK at the module boundary, as books/generate do. The
// style-reference route asks Claude to describe the uploaded image; nothing
// here may leave the process.
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: (...args: unknown[]) => mockCreate(...args) };
  }
  return { default: MockAnthropic };
});

// A 1x1 transparent PNG — the smallest thing multer's filter will accept.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const UPLOADS_DIR = join(import.meta.dirname, '../../../public/uploads/style-refs');

// Files this suite wrote, recorded the moment the response lands and BEFORE
// any assertion can throw. Tracking after an `expect` would leak the file on
// exactly the runs that matter — a failing one.
const written: string[] = [];

async function uploadPng(app: Express) {
  const res = await request(app)
    .post('/api/uploads/style-reference')
    .attach('image', PNG_BYTES, { filename: 'style.png', contentType: 'image/png' });
  const url: unknown = res.body?.url;
  if (typeof url === 'string') written.push(url.split('/').pop() as string);
  return res;
}

describe('POST /api/uploads/style-reference — ANTHROPIC_API_KEY config gate', () => {
  let app: Express;

  beforeEach(() => {
    app = createTestApp();
    mockCreate.mockReset();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    // The route writes a real file per request. Remove only the ones this
    // suite created — the directory is shared with the dev server's uploads.
    for (const filename of written.splice(0)) {
      await rm(join(UPLOADS_DIR, filename), { force: true });
    }
  });

  it('uploads with a null descriptor when the key is unset (the oracle)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', undefined);

    const res = await uploadPng(app);

    // Wire shape for this route's 200: the client reads both fields, and
    // `descriptor: null` is a legitimate success, not an error.
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      url: expect.any(String),
      descriptor: null,
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['your-api-key-here', 'the .env.example literal'],
    ['CHANGEME', 'the other common filler'],
  ])('treats a placeholder key (%s — %s) exactly like an unset one', async (key) => {
    vi.stubEnv('ANTHROPIC_API_KEY', key);

    const res = await uploadPng(app);

    // Before the guard this reached Anthropic, came back 401, and the catch
    // block turned a perfectly good upload into a 500. Describing the style is
    // best-effort; storing the file is not, and must still succeed.
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      url: expect.any(String),
      descriptor: null,
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('still asks Claude for a descriptor when the key looks real', async () => {
    // The false-positive guard: a key containing a filler word is still a key,
    // and rejecting it would silently drop a feature the user is paying for.
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-changeme123');
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Soft watercolor with a muted palette.' }],
    });

    const res = await uploadPng(app);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      url: expect.any(String),
      descriptor: 'Soft watercolor with a muted palette.',
    });
    expect(mockCreate).toHaveBeenCalled();
  });
});
