# Commerce off for the tester build — task plan

> Spec: [spec.md](spec.md)
> Status: Approved (owner, 2026-11-10 — all four recommended defaults accepted)
> Last updated: 2026-11-10

## Overview

Seven tasks, about half a day. Task 1 adds the flag. Tasks 2, 3 and 4 apply it to three disjoint sets of client files and can run in parallel. Task 5 adds a flag-off Playwright project, Task 6 turns the flag off for the Pages deploy and documents it, Task 7 closes the ADR items. Everything is client, e2e, CI config or docs — no server zone, so there is no `test.db` contention.

## Cross-cutting constraints

- **Wire-shape:** none. No route, Zod schema or Prisma change. If you find yourself touching `shared/` or `server/`, stop and surface it.
- **Auth middleware order:** not applicable.
- **Session (guardrail):** do not touch `getSessionId()`, the `storybook-session` key, or the `CartProvider` mount in `main.tsx`. `FeedbackDialog` depends on `useCart().sessionId` with commerce off.
- **Flag access:** only through `commerceEnabled()` from `client/src/lib/commerce.ts`. Never read `import.meta.env.VITE_COMMERCE_ENABLED` anywhere else. Call it inside the component body, not at module scope.
- **Default on:** with the flag unset every existing test must pass with no existing assertion edited or removed. Flag-off coverage is additive `describe` blocks using `vi.stubEnv('VITE_COMMERCE_ENABLED', 'false')` and `afterEach(() => vi.unstubAllEnvs())`.
- **Dark-mode parity:** the only new markup is the card "Read" link (Task 2). Reuse the replaced button's class strings; add no unpaired colour class.
- **Baseline:** `BookCard.tsx`, `BookDetail.tsx`, `Home.tsx`, `MyBooks.tsx` and `Home.test.tsx` carry tester-readiness changes. Build on them as they are; do not revert or restyle that work.
- **Migrations:** none.
- **Guardrails touched:** none need confirmation as designed. Deleting a test, changing session issuance, or adding a dependency would — stop and surface instead.

## Tasks

### Task 1 — Commerce flag module

**Zone:** client
**Depends on:** none
**Parallel-safe with:** none (2–5 depend on it)

**Status:** Done (2026-11-10)

**Files to add or change (4):**
- `client/src/lib/commerce.ts` (new) — parser and reader
- `client/src/vite-env.d.ts` — add `readonly VITE_COMMERCE_ENABLED?: string` to `ImportMetaEnv`, with a one-line comment
- `client/.env.example` — document the variable (leave unset for local dev; `false` hides prices and the cart)
- `client/src/lib/__tests__/commerce.test.ts` (new)

**Signatures / shapes:**
```ts
/** Off only for an explicit off value; unset, empty or unrecognised means on. */
export function parseCommerceFlag(raw: string | undefined): boolean
// off values, after trim().toLowerCase(): 'false' | '0' | 'off' | 'no'

/** Read at call time so Vitest can stub the env; statically replaced in a Vite build. */
export function commerceEnabled(): boolean
// => parseCommerceFlag(import.meta.env.VITE_COMMERCE_ENABLED)
```

**Tests to write:**
- `client/src/lib/__tests__/commerce.test.ts` — `parseCommerceFlag`: `undefined` → true; `''` → true; `'true'` → true; `'banana'` → true; `'false'`, `'0'`, `'off'`, `'no'` → false; `' FALSE '` → false. `commerceEnabled()`: true by default; false after `vi.stubEnv('VITE_COMMERCE_ENABLED', 'false')`; true again after `vi.unstubAllEnvs()`.
- Wire-shape assertion required: no

**Done when:** the new test passes, `cd client && npm test` green, `npx tsc --noEmit` clean.

---

### Task 2 — Catalog surfaces: book card and quick-preview modal

**Zone:** client
**Depends on:** Task 1
**Parallel-safe with:** 3, 4

**Status:** Done (2026-11-10)
**Files to add or change (4):**
- `client/src/components/BookCard.tsx` — when off: omit the price `<span>`; replace the "Add to Cart" `<button>` with a `<Link>`
- `client/src/pages/Home.tsx` — `BookPreviewModal` footer: when off omit the price `<span>` and use `justify-end` instead of `justify-between`
- `client/src/components/__tests__/BookCard.test.tsx` — add a `commerce off` block
- `client/src/pages/__tests__/Home.test.tsx` — add a `commerce off` block

