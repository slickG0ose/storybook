Title: Editing book metadata — price, title, author, cover emoji/colour, theme

<!--
Draft only. Not created yet — create with:
  gh issue create --repo slickG0ose/storybook \
    --title "Editing book metadata — price, title, author, cover emoji/colour, theme" \
    --milestone "Tier 2 Storefront" \
    --body-file .code-captain/specs/edit-published-books/issues/book-metadata-editing.md
(strip this comment and the Title: line from the body first, or pass --body by hand)
-->

**Milestone (suggested):** Tier 2 Storefront
**Source:** [#20](https://github.com/slickG0ose/storybook/issues/20) §"Out of scope"
**ADR:** ADR-012 (the immutability model any such route must obey)

## The gap

**No route mutates `price`, `title`, `author`, `cover_emoji`, `cover_color`, `is_featured`, or
`theme` today.** They are set at creation and are effectively permanent. An author who mistypes a
title, or who wants to reprice, has no path at all — including for a draft. #20 did not change this
in either direction; it only governs *content* mutation.

## Why price is the hard one, and why it drags the rest with it

Price interacts with carts and orders in ways that deserve their own thinking:

- **A cart is a live join, not a snapshot.** `CartItem` stores `book_id` and a quantity; the
  displayed total is computed from the book's current price. Repricing a book therefore silently
  changes what everyone with it in their cart is about to pay — up as well as down.
- **An order is a value snapshot** — `OrderItem` stores `title` and `price` at checkout — so past
  receipts are safe. The exposure is entirely in the window between "in cart" and "charged".
- ADR-012 already accepted that a cart total can legitimately *shrink* between page loads (a
  withdrawn book drops out). "Strictly in the buyer's favour" was the justification. **Repricing
  upward breaks that justification**, so it needs its own answer: refuse while the book is in
  anyone's cart, snapshot price into `CartItem` at add time, or show a "price changed" confirm at
  checkout.

`title` has a smaller version of the same problem — `OrderItem.title` is the snapshot, but a cart
row renders the live one.

## Acceptance sketch

- One owner-gated route for metadata, mounted `requireAuth → validate → handler`, calling
  `isEditable()` after the ownership check like every other mutating book route, so a published
  book stays immutable in metadata as well as content (or a deliberate, documented exception is
  made for cover colour and similar cosmetics).
- A ruling on price-in-cart, written down before the route is built.
- `is_featured` is arguably an admin field, not an author field — decide, don't inherit.

## Size

Its own spec. Small in code, large in the money-path questions it forces open.
