import { z } from 'zod';

// ---------------------------------------------------------------------------
// POST /api/books/:id/pdf — request body
// ---------------------------------------------------------------------------
// MVP body is empty. The `.strict()` modifier rejects unknown keys so a
// future field rename (PS2: { format: 'screen' | 'print' }) can't silently
// land — the test will fail and force a schema bump.
export const BookPdfRequestSchema = z.object({}).strict();
export type BookPdfRequest = z.infer<typeof BookPdfRequestSchema>;

// ---------------------------------------------------------------------------
// POST /api/books/:id/pdf — error response envelope
// ---------------------------------------------------------------------------
// Wire-shape carve-out: this route's 2xx response is a binary PDF stream
// (Content-Type: application/pdf), NOT JSON — there is no success schema to
// pin. The Supertest assertion instead checks Content-Type + the %PDF- magic
// bytes + Content-Disposition. Every 4xx/5xx envelope, however, still goes
// over JSON and matches the shape below — that's what callers parse when
// res.ok is false. Mirrors the shared ErrorResponseSchema in orders.ts but
// kept local so this domain owns its own contract.
export const BookPdfErrorResponseSchema = z.object({
  error: z.string(),
});
export type BookPdfErrorResponse = z.infer<typeof BookPdfErrorResponseSchema>;
