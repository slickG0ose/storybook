import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, resetDatabase, allowEmail } from '../../__tests__/setup';
import prisma from '../../db/prisma';
import { bootstrapAllowlist, isEmailAllowed, normalizeEmail } from '../../services/allowlist';

async function makeAdmin(app: Express, email: string): Promise<string> {
  await allowEmail(email);
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ email, name: 'Admin', password: 'pw-test-1234' });
  await prisma.user.update({ where: { id: reg.body.id as string }, data: { role: 'admin' } });
  return reg.body.token as string;
}

describe('registration allowlist gate', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
  });

  it('rejects registration for an email not on the allowlist', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'stranger@example.com', name: 'Stranger', password: 'pw-test-1234' });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('approved email');
  });

  it('does not create a user row when registration is rejected', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'stranger@example.com', name: 'Stranger', password: 'pw-test-1234' });

    const user = await prisma.user.findFirst({ where: { email: 'stranger@example.com' } });
    expect(user).toBeNull();
  });

  it('allows registration once the email is on the allowlist', async () => {
    await allowEmail('invited@example.com');

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'invited@example.com', name: 'Invited', password: 'pw-test-1234' });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
  });

  it('matches the allowlist case-insensitively', async () => {
    await allowEmail('MixedCase@Example.com');

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'mixedcase@example.com', name: 'Mixed', password: 'pw-test-1234' });

    expect(res.status).toBe(201);
  });

  it('blocks a non-allowed email before revealing whether the account exists', async () => {
    // An already-registered address that is later removed from the allowlist
    // must still 403 on re-registration, not 409. Otherwise the response
    // distinguishes "exists" from "not invited" to an un-invited caller.
    await allowEmail('taken@example.com');
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'taken@example.com', name: 'Taken', password: 'pw-test-1234' });

    await prisma.allowedEmail.deleteMany({ where: { email: 'taken@example.com' } });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'taken@example.com', name: 'Taken', password: 'pw-test-1234' });

    expect(res.status).toBe(403);
  });
});

describe('allowlist bootstrap from env', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('seeds the allowlist when it is empty', async () => {
    vi.stubEnv('ALLOWLIST_BOOTSTRAP_EMAILS', 'a@example.com, B@Example.com');

    const seeded = await bootstrapAllowlist();

    expect(seeded).toEqual(['a@example.com', 'b@example.com']);
    expect(await isEmailAllowed('A@example.com')).toBe(true);
    expect(await isEmailAllowed('b@example.com')).toBe(true);
  });

  it('does nothing when the allowlist already has entries', async () => {
    await allowEmail('existing@example.com');
    vi.stubEnv('ALLOWLIST_BOOTSTRAP_EMAILS', 'newcomer@example.com');

    const seeded = await bootstrapAllowlist();

    // The bootstrap must not re-add an address an admin deliberately removed,
    // so it only ever runs against an empty table.
    expect(seeded).toEqual([]);
    expect(await isEmailAllowed('newcomer@example.com')).toBe(false);
  });

  it('is a no-op when the env var is unset or blank', async () => {
    vi.stubEnv('ALLOWLIST_BOOTSTRAP_EMAILS', '   ');
    expect(await bootstrapAllowlist()).toEqual([]);
    expect(await prisma.allowedEmail.count()).toBe(0);
  });

  it('ignores entries that are not plausible addresses', async () => {
    vi.stubEnv('ALLOWLIST_BOOTSTRAP_EMAILS', 'good@example.com,,not-an-email,   ');

    expect(await bootstrapAllowlist()).toEqual(['good@example.com']);
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });
});

describe('admin allowlist CRUD', () => {
  let app: Express;
  let adminToken: string;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
    adminToken = await makeAdmin(app, 'admin@example.com');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/admin/allowlist');
    expect(res.status).toBe(401);
  });

  it('requires the admin role', async () => {
    await allowEmail('plain@example.com');
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'plain@example.com', name: 'Plain', password: 'pw-test-1234' });

    const res = await request(app)
      .get('/api/admin/allowlist')
      .set('Authorization', `Bearer ${reg.body.token as string}`);

    expect(res.status).toBe(403);
  });

  it('lists allowlist entries', async () => {
    // Seed a row with every field populated so the wire-shape assertion pins
    // real values rather than nulls that would pass by accident.
    await request(app)
      .post('/api/admin/allowlist')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'listed@example.com', note: 'beta tester' });

    const res = await request(app)
      .get('/api/admin/allowlist')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const row = (res.body as { email: string }[]).find(r => r.email === 'listed@example.com');
    // Pin every field the client reads, by name.
    expect(row).toMatchObject({
      email: 'listed@example.com',
      added_by: 'admin@example.com',
      note: 'beta tester',
      created_at: expect.any(String),
    });
  });

  it('adds an email, recording which admin added it', async () => {
    const res = await request(app)
      .post('/api/admin/allowlist')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'Invited@Example.com', note: 'beta tester' });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe('invited@example.com');
    expect(res.body.added_by).toBe('admin@example.com');
    expect(res.body.note).toBe('beta tester');
    expect(await isEmailAllowed('invited@example.com')).toBe(true);
  });

  it('rejects a malformed email', async () => {
    const res = await request(app)
      .post('/api/admin/allowlist')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
  });

  it('returns 409 when the email is already listed', async () => {
    await allowEmail('dupe@example.com');

    const res = await request(app)
      .post('/api/admin/allowlist')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'dupe@example.com' });

    expect(res.status).toBe(409);
  });

  it('removes an email', async () => {
    await allowEmail('remove-me@example.com');

    const res = await request(app)
      .delete('/api/admin/allowlist/remove-me@example.com')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, removed: 'remove-me@example.com' });
    expect(await isEmailAllowed('remove-me@example.com')).toBe(false);
  });

  it('returns 404 when removing an email that is not listed', async () => {
    const res = await request(app)
      .delete('/api/admin/allowlist/ghost@example.com')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  it('removing an email does not disable the account that already used it', async () => {
    await allowEmail('kept@example.com');
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'kept@example.com', name: 'Kept', password: 'pw-test-1234' });

    await request(app)
      .delete('/api/admin/allowlist/kept@example.com')
      .set('Authorization', `Bearer ${adminToken}`);

    // The allowlist gates registration, not authentication. Revoking access to
    // an existing account is the soft-delete user endpoint's job.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'kept@example.com', password: 'pw-test-1234' });

    expect(login.status).toBe(200);
    expect(reg.body.id).toBe(login.body.id);
  });
});
