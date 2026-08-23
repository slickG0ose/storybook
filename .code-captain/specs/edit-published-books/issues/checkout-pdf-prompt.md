Title: Prompt the buyer to download the PDF at checkout, so the durable artifact actually reaches them

<!--
Draft only. Not created yet — create with:
  gh issue create --repo slickG0ose/storybook \
    --title "Prompt the buyer to download the PDF at checkout, so the durable artifact actually reaches them" \
    --milestone "Print/Subscription" \
    --body-file .code-captain/specs/edit-published-books/issues/checkout-pdf-prompt.md
(strip this comment and the Title: line from the body first, or pass --body by hand)
-->

**Milestone (suggested):** Print/Subscription (this is ADR-008 territory)
**Source:** [#20](https://github.com/slickG0ose/storybook/issues/20) / spec §"What a buyer who already ordered sees after an edit" and §"Out of scope"
**ADR:** ADR-008 (PDF export), ADR-012 decision 9

## Why

ADR-012 leans on ADR-008's PDF as the buyer's durable artifact: `POST /api/books/:id/pdf` is
available to any signed-in user for a published book, and **a buyer who downloaded it holds a real
copy that no author edit can touch**. That is the honest bound on the "prior buyer gets a 404 while
the author edits" cost.

The problem is that it is only true of buyers who happen to have found the button. **Nothing in the
purchase flow prompts the download.** `OrderConfirmation.tsx` shows titles, quantities, and a total,
and then links to `/` and `/my-books`. The mitigation exists in the codebase and does not exist in
the user's hands, which is why ADR-012 records it as a bound rather than claiming it as a
mitigation that ships today.

## What ships

- On `/order-confirmation`, a per-item **"Download PDF"** control that hits the existing
  `POST /api/books/:id/pdf` route. No new route, no new wire shape, no new paid call.
- Copy that says why it is worth doing — one line, e.g. "Download a copy to keep. Your PDF stays
  yours even if the author updates the book later."
- Dark-mode parity on the new control in every state, and a tap-target-safe size at mobile
  viewports (ADR-009 harness).

## Sharp edges

- The PDF route requires a **signed-in** user; guest checkout exists. Decide whether the prompt is
  hidden for guests, or whether it is the moment to nudge account creation — that choice is the
  actual design work here, and it overlaps the purchaser-entitlement issue.
- If a book is withdrawn between checkout and the click, the PDF route will refuse it. The
  confirmation page needs a non-alarming state for that.

## Size

Small — one component change plus a decision about guests. Named "small and worthwhile; not this
spec" in #20's §Out of scope, and it is the cheapest thing on the list that materially reduces the
buyer-404 pain.
