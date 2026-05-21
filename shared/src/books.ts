import { z } from 'zod';

// ---------------------------------------------------------------------------
// Character — embedded shape inside hydrated Book responses.
// Mirrors `Character` in server/src/types.ts and client/src/types.ts. Lives in
// shared so book response schemas can reference it directly.
// ---------------------------------------------------------------------------
export const CharacterRoleSchema = z.enum(['primary', 'antagonist', 'supporting']);
export type CharacterRole = z.infer<typeof CharacterRoleSchema>;

export const CharacterSchema = z.object({
  role: CharacterRoleSchema,
  name: z.string(),
  descriptor: z.string().optional(),
  relationship: z.string().optional(),
});
export type Character = z.infer<typeof CharacterSchema>;

// ---------------------------------------------------------------------------
// Page — wire shape for a single page row returned inside book responses.
// ---------------------------------------------------------------------------
export const PageSchema = z.object({
  id: z.number().int(),
  book_id: z.string(),
  page_number: z.number().int(),
  text: z.string(),
  illustration_description: z.string(),
  illustration_url: z.string().nullable(),
});
export type Page = z.infer<typeof PageSchema>;

// ---------------------------------------------------------------------------
// Book — wire shape returned by storefront list/detail/publish/etc endpoints.
//
// Note on `characters_json` vs `characters`:
//   - `characters_json` is the raw DB column (JSON string or null)
//   - `characters` is hydrated by the route's `hydrateBook` helper
// Both ship over the wire today; clients consume `characters` and ignore the
// raw JSON. We pin both so response middleware fails loudly if either is
// dropped — that's the whole point of the drift catch-net.
//
// Date fields are `z.string()` because response middleware validates the
// post-JSON.stringify wire shape (Prisma's Date instances become ISO strings).
// ---------------------------------------------------------------------------
export const BookSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string(),
  description: z.string(),
  theme: z.string(),
  age_range: z.string(),
  cover_emoji: z.string(),
  cover_color: z.string(),
  cover_url: z.string().nullable(),
  price: z.number(),
  is_featured: z.boolean(),
  is_user_created: z.boolean(),
  status: z.string(),
  version: z.number().int(),
  characters_json: z.string().nullable(),
  characters: z.array(CharacterSchema),
  style_descriptor: z.string().nullable(),
  style_reference_url: z.string().nullable(),
  created_by: z.string().nullable(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
});
export type Book = z.infer<typeof BookSchema>;

export const BookWithPagesSchema = BookSchema.extend({
  pages: z.array(PageSchema),
});
export type BookWithPages = z.infer<typeof BookWithPagesSchema>;

// ---------------------------------------------------------------------------
// GET /api/books — storefront catalog
// ---------------------------------------------------------------------------
export const BookListResponseSchema = z.array(BookSchema);
export type BookListResponse = z.infer<typeof BookListResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/books/mine — books the authenticated user has created (with pages)
// ---------------------------------------------------------------------------
export const BookMineResponseSchema = z.array(BookWithPagesSchema);
export type BookMineResponse = z.infer<typeof BookMineResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/books/themes and /age-ranges — distinct facet values
// ---------------------------------------------------------------------------
export const BookFacetResponseSchema = z.array(z.string());
export type BookFacetResponse = z.infer<typeof BookFacetResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/books/:id — book detail (with pages)
// ---------------------------------------------------------------------------
export const BookDetailResponseSchema = BookWithPagesSchema;
export type BookDetailResponse = z.infer<typeof BookDetailResponseSchema>;

// ---------------------------------------------------------------------------
// PUT /api/books/:id/publish | /unpublish — status change, returns hydrated book
// (no pages — these handlers don't include them; matches current behavior)
// ---------------------------------------------------------------------------
export const BookPublishResponseSchema = BookSchema;
export type BookPublishResponse = z.infer<typeof BookPublishResponseSchema>;

// ---------------------------------------------------------------------------
// DELETE /api/books/:id — soft-delete
// ---------------------------------------------------------------------------
export const BookDeleteResponseSchema = z.object({ success: z.boolean() });
export type BookDeleteResponse = z.infer<typeof BookDeleteResponseSchema>;

