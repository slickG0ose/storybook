import type { CorsOptions } from 'cors';

// ---------------------------------------------------------------------------
// CORS origin policy
// ---------------------------------------------------------------------------
// The server shipped with a bare `app.use(cors())` — `Access-Control-Allow-
// Origin: *` — through the Render deploy. Auth here is a Bearer token in the
// Authorization header rather than an ambient cookie, so this was never the
// classic cross-site-request vulnerability: a browser won't attach a token to
// a cross-origin call on its own. What it did allow is any page on the web
// scripting the whole API surface from a victim's browser (and reading the
// response), which is worth closing now that the service is public.
//
// Policy:
//   - CORS_ORIGIN set    → allow exactly those origins, nothing else.
//   - unset, non-prod    → allow any origin. Local dev hits the API from Vite
//                          on :5173, Playwright on another port, and curl.
//   - unset, production  → warn loudly, stay permissive. A misconfigured env
//                          var must not take a live service offline; the
//                          Render Blueprint supplies the value, so this branch
//                          only fires when something has drifted.
// ---------------------------------------------------------------------------

/**
 * Parses `CORS_ORIGIN` into a normalised allowlist. Comma-separated; blank
 * entries are dropped so a trailing comma is harmless. Origins are lowercased
 * because browsers send the scheme and host lowercased regardless of how the
 * value was typed into a dashboard.
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map(o => o.trim().toLowerCase().replace(/\/+$/, ''))
    .filter(o => o.length > 0);
}

export interface CorsPolicy {
  options: CorsOptions;
  /** Non-null when the caller should log a startup warning. */
  warning: string | null;
  /** Empty when the policy is permissive. Exposed for tests and logging. */
  allowed: string[];
}

export function buildCorsPolicy(env: NodeJS.ProcessEnv = process.env): CorsPolicy {
  const allowed = parseAllowedOrigins(env.CORS_ORIGIN);
  const isProduction = env.NODE_ENV === 'production';

  if (allowed.length === 0) {
    return {
      allowed,
      options: { origin: true, credentials: true },
      warning: isProduction
        ? 'CORS_ORIGIN is not set — every origin is allowed. Set it to the client origin ' +
          '(e.g. https://slickg0ose.github.io) in the Render dashboard or render.yaml.'
        : null,
    };
  }

  return {
    allowed,
    warning: null,
    options: {
      credentials: true,
      // Requests with no Origin header — same-origin navigations, curl, the
      // Render health check — must pass. `origin` is undefined for those, and
      // rejecting them would fail the health check and spin the service down.
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        const normalized = origin.trim().toLowerCase().replace(/\/+$/, '');
        if (allowed.includes(normalized)) return callback(null, true);
        // Reject by declining the origin, not by erroring. `cors` then omits
        // the Access-Control-Allow-Origin header and the browser blocks the
        // read — which is the intended outcome. Passing an Error here would
        // instead surface a 500 through the error middleware.
        return callback(null, false);
      },
    },
  };
}
