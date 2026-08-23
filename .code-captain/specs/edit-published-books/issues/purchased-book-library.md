Title: A purchased-book library — "my copies", so a purchase has somewhere to live

<!--
Draft only. Not created yet — create with:
  gh issue create --repo slickG0ose/storybook \
    --title "A purchased-book library — \"my copies\", so a purchase has somewhere to live" \
    --milestone "Tier 2 Storefront" \
    --body-file .code-captain/specs/edit-published-books/issues/purchased-book-library.md
(strip this comment and the Title: line from the body first, or pass --body by hand)
-->

**Milestone (suggested):** Tier 2 Storefront
**Source:** [#20](https://github.com/slickG0ose/storybook/issues/20) / spec §"What a buyer who already ordered sees after an edit" and §"Out of scope"
**ADR:** ADR-012 decision 9 and trigger (c) in decision 3

## The gap

**There is no purchased-book library in this product.** `OrderConfirmation.tsx` renders
`{item.title} ×{item.quantity}` and links to `/` and `/my-books`; there is **no link from an order
to `/book/:id` at all**. `/my-books` is the *authoring* surface — books you created — not books you
bought. So after checkout, the only route back to a book you paid for is finding it again in the
public catalog.

That was survivable when the catalog was permanent. Since #20, a book can legitimately leave the
catalog while its author edits it, and at that moment a buyer has no path to their purchase at all.

## What "shipped" would look like

- A surface (`/my-copies`, or a tab on `/my-books`) listing every book the current user has an
  `OrderItem` for, with the order date and a link that opens the book.
- A re-download of the ADR-008 PDF from the same row, since that is the artifact that survives any
  edit.
- An honest state for a book that is currently withdrawn — "the author is updating this book" —
  rather than a dead link, whatever the entitlement decision turns out to be.

## Blocked on, and blocking

**Blocked on** the purchaser-entitlement decision (separate issue): the library cannot link to a
withdrawn book until something decides a buyer may read one. A library that only works while the
book happens to be published is still worth shipping, and is the cheaper first slice.

**Blocking** nothing, but it is **trigger (c) for reopening the shadow-draft/cutover model**
(ADR-012 decision 3): once buyers hold durable in-app copies, "which version did I buy" becomes a
question worth answering, and that is the version model fork 1 was designed for.

## Why it was not in #20

It is the real fix for the buyer-404 problem and it is a feature in its own right — a route, a
page, an entitlement query, and its own wire shape — not a sub-task of making the existing edit
primitives reachable.
