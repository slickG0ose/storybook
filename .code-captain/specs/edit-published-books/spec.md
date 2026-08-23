# Edit published books — phase 1, "withdraw to edit"

> Status: Draft
> Last updated: 2026-08-23
> Architect: Claude Opus 5 via @architect on 2026-08-23
> Backlog: [#20 — TS2: Edit published books](https://github.com/slickG0ose/storybook/issues/20) (milestone: Tier 2 Storefront, `status:needs-design`)
> Related: ADR-003 (wire shapes), ADR-004 (no-overlay precedent, reused here), ADR-008 (the PDF is the buyer's durable artifact), ADR-009 (mobile x theme discharge), ADR-011 / `.code-captain/specs/read-aloud/spec.md` (shares `BookSpread`, just merged)
> Plan reference: `.code-captain/product/roadmap.md` §Phase 3 — "Direct text editing per page" and "Story remix" are neighbours of this work and are explicitly **not** in it.

## Problem

An author who publishes a book cannot safely change it afterwards, and the codebase is
inconsistent about whether they can change it at all.

Two of the six content-mutating routes on a book (`PUT /:id/pages/:pageNumber`,
`PUT /:id/versions/:version/restore`) already refuse to run unless `book.status === 'draft'`.
The other four — `POST /:id/revise`, `POST /:id/illustrate`,
`POST /:id/characters/:characterIndex/portrait`, `PUT /:id/illustrations/:pageNumber/revert` —
have no status check at all. So today the honest answer to "can you edit a published book?"
is "yes, partially, through the routes nobody remembered to gate."

That is not a harmless gap. `POST /:id/revise` **nulls `illustration_url` on every page
whose text or illustration description changed** (`server/src/routes/books.ts:434-449`),
by design, because a stale image no longer matches revised text. Run it against a book that
is live in the catalog and you have just put a half-illustrated book on sale, with no
operator action, no signal to the buyer, and no way back except a manual re-illustrate that
costs money. `BookDetail.tsx` happens to hide the revise panel behind `isOwner && isDraft`,
so this is currently reachable mostly by intent rather than by accident — but the reader-view
"Regenerate" and "History" buttons at `BookDetail.tsx:851` and `:941` are gated on `isOwner`
alone, with no `isDraft`, so a published owner can already mutate a live book's illustrations
from the UI.

Meanwhile the *sanctioned* path — unpublish, edit, republish — exists and works, but it is
unlabelled and mis-signposted. The only affordance is a button on `/my-books` labelled
**"Unpublish"**, which reads as withdrawal-and-abandonment rather than as the first step of
editing, and it does not exist on the book page where the author is actually reading and
revising. The confirm text (`MyBooks.tsx:42`) already says the right thing — *"It will be
removed from the public catalog but kept as a draft you can keep editing"* — which is
evidence that the intended model was always fork 3; it was just never finished or named.

Underneath all of this sits a money-path defect that this feature would make much more
likely to fire. `GET /api/cart/:sessionId` filters out cart items whose book is soft-deleted
(`cart.ts:31-33`), but `POST /api/orders` reads the cart with **no** such filter
(`orders.ts:25-28`). The two disagree, so a cart can display one total and charge another.
Neither checks `status` at all, so a book withdrawn for editing stays fully purchasable — and
once withdrawn, `GET /api/books/:id` 404s it for everyone but the owner, so the buyer pays
for something they immediately cannot open.

## Constraints

- **CLAUDE.md guardrail — seed data shape.** Changing it breaks existing carts and orders.
  Phase 1 therefore lands **zero Prisma schema changes and zero seed changes**. If a task
  appears to need one, stop and re-dispatch the architect.
- **CLAUDE.md guardrail — auth/session.** The UUID-in-`localStorage` cart session is
  load-bearing. Nothing here reads, writes, rotates, or reinterprets `storybook-session`.
  The purchaser-entitlement idea that would require it is deferred for exactly this reason
  (§"What a buyer sees").
- **CLAUDE.md guardrail — paid external APIs.** Phase 1 adds **no new paid call and no new
  `COST_CENTS` kind**. It does close a pre-existing hole where an already-paid call runs
  ungated (§"The portrait spend hole").
- **OPS.3 / ADR-003 wire shapes.** Every changed route response field must be pinned by name
  with `toMatchObject` in the route test. Phase 1 is designed to change **no success-shape
  field** — the changes are new 403/404 paths and a server-side filter — so the obligation is
  discharged by pinning the error envelopes and by the existing success-shape assertions
  staying green. If a task finds itself adding a field, it is out of scope.
- **Middleware order** (`docs/conventions/server.md` §"Middleware order rule"):
  `requireAuth | adminGate -> validate -> handler`. The new draft gate is a **handler-body
  check**, not new middleware, so the order is unchanged. Do not turn it into middleware
  mounted before `validate` without re-reading that rule.
- **Existing versioning machinery is reused, not replaced.** `BookVersion`,
  `IllustrationVersion`, `book.version`, the self-healing `snapshotVersion` transaction, and
  the `e2e/tests/version-history.spec.ts` / `illustration-history.spec.ts` fences all stay
  exactly as they are. This spec adds no new versioning concept (§"Why this is not a new
  version model").
- **Dark-mode parity** on every new surface *and every state* — default, hover,
  focus-visible, disabled, and both halves of the inline confirm.
- **ADR-004 precedent:** layout swap in place, not an overlay/portal. The withdrawal confirm
  follows it (§"The confirmation is an inline panel, not a modal").

## Proposed shape

### The decision, in one sentence

**Fork 3 — a published book is immutable; editing it means withdrawing it from the catalog
first, and republishing is the cutover.** Withdraw -> edit -> publish. The state machine is
the two values `status` already holds; the work is making it *true* (gate the four ungated
routes), making it *visible* (name the affordance on the book page), and making it *safe for
the money path* (a withdrawn book cannot be added to a cart or charged for).

### Why fork 3, and what the other two cost

The issue presents three forks as if they were peers. They are not — one is already half-built
and the other two each buy a property this product cannot yet use, at a price it would pay
across six read paths.

**Fork 3 (chosen) — edit sends the book back to draft.** It is the only model that is already
structurally true here: `PUT /:id/unpublish` exists, is owner-gated, and returns a 403 if the
book is not published; two mutating routes already enforce the draft precondition with the
exact 403 this model wants; `MyBooks.tsx` already explains the model in its confirm dialog.
Critically, it has **one source of truth for "what is the book"** — the `Page` rows. Every
consumer (catalog list, detail, PDF renderer, narration, illustration generator, cart display,
checkout, version restore) reads those rows and is correct by construction.

*What fork 3 costs, stated plainly:* **the book is off-sale for the duration of the edit.**
That is precisely the property fork 1 exists to buy. Phase 1 accepts it, makes it explicit in
the UI copy rather than surprising, and makes it reversible in one click. See §"Deferred: the
shadow-draft cutover model" for the triggers that would reopen it.

**Fork 1 — new version, old stays public until cutover.** Rejected for phase 1 on
implementation surface, not on principle; it is the better long-run model and is kept as a
named upgrade path.

The migration is the small part. The real cost is that `Book`'s content stops being a single
thing. `BookVersion.pages_json` is a **text-only** snapshot — `{ page_number, text,
illustrationDescription }`, no `illustration_url` (`shared/src/books.ts:163-168`) — so
"the old version stays public" cannot be served from existing snapshots at all. It would need
either a second set of `Page` rows (a shadow-draft `Book` row, which then needs an identity
story for `CartItem.book_id`, `OrderItem.book_id`, `/book/:id` URLs, and the
`IllustrationVersion.book_id` history) or an `illustration_url` column added to the snapshot
plus a resolution rule threaded through **every** read path: `GET /api/books`,
`GET /api/books/:id`, `GET /api/books/mine`, `POST /:id/pdf`, `BookSpread`, `NarrationPlayer`,
`GET /api/cart/:sessionId`, `POST /api/orders`. Each of those currently says "the book is its
`Page` rows" and would have to start asking "which content am I looking at?" That is the
cost — six-plus read paths learning a resolution rule — and it buys uninterrupted
purchasability for a storefront that, per `MEMORY.md`, **is not currently deployed and has no
traffic to interrupt**.

**Fork 2 — mutate in place, no version bump.** Rejected, and it is the one to reject loudest.
It is not "the cheap option"; it is the option that is already partially in effect and is
already producing the wrong outcome. `POST /:id/revise` against a published book nulls
`illustration_url` on changed pages and leaves a live, purchasable, half-illustrated catalog
entry. A buyer mid-read has the text change under them. There is no signal, no rollback other
than paying to re-illustrate, and no moment at which anyone decided the new text was ready.
Fork 2's only genuine advantage — no interruption to availability — is the same advantage
fork 1 offers, except fork 2 gets it by shipping unreviewed work to buyers instead of by
staging it. If uninterrupted availability is worth building, build fork 1.

### Why this is not a new version model

Worth stating because the issue's phrasing ("Editing creates a new version") invites it: this
codebase **already has** a version model, and fork 3 leaves it entirely alone.

`book.version` is an integer that increments on each *content revision*; `BookVersion` holds
the pre-revision snapshot; `POST /:id/revise` and `PUT /:id/versions/:version/restore` both
write a snapshot inside a `$transaction` using a self-healing `snapshotVersion` computation
(`books.ts:405-421`, `:540-556`) added to fix a real stuck state. `GET /:id/versions` powers
the version-history panel and is fenced by `e2e/tests/version-history.spec.ts`.

Under fork 3, **publishing is a status transition, not a version event.** Republishing does
**not** bump `book.version` — the version already moved when the content changed, which is the
only thing versions are about here. Coupling the two would desync the meaning of every
existing `BookVersion` row. (Recorded as Open question 4 with that default.)

The version-history panel therefore works during an edit for free: the book is a draft, the
panel is `isOwner && isDraft`-gated (`BookDetail.tsx:1039`), and restore's existing
`status !== 'draft'` guard is satisfied. No change.

### Route-layer enforcement: a published book is immutable

The spine of the implementation is one shared precondition applied to every content-mutating
route on a book. Not six ad-hoc `if` statements — one helper, so the next route that gets added
either uses it or is visibly missing it.

| Route | Today | Phase 1 |
|---|---|---|
| `PUT /:id/pages/:pageNumber` | 403 if not draft | unchanged (adopts the shared helper + message) |
| `PUT /:id/versions/:version/restore` | 403 if not draft | unchanged (adopts the shared helper + message) |
| `POST /:id/revise` | **ungated** | 403 if not draft |
| `POST /:id/illustrate` | **ungated** | 403 if not draft |
| `POST /:id/characters/:characterIndex/portrait` | **ungated** | 403 if not draft |
| `PUT /:id/illustrations/:pageNumber/revert` | **ungated** | 403 if not draft |
| `PUT /:id/publish` / `/unpublish` | status transitions | unchanged — these *are* the model |
| `DELETE /:id` | soft-delete, any status | unchanged |

The gate runs **after** the owner check, never before. A non-owner must keep getting the
existing 404 (`books.ts:186`, and everywhere else) — we do not confirm that someone else's book
exists, and we certainly do not tell them it is published. Ownership first, then status.

Two of the four newly-gated routes are paid (`illustrate`, `portrait`). Their gate must run
**before** any AI call and before `recordUsage`, so a 403 costs nothing. `spendGate` middleware
already ran by then and reserved headroom; that reservation is not a charge (`recordUsage` is),
so an early 403 leaves no ledger row.

### The portrait spend hole (a pre-existing defect, found while reading)

`POST /api/books/:id/characters/:characterIndex/portrait` (`books.ts:742-750`) mounts
`requireAuth -> validate -> handler` and calls `generateCharacterPortrait`, a **paid image
generation call**. It has **no `spendGate` mount and no `recordUsage` call.** Every other paid
route has both: `/revise` has `spendGate('story')` + `recordUsage(..., 'story')`, `/illustrate`
has `spendGate('illustration')` + per-iteration `checkQuota` + `recordUsage`, `POST /api/generate`
has both for all three kinds.

So today an authenticated, allowlisted user can generate unlimited character portraits: the
per-user daily cap never sees them, and — worse — the **global monthly ceiling**, which nobody
is allowed to bypass, never sees them either, because `recordUsage` is what writes the
`UsageLog` row the ceiling sums.

This is **not caused by #20** and would exist if this spec were never written. It is included
here because Task 1 edits that route's chain anyway and because CLAUDE.md is unambiguous that a
paid call without a gate is a design error rather than a follow-up. It is scoped as its own
task (Task 2) so it can be split into its own PR if the user prefers a clean #20 diff.

The fix charges portraits at the existing **`cover: 4`** rate rather than adding a fourth
`COST_CENTS` kind: a portrait is one image from the same provider at the same size class as a
cover, and a new kind would mean a new `UsageKind` union member, a new env-var story, and
migration questions for historical rows — for a figure identical to one already in the table.
Named as an ADR-worthy sub-decision.

### The money path: one availability filter, shared

Withdrawing a book for editing makes an existing inconsistency load-bearing, so phase 1 fixes
it rather than routing around it.

`GET /api/cart/:sessionId` filters `book: { deleted_at: null }` and calls it "silent-hide UX"
in a comment (`cart.ts:26-33`). `POST /api/orders` does **not** filter (`orders.ts:25-28`).
The result today: a cart containing a soft-deleted book shows total $X and charges $X + that
book's price. That is a live money bug, independent of this feature.

Phase 1 introduces **one exported `where` fragment** used by both, extended to cover status:

```ts
// server/src/lib/availability.ts
export const AVAILABLE_BOOK_WHERE = { deleted_at: null, status: 'published' } as const;
```

Applied in three places:

1. `GET /api/cart/:sessionId` — `where: { session_id, book: AVAILABLE_BOOK_WHERE }`. A
   withdrawn book's row silently disappears from the cart, exactly as a soft-deleted one does.
2. `POST /api/orders` — the same relation filter on the `cartItem.findMany`. The order is built
   from, and the total computed over, only available items. Zero available items falls through
   to the existing `400 Cart is empty`.
3. `POST /api/cart/:sessionId/items` — `findFirst({ where: { id: bookId, ...AVAILABLE_BOOK_WHERE } })`,
   returning the **same 404** as a missing book. No new status code, no information leak about
   whether someone's draft exists. No client path can reach this today (`BookDetail`'s Add to
   Cart renders only when `!isDraft`), so it is purely defensive.

**No wire shape changes.** `CartItemSchema`, `CartGetResponseSchema`, `OrderCreateResponseSchema`
are untouched; the change is which rows the query returns. Existing wire-shape assertions in
`cart.test.ts` and `orders.test.ts` are the regression fence and must stay green unmodified.

**Silent-hide is a deliberate choice, and it has a cost:** a buyer who put a book in their cart
and comes back to find it gone gets no explanation. It is chosen because it matches the
established soft-delete precedent, needs no new field on `CartItemSchema`, and fixes the
charging bug in the same motion. Surfacing withdrawn items with an explanation is Open
question 3, defaulted to "no" and cheap-ish to reverse (one boolean on `CartItemSchema`, which
*is* an OPS.3 wire-shape change).

### What a buyer who already ordered sees after an edit

The brief asks for this plainly, so: **their receipt is unaffected, and — during the edit
window — they cannot open the book at all.**

The mechanics, grounded:

- `OrderItem` snapshots `title`, `quantity`, and `price` at checkout (`orders.ts:44-48`). It
  does **not** snapshot content. So the order is a **receipt, not a copy** — and because it is
  a value snapshot, no edit can retroactively change what the buyer was told they bought or
  what they were charged. Phase 1 does not weaken this and does not need to strengthen it.
- There is **no purchased-book library** in this product. `OrderConfirmation.tsx` renders
  `{item.title} x{item.quantity}` and links to `/` and `/my-books`; there is no link from an
  order to `/book/:id` at all. Access to content is via the public catalog, which is a live
  view.
- Therefore, during the edit window, a buyer who navigates to `/book/:id` gets the existing
  draft branch of `GET /api/books/:id` (`books.ts:164-169`): `user.id !== book.created_by` ->
  **404, "Book not found."** Not a friendly "temporarily unavailable" — a hard 404, because
  that branch deliberately refuses to confirm a non-owner's draft exists.

That is the sharpest cost of fork 3 and the strongest argument for fork 1, and it should not be
softened in review. Two things bound it:

1. **ADR-008's PDF export is the durable artifact.** `POST /api/books/:id/pdf` is available to
   any signed-in user for a published book, and a buyer who downloaded it holds a real copy
   that no edit can touch. The gap is that nothing in the purchase flow *prompts* the download.
   Recorded as a deferred item, not claimed as a mitigation that exists today.
2. **Nothing is deployed** (`MEMORY.md`: deploy down, DB expires 2026-09-14). There are no real
   buyers to strand while this model is proven.

Deferring the fix is principled rather than lazy: granting a purchaser read access to a draft
means an entitlement check, and orders are keyed on `session_id` with an optional `user_id`
(`Order` model). Entitlement would mean either sending the cart session UUID to a read route —
extending a `localStorage` UUID into an authorization token, which is precisely the load-bearing
session model CLAUDE.md says not to touch without confirmation — or requiring accounts for
purchase, which is a product decision well outside #20.

### The author's flow

On `/book/:id`, owner, `status === 'published'`:

1. A primary control reading **"Edit this book"** — not "Unpublish". It sits with the other
   owner controls in the hero panel.
2. Clicking it expands an **inline confirm panel in place** (no modal — see below) with copy
   that states the actual consequence:
   > Editing takes *<title>* out of the catalog while you work. Readers won't be able to find
   > or buy it until you publish again. Anyone who already bought it keeps their receipt.

   Actions: **"Take it out and edit"** (calls the existing `PUT /api/books/:id/unpublish`) and
   **"Cancel"**.
3. On success the book is a draft and **every existing draft-only editing surface appears with
   no new code**: the revise panel, version history, cast portraits, Illustrate All, per-page
   prompt editing, per-page regenerate/history/revert. This is the payoff of choosing the model
   the code already assumes.

Owner, `status === 'draft'`:

4. A banner at the top of the page: **"Out of the catalog while you edit"**, with a
   **"Publish changes"** button (the existing `PUT /api/books/:id/publish`) and a one-line
   summary of what will go live (page count, and how many pages still have no illustration).
5. If any page lacks an `illustration_url`, "Publish changes" first shows an inline confirm:
   *"3 of 5 pages have no illustration yet. Publish anyway?"* — a **client-side** confirm, not
   a server 403. Text-only books are legitimate: the seed catalog has them and `renderBookPdf`
   handles them. This is the guard against fork 2's failure mode arriving through the back door
   after a revise nulls illustrations.

The banner copy is **status-driven only** and reads the same for a never-published draft and a
withdrawn one, because with no schema change the two are indistinguishable. That is a real
(small) copy compromise; see Open question 1.

### The confirmation is an inline panel, not a modal

Three candidates, and the choice follows an existing ADR rather than re-deriving one.

`window.confirm` is what `MyBooks.tsx:42` uses today. It is unstyleable (so it cannot honour
dark mode), its buttons are OS-sized (so `expectTapTargets` cannot assert them), and Playwright
must handle it through `page.on('dialog')`. For the single most consequential action in the
author flow, that is the wrong surface.

A real modal brings the full modal contract — focus trap, escape-to-close, scroll lock,
`aria-modal`, a portal. **ADR-004 decision 2 explicitly rejected exactly this trade** for
theater mode, choosing an in-place layout swap to avoid the contract. The same reasoning holds
for a two-button confirmation.

So: an **inline expanding panel** in the owner-controls region. No portal, no focus trap,
styleable in both themes, tap-target assertable, and trivially reachable by a role-based
Playwright selector. It extends ADR-004's precedent rather than contradicting it.

### Where the UI lives

`BookDetail.tsx` is 1213 lines and was just touched by the read-aloud merge. Rather than adding
a banner, a confirm panel, and two handlers to it, phase 1 adds one component:

`client/src/components/PublishStateBar.tsx` — owns both owner-facing states (published ->
"Edit this book" + confirm; draft -> "Out of the catalog" + "Publish changes" + unillustrated
confirm), renders **nothing** for non-owners, and takes `onWithdraw` / `onPublish` callbacks so
the fetch logic stays in `BookDetail`. `BookDetail`'s diff is then a mount plus two handlers
plus the `isDraft` fixes at `:851` and `:941`.

### Schema / contract changes

**None to Prisma. None to seed data. No new `@storybook/shared` schema, and no field added to
or removed from an existing one.** This is a deliberate design goal, not an accident — it is
what keeps the CLAUDE.md seed/cart/order guardrail untripped.

What *does* change contractually, and how OPS.3 is discharged:

| Route | Change | How it is pinned |
|---|---|---|
| `POST /:id/revise` | new 403 when not draft | `toMatchObject({ error: expect.any(String) })` on the 403; existing 200 success-shape assertion unchanged and still green |
| `POST /:id/illustrate` | new 403 when not draft | same |
| `POST /:id/characters/:characterIndex/portrait` | new 403 when not draft; now `spendGate('cover')`-mounted, so also a new 429 path | 403 and 429 envelopes pinned; existing 200 shape unchanged |
| `PUT /:id/illustrations/:pageNumber/revert` | new 403 when not draft | same |
| `POST /api/cart/:sessionId/items` | 404 for a non-published book | existing 404 envelope assertion covers it; add a case |
| `GET /api/cart/:sessionId` | withdrawn books filtered out | `CartGetResponseSchema` unchanged; assert the item is absent and `total` excludes it |
| `POST /api/orders` | withdrawn/deleted books excluded from items and total | `OrderCreateResponseSchema` unchanged; assert `items` length and `total` |

`validate()`'s response check runs only on 2xx, so the new 403/429 paths flow through the
existing error-envelope handling untouched.

### Data flow

**Withdraw:** owner clicks "Edit this book" on `/book/:id` -> inline confirm ->
`PUT /api/books/:id/unpublish` (`requireAuth -> validate -> handler`; 404 if not owner, 403 if
not published) -> `Book.status = 'draft'` -> response is the hydrated book -> `BookDetail`
merges it into state -> `isDraft` flips -> every draft-gated editing surface mounts. In the
same instant, the book leaves `GET /api/books` (already filters `status: 'published'`), 404s
for non-owners on `GET /api/books/:id`, becomes un-addable to carts, and drops out of existing
carts and checkout totals.

**Edit:** unchanged. Existing routes, existing spend gates, existing `BookVersion` snapshots,
existing version-history panel.

**Cutover:** owner clicks "Publish changes" -> if any page lacks `illustration_url`, inline
confirm -> `PUT /api/books/:id/publish` -> `Book.status = 'published'` -> book reappears in the
catalog, becomes addable and purchasable, and its current `Page` rows are what everyone sees.
`book.version` is **not** touched.

**Concurrency:** a second tab still showing the published view will get a 403 from any edit
route. The client treats a 403 from an edit route as "my view is stale" — refetch the book and
re-render — rather than surfacing a raw error.

### Files likely touched

**Server**

- `server/src/lib/availability.ts` — **new.** `AVAILABLE_BOOK_WHERE`, plus
  `requireDraft(book)` returning the shared 403 payload.
- `server/src/routes/books.ts` — draft gate on four handlers; the two already-gated handlers
  adopt the shared helper; `spendGate('cover')` + `recordUsage(..., 'cover')` on the portrait
  route.
- `server/src/routes/cart.ts` — `AVAILABLE_BOOK_WHERE` on the GET filter and the add-item
  lookup.
- `server/src/routes/orders.ts` — `AVAILABLE_BOOK_WHERE` on the checkout `cartItem.findMany`.
- `server/src/routes/__tests__/{books,cart,orders}.test.ts` — new cases; existing wire-shape
  assertions untouched.
- `server/src/lib/__tests__/availability.test.ts` — **new.**

**Client**

- `client/src/components/PublishStateBar.tsx` — **new.**
- `client/src/components/__tests__/PublishStateBar.test.tsx` — **new.**
- `client/src/pages/BookDetail.tsx` — mount `PublishStateBar`; `handleWithdraw`; extend
  `handlePublish` with the unillustrated confirm; add `isDraft` to the reader-view owner
  controls at `:851` and `:941`; 403-means-stale refetch.
- `client/src/pages/MyBooks.tsx` — relabel the existing control to match the new vocabulary;
  same route, same handler.
- `client/src/pages/__tests__/{BookDetail,MyBooks}.test.tsx` — updated.

**E2E**

- `e2e/tests/edit-published.spec.ts` — **new** (desktop: the full loop + the immutability
  fence).
- `e2e/tests/mobile/edit-published.spec.ts` — **new** (`forEachTheme` x two viewports).

**Docs**

- `.code-captain/product/roadmap.md`, `.code-captain/product/decisions.md` (ADR-012),
  `docs/conventions/server.md` (a short "published books are immutable" note next to the
  middleware-order rule).

## Alternatives considered

### The edit model

#### Withdraw to edit — draft is the edit state (proposed)

**Pros:** One source of truth for book content. Already half-implemented, including the 403
message and the user-facing explanation. No schema change, so the seed/cart/order guardrail is
never approached. Reversible in one click. Makes the existing catalog query correct by
construction.
**Cons:** The book is off-sale during the edit, and a prior buyer gets a hard 404 on
`/book/:id` in that window.

#### Shadow draft with cutover — old version stays public

**Pros:** No availability gap; the author edits at leisure and flips a switch. The right model
for a storefront with real traffic.
**Cons:** Book content stops being one thing. `BookVersion` snapshots are text-only and cannot
serve the live version, so this needs either duplicate `Page` rows under a shadow `Book`
(dragging in identity questions for `CartItem.book_id`, `OrderItem.book_id`, `/book/:id`, and
`IllustrationVersion.book_id`) or an `illustration_url`-bearing snapshot plus a
which-content-am-I resolution rule threaded through eight-plus read paths. Every one of those
is a place a future bug can serve the wrong content to a buyer.
**Status:** held as the upgrade path — see below.

#### Mutate in place, no version bump

**Pros:** Nothing to build; partially in effect already.
**Cons:** `POST /:id/revise` nulls `illustration_url` on changed pages, so one call silently
publishes a half-illustrated book. Text changes under a reader mid-book. No review moment, no
rollback except paying to re-illustrate. It is not "cheap" — it is the current defect, restated
as a feature.
**Status:** rejected. Task 1 is, in part, the removal of this fork from the codebase.

### Deferred: the shadow-draft cutover model

Fork 1 is not wrong, it is early. It becomes worth its cost when any of these fire:

1. **The deploy is restored (#77) and the catalog has real traffic** — an availability gap only
   costs something when someone is trying to buy.
2. **An author reports losing a sale, or complains about the book vanishing** while they edit.
3. **A purchased-book library ships**, so a buyer has a durable in-app copy. That changes the
   calculus twice over: it removes the 404-for-buyers problem and it makes "which version did I
   buy" a question worth answering.
4. **Edit sessions become long-running** — a multi-day revise-and-illustrate cycle is a
   materially different thing to take off-sale than a five-minute typo fix.
5. **Scheduled publishing or an editorial review step** is requested — both presuppose a staged
   version that is not live.

When it fires, the shape to reach for is a `published_version` pointer on `Book` plus an
`illustration_url` field on the `BookVersion` snapshot, so the live view can be served from a
snapshot without duplicating `Page` rows. Recording that here so the next architect starts from
a considered sketch rather than a blank page.

### The cart's treatment of a withdrawn book

#### Silent-hide, shared filter (proposed)

**Pros:** Matches the documented soft-delete precedent in the same file. No wire-shape change.
Fixes the existing GET/POST disagreement — a live charging bug — in the same edit.
**Cons:** The buyer gets no explanation for the disappearance.

#### Show the row as "Unavailable — the author is updating this book"

**Pros:** Honest, and better UX.
**Cons:** Needs a field on `CartItemSchema` (an OPS.3 wire-shape change, a shared-package edit,
and a new cart row state in both themes) plus a decision about what checkout does with it. Also
inconsistent unless soft-deleted books get the same treatment, which widens the change again.
**Status:** deferred, Open question 3.

#### Reject checkout with a 409 listing unavailable ids

**Pros:** Maximally explicit; nothing is silently dropped.
**Cons:** A new error shape (wire-shape change), a hostile experience, and — during a
withdraw-race — an order that fails outright rather than succeeding for the items that are
fine. **Status:** rejected.

### The confirmation surface

`window.confirm` (today's pattern in `MyBooks.tsx`) is rejected: no dark mode, no assertable
tap targets, `page.on('dialog')` in e2e. A real modal is rejected on **ADR-004 decision 2**'s
reasoning — the modal contract (focus trap, escape, scroll lock, `aria-modal`, portal) is a
large tax for two buttons. The inline in-flow panel is chosen; it is the same trade ADR-004
already made and it keeps the new surface inside the `forEachTheme` / `expectTapTargets`
harness.

### Charging portraits

Adding a fourth `COST_CENTS` kind (`portrait: 4`) would be more precise in the ledger, but it
means a new `UsageKind` union member, a new env/limits story, and a question about what
historical rows should have been. Reusing `cover: 4` costs one line and is numerically
identical today. **Status:** reuse `cover`; revisit if portrait pricing ever diverges from cover
pricing.

## Success criteria

1. `cd server && npm test` green, including new cases proving each of the four newly-gated
   routes returns **403 with a pinned error envelope** for a published book and still returns
   its existing, unchanged success shape for a draft.
2. **Ownership beats status:** a non-owner hitting any of the six mutating routes on a
   published book gets **404**, never 403. Asserted directly for at least `revise` and
   `illustrate`.
3. `POST /api/books/:id/characters/:characterIndex/portrait` writes a `UsageLog` row on
   success and returns **429** when the quota is exhausted, proven by a test that exhausts the
   daily cap — the same shape `spendGate`'s existing tests use.
4. **A 403'd paid route costs nothing:** hitting `/illustrate` or `/portrait` on a published
   book writes **no** `UsageLog` row and makes no provider call.
5. `GET /api/cart/:sessionId` and `POST /api/orders` agree: with a withdrawn (or soft-deleted)
   book in the cart, the item is absent from both, and `order.total` equals the cart's displayed
   total. The pre-existing soft-delete divergence is covered by a regression test that fails
   against `master`.
6. `POST /api/cart/:sessionId/items` returns **404** — the same envelope as a missing book —
   for a draft book id.
7. `cd client && npm test` green, including `PublishStateBar` covering: hidden for non-owners;
   published-owner shows "Edit this book"; the confirm panel opens and cancels without calling
   `onWithdraw`; confirming calls it once; draft-owner shows the out-of-catalog banner; publish
   with unillustrated pages requires the second confirm; publish with all pages illustrated does
   not.
8. `BookDetail` no longer renders illustration regenerate/history controls for a published book
   in reader view — a direct regression test on `:851`/`:941`.
9. `e2e/tests/edit-published.spec.ts` passes the full loop against the real server: publish ->
   "Edit this book" -> confirm -> draft surfaces appear -> "Publish changes" -> the book is back
   in the catalog. Plus the fence: while published, no edit affordance is reachable in either
   view mode.
10. `e2e/tests/mobile/edit-published.spec.ts` passes on `mobile-pixel` and `mobile-small`, both
    themes via `forEachTheme`, with `expectNoHorizontalOverflow` and
    `expectTapTargets(..., PRIMARY_TAP_MIN)` on every new control. **This claims the correctness
    half of done-criterion #2 only** (ADR-009); the aesthetic half is named in §Autonomy ledger.
11. `dark-mode-parity-check` reports no missing `dark:` partner on the diff.
12. Existing specs stay green **unmodified** as the regression fence: `version-history.spec.ts`,
    `illustration-history.spec.ts`, `cart-checkout.spec.ts`, `book-detail.spec.ts`,
    `narration.spec.ts`, `e2e/tests/mobile/{money-path,reader,narration,offline-cart}.spec.ts`.
    Any of these needing an edit is a signal the change is larger than designed — hand back.
13. `npx tsc --noEmit`, `npm run lint`, `npm run build` clean in `client/`; no TS errors in
    `server/`.
14. `git diff --stat server/prisma/` is **empty**. No migration, no schema change.

## Autonomy ledger

Per ADR-009, the honest per-task answer to "can `/execute-task` finish this without a human?"

| Task | Machine-verified | Genuinely needs a human |
|---|---|---|
| 1 — draft gate | **Fully.** Supertest over every route x {draft, published} x {owner, non-owner}. | No. |
| 2 — portrait spend gate | **Fully.** The quota-exhaustion pattern already exists in the spend tests. | **Yes, one decision, not a check:** whether this ships inside #20 or as its own PR. Ask before merging. |
| 3 — money-path filter | **Fully.** Including a regression test that fails on `master`. | **Yes, weakly.** This changes checkout behaviour. A human should read the diff knowing that, even though the change is strictly in the buyer's favour. |
| 4 — `PublishStateBar` | **Correctness, fully:** RTL over every branch, plus `dark-mode-parity-check`. | **Aesthetics only.** Non-blocking. |
| 5 — `BookDetail` wiring | **Fully** at the behavioural level, including the `:851`/`:941` regression. | No. |
| 6 — `MyBooks` copy | **Fully.** | **Yes — copy review.** Wording is a product judgement; the strings are in one place for that reason. |
| 7 — desktop e2e | **Fully.** | No. |
| 8 — mobile x theme e2e | **Fully** for the correctness half of #2. | **Yes.** Does the withdrawal read as reassuring rather than alarming? Does the out-of-catalog banner feel like a state or like an error? That is the aesthetic half and no assertion covers it. |
| 9 — docs | **Fully.** | No. |
| 10 — pre-merge follow-ups | `adr-tracking-check` is mechanical; the ADR text is not. | **Yes** — the ADR records a hard-to-reverse product decision and wants the owner's sign-off. |

**Bottom line.** Every behaviour in this feature is deterministic and fully testable — there is
no device API, no audio, no external service in the phase-1 path. What needs a human is
**three judgements, not three verifications**: is the withdrawal copy right (Tasks 4, 6, 8),
should the portrait spend fix ride along or ship separately (Task 2), and is "the book goes
off-sale while you edit" acceptable as the product's answer (the ADR).

## Out of scope

- **Any Prisma schema change, any migration, any seed change.** Including `published_at` and
  `published_version`. See Open questions 1 and the deferred fork-1 sketch.
- **The shadow-draft / cutover model.** Deferred with five named triggers.
- **Purchaser entitlement to draft content.** Requires touching the load-bearing session model
  or requiring accounts for purchase. Deferred with its reasoning.
- **A purchased-book library / "my copies" surface.** It is the real fix for the buyer-404
  problem and it is a feature in its own right, not a sub-task of #20.
- **Prompting the buyer to download the PDF at checkout.** Small and worthwhile; not this spec.
- **Direct per-page text editing** (`roadmap.md` §Phase 3). #20 is about making the *existing*
  edit primitives reachable for published books, not about adding new ones. Adding a text-edit
  route here would double the surface and drag in its own wire shape.
- **Editing `price`, `title`, `author`, `cover_emoji`, `cover_color`, `is_featured`, or
  `theme`.** No route mutates these today. Price in particular interacts with carts and orders
  in ways that deserve their own spec.
- **Story remix / "use this book as a starting point"** (`roadmap.md` §Phase 3) — a clone
  operation, a different feature.
- **Admin editing of books they do not own.** Every route here is owner-gated
  (`created_by === user.id`); `requireAdmin` is not introduced.
- **Surfacing withdrawn items in the cart with an explanation.** Open question 3, defaulted off.
- **Scheduled publishing, editorial review, or any approval workflow.**
- **Notifying buyers that a book they own was updated.** No notification system exists.
- **WebKit e2e coverage.** Inherited from ADR-009: CI installs Chromium only.

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| **A prior buyer gets a hard 404 on `/book/:id` while the author edits.** The sharpest cost of the chosen model, and the thing most likely to be raised in review. | Named explicitly in §"What a buyer sees" rather than softened. Bounded by: the receipt is a value snapshot and is unaffected; ADR-008's PDF is a durable copy; nothing is deployed, so there are no real buyers today. Fix is deferred behind the fork-1 triggers and the entitlement note. **Do not let this ship as an undiscussed surprise — it belongs in the PR body.** |
| **`POST /:id/revise` nulls `illustration_url` on changed pages.** Ungated today, so it can already half-illustrate a live book. | Task 1's draft gate makes it unreachable on a published book. Task 4's publish-time confirm ("3 of 5 pages have no illustration yet") is the second net, so a revise-then-republish cycle cannot quietly ship a degraded book. |
| **The portrait route is a paid call with no `spendGate` and no `recordUsage`.** The global monthly ceiling — which nobody may bypass — never sees these calls, because it sums `UsageLog` rows that are never written. | Task 2. Charged at the existing `cover: 4` rate. Pre-existing, not caused by #20; flagged so it is fixed rather than inherited. |
| **A draft gate on a paid route could still cost money** if it ran after the AI call. | The gate is the first thing in the handler body, before any provider call and before `recordUsage`. `spendGate` middleware reserves headroom but does not charge; only `recordUsage` charges. Success criterion 4 asserts no `UsageLog` row is written on a 403. |
| **Ownership/status leak:** returning 403 before the owner check would tell a stranger that a book exists and is published. | The gate runs strictly **after** the `created_by === user.id` check. Non-owner is 404 everywhere. Success criterion 2 asserts it. |
| **`GET /api/cart` and `POST /api/orders` already disagree** — a soft-deleted book is hidden from the cart but still charged. Withdrawing books for editing makes this fire routinely. | One exported `AVAILABLE_BOOK_WHERE` used by both, plus the add-item lookup. A regression test that fails against `master` proves the pre-existing bug is closed, not just papered over. |
| **This changes money-path behaviour.** A cart total can now legitimately shrink between page loads. | The change is strictly in the buyer's favour (they stop being charged for books they cannot open), the total is already recomputed server-side at checkout, and `OrderConfirmation` renders the server's `order.total`. Flagged in the autonomy ledger for a human diff read and called out in the PR body. |
| **Withdraw-during-checkout race:** the author unpublishes between the buyer's cart GET and their order POST. | The item silently drops and the order total is lower than the buyer last saw. Accepted: the confirmation page shows the server's authoritative total, so the buyer is never charged more than displayed. No locking in phase 1. |
| **Stale second tab** still showing published controls hits a 403. | The client treats a 403 from any edit route as "my view is stale": refetch the book and re-render rather than surfacing a raw error. Specified in Task 5. |
| **`BookDetail.tsx` is 1213 lines and the read-aloud merge just touched it** (ADR-011, `BookSpread` + `NarrationPlayer`). | New UI lands in a separate `PublishStateBar` component. `BookDetail`'s diff is a mount, two handlers, and the two `isDraft` fixes. **No change to `BookSpread`, `NarrationPlayer`, `PageCanvas`, or ADR-004's theater frame.** If a change would touch theater behaviour, hand back — that is an ADR-004 amendment. |
| **The reader-view owner controls at `BookDetail.tsx:851` and `:941` are gated on `isOwner` alone.** Once the routes 403, these buttons break rather than disappear. | Task 5 adds `isDraft` to both, with a direct regression test (success criterion 8). This is the one place where the server change would otherwise produce a visible client bug. |
| **`e2e/tests/version-history.spec.ts` and `illustration-history.spec.ts` are route-mocked** and assume a draft book. | Unaffected by design — draft is exactly the state they mock. They are the regression fence (success criterion 12) and must pass **unmodified**. Editing them is a signal the change grew. |
| **Existing carts in `dev.db` may hold books that are about to be withdrawn.** | No data migration is needed: the filter is evaluated at read time. `dev.db` is not touched; no `db:reset` is required. |
| **Scope creep toward direct text editing.** #20's title invites "while we're here, let people fix a typo." | Explicitly out of scope. It needs its own route, its own wire shape, its own `BookVersion` snapshot semantics, and its own spec. If a task starts adding one, stop and hand back. |
| **No schema change is a load-bearing claim, not an aspiration.** | Success criterion 14 asserts `git diff --stat server/prisma/` is empty. If a task believes it needs a column, hand back to the architect — the seed/cart/order guardrail requires explicit user confirmation. |

## ADR-worthy decisions

- [ ] **"Withdraw to edit": a published book is immutable, and editing it means taking it out
      of the catalog until republished (fork 3).** The spine of the feature, chosen over the
      shadow-draft cutover (fork 1) and in-place mutation (fork 2). The issue itself says this
      needs an ADR. The durable artifacts are the reasoning about eight-plus read paths and the
      five named triggers that would reopen fork 1.
- [ ] **Route-layer immutability is enforced by one shared `requireDraft` helper, not per-route
      checks — and it runs after the owner check, never before.** Establishes both the
      enforcement point and the ownership-beats-status ordering for every future book route.
- [ ] **Republishing does not bump `book.version`; publishing is a status transition, not a
      version event.** Preserves the meaning of every existing `BookVersion` row and of the
      version-history panel.
- [ ] **Cart availability is one shared `where` fragment used by both `GET /api/cart` and
      `POST /api/orders`; unavailable items are silently dropped, matching the soft-delete
      precedent.** Closes a live charging bug and sets the rule for any future availability
      condition.
- [ ] **Phase 1 lands zero schema changes; `published_at` / `published_version` are
      deliberately not added.** Records that the state machine is the two values `status`
      already holds, and what it costs (a never-published draft and a withdrawn one read
      identically in the UI).
- [ ] **Character-portrait generation is charged at the existing `cover` rate rather than
      adding a fourth `COST_CENTS` kind** — and the underlying finding, that the route was
      running paid and unmetered against the global ceiling, is recorded so the next paid route
      is checked against the same list.
- [ ] **The withdrawal confirmation is an inline in-flow panel, not a modal and not
      `window.confirm`** — extends ADR-004 decision 2's no-overlay precedent and keeps the
      surface inside the ADR-009 `forEachTheme` / `expectTapTargets` harness.
- [ ] **The buyer's durable artifact is the ADR-008 PDF, not a live catalog entry; purchase
      confers no entitlement to draft content.** States the product's position on what a
      purchase actually buys today, and why fixing it means touching the load-bearing session
      model.
- [ ] **Deferred:** the shadow-draft/cutover model (five triggers); purchaser entitlement to
      draft content; a purchased-book library; a checkout-time PDF-download prompt;
      `Book.published_at`; surfacing withdrawn items in the cart with an explanation; direct
      per-page text editing; editing price/title/cover metadata; story remix; admin editing of
      others' books; scheduled publishing; buyer notification on update; WebKit e2e coverage.

## Open questions

Each has a stated default the architect would defend, and a note on reversal cost. If nobody
rules, the default ships.

1. **Should `Book.published_at` (nullable `DateTime`) be added so the UI can distinguish "never
   published" from "withdrawn for editing"?**
   **Default: no.** Phase 1's banner copy is status-driven and reads the same for both. The
   compromise is small and the field is speculative until the copy is seen in use.
   **Reversal: cheap.** One additive nullable column plus a one-line backfill
   (`UPDATE Book SET published_at = created_at WHERE status = 'published'`) in the same
   migration. No wire-shape change unless the client needs it, and no seed *shape* change.

2. **Should `PUT /:id/publish` refuse a book with unillustrated pages?**
   **Default: no server block; client-side confirm only.** Text-only books are legitimate — the
   seed catalog contains them and `renderBookPdf` handles them. A server 403 would break them.
   **Reversal: trivial to add** (one check in the handler), but it is a breaking change for
   text-only books, so adding it later needs its own thought.

3. **Should a withdrawn book appear in the cart as an explained "Unavailable" row instead of
   silently disappearing?**
   **Default: no — silent-hide,** matching the documented soft-delete precedent in the same
   file, and consistent for both causes of unavailability.
   **Reversal: moderate.** It is an OPS.3 wire-shape change (a field on `CartItemSchema`), a
   `@storybook/shared` edit, a new cart row state in both themes, and a decision about what
   checkout does with such a row.

4. **Should republishing bump `book.version`?**
   **Default: no.** `version` tracks content revisions and already moves when content changes;
   `BookVersion` snapshots are keyed to it. Bumping on publish would make version numbers move
   without a corresponding snapshot.
   **Reversal: one line, but semantically expensive** — it retroactively changes what every
   existing `BookVersion` row's number means.

5. **Should `GET /api/books/:id` grant draft access to a user who has an `OrderItem` for the
   book, so prior buyers can keep reading during an edit?**
   **Default: no.** `Order` is keyed on `session_id` with an optional `user_id`; an entitlement
   check means either extending the `localStorage` cart UUID into an authorization token — the
   load-bearing session model CLAUDE.md protects — or requiring accounts for purchase.
   **Reversal: expensive.** This is an auth/entitlement design with its own spec and its own
   user confirmation, not a follow-up commit.

6. **Should Task 2 (the portrait `spendGate` + `recordUsage` fix) ship inside this PR or as its
   own?**
   **Default: its own PR, landed first**, because it is a spend-exposure fix that should not
   wait on a feature review, and because a clean #20 diff is easier to reason about. Task 2 is
   written to be independently mergeable either way.
   **Reversal: free** — it is a commit-boundary choice, not a code choice.
