import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema, ZodTypeAny } from 'zod';

// ---------------------------------------------------------------------------
// validate() — Zod-backed Express middleware
//
// Validates the inbound request body against `requestSchema`. Optionally also
// validates outbound responses by wrapping res.json — but only for `success`
// status codes (2xx). Error responses (4xx/5xx) have their own shape and pass
// through untouched.
//
// Drift behavior:
//   - process.env.NODE_ENV !== 'production'  →  console.error + 500 envelope (loud, non-fatal)
//   - process.env.NODE_ENV === 'production'  →  console.warn + serve body as-is (soft)
//
// Rationale: this exists to catch the OrderConfirmation `book_title` vs
// `title` class of drift bug at test time, NOT to 500 every customer on a
// bad deploy. The shape of the request schema is always enforced strictly
// (returns 400). Response drift is the one we soften in prod.
//
// We MUST NOT throw from patchedJson — async route handlers reject and
// Express 4 does not forward async rejections to the error middleware,
// which makes Node exit on unhandledRejection and kills the dev server.
// Instead we send a 500 envelope using the captured `originalJson` so we
// don't recurse into the patched version. Loud (visible in console + the
// request fails) without taking the process down.
// ---------------------------------------------------------------------------

export interface ValidateOptions<TReq extends ZodTypeAny, TRes extends ZodTypeAny> {
  request?: TReq;
  response?: TRes;
  /**
   * Human-readable label used in error messages / warn logs. Defaults to
   * `${req.method} ${req.path}` if not provided.
   */
  name?: string;
}

export function validate<TReq extends ZodTypeAny, TRes extends ZodTypeAny>(
  options: ValidateOptions<TReq, TRes>,
) {
  const { request: requestSchema, response: responseSchema, name } = options;

  return function validateMiddleware(req: Request, res: Response, next: NextFunction): void {
    const routeLabel = name ?? `${req.method} ${req.path}`;

    // --- Request validation ---------------------------------------------
    if (requestSchema) {
      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success) {
        const summary = summarizeIssues(parsed.error.issues);
        res.status(400).json({ error: `Invalid request body: ${summary}` });
        return;
      }
      // Replace req.body with the parsed (and possibly coerced) value so
      // handlers operate on validated data.
      req.body = parsed.data;
    }

    // --- Response validation (wrap res.json) ----------------------------
    if (responseSchema) {
      const originalJson = res.json.bind(res);
      res.json = function patchedJson(body: unknown) {
        // Only validate successful responses. Error envelopes (e.g.
        // `{ error: '...' }` with status 4xx/5xx) are intentionally
        // exempt — they have a different shape.
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // Validate the post-JSON-serialization shape — that's what the
          // client actually receives. Otherwise Date/BigInt/undefined etc.
          // produce false positives against a schema that describes the wire.
          const wireBody: unknown = JSON.parse(JSON.stringify(body));
          const parsed = (responseSchema as ZodSchema<unknown>).safeParse(wireBody);
          if (!parsed.success) {
            const summary = summarizeIssues(parsed.error.issues);
            const message =
              `Response shape drift on ${routeLabel}: ${summary}. ` +
              `Update the Zod schema in @storybook/shared or fix the handler.`;
            if (process.env.NODE_ENV !== 'production') {
              console.error('[validate] ' + message);
              res.status(500);
              return originalJson({ error: message });
            }
            console.warn('[validate] ' + message);
          }
        }
        return originalJson(body);
      };
    }

    next();
  };
}

interface ZodIssueLike {
  path: (string | number)[];
  message: string;
}

function summarizeIssues(issues: ZodIssueLike[]): string {
  return issues
    .slice(0, 5)
    .map(i => {
      const path = i.path.length > 0 ? i.path.join('.') : '<root>';
      return `${path}: ${i.message}`;
    })
    .join('; ');
}
