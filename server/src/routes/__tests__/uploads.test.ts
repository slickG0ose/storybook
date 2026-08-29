import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { rm } from 'fs/promises';
import { join } from 'path';
import { createTestApp, allowEmail, resetDatabase } from '../../__tests__/setup';
import prisma from '../../db/prisma';
import { COST_CENTS } from '../../services/spend';
import { resetRateLimits } from '../../middleware/rateLimit';

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

/**
 * Register a fresh allowlisted user and return its token and id. Registration is
 * closed by default, so the address is opted in first — deliberately not a bypass
 * flag, so a test that forgets it fails exactly like a real un-allowlisted signup.
 */
async function createUserAndGetToken(
  app: Express,
  role: 'user' | 'admin' = 'user',
): Promise<{ token: string; userId: string }> {
  const email = `upload-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await allowEmail(email);
  const reg = await request(app).post('/api/auth/register').send({
    email,
    name: 'Upload Tester',
    password: 'test-password',
  });
  if (role === 'admin') {
    await prisma.user.update({ where: { email }, data: { role: 'admin' } });
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { token: reg.body.token as string, userId: user.id };
}

/** `token` omitted sends no Authorization header — the anonymous case. */
async function uploadPng(app: Express, token?: string) {
  const req = request(app)
    .post('/api/uploads/style-reference')
    .attach('image', PNG_BYTES, { filename: 'style.png', contentType: 'image/png' });
  if (token) req.set('Authorization', `Bearer ${token}`);
  const res = await req;
  const url: unknown = res.body?.url;
  if (typeof url === 'string') written.push(url.split('/').pop() as string);
  return res;
}

describe('POST /api/uploads/style-reference — ANTHROPIC_API_KEY config gate', () => {
  let app: Express;
  let token: string;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
    mockCreate.mockReset();
    // The limiter's counters are module-level and outlive a single test.
    resetRateLimits();
    ({ token } = await createUserAndGetToken(app));
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

    const res = await uploadPng(app, token);

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

    const res = await uploadPng(app, token);

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

    const res = await uploadPng(app, token);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      url: expect.any(String),
      descriptor: 'Soft watercolor with a muted palette.',
    });
    expect(mockCreate).toHaveBeenCalled();
  });
});

/**
 * #96. This route made a real Anthropic vision call while being anonymous and
 * unmetered. Two independent failures, and the second is the worse one: with no
 * `UsageLog` row written, the tokens it burned were invisible to the global monthly
 * ceiling — the one ceiling CLAUDE.md says nobody bypasses, admins included.
 *
 * CORS was never a mitigation. `CORS_ORIGIN` restricts browsers; it does nothing to
 * a direct `curl`.
 */
describe('POST /api/uploads/style-reference — auth and metering', () => {
  let app: Express;
  let token: string;
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
    mockCreate.mockReset();
    resetRateLimits();
    ({ token, userId } = await createUserAndGetToken(app));
    // A key that passes `isUsableApiKey`, so the paid branch is the one under test.
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-key');
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Soft watercolor with a muted palette.' }],
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const filename of written.splice(0)) {
      await rm(join(UPLOADS_DIR, filename), { force: true });
    }
  });

  it('401s an anonymous upload, and never reaches Anthropic', async () => {
    const res = await uploadPng(app);

    expect(res.status).toBe(401);
    // The assertion that matters: rejecting after the paid call would have closed
    // the hole on paper while still spending the money.
    expect(mockCreate).not.toHaveBeenCalled();
    expect(await prisma.usageLog.count()).toBe(0);
  });

  it('records exactly one UsageLog row, priced from COST_CENTS', async () => {
    const res = await uploadPng(app, token);

    expect(res.status).toBe(200);
    const logs = await prisma.usageLog.findMany({ where: { user_id: userId } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      user_id: userId,
      kind: 'style_reference',
      cost_cents: COST_CENTS.style_reference,
    });
  });

  it('records nothing when no usable key made the call', async () => {
    // The upload still succeeds — describing the style is best-effort — but no
    // Anthropic call happened, so charging for one would inflate the ceiling that
    // protects the bill.
    vi.stubEnv('ANTHROPIC_API_KEY', 'your-api-key-here');

    const res = await uploadPng(app, token);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ url: expect.any(String), descriptor: null });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(await prisma.usageLog.count()).toBe(0);
  });

  it('records nothing when the Anthropic call fails', async () => {
    // Usage is recorded AFTER the call resolves, so a failed request consumes no
    // quota — the documented trade-off in spend.ts, pinned here for this route.
    mockCreate.mockRejectedValueOnce(new Error('upstream exploded'));

    const res = await uploadPng(app, token);

    expect(res.status).toBe(500);
    expect(await prisma.usageLog.count()).toBe(0);
  });

  it('429s once the caller is over their daily cap, before spending anything', async () => {
    vi.stubEnv('QUOTA_DAILY_PER_USER_CENTS', '1');
    await prisma.usageLog.create({
      data: { user_id: userId, kind: 'style_reference', cost_cents: 5 },
    });

    const res = await uploadPng(app, token);

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: expect.any(String), quota: { scope: 'daily' } });
    expect(res.headers['retry-after']).toEqual(expect.any(String));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('503s at the global monthly ceiling, for an admin too', async () => {
    // The monthly ceiling is the one QUOTA_ADMIN_BYPASS never applies to. Asserting
    // it with an admin is the only way to prove the bypass was not wired in here.
    const admin = await createUserAndGetToken(app, 'admin');
    vi.stubEnv('QUOTA_MONTHLY_GLOBAL_CENTS', '1');
    await prisma.usageLog.create({
      data: { user_id: userId, kind: 'style_reference', cost_cents: 5 },
    });

    const res = await uploadPng(app, admin.token);

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: expect.any(String), quota: { scope: 'monthly' } });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

/**
 * Rate limiting (#96 item 3), which CodeQL independently flagged on this route as
 * `js/missing-rate-limiting` once the route was touched.
 *
 * It is a separate guard from the spend gate, not a duplicate of it: the gate bounds
 * what a caller may SPEND, this bounds how fast they may ASK. A caller comfortably
 * under quota can still make a hundred multipart uploads a second, each costing a
 * filesystem write and a model call.
 */
describe('POST /api/uploads/style-reference — rate limiting', () => {
  let app: Express;
  let token: string;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
    mockCreate.mockReset();
    resetRateLimits();
    ({ token } = await createUserAndGetToken(app));
    vi.stubEnv('ANTHROPIC_API_KEY', undefined);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetRateLimits();
    for (const filename of written.splice(0)) {
      await rm(join(UPLOADS_DIR, filename), { force: true });
    }
  });

  it('allows the first 10 in a window and rejects the 11th', async () => {
    for (let i = 1; i <= 10; i++) {
      const res = await uploadPng(app, token);
      expect(res.status, `upload ${i} of 10 should have been allowed`).toBe(200);
    }

    const blocked = await uploadPng(app, token);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({
      error: expect.any(String),
      retryAfterSeconds: expect.any(Number),
    });
    expect(blocked.headers['retry-after']).toEqual(expect.any(String));
  });

  it('counts per user, so one caller cannot exhaust another', async () => {
    // A shared counter would be worse than none: the first noisy uploader would
    // lock out everyone else.
    for (let i = 0; i < 10; i++) await uploadPng(app, token);
    expect((await uploadPng(app, token)).status).toBe(429);

    const other = await createUserAndGetToken(app);
    expect((await uploadPng(app, other.token)).status).toBe(200);
  });

  it('rejects before writing a file or reaching Anthropic', async () => {
    // The whole point of rejecting early. Asserting only the status would pass on a
    // limiter mounted after multer, which is the expensive half of the request.
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-key');
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'A style.' }] });

    for (let i = 0; i < 10; i++) await uploadPng(app, token);
    const callsBefore = mockCreate.mock.calls.length;
    const filesBefore = written.length;

    const blocked = await uploadPng(app, token);

    expect(blocked.status).toBe(429);
    expect(blocked.body.url).toBeUndefined();
    expect(mockCreate.mock.calls.length).toBe(callsBefore);
    expect(written.length).toBe(filesBefore);
  });
});
