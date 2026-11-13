import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * Password hashing.
 *
 * Stored format is `scrypt:<salt>:<hash>`. scrypt is deliberately slow and
 * memory-hard, so a leaked hash is expensive to brute-force offline.
 *
 * There used to be a second, legacy format: a bare `<salt>:<hash>` of a SINGLE
 * sha256 round, which verified and was re-hashed to scrypt on the next login.
 * That compatibility path was removed in #68 once prod (Neon) and dev.db both
 * held zero rows in it. A row in the old format now simply fails to verify;
 * the fix for such a user is a password reset, not reviving the weak hash.
 *
 * scrypt is in Node's stdlib — no new dependency.
 *
 * This lives in its own module rather than in the auth route because the
 * Prisma seed scripts need it too. It previously didn't, and the seed carried
 * a duplicate copy of the weak hash that got left behind when the real one
 * changed — CodeQL caught it as js/insufficient-password-hash.
 */
const SCRYPT_PREFIX = 'scrypt';
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${SCRYPT_PREFIX}:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [prefix, salt, hash] = stored.split(':');
  if (prefix !== SCRYPT_PREFIX || !salt || !hash) return false;
  const check = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  if (check.length !== expected.length) return false;
  return timingSafeEqual(check, expected);
}