// ---------------------------------------------------------------------------
// PUT /api/books/:id/pages/:pageNumber — update a single page's illustration
// description. Returns the full hydrated book or null if the lookup races.
// ---------------------------------------------------------------------------
export const BookUpdatePageRequestSchema = z.object({
  illustration_description: z
    .string({ required_error: 'illustration_description is required' })
    .trim()
    .min(1, 'illustration_description is required')
    .max(2000, 'illustration_description must be 2000 characters or fewer'),
});
export type BookUpdatePageRequest = z.infer<typeof BookUpdatePageRequestSchema>;

// Nullable: the post-update findUnique can theoretically return null if the
// row is deleted concurrently. Keep the null path explicit on the wire.
export const BookUpdatePageResponseSchema = BookWithPagesSchema.nullable();
export type BookUpdatePageResponse = z.infer<typeof BookUpdatePageResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/books/:id/revise — Claude-driven story revision
// ---------------------------------------------------------------------------
export const BookReviseRequestSchema = z.object({
  feedback: z
    .string({ required_error: 'feedback is required' })
    .trim()
    .min(1, 'feedback is required'),
  // 3..15 pages enforced by the handler via clamp; we accept any finite number
  // here so legacy callers that pass non-integer page counts still succeed.
  newPageCount: z.number().finite().optional(),
});
export type BookReviseRequest = z.infer<typeof BookReviseRequestSchema>;

export const BookReviseResponseSchema = BookWithPagesSchema;
export type BookReviseResponse = z.infer<typeof BookReviseResponseSchema>;

// ---------------------------------------------------------------------------
// PUT /api/books/:id/versions/:version/restore — restore a prior snapshot
// ---------------------------------------------------------------------------
export const BookRestoreVersionResponseSchema = BookWithPagesSchema;
export type BookRestoreVersionResponse = z.infer<typeof BookRestoreVersionResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/books/:id/versions — list all snapshots for a book
//
// Wire shape includes the raw `pages_json` string AND a parsed `pages` array.
// Both are pinned because the handler ships both and clients consume `pages`.
// ---------------------------------------------------------------------------
export const BookVersionPageSchema = z.object({
  page_number: z.number().int(),
  text: z.string(),
  illustrationDescription: z.string(),
});
export type BookVersionPage = z.infer<typeof BookVersionPageSchema>;

export const BookVersionSchema = z.object({
  id: z.number().int(),
  book_id: z.string(),
  version: z.number().int(),
  pages_json: z.string(),
  description: z.string().nullable(),
  characters_json: z.string().nullable(),
  created_at: z.string(),
  pages: z.array(BookVersionPageSchema),
});
export type BookVersion = z.infer<typeof BookVersionSchema>;

export const BookVersionListResponseSchema = z.array(BookVersionSchema);
export type BookVersionListResponse = z.infer<typeof BookVersionListResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/books/:id/illustrate — generate (or regenerate) illustrations
// ---------------------------------------------------------------------------
export const BookIllustrateRequestSchema = z.object({
  pageNumber: z.number().int().positive().optional(),
  feedback: z.string().optional(),
});
export type BookIllustrateRequest = z.infer<typeof BookIllustrateRequestSchema>;

export const BookIllustrateResponseSchema = BookWithPagesSchema.nullable();
export type BookIllustrateResponse = z.infer<typeof BookIllustrateResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/books/:id/illustrations/:pageNumber — list illustration versions
// ---------------------------------------------------------------------------
export const IllustrationVersionSchema = z.object({
  url: z.string(),
  version: z.number().int(),
  created_at: z.string(),
  feedback: z.string().nullable(),
});
export type IllustrationVersion = z.infer<typeof IllustrationVersionSchema>;

export const IllustrationVersionListResponseSchema = z.array(IllustrationVersionSchema);
export type IllustrationVersionListResponse = z.infer<typeof IllustrationVersionListResponseSchema>;

// ---------------------------------------------------------------------------
// PUT /api/books/:id/illustrations/:pageNumber/revert — point at a prior URL
// ---------------------------------------------------------------------------
export const BookIllustrationRevertRequestSchema = z.object({
  url: z
    .string({ required_error: 'url is required' })
    .min(1, 'url is required'),
});
export type BookIllustrationRevertRequest = z.infer<typeof BookIllustrationRevertRequestSchema>;

export const BookIllustrationRevertResponseSchema = BookWithPagesSchema.nullable();
export type BookIllustrationRevertResponse = z.infer<typeof BookIllustrationRevertResponseSchema>;
