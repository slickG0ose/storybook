import { z } from 'zod';

// ---------------------------------------------------------------------------
// Test-only cleanup endpoint schemas. The router is only mounted outside
// production, but Playwright specs in `e2e/` and the test suite both rely on
// the request/response shape — pinning it here catches drift the same way
// production routes are covered.
// ---------------------------------------------------------------------------

// DELETE /api/_test/user-by-email
export const TestUserDeleteRequestSchema = z.object({
  email: z
    .string({ required_error: 'email is required' })
    .min(1, 'email is required'),
});
export type TestUserDeleteRequest = z.infer<typeof TestUserDeleteRequestSchema>;

export const TestUserDeleteResponseSchema = z.object({
  ok: z.literal(true),
  // 0 when the email had no matching user (idempotent path), 1 when a row was
  // actually deleted. Keep as a plain integer rather than a literal-union to
  // avoid coupling the schema to the handler's branch structure.
  deleted: z.number().int().min(0).max(1),
});
export type TestUserDeleteResponse = z.infer<typeof TestUserDeleteResponseSchema>;
