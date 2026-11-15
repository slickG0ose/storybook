/**
 * Bearer-token helpers: hash for storage, TTL config, issuing (#210).
 *
 * Pure: no Prisma, no Express. The wire token stays a UUIDv4; only its sha256
 * is stored in `User.token`, alongside `token_expires_at`.
 */
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

export const DEFAULT_TOKEN_TTL_DAYS = 30;
export const MAX_TOKEN_TTL_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

let warned = false;

/** sha256 hex (64 lowercase chars) of the bearer token. Unsalted on purpose: the input is a 122-bit random UUID. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Days a new token lives. Reads env at CALL time, never module scope.
 * Accepts /^\d+$/ integers from 1 to MAX_TOKEN_TTL_DAYS. Unset or blank -> default, silently.
 * Anything else -> default plus ONE console.warn per process naming the variable (not the value).
 */
export function resolveTokenTtlDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TOKEN_TTL_DAYS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_TOKEN_TTL_DAYS;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n >= 1 && n <= MAX_TOKEN_TTL_DAYS) return n;
  }
  if (!warned) {
    warned = true;
    console.warn(
      `TOKEN_TTL_DAYS is not an integer from 1 to ${MAX_TOKEN_TTL_DAYS}; using ${DEFAULT_TOKEN_TTL_DAYS}`,
    );
  }
  return DEFAULT_TOKEN_TTL_DAYS;
}

export interface IssuedToken {
  token: string; // UUIDv4, returned to the client, never stored
  tokenHash: string; // hashToken(token), stored in User.token
  expiresAt: Date; // now + resolveTokenTtlDays() days
}

export function issueToken(now: Date = new Date(), env: NodeJS.ProcessEnv = process.env): IssuedToken {
  const token = uuidv4();
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + resolveTokenTtlDays(env) * DAY_MS),
  };
}

/** Test hook for the warn-once latch. */
export function resetTokenTtlWarning(): void {
  warned = false;
}
