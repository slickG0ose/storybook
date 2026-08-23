Title: Direct per-page text editing — let an author fix a typo without a full revise

<!--
Draft only. Not created yet — create with:
  gh issue create --repo slickG0ose/storybook \
    --title "Direct per-page text editing — let an author fix a typo without a full revise" \
    --milestone "Tier 2 Storefront" \
    --body-file .code-captain/specs/edit-published-books/issues/direct-page-text-editing.md
(strip this comment and the Title: line from the body first, or pass --body by hand)
-->

**Milestone (suggested):** Tier 2 Storefront
**Source:** [#20](https://github.com/slickG0ose/storybook/issues/20) §"Out of scope"; [`.code-captain/product/roadmap.md`](https://github.com/slickG0ose/storybook/blob/master/.code-captain/product/roadmap.md) §Phase 3
**ADR:** ADR-012 (the model this would plug into), roadmap entry for #20 explicitly says this remains unbuilt

## Why this is a separate feature, not a follow-up commit

#20's title ("Edit published books") invites "while we're here, let people fix a typo." It
deliberately did **not**. #20 made the *existing* edit primitives reachable for a published book —
withdraw, revise via Claude, illustrate, restore a version, republish. It added no new primitive.

Today an author who wants to change three words must run `POST /api/books/:id/revise`, which calls
the model, costs money, and **nulls `illustration_url` on every page whose text or illustration
description changed**. For a typo that is an absurd price: pay for a story call, then pay again to
re-illustrate the page.

## What it needs (the reason it is not small)

- **Its own route.** `PUT /api/books/:id/pages/:pageNumber` exists but is scoped to the
  illustration prompt; a text edit is a different mutation with different consequences.
- **Its own wire shape** in `@storybook/shared`, with the OPS.3 obligation that follows.
- **Its own `BookVersion` snapshot semantics.** Does a manual text edit bump `book.version` and
  write a snapshot? If yes, version history fills with one-word diffs; if no, the version history
  stops being a complete record of content changes. That question is the actual design work.
- **A ruling on illustrations.** A manual text edit does *not* automatically invalidate the page's
  image the way a model revise does — but sometimes it should. Silent staleness is the failure mode
  fork 2 was rejected for, so this needs an explicit answer, not a default.

## Where it plugs in

Cleanly. Under ADR-012 the book is already a draft while being edited, `isEditable()` is the
existing fence a new mutating route inherits, and the publish-time "N of M pages have no
illustration yet" confirm is already the second net. The model does not need to change — only the
primitive set grows.

## Not this

**Story remix** ("use this book as a starting point") is a clone operation and a different feature
again. Do not build either off the other.
