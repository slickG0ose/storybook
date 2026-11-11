# Commerce off for the tester build

> Status: Approved (owner, 2026-11-10 — all four recommended defaults accepted)
> Last updated: 2026-11-10
> Backlog: none filed — owner request 2026-11-10 ("checkout, lets hide pricing and cart for testers"). Related: [#90 — Editing book metadata — price, title, author, cover emoji/colour, theme](https://github.com/slickG0ose/storybook/issues/90)

## Problem

The deployed site is about to go to a small group of invited testers whose job is to give feedback on creating and reading books. Checkout is a demo ("Payment integration coming soon"), every generated book is priced at a hardcoded $24.99, and the cart leads nowhere real. Left visible, prices and the cart pull tester attention and feedback onto a surface that is not under test, and invite the question "am I being charged?". The owner has ruled: hide pricing and the cart from testers. The existing cart/checkout code and its test coverage (22 e2e files reference it, many use the "Add to Cart" button as the Home-page readiness sentinel) must keep running unchanged.

## Constraints

- **Client-only.** No Prisma change, no `@storybook/shared` schema change, no new dependency, no server change. `Book.price` stays on the wire; the client just stops rendering it.
- **Session model untouched (CLAUDE.md guardrail).** `CartProvider` keeps issuing the `storybook-session` UUID exactly as today. `components/FeedbackDialog.tsx:29` reads `useCart().sessionId` for every feedback report, so the provider and the session id must survive with commerce off.
- **Default is ON.** Unset flag = today's behaviour, so local dev, the client unit suite and all existing Playwright projects are untouched.
- **Uncommitted work on `fix/tester-readiness-client`** (BookCard, BookDetail, Home, MyBooks, Home.test, index.html) is the baseline. This spec builds on those files as they are on disk; that work must be committed or merged before the task chain starts (see tasks.md → Open questions).
- Dark-mode parity and the 44px primary tap-target floor apply to the one new control (the card "Read" link).
- No test is deleted or weakened; flag-off coverage is additive.

## Proposed shape

**Mechanism: a Vite build-time flag, `VITE_COMMERCE_ENABLED`.** It is read through one function in a new `client/src/lib/commerce.ts`. Commerce is off only when the value is one of `false`, `0`, `off`, `no` (trimmed, case-insensitive); unset, empty or anything else means on. `deploy-pages.yml` sets the literal `'false'` for the GitHub Pages build. This matches how the client is already configured (`VITE_API_BASE_URL`, `VITE_BASE_PATH`, `VITE_PUBLIC_ORIGIN`, `VITE_APP_COMMIT`), needs no server round-trip, and has no first-paint flash because the value is compiled into the bundle.

The flag is a **function read at call time** (`commerceEnabled()`), not a module-level constant. In a Vite build `import.meta.env.VITE_COMMERCE_ENABLED` is statically replaced either way, so this costs nothing in production; in Vitest it lets an existing test file add a `describe('commerce off')` block with `vi.stubEnv` instead of restructuring its hoisted `vi.mock` factories.

The value in `deploy-pages.yml` is a **hardcoded literal, not a repo variable**. Turning commerce back on is then a one-line PR that is visible in history and triggers its own deploy (the workflow file is in its own `paths` filter). A repo variable would flip without a trace, would need a manual `workflow_dispatch`, and — because unset means ON — deleting it would silently re-expose the cart to testers.

**Per-surface behaviour when off:**

| Surface | File | Off behaviour | What fills the space |
|---|---|---|---|
| Book card | `components/BookCard.tsx` | Price `<span>` not rendered. "Add to Cart" `<button>` not rendered. `addToCart` not called. | The chips row stays (chips left-aligned, nothing on the right). The button slot becomes a `<Link to="/book/:id">` with visible text **Read**, `aria-label="Read <title>"`, carrying the same classes as the button it replaces (both `default` and `wide` variants) plus `no-underline text-center min-h-11 inline-flex items-center justify-center`. Card height and the `mt-auto` CTA baseline are unchanged. |
| Quick-preview modal | `pages/Home.tsx` (`BookPreviewModal`) | Price `<span>` not rendered. | Footer row switches `justify-between` → `justify-end`; "View Full Book" stays where it is. |
| Book page, published | `pages/BookDetail.tsx` (~line 820) | Price `<span>` and "Add to Cart" button not rendered. | Nothing. The row is `flex flex-wrap gap-3` with no margin of its own; it keeps "Download PDF" for signed-in users and collapses to zero height otherwise. The reader sits directly below, so no replacement CTA is needed. |
| Navbar | `components/Navbar.tsx` | Cart link and count badge not rendered. | Nothing; the row is `gap`-spaced flex and closes up. The densest state drops from nine controls to eight. |
| Routes | `App.tsx` | `/cart`, `/checkout`, `/order/:id` are not registered. | They fall through to the existing `*` route → `pages/NotFound.tsx` ("This page wandered off", with "Browse the collection" and "Go back"). No new markup. |
| Cart provider | `context/CartContext.tsx` | The mount-time `fetchCart()` effect is skipped. Session id issuance, snapshot hydration and all mutation functions are unchanged. | — |
| Author copy | `components/PublishStateBar.tsx`, `pages/MyBooks.tsx` | "find and buy" → "find and read"; "find or buy it" → "find it"; the "Anyone who already bought it keeps their receipt." sentence is dropped. | — |

**Deliberately unchanged when off:**

- **AI generation cost labels** — "Illustrate All (~$0.08)", "Regenerate ($0.04)", the create-wizard mode cards (`lib/cost.ts`, `pages/CreateBook.tsx`, `pages/BookDetail.tsx` ~line 793–806). These are spend-meter figures, not book prices, and they are the only explanation a tester gets for the 50¢/day quota. Flagged as an owner question in tasks.md.
- **Admin page** — its `$` figures are usage/spend in cents, admin-only.
- **Price at create/edit time** — there is nothing to hide. No client UI sets or shows a price during creation; `server/src/routes/generate.ts:225` hardcodes `price: 24.99` and no route mutates it (that is #90, unbuilt). Authors only ever saw their price on the card and the published book page, both covered above.
- `pages/Cart.tsx`, `pages/Checkout.tsx`, `pages/OrderConfirmation.tsx`, `lib/cartCache.ts` — untouched, simply unreachable.
- `client/pwa.config.ts` manifest name "StoryBook Storefront" — product name, not a commerce surface.

**Server: nothing changes, and for the tester phase that is acceptable.** `/api/cart/*` and `/api/orders` are unauthenticated and stay reachable by direct API call, exactly as they are on the public deploy today. Neither router mounts `spendGate` or calls a paid API, no payment provider exists, and an order is only a database row — so hiding the UI changes none of the exposure: no money, no spend, no user data. The worst case is junk `Order` rows, which is already true. A server-side kill switch is listed as a deferred follow-up, not folded in.

### Schema / contract changes

None. No Zod schema, Prisma field or route changes.

New client-only contract:

```ts
// client/src/lib/commerce.ts
export function parseCommerceFlag(raw: string | undefined): boolean
export function commerceEnabled(): boolean   // parseCommerceFlag(import.meta.env.VITE_COMMERCE_ENABLED)
```

```ts
// client/src/vite-env.d.ts — ImportMetaEnv
readonly VITE_COMMERCE_ENABLED?: string
```

### Data flow

Build: `deploy-pages.yml` sets `VITE_COMMERCE_ENABLED: 'false'` → Vite inlines it → `commerceEnabled()` is a constant `false` in the shipped bundle.

Runtime (off): app boots → `CartProvider` issues/reads the session UUID, makes no `/api/cart` request → Navbar renders without the cart → Home lists cards with a "Read" link → book page shows no price → typing `/cart` renders NotFound. Feedback reports still carry `session_id`.

Runtime (on, default): identical to today.

### Files likely touched

- `client/src/lib/commerce.ts` (new) — flag parser and reader
- `client/src/vite-env.d.ts`, `client/.env.example` — typing and documentation of the variable
- `client/src/components/BookCard.tsx` — hide price and Add to Cart; "Read" link
- `client/src/pages/Home.tsx` — hide price in the preview modal
- `client/src/pages/BookDetail.tsx` — hide price and Add to Cart on published books
- `client/src/components/PublishStateBar.tsx`, `client/src/pages/MyBooks.tsx` — purchase-free copy
- `client/src/components/Navbar.tsx` — hide cart link
- `client/src/App.tsx` — conditional commerce routes
- `client/src/context/CartContext.tsx` — skip the mount fetch
- Client tests alongside each of the above (7 existing files extended, 2 new)
- `e2e/playwright.config.ts`, `e2e/ports.ts`, `e2e/tests/commerce-off/tester-build.spec.ts` (new) — flag-off project
- `.github/workflows/deploy-pages.yml` — set the flag off for Pages
- `docs/conventions/client.md`, `docs/conventions/testing.md` — document the flag and the new e2e project

## Alternatives considered

### Runtime config endpoint (`GET /api/config` → `{ commerceEnabled }`)

**Pros:** flips without a client rebuild; one switch could also gate the server routes.
**Cons:** new route means a shared Zod schema and a wire-shape test; every page waits on (or flashes before) the config response; a Render cold start would show commerce first and hide it second; the offline PWA shell needs a cached answer.
**Why rejected:** crosses three zones and a wire-shape guardrail to do what one env line does. Held as the upgrade path if commerce ever needs to differ per user rather than per build.

### Role-based hiding (show commerce to admins only)

**Pros:** the owner keeps the cart on the live site.
**Cons:** depends on `AuthContext` resolving, so anonymous visitors and the pre-auth frame need a third state; commerce markup stays in the tester bundle; every surface gains an auth dependency it does not have today.
**Why rejected:** more moving parts for a benefit the owner already has locally, where the flag defaults on.

### Redirect `/cart`, `/checkout`, `/order/:id` to `/` instead of NotFound

**Pros:** no "wandered off" wording.
**Cons:** a silent redirect explains nothing to the person who typed the URL; needs new route elements and tests.
**Why rejected:** no in-app link reaches these routes once the navbar cart is gone, so only a hand-typed URL lands there, and NotFound already gives a themed, tested page with a way onward. Swapping to `<Navigate to="/" replace />` later is a three-line change in `App.tsx`.

### Flag-off e2e via a second Vite *dev* server instead of a second build

**Pros:** starts in seconds.
**Cons:** two dev servers in one root share the `node_modules/.vite` dependency-optimizer cache and would both cold-optimize at once in CI; needs a `cacheDir` override in `vite.config.ts`. Tests the dev transform, not the statically-replaced artifact testers get.
**Why rejected (held as fallback):** the build + `vite preview` route mirrors the existing `pwa` project and exercises the real bundle. If the second build proves unreliable or too slow in CI, fall back to this.

### No flag-off e2e spec; rely on unit tests plus a manual browser pass

**Pros:** saves about an hour and one CI build.
**Cons:** the layout claims (no overflow, 44px "Read" target, both themes) would rest on a manual check each time the card changes.
**Why rejected:** ADR-009 exists precisely so this half of Done criterion #2 is mechanical. It is the designated cut line if the owner wants a smaller change (tasks.md → Open questions).

## Success criteria

- With `VITE_COMMERCE_ENABLED=false`: no `$`-prefixed book price, no "Add to Cart" control and no "Cart" link render on Home, the preview modal or a published book page; each card exposes a "Read <title>" link to `/book/:id`; `/cart`, `/checkout` and `/order/x` render the NotFound page; no request to `/api/cart/` is made on load; `localStorage['storybook-session']` is still set.
- With the flag unset: `cd client && npm test` and `cd e2e && npm test` pass with no existing assertion edited.
- `parseCommerceFlag` is unit-tested for unset, empty, each off value, mixed case, whitespace and an unrecognised value.
- A Playwright spec in a `commerce-off` project passes at a 393px mobile viewport in both themes with `expectNoHorizontalOverflow` and `expectTapTargets` on the card "Read" links. It claims the **correctness** half of Done criterion #2; the aesthetic half (does the card look right without its price) still needs the owner's eyes.
- `deploy-pages.yml` carries `VITE_COMMERCE_ENABLED: 'false'`.
- `npx tsc --noEmit` and `npm run lint` clean in `client/`.

## Out of scope

- Any server change, including gating `/api/cart` and `/api/orders`.
- Removing or refactoring Cart/Checkout/OrderConfirmation/cartCache code.
- Hiding AI generation cost labels.
- Price editing (#90).
- A per-user or runtime toggle.
- Editing `CLAUDE.md` (the owner may add a pointer to the flag; agents do not edit that file).

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| **Merging is the go-live.** The PR touches `client/**` and `deploy-pages.yml`, so the push to `master` redeploys Pages with commerce off within ~2 minutes. | Intended. Stated here so the merge is a deliberate act; the PR body should say it. |
| Unset/typo'd flag fails toward ON (commerce visible to testers). | Literal value in the workflow, not a variable. The failure is cosmetic — no money or data is exposed. Fail-ON is what keeps 22 e2e files green. |
| A developer's local `.env.local` with the flag off would break the existing e2e suite under `reuseExistingServer`. | `playwright.config.ts` pins `VITE_COMMERCE_ENABLED: 'true'` in the `env` of the two existing client servers; process env outranks `.env` files in Vite. A server already running outside Playwright is not covered — documented in testing.md. |
| Second production build in the e2e run adds CI time and CPU contention on a 4-vCPU runner. | Own 180s timeout like the `pwa` entry; built with `vite build` only (no `tsc -b`), into its own `outDir` so it cannot race the `pwa` build's `emptyOutDir`. Not observable by reading — the developer measures it; fallback is the dev-server alternative above. |
| Session model (guardrail). | Not changed: `getSessionId()` and the `storybook-session` key are untouched; only the mount `useEffect` is gated. A unit test pins that the UUID is still issued when off. |
| Dark-mode parity. | The only new markup is the card "Read" link, which reuses the replaced button's class string (already paired for both variants). No new colour classes are introduced; the copy changes are text-only. |
| Wire-shape (OPS.3), Prisma, auth middleware, paid APIs, spend exposure. | Not touched. No route is added or changed. |
| 11 identical "Read" links on Home are ambiguous to a screen reader. | `aria-label="Read <title>"` (contains the visible text, so WCAG 2.5.3 holds). |
| Stale persisted cart snapshot (`storybook-cart-cache`) still hydrates when off. | Harmless: its only consumer left on screen was the navbar badge, which is not rendered. |
| e2e/unit tests pin the "find and buy" / "keeps their receipt" strings. | Those strings are unchanged with the flag on; the off-copy gets its own unit assertions. |

## ADR-worthy decisions

- [ ] **Commerce surface is gated by a build-time client flag (`VITE_COMMERCE_ENABLED`, default on, literal `'false'` in `deploy-pages.yml`), with the routes falling through to NotFound and a dedicated `commerce-off` Playwright project** — write as ADR-036 via /create-adr after spec approval (`.code-captain/product/decisions.md`).
- [ ] **Cart and order API routes stay open while the client hides them** — Deferred: no payment provider, no paid API and no `spendGate` sits behind `/api/cart` or `/api/orders`, so the exposure is identical to today's public deploy (junk `Order` rows at worst). File a follow-up issue "Server-side commerce kill switch for `/api/cart` and `/api/orders`" in the Pre-merge follow-ups task and link it here; it becomes required before any real payment integration.
