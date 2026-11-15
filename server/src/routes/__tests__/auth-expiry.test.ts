import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, resetDatabase, allowEmail } from '../../__tests__/setup';
import prisma from '../../db/prisma';
import { hashToken } from '../../lib/authToken';

/**
 * Token expiry and hashing at rest (#210, spec auth-token-expiry Task 3).
 * Expiry by clock is pinned here: the browser cannot tell an expired token
 * from a revoked one, because the server answers both with the same 401.
 */

const EMAIL = 'expiry@example.com';
const PASSWORD = 'pw-test-1234';
const DAY_MS = 24 * 60 * 60 * 1000;

let app: Express;

async function register(email = EMAIL) {
  await allowEmail(email);
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, name: 'Expiry', password: PASSWORD });
  expect(res.status).toBe(201);
  return res.body as { id: string; token: string };
}

async function expire(email = EMAIL) {
  await prisma.user.update({
    where: { email },
    data: { token_expires_at: new Date(Date.now() - 1000) },
  });
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('auth token expiry', () => {
  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('a fresh token works', async () => {
    const { token } = await register();
    const res = await request(app).get('/api/auth/me').set(bearer(token));
    expect(res.status).toBe(200);
  });

  it('stores the hash, not the token, after register and login', async () => {
    const { token } = await register();
    let row = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(row.token).toBe(hashToken(token));
    expect(row.token).not.toBe(token);

    const login = await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
    expect(login.status).toBe(200);
    row = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(row.token).toBe(hashToken(login.body.token));
    expect(row.token).not.toBe(login.body.token);
  });

  it('sets token_expires_at about 30 days out after register and login', async () => {
    await register();
    const check = async () => {
      const row = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
      const delta = Math.abs(row.token_expires_at!.getTime() - (Date.now() + 30 * DAY_MS));
      expect(delta).toBeLessThan(10_000);
    };
    await check();
    await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
    await check();
  });

  it('401s an expired token on /me', async () => {
    const { token } = await register();
    await expire();
    const res = await request(app).get('/api/auth/me').set(bearer(token));
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it('401s an expired token on a requireAuth route', async () => {
    const { token } = await register();
    await expire();
    const res = await request(app).get('/api/books/mine').set(bearer(token));
    expect(res.status).toBe(401);
  });

  it('401s (not 403) an expired admin token on an adminGate route', async () => {
    const { token } = await register();
    await prisma.user.update({ where: { email: EMAIL }, data: { role: 'admin' } });
    const ok = await request(app).get('/api/admin/users').set(bearer(token));
    expect(ok.status).toBe(200);
    await expire();
    const res = await request(app).get('/api/admin/users').set(bearer(token));
    expect(res.status).toBe(401);
  });

  it('never authenticates a null expiry', async () => {
    const { token } = await register();
    await prisma.user.update({ where: { email: EMAIL }, data: { token_expires_at: null } });
    const res = await request(app).get('/api/auth/me').set(bearer(token));
    expect(res.status).toBe(401);
  });

  it('never authenticates a plaintext row', async () => {
    await prisma.user.create({
      data: {
        email: 'legacy@example.com',
        name: 'Legacy',
        password_hash: 'x',
        token: 'legacy-plaintext',
        token_expires_at: new Date(Date.now() + DAY_MS),
      },
    });
    const res = await request(app).get('/api/auth/me').set(bearer('legacy-plaintext'));
    expect(res.status).toBe(401);
  });

  it('login rotates the token and renews expiry', async () => {
    const { token: oldToken } = await register();
    await expire();
    const login = await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
    expect(login.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(bearer(login.body.token))).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(bearer(oldToken))).status).toBe(401);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(row.token_expires_at!.getTime()).toBeGreaterThan(Date.now());
  });

  it('logout clears both columns, and is still 200 with an expired token', async () => {
    const { token } = await register();
    const res = await request(app).post('/api/auth/logout').set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    const row = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(row.token).toBeNull();
    expect(row.token_expires_at).toBeNull();

    const second = await register('expiry2@example.com');
    await expire('expiry2@example.com');
    const res2 = await request(app).post('/api/auth/logout').set(bearer(second.token));
    expect(res2.status).toBe(200);
    expect(res2.body).toMatchObject({ ok: true });
  });

  it('an expired token on an optional-auth read is not a 401', async () => {
    // Deliberate: optional-auth reads treat a dead token as signed out, so
    // published books still load. Only requireAuth/adminGate routes 401.
    const { token } = await register();
    await expire();
    const res = await request(app).get('/api/books/luna-star-garden').set(bearer(token));
    expect(res.status).toBe(200);
  });

  it('admin restore does not resurrect a session', async () => {
    const { id, token } = await register();
    await prisma.user.update({ where: { id }, data: { deleted_at: new Date() } });
    await register('admin@example.com');
    await prisma.user.update({ where: { email: 'admin@example.com' }, data: { role: 'admin' } });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: PASSWORD });

    const res = await request(app).put(`/api/admin/users/${id}/restore`).set(bearer(login.body.token));
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('token_expires_at');
    expect((await request(app).get('/api/auth/me').set(bearer(token))).status).toBe(401);
    const row = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(row.token).toBeNull();
  });

  it('reads TOKEN_TTL_DAYS per call', async () => {
    vi.stubEnv('TOKEN_TTL_DAYS', '1');
    await register();
    const row = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(Math.abs(row.token_expires_at!.getTime() - (Date.now() + DAY_MS))).toBeLessThan(10_000);
  });

  it('keeps token_expires_at off /register, /login and /me bodies', async () => {
    await allowEmail(EMAIL);
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: EMAIL, name: 'Expiry', password: PASSWORD });
    expect(reg.body).toMatchObject({ id: expect.any(String), token: expect.any(String) });
    expect(reg.body).not.toHaveProperty('token_expires_at');
    const login = await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
    expect(login.body).toMatchObject({ id: expect.any(String), token: expect.any(String) });
    expect(login.body).not.toHaveProperty('token_expires_at');
    const me = await request(app).get('/api/auth/me').set(bearer(login.body.token));
    expect(me.body).toMatchObject({ id: expect.any(String), email: EMAIL });
    expect(me.body).not.toHaveProperty('token_expires_at');
  });
});
