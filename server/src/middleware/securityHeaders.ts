import type { Request, Response, NextFunction } from 'express';

/**
 * Baseline response headers for the API (#208). Hand-written rather than helmet: it is
 * four headers and a new dependency would go through the design gate.
 *
 * Deliberately NOT set: Cross-Origin-Resource-Policy, Cross-Origin-Embedder-Policy, and
 * any CSP that restricts fetch/img-src. The client lives on a different origin (GitHub
 * Pages) and loads the API and /illustrations, /uploads and /hero images cross-origin;
 * CORP same-origin would break every one of those. Framing is blocked via
 * X-Frame-Options, so no CSP is needed at all.
 *
 * Pair with `app.disable('x-powered-by')` in index.ts.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Read per request so tests can flip NODE_ENV. Production only: browsers ignore HSTS
  // over plain-http dev, and it would be noise there.
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}