**Signatures / shapes:**
```tsx
// BookCard, off branch — same slot, same variant-dependent classes as the button it replaces
<Link
  to={`/book/${book.id}`}
  aria-label={`Read ${book.title}`}
  className={`no-underline text-center min-h-11 inline-flex items-center justify-center py-3 rounded-xl font-semibold text-sm transition-[background-color,color,transform] duration-150 active:scale-[0.98] ${
    wide ? /* the button's wide classes, verbatim */ : /* the button's default classes, verbatim */
  }`}
>
  Read
</Link>
```
The chips row keeps its wrapper and `mb-3`; only the price span is conditional. `useCart()` may still be called unconditionally (hook order); just do not render the button.

**Tests to write:**
- `BookCard.test.tsx` (off): no text matching `/\$\d/`; no button named "Add to Cart"; a link named "Read The Brave Little Fox" with `href="/book/book-1"`; `mockAddToCart` never called. Repeat the link assertion for `variant="wide"`.
- `Home.test.tsx` (off): open the quick preview for a book; the dialog shows "View Full Book" and no `/\$\d/` text.
- Existing flag-on tests in both files pass unedited.
- Wire-shape assertion required: no

**Manual verify:**
- `VITE_COMMERCE_ENABLED=false npm run dev:client`; Home in light and dark, default and wide (Featured lead) cards: no gap where the price was, "Read" sits on the same baseline across a row. Open a quick preview in both themes.

**Done when:** listed tests pass, `cd client && npm test` green, no new TS or lint errors.

---

### Task 3 — Book page and author copy

**Zone:** client
**Depends on:** Task 1
**Parallel-safe with:** 2, 4

**Status:** Done (2026-11-10)
**Files to add or change (6):**
- `client/src/pages/BookDetail.tsx` — the `{!isDraft && (<>…price…Add to Cart…</>)}` block (~line 820) becomes `{!isDraft && commerceEnabled() && (…)}`. Nothing replaces it. Do not touch the "Illustrate All (~$…)" cost labels.
- `client/src/components/PublishStateBar.tsx` — two strings, off variants below
- `client/src/pages/MyBooks.tsx` — the `window.confirm` string in `unpublishBook`, off variant below
- `client/src/pages/__tests__/BookDetail.test.tsx` — add a `commerce off` block
- `client/src/components/__tests__/PublishStateBar.test.tsx` — add a `commerce off` block
- `client/src/pages/__tests__/MyBooks.test.tsx` — add a `commerce off` block

**Signatures / shapes (copy):**

| Where | On (unchanged) | Off |
|---|---|---|
| PublishStateBar, "In the catalog" | Readers can find and buy this book. Editing it means taking it out first. | Readers can find and read this book. Editing it means taking it out first. |
| PublishStateBar, withdraw confirm | …Readers won't be able to find or buy it until you publish again. Anyone who already bought it keeps their receipt. | …Readers won't be able to find it until you publish again. |
| MyBooks `window.confirm` | same sentence pair as above | same off wording as above |

**Tests to write:**
- `BookDetail.test.tsx` (off): a published book renders no "Add to Cart" button and no `$24.99`-style price; "Download PDF" still renders for a signed-in user; an owner's draft still shows the "Illustrate All (~$…)" label.
- `PublishStateBar.test.tsx` (off): bar text contains "find and read this book" and not "buy"; opened confirm does not contain "receipt".
- `MyBooks.test.tsx` (off): the confirm message does not match `/buy|bought|receipt/i` and matches `/find it until you publish again/i`.
- Existing flag-on tests in all three files pass unedited.
- Wire-shape assertion required: no

**Manual verify:**
- Flag off, light and dark: a published book signed in (only "Download PDF" in the action row) and signed out (no stray gap under the chips).

**Done when:** listed tests pass, `cd client && npm test` green, no new TS or lint errors.

---

### Task 4 — App shell: navbar, routes, cart provider

**Zone:** client
**Depends on:** Task 1
**Parallel-safe with:** 2, 3

**Status:** Done (2026-11-10)
**Files to add or change (6):**
- `client/src/components/Navbar.tsx` — render the Cart `<Link>` (and badge) only when `commerceEnabled()`
- `client/src/App.tsx` — register `/cart`, `/checkout`, `/order/:id` only when `commerceEnabled()`, so they fall through to `path="*"` → `NotFound`
- `client/src/context/CartContext.tsx` — the mount effect returns early when `!commerceEnabled()`; nothing else in the file changes
- `client/src/components/__tests__/Navbar.test.tsx` — add a `commerce off` block
- `client/src/context/__tests__/CartContext.test.tsx` — add a `commerce off` block
- `client/src/__tests__/AppRoutes.test.tsx` (new)

