import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, allowEmail, resetDatabase } from '../../__tests__/setup';
import prisma from '../../db/prisma';
import { resetRateLimits } from '../../middleware/rateLimit';
import { FEEDBACK_RATE_LIMIT } from '../feedback';

async function createUserAndGetToken(app: Express): Promise<{ token: string; userId: string }> {
  const email = `feedback-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await allowEmail(email);
  const reg = await request(app).post('/api/auth/register').send({
    email,
    name: 'Feedback Tester',
    password: 'test-password',
  });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { token: reg.body.token as string, userId: user.id };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    category: 'bug',
    message: 'The page turn button did nothing.',
    route: '/book/luna-star-garden?theater=1',
    book_id: 'luna-star-garden',
    session_id: '11111111-2222-3333-4444-555555555555',
    viewport_width: 393,
    viewport_height: 852,
    theme: 'dark',
    client_build: 'abc1234',
    recent_errors: ['TypeError: x is undefined'],
    ...overrides,
  };
}

function post(app: Express, body: unknown, token?: string) {
  const req = request(app).post('/api/feedback').send(body as object);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req;
}

describe('POST /api/feedback', () => {
  let app: Express;
  let token: string;
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    resetRateLimits();
    app = createTestApp();
    ({ token, userId } = await createUserAndGetToken(app));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('201 with the FeedbackCreateResponse shape, and stores the body plus the token user', async () => {
    const res = await post(app, validBody(), token).set('User-Agent', 'Mozilla/5.0 TestPhone');

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      status: 'new',
      created_at: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(res.body.created_at))).toBe(false);

    const row = await prisma.feedback.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row).toMatchObject({
      user_id: userId,
      session_id: '11111111-2222-3333-4444-555555555555',
      category: 'bug',
      message: 'The page turn button did nothing.',
      route: '/book/luna-star-garden?theater=1',
      book_id: 'luna-star-garden',
      user_agent: 'Mozilla/5.0 TestPhone',
      viewport_width: 393,
      viewport_height: 852,
      theme: 'dark',
      client_build: 'abc1234',
      status: 'new',
    });
    expect(JSON.parse(row.recent_errors_json as string)).toEqual(['TypeError: x is undefined']);
  });

  it('stores recent_errors as normalised JSON (last 5, 300 chars each), and null when empty or omitted', async () => {
    const many = Array.from({ length: 7 }, (_, i) => `err-${i}-${'x'.repeat(400)}`);
    const withErrors = await post(app, validBody({ recent_errors: many }), token);
    expect(withErrors.status).toBe(201);
    const row = await prisma.feedback.findUniqueOrThrow({ where: { id: withErrors.body.id } });
    const stored = JSON.parse(row.recent_errors_json as string) as string[];
    expect(stored).toHaveLength(5);
    expect(stored[0].startsWith('err-2-')).toBe(true);
    expect(stored.every((e) => e.length === 300)).toBe(true);

    const empty = await post(app, validBody({ recent_errors: [] }), token);
    const omitted = await post(app, { ...validBody(), recent_errors: undefined }, token);
    for (const res of [empty, omitted]) {
      expect(res.status).toBe(201);
      const r = await prisma.feedback.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(r.recent_errors_json).toBeNull();
    }
  });

  it('ignores a user_id in the body and stores the token user', async () => {
    const other = await createUserAndGetToken(app);
    const res = await post(app, validBody({ user_id: other.userId }), token);
    expect(res.status).toBe(201);
    const row = await prisma.feedback.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.user_id).toBe(userId);
  });

  it('stores an unknown book_id as null and a real one as-is', async () => {
    const unknown = await post(app, validBody({ book_id: 'no-such-book' }), token);
    expect(unknown.status).toBe(201);
    expect(
      (await prisma.feedback.findUniqueOrThrow({ where: { id: unknown.body.id } })).book_id,
    ).toBeNull();

    const real = await post(app, validBody({ book_id: 'dinosaur-bakery' }), token);
    expect(real.status).toBe(201);
    expect(
      (await prisma.feedback.findUniqueOrThrow({ where: { id: real.body.id } })).book_id,
    ).toBe('dinosaur-bakery');
  });

  it('truncates user_agent to 512 chars and takes server_build from RENDER_GIT_COMMIT', async () => {
    vi.stubEnv('RENDER_GIT_COMMIT', 'deadbeef');
    const res = await post(app, validBody(), token).set('User-Agent', 'U'.repeat(600));
    expect(res.status).toBe(201);
    const row = await prisma.feedback.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.server_build).toBe('deadbeef');
    expect(row.user_agent).toBe('U'.repeat(512));
  });

  it('stores server_build as null when RENDER_GIT_COMMIT is unset', async () => {
    vi.stubEnv('RENDER_GIT_COMMIT', undefined);
    const res = await post(app, validBody(), token);
    expect(res.status).toBe(201);
    const row = await prisma.feedback.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.server_build).toBeNull();
  });

  it('401 { error } with no token, and still 401 (not 400) with no token and a bad body', async () => {
    const noToken = await post(app, validBody());
    expect(noToken.status).toBe(401);
    expect(noToken.body).toMatchObject({ error: expect.any(String) });

    const noTokenBadBody = await post(app, { message: '' });
    expect(noTokenBadBody.status).toBe(401);
    expect(noTokenBadBody.body).toMatchObject({ error: expect.any(String) });

    expect(await prisma.feedback.count()).toBe(0);
  });

  it.each([
    ['a whitespace-only message', { message: '   \n ' }],
    ['a 2001-character message', { message: 'a'.repeat(2001) }],
    ['a protocol-relative route', { route: '//evil.example' }],
  ])('400 { error } for %s', async (_label, override) => {
    const res = await post(app, validBody(override), token);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.any(String) });
    expect(await prisma.feedback.count()).toBe(0);
  });

  it('429 with the feedback message and Retry-After on the 11th call in the window', async () => {
    for (let i = 0; i < FEEDBACK_RATE_LIMIT.max; i++) {
      const ok = await post(app, validBody(), token);
      expect(ok.status).toBe(201);
    }

    const limited = await post(app, validBody(), token);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({
      error: expect.stringMatching(/feedback/i),
      retryAfterSeconds: expect.any(Number),
    });
    expect(limited.headers['retry-after']).toMatch(/^\d+$/);
    expect(await prisma.feedback.count()).toBe(FEEDBACK_RATE_LIMIT.max);
  });
});
