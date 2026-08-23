Title: Purchaser entitlement — let someone who bought a book read it while the author edits

<!--
Draft only. Not created yet — create with:
  gh issue create --repo slickG0ose/storybook \
    --title "Purchaser entitlement — let someone who bought a book read it while the author edits" \
    --milestone "Tier 2 Storefront" \
    --body-file .code-captain/specs/edit-published-books/issues/purchaser-entitlement.md
(strip this comment and the Title: line from the body first, or pass --body by hand)
-->

**Milestone (suggested):** Tier 2 Storefront
**Source:** [#20](https://github.com/slickG0ose/storybook/issues/20) / spec [`.code-captain/specs/edit-published-books/spec.md`](https://github.com/slickG0ose/storybook/blob/master/.code-captain/specs/edit-published-books/spec.md) §"What a buyer who already ordered sees after an edit", Open question 5
**ADR:** ADR-012 decision 9 in [`.code-captain/product/decisions.md`](https://github.com/slickG0ose/storybook/blob/master/.code-captain/product/decisions.md)
**Guardrail:** touches the CLAUDE.md session/auth model — needs explicit user confirmation before any implementation starts.

## The problem, stated plainly

Under the "withdraw to edit" model shipped in #20, a published book becomes a draft while its
author edits it. `GET /api/books/:id` returns **404, "Book not found"** to anyone who is not the
owner — including **someone who already paid for it**. Not "temporarily unavailable": a hard 404,
because that branch deliberately refuses to confirm a non-owner's draft exists.

The receipt is unaffected — `OrderItem` snapshots `title`, `quantity`, and `price`, so nobody is
retroactively told they bought something different. But a receipt is not a copy, and today the
only way to read a book you bought is the public catalog, which is a live view.

## Why it is not already fixed

`Order` is keyed on `session_id` with an optional `user_id`. An entitlement check therefore means
one of:

1. **Send the cart-session UUID to a read route** — i.e. promote a `localStorage` UUID into an
   authorization token. That is exactly the load-bearing session model CLAUDE.md protects, and
   anyone can mint a UUID, so it is not an authorization primitive today.
2. **Require an account for purchase**, so `Order.user_id` is always populated and entitlement is
   a normal authenticated check. That is a product decision about the checkout funnel, not a
   sub-task of an edit feature.
3. **Something else** — a signed, expiring, per-order access token emailed with the receipt, which
   avoids both traps but is a new artifact with its own lifecycle.

Any of the three is a spec of its own with its own user confirmation.

## Acceptance sketch (for whoever picks this up)

- A user who holds an `OrderItem` for book X can read X at `/book/:id` regardless of `status`.
- A user who does not gets today's 404, unchanged. Ownership/entitlement must never leak the
  existence of someone else's draft.
- Whatever mechanism is chosen is written down in an ADR **before** it is built, because it is an
  authorization design and this repo has exactly one of those today.

## Related

- A **purchased-book library** (separate issue) is the other half of this: entitlement decides
  *may I*, the library decides *where do I click*.
- The **checkout-time PDF prompt** (separate issue) is the cheap partial mitigation — a buyer who
  downloaded the ADR-008 PDF already holds a durable copy no edit can touch.
- Reopening the shadow-draft/cutover model (ADR-012 decision 3, trigger c) would remove the
  404 entirely by keeping the old version public. This issue and that one are alternative fixes
  for the same pain, not sequential steps.