**Signatures / shapes:**
```tsx
// App.tsx
{commerceEnabled() && (
  <>
    <Route path="/cart" element={<Cart />} />
    <Route path="/checkout" element={<Checkout />} />
    <Route path="/order/:id" element={<OrderConfirmation />} />
  </>
)}

// CartContext.tsx
useEffect(() => {
  if (!commerceEnabled()) return
  void fetchCart()
}, [fetchCart])
```

**Tests to write:**
- `Navbar.test.tsx` (off): no link named "Cart"; "Create a Book", "Browse" and "Toggle dark mode" still present.
- `CartContext.test.tsx` (off): mounting `CartProvider` does not call `fetch`; `localStorage.getItem('storybook-session')` is a non-empty string; `useCart().sessionId` equals it.
- `AppRoutes.test.tsx`: render `<App />` in a `MemoryRouter` with `Navbar` and the page modules (`Cart`, `Checkout`, `OrderConfirmation`, `Home`) mocked to one-line stubs. Off: `/cart`, `/checkout`, `/order/abc` each show the heading "This page wandered off". On: `/cart` shows the Cart stub.
- Existing flag-on tests pass unedited.
- Wire-shape assertion required: no

**Manual verify:**
- Flag off, 360px wide, both themes: navbar row has no gap or overflow; visiting `/cart` shows the NotFound page; the Network panel shows no `/api/cart/` request on load; sending feedback still works.

**Done when:** listed tests pass, `cd client && npm test` green, no new TS or lint errors.

---

### Task 5 — Flag-off Playwright project and spec

**Zone:** e2e
**Depends on:** Tasks 2, 3, 4
**Parallel-safe with:** 6

**Files to add or change (3):**
- `e2e/ports.ts` — add `COMMERCE_OFF_PORT` (default `'4174'`) and `COMMERCE_OFF_BASE`, same pattern as `PREVIEW_PORT`
- `e2e/playwright.config.ts` — (a) add `VITE_COMMERCE_ENABLED: 'true'` to the `env` of the two existing client `webServer` entries; (b) add a fourth `webServer`; (c) add a `commerce-off` project; (d) widen the `chromium` project's `testIgnore` to `/tests\/(mobile|pwa|commerce-off)\//`
- `e2e/tests/commerce-off/tester-build.spec.ts` (new)

**Signatures / shapes:**
```ts
// webServer — production build with the flag off, own outDir so it cannot race the pwa build
{
  command:
    `npx vite build --outDir node_modules/.cache/commerce-off-dist && ` +
    `npx vite preview --outDir node_modules/.cache/commerce-off-dist --port ${COMMERCE_OFF_PORT} --strictPort`,
  cwd: '../client',
  env: { API_PORT, CLIENT_PORT, PREVIEW_PORT, VITE_COMMERCE_ENABLED: 'false' },
  url: `${COMMERCE_OFF_BASE}/`,
  reuseExistingServer: !process.env.CI,
  timeout: 180_000,
},

// project — mobile viewport, matching mobile-pixel
{
  name: 'commerce-off',
  use: {
    browserName: 'chromium',
    baseURL: `${COMMERCE_OFF_BASE}/`,
    viewport: { width: 393, height: 851 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  testMatch: /tests\/commerce-off\/.*\.spec\.ts$/,
},
```
The `outDir` sits under `node_modules/` so git, eslint and `tsc` already ignore it. If that path, the `--outDir` flag on `preview`, or the second concurrent build misbehaves, stop and report — the fallback (spec → Alternatives → second Vite dev server) changes `client/vite.config.ts` and is a design call.

