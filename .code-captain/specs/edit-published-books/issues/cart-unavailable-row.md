Title: Show withdrawn/unavailable cart items with an explanation instead of silently dropping them

<!--
Draft only. Not created yet — create with:
  gh issue create --repo slickG0ose/storybook \
    --title "Show withdrawn/unavailable cart items with an explanation instead of silently dropping them" \
    --milestone "Tier 2 Storefront" \
    --body-file .code-captain/specs/edit-published-books/issues/cart-unavailable-row.md
(strip this comment and the Title: line from the body first, or pass --body by hand)
-->

**Milestone (suggested):** Tier 2 Storefront
**Source:** [#20](https://github.com/slickG0ose/storybook/issues/20) / spec §"The money path: one availability filter, shared", Open question 3
**ADR:** ADR-012 decision 6 (and the third Consequence bullet, which is the second half of this issue)

## What ships today, and why it is only half right

#20 introduced one shared `AVAILABLE_BOOK_WHERE = { deleted_at: null, status: 'published' }` used by
cart display, add-to-cart, and checkout. That **fixed a live charging bug** — cart display filtered
soft-deleted books while checkout still charged for them, so a cart could show one total and bill
another — and it stopped withdrawn books from being purchasable while 404-ing for the buyer.

Unavailable rows are dropped **silently**, matching the soft-delete precedent in the same file.
The buyer who put a book in their cart and came back to find it gone gets **no explanation**.

Silent-hide was ruled in, not defaulted in: the "explained row" branch adds a field to
`CartItemSchema`, and phase 1's discipline was zero wire-shape changes.

## Two things to fix together

1. **An explained row.** "Unavailable — the author is updating this book" (withdrawn) or a
   soft-delete equivalent, rendered in the cart, excluded from the total, with a clear way to
   remove it. Consistency matters: if a withdrawn book gets an explanation, a soft-deleted one
   should too, or the cart tells two different stories about the same disappearance.
2. **Checkout no longer deletes it.** `POST /api/orders` still runs
   `cartItem.deleteMany({ where: { session_id } })` — it clears the **whole** cart, so an
   unavailable row is deleted alongside the purchased ones rather than surviving until the author
   republishes. #20's Task 3 stopped checkout *charging* for it and deliberately did not touch the
   clear, because the plan did not rule on it. **The user-visible effect: a buyer loses the
   withdrawn book from their cart permanently at checkout instead of finding it waiting when it
   goes back on sale.** Fixing (1) without (2) ships an explanation for a row that then vanishes at
   the next purchase anyway.

## Cost, honestly

This is an **OPS.3 wire-shape change**: a field on `CartItemSchema` in `@storybook/shared`, a new
cart row state in both themes, a decision about what checkout does with such a row, and the same
treatment for soft-deleted books. Moderate, not trivial — that is why it was deferred rather than
folded in.

## Acceptance sketch

- `GET /api/cart/:sessionId` returns unavailable items flagged rather than omitted; `total` still
  excludes them, and the existing `toMatchObject` assertions are extended, not replaced.
- `POST /api/orders` charges for available items only (unchanged) and **leaves unavailable rows in
  the cart**.
- Cart UI renders the flagged row in both themes with a reason and a remove control; checkout stays
  enabled when at least one available item remains.
