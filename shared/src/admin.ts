import { z } from 'zod';
import { BookSchema, BookWithPagesSchema } from './books';

// ---------------------------------------------------------------------------
// AdminUser — wire shape returned by /api/admin/users.
// Stripped of secrets (no password_hash, no token) by the route's stripUser().
// Date fields are strings on the wire (post-JSON.stringify).
// ---------------------------------------------------------------------------
export const UserRoleSchema = z.enum(['user', 'admin']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const AdminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  // The DB column is a free-form string today (Prisma `String @default("user")`),
  // so we accept any string here rather than enum-locking the wire shape.
  // Client-side narrowing happens via UserRole in client/src/types.ts.
  role: z.string(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const AdminUserListResponseSchema = z.array(AdminUserSchema);
export type AdminUserListResponse = z.infer<typeof AdminUserListResponseSchema>;

export const AdminUserRestoreResponseSchema = AdminUserSchema;
export type AdminUserRestoreResponse = z.infer<typeof AdminUserRestoreResponseSchema>;

// ---------------------------------------------------------------------------
// AdminBook — admin view of a book row.
//   - includes the `creator` join shape returned by `/api/admin/books`
//   - includes pages on restore/featured endpoints (they include pages in the
//     Prisma query)
// ---------------------------------------------------------------------------
export const AdminCreatorSchema = z
  .object({
    email: z.string(),
    name: z.string(),
  })
  .nullable();
export type AdminCreator = z.infer<typeof AdminCreatorSchema>;

// Admin list response: book row + creator. No pages (the list query doesn't
// include them).
export const AdminBookListItemSchema = BookSchema.extend({
  creator: AdminCreatorSchema,
});
export type AdminBookListItem = z.infer<typeof AdminBookListItemSchema>;

export const AdminBookListResponseSchema = z.array(AdminBookListItemSchema);
export type AdminBookListResponse = z.infer<typeof AdminBookListResponseSchema>;

// Restore / set-featured: returned with pages, no creator join.
export const AdminBookMutationResponseSchema = BookWithPagesSchema;
export type AdminBookMutationResponse = z.infer<typeof AdminBookMutationResponseSchema>;

// ---------------------------------------------------------------------------
// PUT /api/admin/books/:id/featured
// ---------------------------------------------------------------------------
export const AdminBookFeaturedRequestSchema = z.object({
  is_featured: z.boolean({
    required_error: 'is_featured must be a boolean',
    invalid_type_error: 'is_featured must be a boolean',
  }),
});
export type AdminBookFeaturedRequest = z.infer<typeof AdminBookFeaturedRequestSchema>;

// ---------------------------------------------------------------------------
// GET /api/admin/orphan-illustrations — directories on disk with no live book
// ---------------------------------------------------------------------------
export const OrphanIllustrationSchema = z.object({
  path: z.string(),
  book_exists: z.boolean(),
  soft_deleted: z.boolean(),
});
export type OrphanIllustration = z.infer<typeof OrphanIllustrationSchema>;

export const OrphanIllustrationListResponseSchema = z.array(OrphanIllustrationSchema);
export type OrphanIllustrationListResponse = z.infer<typeof OrphanIllustrationListResponseSchema>;

// ---------------------------------------------------------------------------
// DELETE /api/admin/orphan-illustrations/:id — remove a directory on disk
// that has no live book row. `deleted` is the directory name that was removed
// (echoed back so the client can update its local list without re-fetching).
// ---------------------------------------------------------------------------
export const OrphanDeleteResponseSchema = z.object({
  success: z.boolean(),
  deleted: z.string(),
});
export type OrphanDeleteResponse = z.infer<typeof OrphanDeleteResponseSchema>;
