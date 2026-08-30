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
 * **In-process and per-instance, deliberately — see ADR-018.** The counter lives in a
 * Map in this process. Render runs a single instance today, so that is the whole fleet;
 * if a second instance is ever added, each gets its own budget and the effective limit
 * multiplies by the instance count. Fixing that means a shared store (Redis, or a
 * table), which is a real dependency and a real decision — not something to smuggle
 * in behind a middleware. `assertSingleInstanceAssumption()` below is what makes that
 * assumption fail loudly instead of silently; `__tests__/rateLimitScope.test.ts` is
 * the other half, guarding `render.yaml`.
 *
 * Fixed window, not a sliding one: a caller can burst up to `max` at the end of one
 * window and again at the start of the next. That is a known and accepted property
 * — the point here is to bound sustained abuse, not to smooth traffic.
 *
 * **This middleware is for AUTHENTICATED routes only, and that is structural, not a
 * preference.** Mount it AFTER requireAuth: the key is the user id, so an anonymous
 * request has nothing to key on, and it fails closed with a 401 rather than falling
 * back to an IP — which would be trivially spoofable behind a proxy and would silently
 * create a second, weaker policy.
 *
 * The consequence is easy to miss and expensive to discover: **mounting this on
 * `POST /api/auth/login` would 401 every login attempt.** CodeQL alert #7 flags that
 * route for `js/missing-rate-limiting` and it is the highest-severity of the three
 * open alerts, so the temptation to reach for this file is real. It cannot be reused
 * there. Brute-force limiting on an unauthenticated route needs a different key (IP or
 * submitted email) and an eviction policy this Map does not have — tracked in
 * [#148](https://github.com/slickG0ose/storybook/issues/148), reasoned in ADR-018.
 *
 * Admin routes (alerts #5 and #6) sit behind `adminGate`, so they ARE authenticated and
 * this middleware does apply to them unchanged.
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

/**
 * Never evicted. One entry per (bucket, user id) for the life of the process, which is
 * bounded by the user table and fine at today's scale. It would NOT be fine keyed by IP
 * — an unbounded key space makes this Map a memory-growth vector. Named here because
 * the eviction policy and the keying decision are the same decision (ADR-018).
 */
const counters = new Map<string, Counter>();

/**
 * Fails loudly when the single-instance assumption this module is built on stops
 * holding.
 *
 * The failure mode being guarded is silent by nature: scale to two instances and the
 * effective limit doubles with no error, no log, and no test going red. Nothing about
 * serving traffic would look wrong.
 *
 * Render exposes no reliable runtime instance count, so this reads an explicit
 * `RATE_LIMIT_INSTANCE_COUNT`, which an operator sets when they scale. That is a real
 * gap — an operator who scales without setting it gets no signal here, which is exactly
 * why `__tests__/rateLimitScope.test.ts` guards the declared `render.yaml` separately.
 * Two imperfect surfaces covering different paths, rather than one that looks complete.
 *
 * Throws in production and warns elsewhere, matching the `ALLOW_INSECURE_TLS` guard in
 * `index.ts`: a local experiment should be possible, a silently-weakened production
 * limit should not.
 */
export function assertSingleInstanceAssumption(
  env: NodeJS.ProcessEnv = process.env,
  log: (message: string) => void = console.warn,
): void {
  const raw = env.RATE_LIMIT_INSTANCE_COUNT;
  if (raw === undefined || raw.trim() === '') return;

  const declared = Number.parseInt(raw, 10);
  // A malformed value falls back to "assume one", matching how spend.ts treats a
  // malformed limit: a typo must not be the thing that disables the guard.
  if (!Number.isFinite(declared) || declared <= 1) return;

  const message =
    `rateLimit is in-process and per-instance (ADR-018), but RATE_LIMIT_INSTANCE_COUNT=${raw}. ` +
    `Each instance keeps its own counter, so the effective limit is ${declared}x what every ` +
    `rateLimit() call site declares. Move the counter to a shared store before scaling, or ` +
    `lower each route's max accordingly and record that here.`;

  if (env.NODE_ENV === 'production') {
    throw new Error(`[rateLimit] ${message}`);
  }
  log(`[rateLimit] ${message}`);
}

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
