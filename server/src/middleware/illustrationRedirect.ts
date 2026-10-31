import type { Request, Response, NextFunction } from 'express';
import { isValidKey, readR2Config, resolveBackendName } from '../services/storage';

// Fallback for the /illustrations mount (ADR-026). Mounted AFTER
// express.static, so it only ever sees requests the local disk could not
// answer:
//
//   - local backend: next() — the request falls through to Express's default
//     404, exactly as it did before this handler existed.
//   - r2 backend:    302 to `${R2_PUBLIC_BASE_URL}/<key>`. Generated-image bytes
//     never cross the Render instance; the bucket is public-read.
//
// The redirect target host is ALWAYS R2_PUBLIC_BASE_URL. The key is validated by
// the storage seam (no `..`, leading `/`, backslash, NUL, or `.` segment) and
// each path segment is percent-encoded, so the request path cannot steer the
// Location anywhere else. An invalid key is a 404, never a redirect.
export function illustrationRedirect(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (resolveBackendName() !== 'r2') return next();

  // req.path is relative to the mount ("/<bookId>/page-1-v1.png") and still
  // percent-encoded. A malformed escape is not a key.
  let key: string;
  try {
    key = decodeURIComponent(req.path.replace(/^\//, ''));
  } catch {
    return next();
  }
  if (!isValidKey(key) || key.endsWith('/')) return next();

  const { publicBaseUrl } = readR2Config();
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  res.redirect(302, `${publicBaseUrl}/${encoded}`);
}
