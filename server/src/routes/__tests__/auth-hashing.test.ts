import { describe, it, expect, beforeEach } from 'vitest';
import { createHash, randomBytes } from 'crypto';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, resetDatabase, allowEmail } from '../../__tests__/setup';
import prisma from '../../db/prisma';
import { hashPassword, verifyPassword } from '../auth';

/**
 * Reproduces the retired pre-scrypt format (#68) so we can prove it no longer
 * authenticates — a leaked old-format hash must not be a working credential.
 */
function legacyHash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(salt + password).digest('hex');
  return `${salt}:${hash}`;
}

describe('password hashing', () => {
  it('produces a scrypt-prefixed hash', () => {
    const stored = hashPassword('correct-horse');
    expect(stored.startsWith('scrypt:')).toBe(true);
  });

  it('salts — the same password hashes differently each time', () => {
    expect(hashPassword('same-password')).not.toBe(hashPassword('same-password'));
  });

  it('verifies a correct password and rejects a wrong one', () => {
    const stored = hashPassword('correct-horse');
    expect(verifyPassword('correct-horse', stored)).toBe(true);
    expect(verifyPassword('wrong-horse', stored)).toBe(false);
  });

  it('rejects a legacy sha256 hash even with the right password', () => {
    const stored = legacyHash('old-password');
    expect(verifyPassword('old-password', stored)).toBe(false);
    expect(verifyPassword('not-it', stored)).toBe(false);
  });

  it('rejects a malformed stored hash instead of throwing', () => {
    expect(verifyPassword('anything', 'garbage')).toBe(false);
    expect(verifyPassword('anything', 'scrypt:only-one-part')).toBe(false);
    expect(verifyPassword('anything', 'scrypt:abcd:not-hex')).toBe(false);
  });
});

describe('POST /api/auth — registration + login hashing', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
  });

  it('stores a scrypt hash on registration', async () => {
    await allowEmail('new@example.com');
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@example.com', name: 'New', password: 'pw-test-1234' });

    const user = await prisma.user.findFirst({ where: { email: 'new@example.com' } });
    expect(user?.password_hash.startsWith('scrypt:')).toBe(true);
  });

  it('rejects a password shorter than 8 characters', async () => {
    await allowEmail('short@example.com');
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'short@example.com', name: 'Short', password: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('at least 8 characters');
  });

  it('logs in a scrypt-hashed user without rewriting the hash', async () => {
    const stored = hashPassword('pw-test-1234');
    await prisma.user.create({
      data: { email: 'scrypt@example.com', name: 'Scrypt', password_hash: stored, token: 'old-token' },
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'scrypt@example.com', password: 'pw-test-1234' });

    expect(res.status).toBe(200);
    const after = await prisma.user.findFirst({ where: { email: 'scrypt@example.com' } });
    expect(after!.password_hash).toBe(stored);
    expect(after!.token).toBe(res.body.token);
  });

  it('refuses a legacy-hashed user with 401 and leaves the row untouched', async () => {
    const stored = legacyHash('old-password');
    await prisma.user.create({
      data: { email: 'legacy@example.com', name: 'Legacy', password_hash: stored, token: 'legacy-token' },
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'legacy@example.com', password: 'old-password' });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'Invalid email or password' });
    const after = await prisma.user.findFirst({ where: { email: 'legacy@example.com' } });
    expect(after!.password_hash).toBe(stored);
    expect(after!.token).toBe('legacy-token');
  });
});
