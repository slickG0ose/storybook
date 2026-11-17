/**
 * Serving for /illustrations and /uploads (#237, decisions 1 and 6 stage 1).
 *
 * Per root: mediaGate -> express.static -> mediaPresignRedirect.
 *
 *   - mediaGate verifies the signed link (lib/mediaUrl.ts) for EVERY backend.
 *     enforce: a bad or missing link is 403 `{ error: 'Link expired' }`, no-store.
 *     lenient (rollout stage 1): it is counted and let through, so today's
 *     unsigned URLs keep working until the API signs them (Task 5).
 *   - express.static serves a disk hit, with `private, max-age` bounded by the
 *     link's own expiry so no cache outlives it.
 *   - mediaPresignRedirect handles a disk MISS under the r2 backend: 302 to a
 *     short presigned R2 GET. The Location host is always the R2 endpoint; the
 *     key is validated, so the request path cannot steer it elsewhere. An
 *     invalid key is a 404, never a redirect, in both modes.
 *
 * The `uploads` root presigns through getUploadStorage(), whose R2 client prefixes
 * every key with `uploads/` in the bucket.
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { MEDIA_PATH_RE, MEDIA_ROOTS, mediaPath, type MediaRoot } from '@storybook/shared';
import { getMediaConfig, mediaWindow, signMediaPath, verifyMediaRequest } from '../lib/mediaUrl';
import { ILLUSTRATIONS_DIR, R2Storage, UPLOADS_DIR, getStorage, getUploadStorage, resolveBackendName } from '../services/storage';

const ROOT_DIRS: Record<MediaRoot, string> = {
  illustrations: ILLUSTRATIONS_DIR,
  uploads: UPLOADS_DIR,
};

let lenientCount = 0;
/** Unsigned/invalid requests let through under lenient since boot. Watch it fall to ~0 before enforce. */
export function getLenientMediaCount(): number {
  return lenientCount;
}
export function __resetLenientMediaCountForTests(): void {
  lenientCount = 0;
}

const isReadMethod = (req: Request): boolean => req.method === 'GET' || req.method === 'HEAD';

// The `uploads/` first segment belongs to the uploads root. It is never served
// or presigned through /illustrations (same fence as mediaUrl.reservedForOtherRoot).
const reservedForOtherRoot = (root: MediaRoot, key: string): boolean =>
  root === 'illustrations' && key.split('/')[0] === 'uploads';

export function mediaGate(root: MediaRoot): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isReadMethod(req)) return next();
    const cfg = getMediaConfig();
    const result = verifyMediaRequest(root, req.path, req.query as Record<string, unknown>, new Date(), cfg);
    res.locals.mediaKey = result.key ?? null;
    if (result.ok) {
      res.locals.mediaExpiresAt = result.expiresAt;
      return next();
    }
    if (cfg.mode === 'enforce') {
      res.setHeader('Cache-Control', 'no-store');
      res.status(403).json({ error: 'Link expired' });
      return;
    }
    lenientCount += 1;
    if (lenientCount === 1 || lenientCount % 100 === 0) {
      // Reason only; never the query string, which carries the signature.
      console.warn(`[media] lenient: served ${lenientCount} request(s) without a valid link (last reason: ${result.reason})`);
    }
    res.locals.mediaExpiresAt = null;
    next();
  };
}

function cacheControlFor(res: Response): string | null {
  const e = res.locals.mediaExpiresAt as number | null | undefined;
  if (typeof e !== 'number') return null;
  return `private, max-age=${Math.max(0, e - Math.floor(Date.now() / 1000))}`;
}

export function mediaPresignRedirect(root: MediaRoot): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!isReadMethod(req)) return next();
      if (resolveBackendName() !== 'r2') return next();
      const key = res.locals.mediaKey as string | null | undefined;
      if (!key || reservedForOtherRoot(root, key)) return next();
      const storage = root === 'uploads' ? getUploadStorage() : getStorage();
      if (!(storage instanceof R2Storage)) return next();

      const { ttlMinutes } = getMediaConfig();
      const window = mediaWindow(new Date(), ttlMinutes);
      const mediaExpiresAt = res.locals.mediaExpiresAt as number | null | undefined;
      const expiresAt = typeof mediaExpiresAt === 'number' ? mediaExpiresAt : window.expiresAt;
      const url = await storage.presignGet(key, {
        signingDate: window.windowStart,
        expiresIn: expiresAt - Math.floor(window.windowStart.getTime() / 1000),
      });
      const cc = cacheControlFor(res);
      if (cc) res.setHeader('Cache-Control', cc);
      res.redirect(302, url);
    } catch (err) {
      next(err);
    }
  };
}

