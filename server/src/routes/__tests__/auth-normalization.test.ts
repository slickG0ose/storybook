import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, resetDatabase, allowEmail } from '../../__tests__/setup';
import prisma from '../../db/prisma';
import { hashPassword } from '../../lib/password';

/**
 * Email normalization on the auth path (spec Decision 5).
 *
 * The reported bug: registering `Nick@Gmail.com` and then logging in as
 * `nick@gmail.com` was a permanent 401, and mobile keyboards capitalise the
 * first letter by default, so testers hit it without trying.
 *
 * Registration is closed by default, so `allowEmail()` comes before every
 * `/register` — same as server/src/routes/__tests__/allowlist.test.ts.
 */

const PASSWORD = 'pw-test-1234';

describe('auth email normalization', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
  });

  it('stores a mixed-case registration lowercase and lets the lowercase form log in', async () => {
    await allowEmail('nick@gmail.com');

    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: '  Nick@Gmail.com ', name: 'Nick', password: PASSWORD });

    expect(reg.status).toBe(201);
    // Wire shape: every field the client reads off /register, pinned by name.
    // Nothing else in the repo pins this response.
    expect(reg.body).toMatchObject({
      id: expect.any(String),
      email: 'nick@gmail.com',
      name: 'Nick',
      role: 'user',
      token: expect.any(String),
    });

    const stored = await prisma.user.findFirst({ where: { id: reg.body.id as string } });
    expect(stored?.email).toBe('nick@gmail.com');

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nick@gmail.com', password: PASSWORD });

    expect(login.status).toBe(200);
    // Wire shape: /login returns the same five fields, with a fresh token.
    expect(login.body).toMatchObject({
      id: stored?.id,
      email: 'nick@gmail.com',
      name: 'Nick',
      role: 'user',
      token: expect.any(String),
    });
  });

  it('rejects a differently-cased re-registration with 409 and creates no second row', async () => {
    await allowEmail('nick@gmail.com');
    const first = await request(app)
      .post('/api/auth/register')
      .send({ email: 'nick@gmail.com', name: 'Nick', password: PASSWORD });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/auth/register')
      .send({ email: 'NICK@gmail.com', name: 'Impostor', password: PASSWORD });

    expect(second.status).toBe(409);
    expect(await prisma.user.count()).toBe(1);
  });

  it('finds the account when the login email is typed mixed-case and padded', async () => {
    await allowEmail('nick@gmail.com');
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'nick@gmail.com', name: 'Nick', password: PASSWORD });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: '  NICK@GMAIL.COM ', password: PASSWORD });

    expect(login.status).toBe(200);
    expect(login.body.email).toBe('nick@gmail.com');
  });

  it('still admits a mixed-case typing of an address allowlisted in lowercase', async () => {
    await allowEmail('invited@example.com');

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'Invited@Example.COM', name: 'Invited', password: PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe('invited@example.com');
  });

  it('answers 409, not 500, when the only row for the address is soft-deleted', async () => {
    // The unique index spans tombstones, so the duplicate check deliberately
    // omits `deleted_at: null`. With the filter in place the create below threw
    // P2002 and the global error handler turned it into a generic 500.
    await allowEmail('gone@example.com');
    await prisma.user.create({
      data: {
        email: 'gone@example.com',
        name: 'Gone',
        password_hash: hashPassword(PASSWORD),
        deleted_at: new Date(),
      },
    });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'Gone@Example.com', name: 'Gone Again', password: PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already exists');
    expect(await prisma.user.count()).toBe(1);
  });
});
