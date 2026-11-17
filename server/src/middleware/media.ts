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
 * The `uploads` root keys as `uploads/<key>` in the bucket. Task 6 moves that to
 * getUploadStorage(); until then it presigns through the illustrations client.
 */
import express from 'express';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { MEDIA_ROOTS, type MediaRoot } from '@storybook/shared';
import { getMediaConfig, mediaWindow, verifyMediaRequest } from '../lib/mediaUrl';
import { ILLUSTRATIONS_DIR, R2Storage, UPLOADS_DIR, getStorage, resolveBackendName } from '../services/storage';

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
      const storage = getStorage();
      if (!(storage instanceof R2Storage)) return next();

      const { ttlMinutes } = getMediaConfig();
      const window = mediaWindow(new Date(), ttlMinutes);
      const mediaExpiresAt = res.locals.mediaExpiresAt as number | null | undefined;
      const expiresAt = typeof mediaExpiresAt === 'number' ? mediaExpiresAt : window.expiresAt;
      const storageKey = root === 'uploads' ? `uploads/${key}` : key;
      const url = await storage.presignGet(storageKey, {
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

export function mountMedia(app: Express): void {
  for (const root of MEDIA_ROOTS) {
    app.use(
      `/${root}`,
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