export const DEFAULT_MEDIA_RATE_LIMIT_PER_MINUTE = 600;
const MIN_MEDIA_RATE_LIMIT = 60;
const MAX_MEDIA_RATE_LIMIT = 100_000;
export const MEDIA_RATE_LIMIT_WINDOW_MS = 60_000;
export const MEDIA_RATE_LIMIT_ERROR = 'Too many requests. Try again in a minute.';

/**
 * Requests per IP per minute across both media roots (spec §Amendment 2026-11-17).
 * Anything but an integer in range falls back to the default with one warning, never
 * to "unlimited", so a typo cannot switch the limit off.
 */
export function resolveMediaRateLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MEDIA_RATE_LIMIT_PER_MINUTE;
  if (raw === undefined || raw.trim() === '') return DEFAULT_MEDIA_RATE_LIMIT_PER_MINUTE;
  if (/^\d+$/.test(raw.trim())) {
    const n = Number(raw.trim());
    if (n >= MIN_MEDIA_RATE_LIMIT && n <= MAX_MEDIA_RATE_LIMIT) return n;
  }
  console.warn(
    `MEDIA_RATE_LIMIT_PER_MINUTE is not an integer from ${MIN_MEDIA_RATE_LIMIT} to ${MAX_MEDIA_RATE_LIMIT}; using ${DEFAULT_MEDIA_RATE_LIMIT_PER_MINUTE}`,
  );
  return DEFAULT_MEDIA_RATE_LIMIT_PER_MINUTE;
}

export function mountMedia(app: Express): void {
  // One budget per client across /illustrations and /uploads, checked BEFORE the
  // signature gate so bad links cost the same as good ones. Keyed on req.ip, which is
  // the real client only when `trust proxy` is right (TRUST_PROXY_HOPS, ADR-030); IPv6
  // is reduced to a /64 like authRateLimit.ts. In-process store: ADR-018's
  // single-instance assumption. CodeQL alert #41.
  const mediaRateLimiter = rateLimit({
    windowMs: MEDIA_RATE_LIMIT_WINDOW_MS,
    limit: resolveMediaRateLimit(),
    ipv6Subnet: 64,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
      res.setHeader('Cache-Control', 'no-store');
      res.status(options.statusCode).json({ error: MEDIA_RATE_LIMIT_ERROR });
    },
  });
  for (const root of MEDIA_ROOTS) {
    app.use(
      `/${root}`,
      mediaRateLimiter,
      mediaGate(root),
      express.static(ROOT_DIRS[root], {
        setHeaders: res => {
          const cc = cacheControlFor(res as unknown as Response);
          if (cc) res.setHeader('Cache-Control', cc);
        },
      }),
      mediaPresignRedirect(root),
    );
  }
}

const SIGNED_KEYS = new Set(['illustration_url', 'cover_url', 'portrait_url', 'style_reference_url', 'url']);
const MAX_SIGN_DEPTH = 8;

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** Copy-on-write: returns the same reference when nothing under `value` changed. */
function signDeep(value: unknown, now: Date, depth: number): unknown {
  if (depth > MAX_SIGN_DEPTH) return value;
  if (Array.isArray(value)) {
    let out: unknown[] | null = null;
    value.forEach((item, i) => {
      const next = signDeep(item, now, depth + 1);
      if (next !== item) {
        out ??= value.slice();
        out[i] = next;
      }
    });
    return out ?? value;
  }
  if (!isPlainObject(value)) return value;
  let out: Record<string, unknown> | null = null;
  for (const [key, v] of Object.entries(value)) {
    let next: unknown = v;
    if (typeof v === 'string' && SIGNED_KEYS.has(key)) {
      // Canonicalise first, so an already-signed value is re-signed, not double-signed.
      if (MEDIA_PATH_RE.test(v)) next = signMediaPath(mediaPath(v), now);
    } else {
      next = signDeep(v, now, depth + 1);
    }
    if (next !== v) {
      out ??= { ...value };
      out[key] = next;
    }
  }
  return out ?? value;
}

/**
 * The outbound choke point (#237, decision 2). Mounted at `app.use('/api', ...)` ahead of every
 * router. Wraps `res.json` once and signs allowlisted media fields on a copy of the body; stored
 * rows are never mutated. `now` is captured once per response so every URL shares a window.
 */
export function signMediaResponses(_req: Request, res: Response, next: NextFunction): void {
  const original = res.json.bind(res);
  res.json = (body?: unknown): Response => original(signDeep(body, new Date(), 0));
  next();
}
