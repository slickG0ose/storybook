import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * Password hashing.
 *
 * Stored format is `scrypt:<salt>:<hash>`. The legacy format was a bare
 * `<salt>:<hash>` of a SINGLE sha256 round — fast enough to brute-force
 * offline, which is the whole problem: a fast hash is a weak hash. scrypt is
 * deliberately slow and memory-hard.
 *
 * Legacy hashes still verify, so nobody is locked out. On a successful login
 * against a legacy hash the auth route transparently re-hashes to scrypt, so
 * the old format drains as users sign in rather than needing a migration or a
 * forced reset.
 *
 * scrypt is in Node's stdlib — no new dependency, which also keeps this off
 * the CLAUDE.md "new dependency" guardrail.
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

/** True when the stored hash still uses the legacy single-round sha256 format. */
export function isLegacyHash(stored: string): boolean {
  return !stored.startsWith(`${SCRYPT_PREFIX}:`);
}

export function verifyPassword(password: string, stored: string): boolean {
  if (isLegacyHash(stored)) {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const check = createHash('sha256').update(salt + password).digest('hex');
    // Both sides are fixed-length hex of our own making, so the lengths match
    // and timingSafeEqual won't throw.
    return timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
  }

  const [, salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  if (check.length !== expected.length) return false;
  return timingSafeEqual(check, expected);
}