**Tests to write** (`tester-build.spec.ts`, read-only against seeded books, helpers imported from `../mobile/_helpers`; header comment states it claims the **correctness** half of Done criterion #2):
- Home, inside `forEachTheme`: wait for the first `link` named `/^Read /`; zero buttons named "Add to Cart"; `main` has no text matching `/\$\d+\.\d{2}/`; no link named "Cart" in the navbar; `expectNoHorizontalOverflow(page)`; `expectTapTargets` on the card "Read" links at `PRIMARY_TAP_MIN`.
- Home → tap the first "Read …" link → URL matches `/book/`; inside `forEachTheme`: no "Add to Cart" button, no `/\$\d+\.\d{2}/` in `main`, `expectNoHorizontalOverflow(page)`.
- `/cart`, `/checkout`, `/order/does-not-exist` each show the heading "This page wandered off".
- Loading Home issues no request whose URL contains `/api/cart/` (collect via `page.on('request')` before `goto`), and `localStorage['storybook-session']` is set.
- Wire-shape assertion required: no

**Done when:** `cd e2e && npm test` green across all five projects with no existing spec edited; note the added wall-clock for the extra build in the hand-back.

---

### Task 6 — Turn the flag off for the Pages deploy; document it

**Zone:** multi-zone (CI config + docs)
**Depends on:** Tasks 2, 3, 4
**Parallel-safe with:** 5

**Status:** Done (2026-11-10) — the PR-body line is owed at ship time

**Files to add or change (3):**
- `.github/workflows/deploy-pages.yml` — in the "Build client" `env`, add `VITE_COMMERCE_ENABLED: 'false'` with a comment: tester phase, hides prices and the cart; delete the line (or set `'true'`) to bring commerce back; a literal rather than a repo variable so the flip is a reviewed PR that triggers its own deploy
- `docs/conventions/client.md` — short "Commerce flag" section: the variable, `commerceEnabled()` as the only reader, default on, the surfaces it gates, the `vi.stubEnv` test pattern, and that `CartProvider`/session stay mounted
- `docs/conventions/testing.md` — E2E section: the `commerce-off` project, its port and build, and the note that a client dev server started by hand with the flag off will fail the default projects

Do not edit `CLAUDE.md`; mention in the hand-back that the owner may want a one-line pointer there.

**Tests to write:** none (config and docs).
- Wire-shape assertion required: no

**Done when:** `grep -n VITE_COMMERCE_ENABLED .github/workflows/deploy-pages.yml` shows the literal `'false'`; root `npm test` (harness) green; the PR body states that merging redeploys Pages with commerce hidden.

---

### Task 7 — Pre-merge follow-ups

**Zone:** docs (harness) · **Depends on:** none (run last)

For each ADR-worthy item in spec.md, ensure exactly one tracking action exists:

1. **Build-time commerce flag** — write ADR-036 via `/create-adr` in `.code-captain/product/decisions.md` (Scope: `tester-commerce-off`), bundling the flag semantics, the literal-in-workflow choice, NotFound fall-through and the `commerce-off` e2e project.
2. **Cart and order API routes stay open** — file the follow-up issue "Server-side commerce kill switch for `/api/cart` and `/api/orders`" and add its `#NN` next to the spec item (the `Deferred:` line already there is sufficient if issue creation is unavailable).

**Done when:** `adr-tracking-check tester-commerce-off` reports zero orphaned items.

## Sequencing notes

- 1 → (2 ‖ 3 ‖ 4) → (5 ‖ 6) → 7. Tasks 2–4 share no files. One PR for the whole chain.
- **Merging is the release.** The PR touches `client/**` and `deploy-pages.yml`, so the push to `master` redeploys Pages with commerce hidden. There is no separate switch-on step.
- Task 5 is the cut line if scope must shrink: without it, Tasks 2–4 fall back to the manual light/dark browser pass listed under each.

## Open questions

- **Baseline branch — Deferred: owner action, not a design decision.** Five of the files this plan edits have uncommitted changes on `fix/tester-readiness-client`. An agent worktree branches from a commit, so that work has to be committed (or merged) first, and this chain should branch from wherever it lands. Recommended default: land the tester-readiness PR, then branch `agent/feat/tester-commerce-off` from `master`.
- **AI generation cost labels ("Illustrate All (~$0.08)", "Regenerate ($0.04)", create-mode cards) — Deferred: left visible by default.** They are spend-meter figures, not book prices, and they explain the 50¢/day quota a tester will hit. If the owner wants them gone too, that is a separate small change behind the same flag.
- **Keep Task 5 (flag-off e2e project)? — Deferred: recommended default is keep.** It costs one extra client build per e2e run and discharges the correctness half of Done criterion #2 mechanically (ADR-009).
- **NotFound vs redirect-home for `/cart`, `/checkout`, `/order/:id` — Deferred: NotFound by default**, covered by ADR-036 in Task 7. Switching to a redirect is a three-line change in `client/src/App.tsx`.
