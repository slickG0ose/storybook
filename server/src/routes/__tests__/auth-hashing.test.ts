import { describe, it, expect, beforeEach } from 'vitest';
import { createHash, randomBytes } from 'crypto';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, resetDatabase } from '../../__tests__/setup';
import prisma from '../../db/prisma';
import { hashPassword, verifyPassword, isLegacyHash } from '../auth';

/** Reproduces the pre-scrypt format so we can prove old rows still work. */
function legacyHash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(salt + password).digest('hex');
  return `${salt}:${hash}`;
}

describe('password hashing', () => {
  it('produces a scrypt-prefixed hash', () => {
    const stored = hashPassword('correct-horse');
    expect(stored.startsWith('scrypt:')).toBe(true);
    expect(isLegacyHash(stored)).toBe(false);
  });

  it('salts — the same password hashes differently each time', () => {
    expect(hashPassword('same-password')).not.toBe(hashPassword('same-password'));
  });

  it('verifies a correct password and rejects a wrong one', () => {
    const stored = hashPassword('correct-horse');
    expect(verifyPassword('correct-horse', stored)).toBe(true);
    expect(verifyPassword('wrong-horse', stored)).toBe(false);
  });

  it('still verifies legacy sha256 hashes', () => {
    // Nobody gets locked out by the format change.
    const stored = legacyHash('old-password');
    expect(isLegacyHash(stored)).toBe(true);
    expect(verifyPassword('old-password', stored)).toBe(true);
    expect(verifyPassword('not-it', stored)).toBe(false);
  });

  it('rejects a malformed stored hash instead of throwing', () => {
    expect(verifyPassword('anything', 'garbage')).toBe(false);
    expect(verifyPassword('anything', 'scrypt:only-one-part')).toBe(false);
  });
});

describe('POST /api/auth — registration + legacy upgrade', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
  });

  it('stores a scrypt hash on registration', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@example.com', name: 'New', password: 'pw-test-1234' });

    const user = await prisma.user.findFirst({ where: { email: 'new@example.com' } });
    expect(user?.password_hash.startsWith('scrypt:')).toBe(true);
  });

  it('rejects a password shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'short@example.com', name: 'Short', password: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('at least 8 characters');
  });

  it('lets a legacy-hashed user log in, and upgrades their hash in place', async () => {
    // Seed a user the old way, as an existing production row would look.
    await prisma.user.create({
      data: {
        email: 'legacy@example.com',
        name: 'Legacy',
        password_hash: legacyHash('old-password'),
        token: 'legacy-token',
      },
    });

    const before = await prisma.user.findFirst({ where: { email: 'legacy@example.com' } });
    expect(isLegacyHash(before!.password_hash)).toBe(true);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'legacy@example.com', password: 'old-password' });

    expect(res.status).toBe(200);

    const after = await prisma.user.findFirst({ where: { email: 'legacy@example.com' } });
    expect(after!.password_hash.startsWith('scrypt:')).toBe(true);
    expect(verifyPassword('old-password', after!.password_hash)).toBe(true);
  });

  it('does not upgrade the hash on a FAILED login', async () => {
    await prisma.user.create({
      data: {
        email: 'legacy2@example.com',
        name: 'Legacy2',
        password_hash: legacyHash('old-password'),
        token: 'legacy-token-2',
      },
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'legacy2@example.com', password: 'wrong' });

    expect(res.status).toBe(401);

    const after = await prisma.user.findFirst({ where: { email: 'legacy2@example.com' } });
    expect(isLegacyHash(after!.password_hash)).toBe(true);
  });
});
