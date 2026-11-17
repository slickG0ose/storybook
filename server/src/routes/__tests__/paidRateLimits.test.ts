import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { mediaPath } from '@storybook/shared';
import { createTestApp, allowEmail, resetDatabase } from '../../__tests__/setup';
import prisma from '../../db/prisma';
import { PAID_RATE_LIMITS } from '../../middleware/rateLimit';

/**
 * The paid routes are spend-gated, but the spend gate reads the ledger on arrival and
 * writes it after the model call returns — so a burst all passes it together. These pin
 * the request-rate ceiling in front of it. Each case drives the route with requests
 * that fail cheaply AFTER the limiter (unknown book, invalid body), so no provider is
 * stubbed and none can be reached: the limiter runs before any of that.
 */
async function register(app: Express, role: 'user' | 'admin' = 'user'): Promise<string> {
  const email = `paid-rl-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await allowEmail(email);
  const reg = await request(app).post('/api/auth/register').send({ email, name: 'RL', password: 'test-password' });
  if (role === 'admin') {
    await prisma.user.update({ where: { email }, data: { role: 'admin' } });
  }
  return reg.body.token as string;
}

describe('rate limits on paid routes', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
  });

  const cases = [
    { name: 'POST /api/generate', path: '/api/generate', body: {}, limit: PAID_RATE_LIMITS.generate },
    { name: 'POST /api/books/:id/revise', path: '/api/books/no-such-book/revise', body: {}, limit: PAID_RATE_LIMITS.revise },
    { name: 'POST /api/books/:id/illustrate', path: '/api/books/no-such-book/illustrate', body: {}, limit: PAID_RATE_LIMITS.illustrate },
    {
      name: 'POST /api/books/:id/characters/:i/portrait',
      path: '/api/books/no-such-book/characters/0/portrait',
      body: {},
      limit: PAID_RATE_LIMITS.portrait,
    },
    { name: 'POST /api/books/:id/narration', path: '/api/books/no-such-book/narration', body: {}, limit: PAID_RATE_LIMITS.narration },
  ] as const;

  for (const c of cases) {
    it(`${c.name}: allows ${c.limit.max} per window, then 429s with Retry-After`, async () => {
      const token = await register(app);
      const send = () => request(app).post(c.path).set('Authorization', `Bearer ${token}`).send(c.body);

      for (let i = 1; i <= c.limit.max; i++) {
        const res = await send();
        expect(res.status, `request ${i} of ${c.limit.max} was rate-limited early`).not.toBe(429);
      }

      const blocked = await send();
      expect(blocked.status).toBe(429);
      expect(blocked.body).toMatchObject({ error: expect.any(String), retryAfterSeconds: expect.any(Number) });
      expect(blocked.headers['retry-after']).toEqual(expect.any(String));

      // Per user: someone else is unaffected.
      const other = await register(app);
      const fresh = await request(app).post(c.path).set('Authorization', `Bearer ${other}`).send(c.body);
      expect(fresh.status).not.toBe(429);
    });

    it(`${c.name}: an anonymous caller gets 401, never a 429`, async () => {
      const res = await request(app).post(c.path).send(c.body);
      expect(res.status).toBe(401);
    });
  }

  it('POST /api/admin/allowlist (invites): rate-limited per admin', async () => {
    const token = await register(app, 'admin');
    for (let i = 1; i <= PAID_RATE_LIMITS.invite.max; i++) {
      const res = await request(app)
        .post('/api/admin/allowlist')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: `invitee-${i}@example.com` });
      expect(res.status, `invite ${i}`).toBe(201);
    }
    const blocked = await request(app)
      .post('/api/admin/allowlist')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'one-too-many@example.com' });
    expect(blocked.status).toBe(429);
    expect(await prisma.allowedEmail.findUnique({ where: { email: 'one-too-many@example.com' } })).toBeNull();
  });
});

describe('style_reference_url is the author’s alone', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
  });

  it('is nulled for other readers of a public book, in detail and in the catalog', async () => {
    const email = `owner-${Date.now()}@example.com`;
    await allowEmail(email);
    const reg = await request(app).post('/api/auth/register').send({ email, name: 'Owner', password: 'test-password' });
    const ownerToken = reg.body.token as string;
    const url = '/uploads/style-refs/123e4567-e89b-12d3-a456-426614174000.jpg';
    await prisma.book.update({
      where: { id: 'luna-star-garden' },
      data: { status: 'published', created_by: reg.body.id as string, style_reference_url: url },
    });

    const anon = await request(app).get('/api/books/luna-star-garden');
    expect(anon.status).toBe(200);
    expect(anon.body).toMatchObject({ id: 'luna-star-garden', style_reference_url: null });

    const stranger = await register(app);
    const other = await request(app).get('/api/books/luna-star-garden').set('Authorization', `Bearer ${stranger}`);
    expect(other.body).toMatchObject({ style_reference_url: null });

    const list = await request(app).get('/api/books');
    const row = (list.body as Array<{ id: string; style_reference_url: string | null }>).find(b => b.id === 'luna-star-garden');
    expect(row).toMatchObject({ style_reference_url: null });

    const mine = await request(app).get('/api/books/luna-star-garden').set('Authorization', `Bearer ${ownerToken}`);
    expect(mine.body).toMatchObject({
      style_reference_url: expect.stringMatching(/^\/uploads\/style-refs\/[^?]+\?e=\d+&s=[A-Za-z0-9_-]{43}$/),
    });
    expect(mediaPath(mine.body.style_reference_url)).toBe(url);
  });
});
