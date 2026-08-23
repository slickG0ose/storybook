# Edit published books — phase 1, "withdraw to edit" — task plan

> Spec: [spec.md](spec.md)
> Status: Draft
> Last updated: 2026-08-23
> Architect: Claude Opus 5 via @architect on 2026-08-23
> Backlog: [#20](https://github.com/slickG0ose/storybook/issues/20)

## Overview

Ten tasks in three movements: **make the model true on the server (1–3), make it visible in
the client (4–6), prove it and record it (7–10).**

The server movement is where the correctness lives and it is fully deterministic under
Supertest — no AI call, no provider, no browser. Tasks 1 and 3 are the natural parallel cut
(they touch disjoint route files and disjoint tests). Task 2 is independently mergeable and may
be split into its own PR (Open question 6); it is sequenced second so the paid-route chain is
settled before any client work assumes it.

The client movement is deliberately shaped so `BookDetail.tsx` — 1213 lines, just touched by
the read-aloud merge — receives a small diff: Task 4 builds a standalone component with its own
tests, Task 5 mounts it and fixes two pre-existing `isDraft` gaps.

**`**Status:** <state>` lines under each task heading are how `/execute-task` records progress.**

## Branch base

Branch from `master`. This spec has no dependency on in-flight work; `agent/feat/mobile-pwa`
(PR #79) and the read-aloud bundle are already merged, and the ADR-009 e2e harness this plan
uses (`e2e/tests/mobile/_helpers.ts`) is on `master`.

If PR #79 is still unmerged when work starts, rebase onto it rather than branching from
`master` — Task 8 needs `forEachTheme` / `expectNoHorizontalOverflow` / `expectTapTargets`.

## Cross-cutting constraints

Obey these; the reasoning is in the spec.

- **No Prisma schema change, no migration, no seed change.** `git diff --stat server/prisma/`
  must be empty at the end. If a task believes it needs a column, **stop and hand back** — this
  is the CLAUDE.md seed/cart/order guardrail and it needs explicit user confirmation.
- **No new `@storybook/shared` schema, and no field added to or removed from an existing one.**
  Every route keeps its current success shape. If a task finds itself editing `shared/src/`,
  stop and hand back.
- **Wire-shape (OPS.3 / ADR-003).** New response *paths* still need pinning. For each new 403
  and the new 429: `expect(res.body).toMatchObject({ error: expect.any(String) })`. Every
  existing `toMatchObject` success assertion in `books.test.ts`, `cart.test.ts`, and
  `orders.test.ts` must stay green **unmodified** — they are the fence proving success shapes
  did not drift.
- **Ownership beats status, always.** The draft gate runs **after** the `created_by === user.id`
  check. A non-owner gets 404 on every mutating route regardless of status. Never 403 to a
  stranger.
- **Auth middleware order is unchanged.** `requireAuth -> [spendGate] -> validate -> handler`.
  The draft gate is a **handler-body check**, not middleware. Do not mount it before
  `validate()` (`docs/conventions/server.md` §"Middleware order rule").
- **A 403 must cost nothing.** On the two paid routes the gate is the first statement in the
  handler body — before any provider call and before `recordUsage`. Assert no `UsageLog` row is
  written.
- **Guardrails touched — surface these before acting:**
  - **Money-path behaviour changes** in Task 3 (`POST /api/orders` stops charging for
    unavailable books). Strictly in the buyer's favour, but say so in the hand-back and the PR
    body.
  - **A paid route gains a spend gate** in Task 2. No new `COST_CENTS` kind; reuse `cover: 4`.
  - Nothing here reads, writes, or reinterprets `storybook-session`, `storybook-auth`, or any
    other `localStorage` key. If a task needs to, **stop** — that is the load-bearing session
    model.
- **Dark-mode parity** on every new surface and **every state**: default, hover, focus-visible,
  disabled, confirm-open and confirm-closed. Run `dark-mode-parity-check` on the diff before
  marking any client task Done.
- **Do not touch** `BookSpread.tsx`, `NarrationPlayer.tsx`, `PageCanvas`, or ADR-004's theater
  frame/`?theater=1` contract. If a change appears to need it, hand back — that is an ADR-004 or
  ADR-011 amendment.
- **These specs must pass unmodified** as the regression fence: `e2e/tests/version-history.spec.ts`,
  `illustration-history.spec.ts`, `cart-checkout.spec.ts`, `book-detail.spec.ts`,
  `narration.spec.ts`, `e2e/tests/mobile/{money-path,reader,narration,offline-cart}.spec.ts`.
  Needing to edit one is a signal the change grew past its design — hand back.
- **Mobile done-criterion claims (ADR-009).** Tasks 4–6 claim the **correctness** half of
  done-criterion #2 via Task 8's `forEachTheme` spec. The **aesthetic** half is named in the
  spec's §Autonomy ledger and is not claimed by any task.

## Tasks

### Task 1 — Server: a published book is immutable

**Status:** Done (2026-08-23)

**Zone:** server
**Depends on:** none
**Parallel-safe with:** Task 3

Close the fork-2 hole. Four content-mutating routes currently run against published books; two
already refuse. Make all six use one helper with one message.

**Files to add or change:**
- `server/src/lib/availability.ts` — **new.** The shared draft precondition.
- `server/src/lib/__tests__/availability.test.ts` — **new.**
- `server/src/routes/books.ts` — gate four handlers; migrate the two existing ad-hoc checks.
- `server/src/routes/__tests__/books.test.ts` — new cases.

**Signatures / shapes:**

```ts
// server/src/lib/availability.ts

/** Message returned by every "this book is published" 403. One string, one meaning. */
export const PUBLISHED_IMMUTABLE_ERROR =
  'Published books cannot be edited. Take the book out of the catalog to edit it.';

/**
 * True when the book may be mutated. Publishing/unpublishing/soft-deleting are
 * status transitions, not content mutations, and do not go through this.
 */
export function isEditable(book: { status: string }): boolean {
  return book.status === 'draft';
}
```

Applied in each handler, **after** the owner check and **before** anything else:

```ts
const book = await prisma.book.findFirst({ where: { id: req.params.id, deleted_at: null }, /* ... */ });
if (!book || book.created_by !== user.id) {
  return res.status(404).json({ error: 'Book not found' });   // ownership first — unchanged
}
if (!isEditable(book)) {
  return res.status(403).json({ error: PUBLISHED_IMMUTABLE_ERROR });
}
```

Routes to gate (all in `server/src/routes/books.ts`):

| Route | Current state |
|---|---|
| `POST /:id/revise` (~line 293) | ungated — **add** |
| `POST /:id/illustrate` (~line 640) | ungated — **add**, before the `isImageGenConfigured` 501 and before the loop |
| `POST /:id/characters/:characterIndex/portrait` (~line 742) | ungated — **add** |
| `PUT /:id/illustrations/:pageNumber/revert` (~line 855) | ungated — **add** |
| `PUT /:id/pages/:pageNumber` (~line 264) | already 403s — **replace** the inline check with `isEditable` + the shared message |
| `PUT /:id/versions/:version/restore` (~line 505) | already 403s — same |

**Do not gate:** `PUT /:id/publish`, `PUT /:id/unpublish`, `DELETE /:id`, or any `GET`.

**Tests to write:**
- `server/src/lib/__tests__/availability.test.ts` — `isEditable` for `'draft'`, `'published'`,
  and an unexpected value (must be false — fail closed).
- `server/src/routes/__tests__/books.test.ts`, per newly-gated route:
  - published + owner -> **403**, `toMatchObject({ error: expect.any(String) })`, and the body
    matches `PUBLISHED_IMMUTABLE_ERROR`.
  - draft + owner -> unchanged existing behaviour; the existing success-shape assertion still
    passes.
  - published + **non-owner** -> **404**, not 403 (assert for at least `revise` and
    `illustrate`).
  - **No `UsageLog` row** is written by a 403 on `/illustrate` (`prisma.usageLog.count()` is 0
    after the call), and the Anthropic/provider mock was not called.
- Migrating the two already-gated routes: their existing 403 tests must still pass, with the
  message assertion updated to the shared constant.
- Wire-shape assertion required: **yes** — the 403 envelope on each of the four newly-gated
  routes. Success shapes are unchanged and their existing assertions are the fence.

**Manual verify:** none — pure server behaviour.

**Done when:** listed tests pass, `cd server && npm test` green, no new TS errors,
`git diff --stat server/prisma/` empty.

---

### Task 2 — Server: close the character-portrait spend hole

**Status:** Done (2026-08-23)

**Zone:** server
**Depends on:** Task 1 (edits the same handler's chain; sequencing avoids a conflict)
**Parallel-safe with:** Task 3

**A pre-existing defect, not caused by #20.** `POST /api/books/:id/characters/:characterIndex/portrait`
makes a paid image call with **no `spendGate` mount and no `recordUsage` call**, so those calls
are invisible to both the per-user daily cap and the global monthly ceiling — the ceiling
nobody is allowed to bypass.

**This task is independently mergeable and may ship as its own PR (Open question 6, default:
its own PR, landed first). Surface that choice in the hand-back.**

**Files to add or change:**
- `server/src/routes/books.ts` — the portrait route only.
- `server/src/routes/__tests__/books.test.ts` — quota cases.

**Signatures / shapes:**

```ts
router.post(
  '/:id/characters/:characterIndex/portrait',
  requireAuth,
  spendGate('cover'),            // ← added. requireAuth -> spendGate -> validate -> handler
  validate({ /* unchanged */ }),
  async (req, res) => {
    // ... owner 404, Task 1's isEditable 403, 501 when unconfigured, index parse — unchanged
    const url = await generateCharacterPortrait(/* unchanged */);
    if (url) {
      await recordUsage(user.id, 'cover');   // ← added, AFTER success, mirroring /illustrate
      // ... existing characters_json patch
    }
    // ...
  },
);
```

**No new `COST_CENTS` kind.** A portrait is one image at the same size class as a cover;
`cover: 4` already exists and is numerically identical. Do not add `portrait`.

`recordUsage` fires **only when `url` is truthy** — a provider miss must not consume quota,
matching the "written AFTER the call succeeds" rule in CLAUDE.md §Spend gates.

**Tests to write:**
- Success writes exactly one `UsageLog` row with `kind: 'cover'` and
  `cost_cents: COST_CENTS.cover`.
- A provider returning null writes **no** row.
- With the daily cap exhausted, the route returns **429** and the envelope is pinned:
  `toMatchObject({ error: expect.any(String) })`. Reuse the exhaustion pattern from the
  existing `spendGate` / `/illustrate` tests rather than inventing one.
- Task 1's 403 path still writes no row (already asserted there — re-run, don't duplicate).
- Wire-shape assertion required: **yes** — the new 429 envelope. The 200 shape
  (`CharacterPortraitGenerateResponseSchema`) is unchanged; its existing assertion is the fence.

**Manual verify:** none.

**Done when:** listed tests pass, `cd server && npm test` green, no new TS errors, and the
hand-back states explicitly whether this should be split into its own PR.

---

### Task 3 — Server: one availability filter for cart display and checkout

**Status:** Done (2026-08-23)

**Zone:** server
**Depends on:** none
**Parallel-safe with:** Tasks 1, 2 (disjoint files; only `server/src/lib/availability.ts` is
shared — if Task 1 has not landed, create the file and let Task 1 add to it)

Make a withdrawn book un-buyable, and close the live divergence where
`GET /api/cart/:sessionId` hides soft-deleted books while `POST /api/orders` still charges for
them.

**Files to add or change:**
- `server/src/lib/availability.ts` — add the shared `where` fragment.
- `server/src/routes/cart.ts` — GET filter + add-item lookup.
- `server/src/routes/orders.ts` — checkout `findMany` filter.
- `server/src/routes/__tests__/cart.test.ts`, `orders.test.ts` — new cases.

**Signatures / shapes:**

```ts
// server/src/lib/availability.ts

/**
 * A book a shopper may see, add, or be charged for. Used by GET /api/cart,
 * POST /api/cart/:sessionId/items, and POST /api/orders — the three places
 * that must agree, and previously did not.
 */
export const AVAILABLE_BOOK_WHERE = { deleted_at: null, status: 'published' } as const;
```

```ts
// cart.ts — GET /:sessionId
where: { session_id: sessionId, book: AVAILABLE_BOOK_WHERE }

// cart.ts — POST /:sessionId/items  (same 404 as a missing book; no new status code)
const book = await prisma.book.findFirst({ where: { id: bookId, ...AVAILABLE_BOOK_WHERE } });
if (!book) return res.status(404).json({ error: 'Book not found' });

// orders.ts — POST /
const cartItems = await prisma.cartItem.findMany({
  where: { session_id: sessionId, book: AVAILABLE_BOOK_WHERE },
  include: { book: true },
});
// zero rows falls through to the existing 400 'Cart is empty' — do not add a new code
```

**Do not** add a field to `CartItemSchema`, do not add a 409, do not change
`OrderCreateResponseSchema`. Unavailable items disappear silently, matching the existing
soft-delete comment in `cart.ts`.

**Tests to write:**
- `cart.test.ts`:
  - a draft book in the cart is absent from `GET /api/cart/:sessionId` and excluded from
    `total`.
  - `POST /api/cart/:sessionId/items` with a draft book id -> **404**, envelope pinned.
  - a published book is still added and still returned — existing wire-shape assertion
    unmodified.
- `orders.test.ts`:
  - **Regression (must fail against `master`):** cart with one published book and one
    soft-deleted book -> `order.items` has exactly one entry and `order.total` equals the
    published book's price alone.
  - the same with a **draft** book instead of soft-deleted.
  - a cart whose every item is unavailable -> **400 `Cart is empty`**, envelope pinned.
  - `GET /api/cart` total and the resulting `order.total` are equal in every case above — the
    property that was broken.
  - the existing `items[0]` wire-shape assertion (`book_id`, `title`, `quantity`, `price`)
    stays unmodified and green.
- Wire-shape assertion required: **yes for the 404/400 envelopes; no new success shape.**

**Manual verify:** none mechanically required, but **flag in the hand-back that this changes
checkout behaviour** — a cart total can now legitimately shrink between page loads. The change
is strictly in the buyer's favour; say so rather than letting a reviewer discover it.

**Done when:** listed tests pass, `cd server && npm test` green, the regression test
demonstrably fails when the `orders.ts` filter is reverted, no new TS errors.

---

### Task 4 — Client: `PublishStateBar`

**Status:** Done (2026-08-23)

**Zone:** client
**Depends on:** none (pure component; can start alongside the server tasks)
**Parallel-safe with:** Tasks 1–3, 9

The whole author-facing surface, as one self-contained component, so `BookDetail`'s diff stays
small.

**Files to add or change:**
- `client/src/components/PublishStateBar.tsx` — **new.**
- `client/src/components/__tests__/PublishStateBar.test.tsx` — **new.**

**Signatures / shapes:**

```ts
interface PublishStateBarProps {
  isOwner: boolean;
  isDraft: boolean;
  title: string;
  pageCount: number;
  unillustratedCount: number;
  /** PUT /api/books/:id/unpublish. Resolves when the book is a draft. */
  onWithdraw: () => Promise<void>;
  /** PUT /api/books/:id/publish. */
  onPublish: () => Promise<void>;
  busy?: boolean;
  error?: string;
}
```

Behaviour:

- `!isOwner` -> renders `null`. Nothing about publish state is shown to a reader.
- `isOwner && !isDraft` -> a **"Edit this book"** control. Clicking it does **not** call
  `onWithdraw`; it expands an inline confirm **in place** (local `useState`, no portal, no
  modal — ADR-004 decision 2 precedent) containing:
  > Editing takes **{title}** out of the catalog while you work. Readers won't be able to find
  > or buy it until you publish again. Anyone who already bought it keeps their receipt.

  with **"Take it out and edit"** (calls `onWithdraw` once) and **"Cancel"** (collapses, no
  call).
- `isOwner && isDraft` -> a banner: **"Out of the catalog while you edit"**, a one-line summary
  (`{pageCount} pages · {unillustratedCount} without an illustration`, and omit the second
  clause when it is 0), and a **"Publish changes"** control.
  - `unillustratedCount > 0` -> the first click expands a second inline confirm:
    *"{unillustratedCount} of {pageCount} pages have no illustration yet. Publish anyway?"* with
    **"Publish anyway"** / **"Cancel"**. **Client-side only — the server does not block this.**
  - `unillustratedCount === 0` -> the click calls `onPublish` directly, no confirm.
- `busy` disables every control; `error` renders in a `dark:`-paired error style.
- Exactly one confirm can be open at a time.

Constraints:
- **No `window.confirm`.** It cannot honour dark mode and its buttons are not tap-target
  assertable.
- **Dark-mode parity on every state** — collapsed, expanded, hover, focus-visible, disabled,
  error.
- Every control is a real `<button>` with an accessible name, reachable by
  `getByRole('button', { name: ... })`. No icon-only buttons without `aria-label`
  (`docs/conventions/client.md` §Accessibility).
- Tap targets sized for `PRIMARY_TAP_MIN = 44` (Task 8 asserts it).

**Tests to write:**
- `client/src/components/__tests__/PublishStateBar.test.tsx`:
  - `isOwner: false` -> renders nothing, in both `isDraft` states.
  - published + owner -> "Edit this book" present; the confirm copy is **not** in the document
    until clicked.
  - clicking "Edit this book" reveals the confirm and calls `onWithdraw` **zero** times.
  - "Cancel" collapses it and still calls `onWithdraw` zero times.
  - "Take it out and edit" calls `onWithdraw` **exactly once**.
  - draft + owner -> banner + "Publish changes"; the summary line omits the illustration clause
    when `unillustratedCount === 0`.
  - draft, `unillustratedCount > 0` -> first click shows the confirm and calls `onPublish` zero
    times; "Publish anyway" calls it once.
  - draft, `unillustratedCount === 0` -> click calls `onPublish` once with no confirm.
  - `busy` disables every rendered control; `error` renders.
- Wire-shape assertion required: **no** — no route is touched by this task.

**Manual verify:** correctness is discharged by Task 8 (`forEachTheme` x two viewports).
**Aesthetics are not claimed** — whether the banner reads as a state rather than an error is a
human call, named in the spec's §Autonomy ledger.

**Done when:** listed tests pass, `dark-mode-parity-check` clean on the diff,
`cd client && npm test` green, `npx tsc --noEmit` clean.

---

### Task 5 — Client: wire `BookDetail`, and close the two ungated reader-view controls

**Status:** Done (2026-08-23)

**Zone:** client
**Depends on:** Tasks 1, 4 (needs the 403 to exist and the component to mount)
**Parallel-safe with:** Task 6

Mount the bar, add the two fetch handlers, and fix the two places where the client would
otherwise render a button that now 403s.

**Files to add or change:**
- `client/src/pages/BookDetail.tsx`
- `client/src/pages/__tests__/BookDetail.test.tsx`

**Signatures / shapes:**

```ts
const [publishBusy, setPublishBusy] = useState(false)
const [publishError, setPublishError] = useState('')

// PUT /api/books/:id/unpublish — same call MyBooks already makes.
const handleWithdraw = async (): Promise<void> => { /* merge the hydrated book into state */ }

// handlePublish (BookDetail.tsx:320) gains busy/error handling. The
// unillustrated confirm lives in PublishStateBar, NOT here.
```

Mount it directly under the hero panel, above the cast panel:

```tsx
<PublishStateBar
  isOwner={!!isOwner}
  isDraft={isDraft}
  title={book.title}
  pageCount={pages.length}
  unillustratedCount={pages.filter(p => !p.illustration_url).length}
  onWithdraw={handleWithdraw}
  onPublish={handlePublish}
  busy={publishBusy}
  error={publishError}
/>
```

**Two required fixes to existing code:**

1. **`BookDetail.tsx:851` and `:941`** — the reader-view illustration controls
   (`Regenerate` / `History` at `:851`, `Generate illustration` at `:941`) are gated on
   `isOwner` alone. After Task 1 their routes 403. Change both to `isOwner && isDraft`, matching
   how `BookSpread` already gates the equivalent controls (`isOwner && isDraft` at
   `BookSpread.tsx:394`, `:421`, `:691`, `:783`, `:818`, `:833`).
2. **403 means my view is stale.** Any edit-route fetch returning **403** should refetch the
   book and re-render rather than surfacing a raw error string — the likely cause is a second
   tab that already withdrew or republished. Keep this to one small helper; do not build a
   general retry layer.

**Do not:** remove the existing hero "Publish" button for drafts — it may stay or move into
`PublishStateBar`, but do not leave two competing publish affordances. Prefer removing it from
the hero, since `PublishStateBar` now owns publish state.
**Do not** touch `BookSpread`, `NarrationPlayer`, or the `?theater=1` contract.

**Tests to write:**
- `BookDetail.test.tsx`:
  - owner + published renders `PublishStateBar`'s "Edit this book"; owner + draft renders
    "Publish changes"; non-owner renders neither.
  - `handleWithdraw` calls `PUT /api/books/:id/unpublish` with the bearer token, and the
    component re-renders in draft state from the response.
  - **Regression (success criterion 8):** owner + **published** in **reader view** renders no
    `Regenerate`, no `History`, and no `Generate illustration` control. Owner + draft still
    does.
  - a 403 from an edit route triggers a book refetch.
  - existing `BookDetail` tests, including the ADR-004 theater prop-capture test, pass
    unmodified.
- Wire-shape assertion required: **no** new route; existing shapes unchanged.

**Manual verify:** discharged by Tasks 7 and 8.

**Done when:** listed tests pass, `dark-mode-parity-check` clean, `cd client && npm test` green,
`npx tsc --noEmit`, `npm run lint`, `npm run build` clean.

---

### Task 6 — Client: align `MyBooks` vocabulary

**Status:** Done (2026-08-23)

**Zone:** client
**Depends on:** Task 4 (adopt the same wording)
**Parallel-safe with:** Task 5

`MyBooks.tsx` has the only existing affordance and it is labelled "Unpublish" — withdrawal, not
editing. Same route, same handler, same confirm semantics; new words.

**Files to add or change:**
- `client/src/pages/MyBooks.tsx`
- `client/src/pages/__tests__/MyBooks.test.tsx`

**Changes:**
- The `book.status === 'published'` control (`MyBooks.tsx:193-201`) becomes **"Edit"** (or
  **"Take out to edit"** if space allows), keeping `aria-label="Take book out of the catalog to edit"`.
  It still calls `PUT /api/books/:id/unpublish` via the existing handler.
- The `window.confirm` copy (`MyBooks.tsx:42`) is updated to match `PublishStateBar`'s wording,
  including the "anyone who already bought it keeps their receipt" clause.
- The `unpublishingId` busy label (`:201`) reads "Taking out..." rather than "Unpublishing...".
- The failure alert (`:55`) is reworded consistently.
- The draft badge (`:170`) and the tab labels (`:141`) stay as `Draft` / `Drafts` — they name
  the status, not the action, and the status vocabulary is unchanged.

**`window.confirm` may stay here.** It is pre-existing, the destination page now carries the
richer inline explanation, and replacing it would pull `PublishStateBar` into a list context it
was not designed for. Named as a deliberate inconsistency, not an oversight.

**Tests to write:**
- `MyBooks.test.tsx`: the published-book control is found by its new accessible name and still
  calls `PUT /api/books/:id/unpublish`; the draft-book Publish control is unchanged.
- Existing `MyBooks` tests pass with only the label expectations updated.
- Wire-shape assertion required: **no.**

**Manual verify:** **copy review by a human.** All the strings are in this file and Task 4's
component for exactly that reason. Non-blocking for the task; flag it in the hand-back.

**Done when:** listed tests pass, `dark-mode-parity-check` clean, `cd client && npm test` green,
`npx tsc --noEmit` clean.

---

### Task 7 — E2E: the desktop loop and the immutability fence

**Status:** Done (2026-08-23)

**Zone:** e2e
**Depends on:** Tasks 1, 3, 4, 5, 6
**Parallel-safe with:** Task 9

**Files to add or change:**
- `e2e/tests/edit-published.spec.ts` — **new.**

**Shape:** follow `e2e/tests/version-history.spec.ts` exactly — register a throwaway user
against the **real** server (allowlist it first via
`POST /api/_test/allow-email` with `x-test-secret`), seed the token into `localStorage`, and
**route-mock the `/api/books/*` responses** so no Claude or image call ever fires. Track created
emails and clean up in `afterAll`.

**Specs:**
1. **The loop.** Start on `/book/:id` with a published, owner-owned book. Assert the draft-only
   surfaces (revise panel, version history, cast portraits) are **absent**. Click "Edit this
   book" -> the confirm copy appears -> click "Take it out and edit" -> `PUT .../unpublish` is
   hit once -> the out-of-catalog banner appears and the draft-only surfaces mount. Click
   "Publish changes" -> `PUT .../publish` is hit once -> the banner is replaced by the "Edit
   this book" control.
2. **Confirm is required.** Clicking "Edit this book" and then "Cancel" issues **zero**
   `unpublish` requests.
3. **The unillustrated confirm.** With a draft whose pages lack `illustration_url`, "Publish
   changes" shows the second confirm and issues **zero** `publish` requests until "Publish
   anyway" is clicked.
4. **The immutability fence.** With a published owned book, in **both** `viewMode` values
   (spread and reader), no `Regenerate`, `History`, `Generate illustration`, `Illustrate All`,
   or revise control is visible.
5. **Non-owner.** A published book viewed by a different signed-in user shows no publish-state
   control at all.

**Tests to write:** the five above. Role-based selectors only
(`docs/conventions/testing.md` §"Selector strategy"). Wait on visible content, not response
timing.

**Manual verify:** none.

**Done when:** `cd e2e && npm test` green, and the fence specs listed in §Cross-cutting
constraints pass **unmodified**.

---

### Task 8 — E2E: mobile x both themes

**Status:** Done (2026-08-23)

**Zone:** e2e
**Depends on:** Task 7
**Parallel-safe with:** Task 9

**Files to add or change:**
- `e2e/tests/mobile/edit-published.spec.ts` — **new.**

**Shape:** same real-auth + route-mock setup as Task 7, wrapped in `forEachTheme` from
`e2e/tests/mobile/_helpers.ts`. Runs under the `mobile-pixel` (393x851) and `mobile-small`
(360x740) projects via the existing `testMatch`.

**Assertions, inside `forEachTheme`, in both the published and the draft state, and with each
confirm panel both collapsed and expanded:**
- `expectNoHorizontalOverflow(page)` — the expanded confirm is the likely offender at 360 px.
- `expectTapTargets(page, '<explicit selector list>', PRIMARY_TAP_MIN)` — an **explicit list**
  of the new controls, never "all buttons" (ADR-009).
- The out-of-catalog banner and both confirm panels are visible and legible in both themes.
- The controls are **not** `position: fixed` — `UpdateToast` remains the app's only
  bottom-fixed surface (the ADR-011 invariant).

**Manual verify:** **this task claims the correctness half of CLAUDE.md done-criterion #2 only**
(ADR-009). The **aesthetic** half is explicitly not claimed: whether the withdrawal copy reads
as reassuring rather than alarming, and whether the banner feels like a state rather than an
error, needs one human look. Recommend before merge; do not block the task.

**Done when:** both mobile projects pass in both themes, `cd e2e && npm test` green.

---

### Task 9 — Docs: roadmap, conventions

**Status:** Done (2026-08-23)

**Zone:** docs
**Depends on:** none
**Parallel-safe with:** everything

**Files to add or change:**
- `.code-captain/product/roadmap.md` — note that "edit published books" shipped as
  withdraw-to-edit, link this spec, and state that "Direct text editing per page" and "Story
  remix" remain unbuilt and are **not** covered by it. Follow the format the read-aloud entry
  uses (shipped line + an indented deferred sub-bullet).
- `docs/conventions/server.md` — a short paragraph next to §"Middleware order rule": **published
  books are immutable; content-mutating book routes call `isEditable` after the owner check and
  return 403; the ownership check always comes first.** Add it to the §"When adding a new route"
  checklist so the next book route inherits the fence.
- `docs/conventions/server.md` §"When adding a new route" — one line: a paid route needs both a
  `spendGate` mount and a `recordUsage` call; gating without recording defeats the global
  ceiling. (This is what Task 2 found missing.)

**Do not** edit `CLAUDE.md` — surface any proposed change to it in the hand-back for the user to
make.

**Tests to write:** none.

**Done when:** the roadmap no longer implies this is unbuilt, and the conventions note exists.

---

### Task 10 — Pre-merge follow-ups

**Status:** Done (2026-08-23)

**Zone:** docs (harness) · **Depends on:** none (run last)

The spec's §"ADR-worthy decisions" list is non-empty, so this task is required (ADR-005).

For each ADR-worthy item, ensure exactly one tracking action exists — a matching ADR entry, a
linked issue, or an explicit `Deferred:` line with reasoning.

Specifically:

1. **Write ADR-012** via `/create-adr`, appended to `.code-captain/product/decisions.md`. It
   should follow the grouped-decision precedent of ADR-004 / ADR-011: one entry, the coupled
   sub-decisions numbered, each naming its trade-off. It **must** record, in the author's own
   words: the three-fork comparison and why fork 3 won; the eight-plus read paths that make
   fork 1 expensive today; the five triggers that would reopen it; and — stated plainly, not
   buried — that **a prior buyer gets a 404 on `/book/:id` while the author edits**.
2. **File a separate issue** for the character-portrait spend hole if Task 2 shipped as its own
   PR, so the fix and the finding are both traceable.
3. **File issues or add `Deferred:` lines** for: purchaser entitlement to draft content; a
   purchased-book library; a checkout-time PDF-download prompt; `Book.published_at`; surfacing
   withdrawn cart items with an explanation; direct per-page text editing; editing
   price/title/cover metadata.
4. **Close out the six Open questions** — each has a stated default; record which defaults were
   ruled on and which shipped by default.

**Done when:** `adr-tracking-check edit-published-books` reports zero orphaned items.

## Sequencing notes

**Parallel cuts.** Tasks 1 and 3 touch disjoint route files and can run concurrently; whoever
runs first creates `server/src/lib/availability.ts` and the other appends. Task 4 is a
standalone component with no dependency on the server work and can start immediately. Task 9 is
independent of everything.

**Commit / PR boundaries.** Three natural PRs:

1. **Task 2 alone** — the spend fix. Landing it first, on its own, is the default (Open
   question 6): it is a spend-exposure fix that should not wait on a feature review.
2. **Tasks 1 + 3 + 9** — the server model and the money-path filter. Mergeable on its own: the
   routes tighten, and the only user-visible effect is that a published book stops being
   editable through the two reader-view buttons Task 5 then removes. **If these ship separately
   from Task 5, expect a short window where those two buttons render and 403** — either ship
   1+3 with 5, or accept and note it.
3. **Tasks 4–8** — the author-facing surface and its proof.

If it ships as one PR, that is fine too; the ordering above still holds within it.

**The riskiest ordering constraint** is Task 1 before Task 5. Reversing it leaves the client
hiding controls whose routes still accept the request — harmless but untestable. Task 1 before
Task 5 means the buttons exist and 403 for one commit, which is visible but recoverable.

**PR body must record** (CLAUDE.md §"How work flows"): the spec/tasks links, that the architect
and developer roles were used, the chosen model and its accepted cost (**the book is off-sale
during an edit; a prior buyer sees a 404**), the money-path behaviour change from Task 3, and
which half of done-criterion #2 is being claimed.

## Open questions

Blocking-before-start: **none.** Every open question in the spec has a stated default that a
task implements, so `/execute-task` can proceed without a ruling. Two are worth raising in the
hand-back because a ruling changes the shape of the work rather than a line of it:

- **Open question 6 — should Task 2 be its own PR?** Default: yes, landed first. This changes
  the commit plan, not the code.
- **Open question 3 — should withdrawn cart items be shown with an explanation?** Default: no.
  A "yes" would add a field to `CartItemSchema` and therefore an OPS.3 wire-shape change and a
  new cart row state, which is a materially larger Task 3.

The remaining four (Open questions 1, 2, 4, 5) are single-line decisions inside tasks that
already have a default; they do not gate the start.
