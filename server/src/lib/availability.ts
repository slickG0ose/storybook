/**
 * Book availability and mutability preconditions (#20, "withdraw to edit").
 *
 * One place, so the next route that mutates a book either uses this or is
 * visibly missing it. See `.code-captain/specs/edit-published-books/spec.md`.
 */

/** Message returned by every "this book is published" 403. One string, one meaning. */
export const PUBLISHED_IMMUTABLE_ERROR =
  'Published books cannot be edited. Take the book out of the catalog to edit it.';

/**
 * True when the book may be mutated. Publishing/unpublishing/soft-deleting are
 * status transitions, not content mutations, and do not go through this.
 *
 * Fails closed: anything that is not exactly `'draft'` is immutable, so a
 * future status value can't accidentally reopen the fork-2 hole.
 */
export function isEditable(book: { status: string }): boolean {
  return book.status === 'draft';
}

/**
 * A book a shopper may see, add, or be charged for.
 *
 * Used as a Prisma `where` fragment by `GET /api/cart/:sessionId`,
 * `POST /api/cart/:sessionId/items`, and `POST /api/orders` — the three places
 * that must agree, and previously did not: cart display filtered soft-deleted
 * books while checkout still charged for them, so a cart could show one total
 * and bill another. Neither looked at `status`, so a book withdrawn for editing
 * stayed purchasable while 404-ing for the buyer who bought it.
 *
 * Unavailable rows are dropped silently, matching the soft-delete precedent in
 * `cart.ts`.
 */
export const AVAILABLE_BOOK_WHERE = { deleted_at: null, status: 'published' } as const;
