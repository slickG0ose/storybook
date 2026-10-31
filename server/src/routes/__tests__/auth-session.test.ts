import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, resetDatabase, allowEmail } from '../../__tests__/setup';
import prisma from '../../db/prisma';

/**
 * Wire shapes for the two session endpoints, /logout and /me (#179).
 *
 * /register and /login are pinned in auth-normalization.test.ts. These two were
 * not, and the only other references to /me are Playwright `page.route()` mocks
 * in e2e/tests/admin.spec.ts — which replace the response and so never reach
 * the handler. AuthContext reads `id`, `email`, `name`, `role` off /me to decide
 * whether to render admin UI, so these fields are pinned by name here.
 */

const EMAIL = 'session@example.com';
const PASSWORD = 'pw-test-1234';

async function registerToken(app: Express): Promise<string> {
  await allowEmail(EMAIL);
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ email: EMAIL, name: 'Session', password: PASSWORD });
  expect(reg.status).toBe(201);
  return reg.body.token as string;
}

describe('auth session endpoints', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
  });

  it('GET /me returns the four user fields for a valid token, and no secrets', async () => {
    const token = await registerToken(app);

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Wire shape: every field AuthContext reads off /me, pinned by name.
    expect(res.body).toMatchObject({
      id: expect.any(String),
      email: EMAIL,
      name: 'Session',
      role: 'user',
    });
    // The client keeps its stored token; /me never echoes it or the hash.
    expect(res.body).not.toHaveProperty('token');
    expect(res.body).not.toHaveProperty('password_hash');
  });

  it('GET /me returns 401 with the error envelope when no token is sent', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it('GET /me returns 401 for an unknown token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-real-token');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it('POST /logout returns { ok: true } and revokes the token', async () => {
    const token = await registerToken(app);

    const res = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });

    const stored = await prisma.user.findFirst({ where: { email: EMAIL } });
    expect(stored?.token).toBeNull();

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(401);
  });

  it('POST /logout without a token still returns { ok: true }', async () => {
    // Deliberate: logout is idempotent, so a client whose token already
    // expired can clear local state without handling an error.
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });
});
