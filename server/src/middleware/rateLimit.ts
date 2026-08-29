import type { Request, Response, NextFunction } from 'express';

/**
 * A fixed-window, per-user rate limiter.
 *
 * Exists because spend gating and rate limiting protect against different things
 * (#96). The spend gate stops a caller from spending more than their quota; it does
 * nothing about a caller making a hundred cheap requests a second. A multipart
 * upload plus a model call is a cheap request to make and an expensive one to serve,
 * and CodeQL flags the filesystem write on an unlimited route as
 * `js/missing-rate-limiting` — correctly.
 *
 * **In-process and per-instance, deliberately.** The counter lives in a Map in this
 * process. Render runs a single instance today, so that is the whole fleet; if a
 * second instance is ever added, each gets its own budget and the effective limit
 * multiplies by the instance count. Fixing that means a shared store (Redis, or a
 * table), which is a real dependency and a real decision — not something to smuggle
 * in behind a middleware. Revisit when the deploy stops being one box.
 *
 * Fixed window, not a sliding one: a caller can burst up to `max` at the end of one
 * window and again at the start of the next. That is a known and accepted property
 * — the point here is to bound sustained abuse, not to smooth traffic.
 *
 * Mount AFTER requireAuth: the key is the user id, so an anonymous request has
 * nothing to key on. It fails closed with a 401 rather than falling back to an IP,
 * which would be trivially spoofable behind a proxy and would silently create a
 * second, weaker policy.
 */
export interface RateLimitOptions {
  /** Requests permitted per window, per user. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Distinguishes counters when several routes use this middleware. */
  bucket: string;
}

interface Counter {
  count: number;
  windowStartedAt: number;
}

const counters = new Map<string, Counter>();

/** Exported for tests — there is no other way to get a clean window. */
export function resetRateLimits(): void {
  counters.clear();
}

export function rateLimit({ max, windowMs, bucket }: RateLimitOptions) {
  return function rateLimitMiddleware(_req: Request, res: Response, next: NextFunction): void {
    const user = res.locals.user as { id: string } | undefined;
    if (!user) {
      // Mounted without requireAuth in front of it. Fail closed, matching spendGate.
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const key = `${bucket}:${user.id}`;
    const now = Date.now();
    const existing = counters.get(key);

    if (!existing || now - existing.windowStartedAt >= windowMs) {
      counters.set(key, { count: 1, windowStartedAt: now });
      next();
      return;
    }

    if (existing.count < max) {
      existing.count += 1;
      next();
      return;
    }

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.windowStartedAt + windowMs - now) / 1000),
    );
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      error: 'Too many uploads in a short time. Try again in a moment.',
      retryAfterSeconds,
    });
  };
}
