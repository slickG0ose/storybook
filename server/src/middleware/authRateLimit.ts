import { isIPv4, isIPv6 } from 'node:net';
import type { Request, Response, NextFunction } from 'express';

/**
 * Brute-force limiter for the unauthenticated auth routes (CodeQL alert #7, ADR-030).
 *
 * A separate module from `rateLimit.ts` because that one cannot go here: it keys on
 * `res.locals.user`, so it would 401 every login attempt (ADR-018). This file answers
 * the three questions ADR-018 left open for an anonymous key:
 *
 * **What it keys on: `req.ip`, reduced to a /64 for IPv6.** One IPv6 customer commonly
 * holds a whole /64, so keying on the full address would hand them 2^64 budgets. `req.ip`
 * is only as good as the `trust proxy` setting; see `resolveTrustProxyHops()`.
 *
 * **How it evicts: least-recently-attempted first, capped at MAX_TRACKED_KEYS.** Every
 * attempt re-inserts its key at the end of the Map, so expired keys collect at the front
 * and each sweep stops at the first live one. An attacker rotating addresses can push
 * out older entries, including their own, but cannot grow memory past the cap.
 *
 * **Who it can lock out: only callers who keep failing.** A successful request gives its
 * attempt back, so a family behind one router is not counted for logging in. The attempt
 * is taken on the way in and refunded on the way out, not counted after the handler
 * fails: otherwise a parallel burst would all pass the check before the first failure
 * was recorded. A success does not clear earlier failures, or an attacker could reset
 * the budget by logging in to their own account between guesses.
 *
 * Sliding window, unlike `rateLimit.ts`, because ADR-018 rejected the fixed window's 2x
 * boundary burst for password guessing. In-process and per-instance like `rateLimit.ts`,
 * and covered by the same single-instance guards. Counters reset on every restart,
 * including each free-tier cold start.
 */
export const AUTH_RATE_LIMIT_MAX = 10;
export const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const MAX_TRACKED_KEYS = 50_000;

/** Attempt timestamps per key, oldest first. Map order is least-recently-attempted first. */
const attemptsByKey = new Map<string, number[]>();

/** Exported for tests — there is no other way to get a clean window. */
export function resetAuthRateLimits(): void {
  attemptsByKey.clear();
}

export function trackedKeyCount(): number {
  return attemptsByKey.size;
}

/**
 * How many proxies to trust when Express reads `X-Forwarded-For`.
 *
 * The left-most entries of that header can be whatever the client sent, and Render is
 * reported to append rather than replace. Counting hops from the right is what makes it
 * safe, and the count is asymmetric when wrong:
 *
 *   - Too high reads a client-supplied entry, so an attacker gets a fresh budget per
 *     request. The limiter silently stops working.
 *   - Too low reads a proxy's address, so clients on that proxy share one budget. Logins
 *     can be blocked, but guessing stays bounded.
 *
 * So the production default is 1, the low end, and a malformed value falls back to the
 * default rather than to trusting anything. Render's real hop count is unconfirmed; the
 * check that settles it against the live service is in ADR-030.
 */
export function resolveTrustProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  const fallback = env.NODE_ENV === 'production' ? 1 : 0;
  const raw = env.TRUST_PROXY_HOPS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  return Number.parseInt(raw, 10);
}

/** The address a budget belongs to: IPv4 as-is, IPv6 reduced to its /64. */
export function clientKey(ip: string | undefined): string {
  if (!ip) return 'unknown';

  const mapped = /^::ffff:(.+)$/i.exec(ip);
  if (mapped && isIPv4(mapped[1])) return mapped[1];
  if (!isIPv6(ip)) return ip;

  const [head, tail = ''] = ip.split('%')[0].split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  // An embedded dotted quad (::1.2.3.4) only ever sits in the low 32 bits, which the
  // /64 discards, but it still occupies two groups when counting what `::` stands for.
  const tailLength = tailGroups.reduce((n, group) => n + (group.includes('.') ? 2 : 1), 0);
  const zeros = new Array<string>(Math.max(0, 8 - headGroups.length - tailLength)).fill('0');
  const network = [...headGroups, ...zeros, ...tailGroups]
    .slice(0, 4)
    .map((group) => group.toLowerCase().replace(/^0+(?=.)/, ''));
  return `${network.join(':')}::/64`;
}

function evict(now: number): void {
  for (const [key, attempts] of attemptsByKey) {
    const expired = attempts[attempts.length - 1] + AUTH_RATE_LIMIT_WINDOW_MS <= now;
    if (!expired && attemptsByKey.size < MAX_TRACKED_KEYS) return;
    attemptsByKey.delete(key);
  }
}

function refund(key: string, attemptedAt: number): void {
  const attempts = attemptsByKey.get(key);
  if (!attempts) return;
  const index = attempts.lastIndexOf(attemptedAt);
  if (index !== -1) attempts.splice(index, 1);
  if (attempts.length === 0) attemptsByKey.delete(key);
}

/** `bucket` keeps each route's budget separate, so failed signups cannot block logins. */
export function authRateLimit(bucket: string) {
  return function authRateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const key = `${bucket}:${clientKey(req.ip)}`;
    const now = Date.now();
    const cutoff = now - AUTH_RATE_LIMIT_WINDOW_MS;
    const attempts = (attemptsByKey.get(key) ?? []).filter((at) => at > cutoff);

    if (attempts.length >= AUTH_RATE_LIMIT_MAX) {
      attemptsByKey.set(key, attempts);
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((attempts[0] + AUTH_RATE_LIMIT_WINDOW_MS - now) / 1000),
      );
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: 'Too many failed attempts. Please try again later.',
        retryAfterSeconds,
      });
      return;
    }

    attempts.push(now);
    attemptsByKey.delete(key);
    evict(now);
    attemptsByKey.set(key, attempts);

    res.once('finish', () => {
      if (res.statusCode < 400) refund(key, now);
    });
    next();
  };
}
