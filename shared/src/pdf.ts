import { z } from 'zod';

// ---------------------------------------------------------------------------
// POST /api/books/:id/pdf — request body
// ---------------------------------------------------------------------------
// MVP body is empty. Two things to know:
//
//   1. `req.body` is `undefined` (not `{}`) when a client POSTs with no body.
//      Without the preprocess step, `z.object({}).strict()` would reject
//      undefined and the route would always 400. Coerce only undefined →
//      {}; let null / strings / arrays fall through to strict and fail.
//   2. `.strict()` rejects unknown keys so a future field rename (PS2:
//      { format: 'screen' | 'print' }) can't silently land — the test will
//      fail and force a schema bump.
export const BookPdfRequestSchema = z.preprocess(
  (v) => (v === undefined ? {} : v),
  z.object({}).strict(),
);
export type BookPdfRequest = z.infer<typeof BookPdfRequestSchema>;

// ---------------------------------------------------------------------------
// POST /api/books/:id/pdf — error response envelope
// ---------------------------------------------------------------------------
// Wire-shape carve-out: this route's 2xx response is a binary PDF stream
// (Content-Type: application/pdf), NOT JSON — there is no success schema to
// pin. The Supertest assertion instead checks Content-Type + the %PDF- magic
// bytes + Content-Disposition. Every 4xx/5xx envelope, however, still goes
// over JSON and matches the shared `ErrorResponseSchema` shape — re-exported
// here under a domain-specific name so route tests can `import` it without
// reaching into the orders domain, but the underlying definition stays in
// one place to prevent drift across domains.
export { ErrorResponseSchema as BookPdfErrorResponseSchema } from './orders';
export type { ErrorResponse as BookPdfErrorResponse } from './orders';
