# Mobile PWA slice (MS2) — task plan

> Spec: [spec.md](spec.md)
> Status: Draft
> Last updated: 2026-08-16
> Architect: Claude Opus 5 via @architect on 2026-08-16

## Overview

Seven tasks: one e2e harness, three layout-repair passes, one PWA shell, one offline
cart, one ADR sweep. The order is **measure → fix → extend**, and it is load-bearing:
Task 1 exists so Tasks 2–6 can prove their own done-criteria in CI instead of waiting
on a human to look at a phone.

Task 1 is a hard prerequisite for Tasks 2, 3 and 4 (they delete `test.fixme()` entries
it creates). Tasks 5 and 6 are independent of the layout work and of each other in
spirit, but Task 6's Playwright offline check needs Task 5's service worker to survive a
cold reload — so run 5 before 6. Tasks 2, 3 and 4 touch disjoint files and are
parallel-safe with each other once Task 1 lands.

`Status: <state>` lines under each task heading are how `/execute-task` records progress.

## Cross-cutting constraints

- **No server changes.** Nothing under `server/` is touched. **No route is added or
  modified, so OPS.3 wire-shape obligations do not attach.** If any task appears to need
  a route change, **stop and hand back to the architect** rather than improvising one.
- **Wire-shape, client-side reuse:** `client/src/lib/cartCache.ts` must validate the
  localStorage snapshot with `CartGetResponseSchema` imported from `@storybook/shared`.
  Do not hand-write a parallel shape.
- **Cart session guardrail (CLAUDE.md):** the UUID in `localStorage['storybook-session']`
  is load-bearing. New cache state lives under `localStorage['storybook-cart-cache']`.
  `cartCache.ts` may **read** the session id for a match check; it must never write,
  rotate, clear, or reinterpret it. Editing session issuance requires user confirmation.
- **Dark-mode parity:** every new or changed surface needs `dark:` variants on every
  state (default, hover, focus, disabled). Run the `dark-mode-parity-check` skill on the
  diff before marking any client task Done.
- **Accessibility:** icon-only interactive elements need `aria-label` (the e2e suite
  selects by role/name). Do not change an existing accessible name — desktop specs
  target them.
- **Migrations:** none. No Prisma schema change in this spec.
- **TypeScript strict, no `any`.**
- **Guardrails touched — surface before acting:**
  - **Task 5 adds `vite-plugin-pwa` to `client/package.json`.** New dependency = CLAUDE.md
    size-gate trigger. **Do not run `npm install` until the user explicitly approves.**
    Present the alternatives from the spec (Workbox-direct, hand-rolled SW, manifest-only
    fallback) so it is a choice, not a rubber stamp.
- **Manual-verification stance (read this before claiming Done).** CLAUDE.md
  done-criterion #2 requires browser verification in both light and dark mode. For Tasks
  2, 3 and 6 the `forEachTheme` mobile e2e assertions from Task 1 **are** that
  verification — say so explicitly in the hand-back rather than silently skipping it.
  **Task 4 is the exception:** it passes mechanically but genuinely wants a human read
  of the mobile reader; complete the task, then flag it for a human pass in the hand-back.
- **Deploy-blocked checks are out of scope for every "Done when".** Install prompts, iOS
  Add-to-Home-Screen, and Lighthouse against the deployed origin are blocked on #77 and
  live in the spec's "Deferred verification" list. Copy that list into the PR body; do
  not attempt them and do not let them block a task.

## Tasks

### Task 1 — Mobile e2e harness: viewport projects + assertion helpers + route smoke

**Status:** Done (2026-08-16)

**Zone:** e2e
**Depends on:** none
**Parallel-safe with:** none (everything else builds on it)

**Files to add or change:**
- `e2e/playwright.config.ts` — add two mobile projects; scope the existing `chromium` project away from `tests/mobile/**`.
- `e2e/tests/mobile/_helpers.ts` — new; the three shared assertions.
- `e2e/tests/mobile/smoke.spec.ts` — new; per-route mobile × theme assertions.

**Signatures / shapes:**

```ts
// e2e/playwright.config.ts — projects array
projects: [
  {
    name: 'chromium',
    use: { browserName: 'chromium' },
    testIgnore: /tests\/(mobile|pwa)\//,   // desktop suite unchanged, no duplicate runs
  },
  {
    name: 'mobile-pixel',                   // Pixel 5 / iPhone 13 class
    use: {
      browserName: 'chromium',
      viewport: { width: 393, height: 851 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    },
    testMatch: /tests\/mobile\//,
  },
  {
    name: 'mobile-small',                   // the tight real-world case
    use: {
      browserName: 'chromium',
      viewport: { width: 360, height: 740 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    },
    testMatch: /tests\/mobile\//,
  },
],
```

Do **not** use `devices['iPhone 13']` as-shipped — its `defaultBrowserType` is `webkit`,
and CI installs Chromium only (`.github/workflows/pr-ci.yml`). Using it would fail CI
with a missing-browser error. WebKit coverage is deliberately deferred (spec §Alternatives).

```ts
// e2e/tests/mobile/_helpers.ts
import { expect, type Page } from '@playwright/test';

/** The document must not scroll horizontally. Catches fixed-width rows and overflowing flex. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void>;

/** Every element matching `selector` must have a bounding box of at least 44x44 CSS px. */
export async function expectTapTargets(page: Page, selector: string, min = 44): Promise<void>;

/** Runs `body` twice — once with theme 'light', once with 'dark' — reloading between. */
export async function forEachTheme(
  page: Page,
  body: (theme: 'light' | 'dark') => Promise<void>,
): Promise<void>;
```

Implementation notes:
- `expectNoHorizontalOverflow` evaluates
  `document.documentElement.scrollWidth - window.innerWidth` and asserts `<= 1`
  (1 px tolerance for subpixel rounding). Include the offending page URL in the
  assertion message so a failure names the route.
- `expectTapTargets` uses `locator.all()` + `boundingBox()`, **skips elements that are
  not visible**, and asserts on both dimensions. It takes an explicit selector so
  exceptions are visible in code rather than silently waived.
- `forEachTheme` sets `localStorage['storybook-theme']` (the key `ThemeContext` uses),
  reloads, asserts `html` has/lacks the `dark` class to confirm the seed took, then runs
  the body. Failure messages must name the theme.

```ts
// e2e/tests/mobile/smoke.spec.ts — one describe per route
const ROUTES = ['/', '/cart', '/checkout', '/login', '/register', '/create', '/my-books'];
// plus '/book/<id>' resolved from the first catalog card.
// '/admin' is intentionally excluded — see spec §Out of scope.
```

Each route runs, inside `forEachTheme`:
1. `expectNoHorizontalOverflow(page)`
2. `expectTapTargets(page, 'nav a, nav button')` — primary chrome
3. `expectTapTargets(page, 'main button[type="submit"], form button')` where a form exists

`/checkout` needs a seeded cart (add an item first, mirroring
`e2e/tests/cart-checkout.spec.ts`); `/my-books` and `/create` may redirect when logged
out — assert against whatever renders, the point is the viewport, not the auth state.
Clear `localStorage` in `beforeEach` per `docs/conventions/testing.md`.

**Expected-failing routes:** several assertions will fail on today's code — that is the
purpose of this task. Run the suite, record the **actual** failures, and mark exactly
those with `test.fixme()` carrying the owning task in the annotation:

```ts
test.fixme(true, 'Navbar flex row overflows at 360px — fixed in Task 2');
```

Do **not** weaken an assertion to make it pass, and do **not** `fixme` a route that
actually passes. The `fixme` list is the work queue for Tasks 2–4.

**Tests to write:** the specs above are the tests.
- Wire-shape assertion required: **no** (no server route touched).

**Manual verify:** none required. `npm run test:ui` is available if a helper misbehaves.

**Done when:**
- `cd e2e && npm test` is green across `chromium`, `mobile-pixel`, `mobile-small`.
- The `chromium` project still runs exactly the 28 pre-existing tests (no duplicates).
- Every `test.fixme()` names a concrete symptom and an owning task number.
- The hand-back lists the failing routes so Tasks 2–4 can be scoped against reality.

---

### Task 2 — Responsive repair: `Navbar`, `BookCard`, `Login`, `Register`

**Status:** Done (2026-08-16)

**Zone:** client
**Depends on:** Task 1
**Parallel-safe with:** Tasks 3, 4 (disjoint files)

**Files to add or change:**
- `client/src/components/Navbar.tsx` — the dense single flex row (logo + 4 links + gradient CTA + theme toggle + cart + auth).
- `client/src/components/BookCard.tsx` — zero breakpoints today.
- `client/src/pages/Login.tsx` — zero breakpoints today (`max-w-md mx-auto px-4 py-16`, `p-8` card).
- `client/src/pages/Register.tsx` — same shape as Login.
- `e2e/tests/mobile/smoke.spec.ts` — delete the `test.fixme()` entries owned by this task.

**Signatures / shapes:** no API or prop changes. Tailwind classes only. Guidance:
- Navbar: the existing `hidden sm:inline` label pattern is already there — extend the
  idea rather than inventing a new one. Shrink or wrap the "Create a Book" pill below
  `sm` (icon-only with `aria-label="Create a Book"` is acceptable **only if** the
  accessible name is preserved — `e2e/tests/create-book.spec.ts` may select it).
- Reduce `gap-4` at small widths; keep the cart badge positioned correctly.
- Login/Register: `p-8` → `p-6 sm:p-8`, `py-16` → `py-10 sm:py-16`; inputs `py-2` → `py-3`
  so they clear the 44 px tap target.
- BookCard: the `h-48` cover and `text-7xl` emoji should scale down below `sm`.

**Tests to write:**
- No new spec file. The Task 1 assertions become live for these routes once the
  `fixme`s are removed.
- `cd client && npm test` must stay green — `Navbar.test.tsx` and `BookCard.test.tsx`
  exist and assert on rendered content.
- Wire-shape assertion required: **no**.

**Manual verify:** not required — `forEachTheme` covers light and dark at both
viewports. Attach the Playwright HTML report if a layout looks questionable.

**Done when:**
- The `fixme`s owned by this task are gone and `cd e2e && npm test` is green on all three projects.
- `cd client && npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build` all green.
- `dark-mode-parity-check` on the diff reports no missing `dark:` partner.

---

### Task 3 — Responsive repair: the money path (`Cart`, `Checkout`)

**Status:** Done (2026-08-16)

**Zone:** client + e2e
**Depends on:** Task 1
**Parallel-safe with:** Tasks 2, 4

**Files to add or change:**
- `client/src/pages/Cart.tsx` — each item is one un-wrapping `flex items-center gap-4` row containing a 64 px thumb, title block, a 3-control quantity group, a `w-20` price column, and a delete button. It cannot fit 360 px; it must stack.
- `client/src/pages/Checkout.tsx` — verify the `grid md:grid-cols-2` collapse, input sizing, and the sticky-enough placement of "Place Order".
- `e2e/tests/mobile/money-path.spec.ts` — new.
- `e2e/tests/mobile/smoke.spec.ts` — delete this task's `fixme`s.

**Signatures / shapes:** no prop or context changes. Tailwind only. Preserve every
existing `aria-label` verbatim — `Decrease quantity`, `Increase quantity`,
`Remove from cart` are selected by `e2e/tests/cart-checkout.spec.ts`, and the
`nav .bg-red-500` cart-badge selector must keep matching.

```ts
// e2e/tests/mobile/money-path.spec.ts
// Full add -> cart -> checkout -> confirmation at mobile width, in both themes.
test.describe('Money path on mobile', () => {
  // forEachTheme wrapping:
  //   home -> Add to Cart -> badge reads '1'
  //   /cart -> item title + price visible, expectNoHorizontalOverflow
  //   expectTapTargets(page, '[aria-label="Increase quantity"], [aria-label="Decrease quantity"], [aria-label="Remove from cart"]')
  //   Proceed to Checkout -> fill name/email -> Place Order
  //   expect(page).toHaveURL(/\/order\/.+/) and 'Order Confirmed!' visible
  //   expectNoHorizontalOverflow at every step
});
```

**Tests to write:**
- `e2e/tests/mobile/money-path.spec.ts` — asserts the full purchase completes at 360 px
  and 393 px in both themes with no horizontal overflow and adequately sized controls.
- Wire-shape assertion required: **no** (no route touched; the existing
  `orders.ts` wire-shape tests already cover the response).

**Manual verify:** not required — this task's e2e coverage is the strongest in the spec.

**Done when:**
- `money-path.spec.ts` passes on both mobile projects.
- This task's `fixme`s are gone; `cd e2e && npm test` green on all projects, including the
  untouched desktop `cart-checkout.spec.ts`.
- Client unit tests, typecheck, lint, build green; `dark-mode-parity-check` clean.

---

### Task 4 — Responsive repair: `CreateBook` wizard + `BookSpread` single-page reader

**Status:** Done (2026-08-16)

**Zone:** client + e2e
**Depends on:** Task 1
**Parallel-safe with:** Tasks 2, 3

**Files to add or change:**
- `client/src/components/BookSpread.tsx` (563 lines) — add a single-page mode below `md`.
- `client/src/pages/CreateBook.tsx` (690 lines) — wizard step layout, option grids (`grid-cols-2 md:grid-cols-4`, `grid-cols-2 md:grid-cols-3`), and action buttons.
- `e2e/tests/mobile/reader.spec.ts` — new.
- `e2e/tests/mobile/smoke.spec.ts` — delete this task's `fixme`s.

**Signatures / shapes:** no prop changes to `BookSpread`. The change is internal: below
the `md` breakpoint, render one page panel instead of the `grid grid-cols-2
min-h-[400px]` spread, and step next/prev by one page rather than two.

```ts
// BookSpread — internal only, no exported API change.
// Drive the mode off a matchMedia hook, not off a prop:
//   const isNarrow = useMediaQuery('(max-width: 767px)')   // Tailwind md = 768px
// `client/src/test/setup.ts` already polyfills window.matchMedia for jsdom.
```

Constraints specific to this task:
- The `pl-14 / pr-14` gutter padding on the page panels exists for the two-page spread's
  inner shadow. In single-page mode it wastes ~56 px of a 360 px viewport — reduce it.
- **ADR-004 (theater mode) is in scope only additively.** Desktop behaviour must not
  change. `e2e/tests/book-detail.spec.ts`, `version-history.spec.ts` and
  `illustration-history.spec.ts` are the regression fence — if a change would alter
  desktop theater-mode interaction, **stop and hand back to the architect**; that is an
  ADR-004 amendment, not this spec.
- The `hidden md:inline-flex` control at `BookSpread.tsx:266` is desktop-only today.
  Decide deliberately whether its function is reachable on mobile, and say which in the
  hand-back.

**Tests to write:**
- `e2e/tests/mobile/reader.spec.ts` — at mobile viewport, in both themes:
  exactly one page panel is visible; next advances by one page (assert the visible page
  text/number changes by one, not two); prev reverses it; `expectNoHorizontalOverflow`
  throughout; page-navigation controls meet the tap-target bar.
- Optional RTL test in `client/src/components/__tests__/BookSpread.test.tsx` for the
  narrow-mode branch, mocking `matchMedia`.
- Wire-shape assertion required: **no**.

**Manual verify (recommended, non-blocking):**
- Open a book at ~390 px in **both** light and dark mode and actually read a couple of
  spreads. Machine checks confirm one panel renders and navigation steps correctly; they
  cannot judge line length, illustration crop, or whether the flip animation feels right.
  This is the one task in the spec where "passes" and "good" can diverge — flag it for a
  human pass in the hand-back rather than blocking completion on it.

**Done when:**
- `reader.spec.ts` passes on both mobile projects in both themes.
- This task's `fixme`s are gone; `smoke.spec.ts` now has **zero** `test.fixme()` entries.
- All desktop e2e specs still pass unchanged.
- Client unit tests, typecheck, lint, build green; `dark-mode-parity-check` clean.
- The hand-back states explicitly that a human reader pass is recommended and not yet done.

---

### Task 5 — PWA shell: `vite-plugin-pwa`, manifest, icons, update prompt (USER CONFIRMATION REQUIRED)

**Status:** Done (2026-08-16)

**Zone:** client + e2e
**Depends on:** none technically; **run after Task 1** so the PWA e2e project slots into a config that already understands per-project scoping.
**Parallel-safe with:** Tasks 2, 3, 4

**Files to add or change:**
- `client/package.json` — add `vite-plugin-pwa` to `devDependencies` (**after approval**).
- `client/pwa.config.ts` — new; exported options object so it is unit-testable without a build.
- `client/vite.config.ts` — mount `VitePWA(pwaOptions)` alongside `react()` and `tailwindcss()`.
- `client/public/icons/icon.svg`, `client/public/icons/maskable-icon.svg` — new.
- `client/src/components/UpdateToast.tsx` — new.
- `client/src/main.tsx` — mount `<UpdateToast />` inside the existing provider chain.
- `client/src/vite-env.d.ts` — add `/// <reference types="vite-plugin-pwa/client" />` for the virtual module types.
- `client/src/__tests__/pwaOptions.test.ts` — new.
- `e2e/playwright.config.ts` — add a `pwa` project + a `vite preview` webServer on `:4173`.
- `e2e/tests/pwa/install.spec.ts` — new.

**Signatures / shapes:**

```ts
// client/pwa.config.ts
import type { VitePWAOptions } from 'vite-plugin-pwa';

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: 'prompt',          // NOT autoUpdate — an auto reload can fire mid-checkout
  injectRegister: 'auto',
  includeAssets: ['icons/icon.svg', 'icons/maskable-icon.svg'],
  manifest: {
    name: 'StoryBook Storefront',
    short_name: 'StoryBook',
    description: 'Create and collect one-of-a-kind AI children\'s books.',
    start_url: '.',                // base-relative — MUST NOT be '/' (GitHub Pages serves /storybook/)
    scope: '.',
    display: 'standalone',
    background_color: '#fffbeb',   // amber-50, matches the app's light surface
    theme_color: '#f59e0b',        // amber-500, matches the primary CTA
    icons: [
      { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: 'icons/maskable-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,woff2}'],
    navigateFallback: 'index.html',
    navigateFallbackDenylist: [/^\/api\//, /^\/illustrations\//],
    // No runtimeCaching for /api/* — offline cart data comes from cartCache.ts (Task 6).
  },
  devOptions: { enabled: false },  // keep the SW out of the :5173 dev server the desktop e2e suite uses
};
```

SVG-only icons are deliberate: they are agent-authorable with zero dependencies and
satisfy Chromium installability. A raster `apple-touch-icon` PNG is **not** in this task —
it needs either a supplied asset or a `sharp` devDependency, and iOS install cannot be
verified until #77 anyway. Note it in the hand-back as a follow-up.

```tsx
// client/src/components/UpdateToast.tsx
import { useRegisterSW } from 'virtual:pwa-register/react';
// Renders nothing unless needRefresh. When set: a dismissable toast with a
// "Reload" action calling updateServiceWorker(true). Full dark: variants on
// every state; the dismiss control needs aria-label="Dismiss update notice".
```

```ts
// e2e/playwright.config.ts — additions
projects: [
  // ...chromium, mobile-pixel, mobile-small
  {
    name: 'pwa',
    use: { browserName: 'chromium', baseURL: 'http://localhost:4173/' },
    testMatch: /tests\/pwa\//,
  },
],
webServer: [
  // ...existing server :3001 and client :5173 entries, unchanged
  {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    cwd: '../client',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,   // a cold production build is slow; do not inherit the 15s default
  },
],
```

**Tests to write:**
- `client/src/__tests__/pwaOptions.test.ts` — imports `pwaOptions` and asserts
  `manifest.start_url === '.'`, `manifest.scope === '.'`, `display === 'standalone'`,
  `registerType === 'prompt'`, `devOptions.enabled === false`, both icon entries present
  with `purpose` `any` and `maskable`, and that `navigateFallbackDenylist` covers `/api/`.
  Guards the base-path trap without spawning a build.
- `client/src/components/__tests__/UpdateToast.test.tsx` — mock
  `virtual:pwa-register/react`; assert nothing renders when `needRefresh` is false, and
  that the Reload action calls `updateServiceWorker` when it is true.
- `e2e/tests/pwa/install.spec.ts` — against `:4173`:
  1. `request.get('/manifest.webmanifest')` returns 200 and JSON with `name`, `start_url`, `display`, `icons`.
  2. `document.querySelector('link[rel="manifest"]')` exists.
  3. `navigator.serviceWorker.getRegistration()` resolves to a registration (poll — activation is async).
  4. With `context.setOffline(true)`, `page.reload()` still renders the app shell (the `h1`), not a browser error page.
- Wire-shape assertion required: **no**.

**Manual verify:** none reachable locally beyond the above. Everything device- or
HTTPS-dependent is on the spec's deferred list — **do not attempt it and do not treat it
as blocking.**

**Done when:**
- **The user has explicitly approved adding `vite-plugin-pwa`** before any `npm install`
  ran. If they decline, fall back to the manifest-only variant in the spec's
  §Alternatives and say so in the hand-back.
- `cd client && npm run build` emits `dist/manifest.webmanifest` and a Workbox SW file.
- `pwaOptions.test.ts` and `UpdateToast.test.tsx` pass.
- `e2e/tests/pwa/install.spec.ts` passes; the `chromium`, `mobile-pixel` and
  `mobile-small` projects remain green and unaffected (no SW on `:5173`).
- Client typecheck, lint, build green; `dark-mode-parity-check` clean on `UpdateToast`.
- The hand-back records the deferred-verification list and the `apple-touch-icon` follow-up.

---

### Task 6 — Offline-tolerant cart

**Status:** Done (2026-08-16)

**Zone:** client + e2e
**Depends on:** Task 5 (the cold-offline-reload assertion needs the service worker); Task 3 for the mobile cart layout
**Parallel-safe with:** none once 3 and 5 have landed — it edits `Cart.tsx` after Task 3

**Files to add or change:**
- `client/src/lib/cartCache.ts` — new.
- `client/src/context/CartContext.tsx` — hydrate from snapshot, write on success, expose `offline` / `lastSyncedAt`.
- `client/src/pages/Cart.tsx` — offline banner; disable quantity, remove, and checkout controls while offline.
- `client/src/context/__tests__/CartContext.test.tsx` — new.
- `client/src/lib/__tests__/cartCache.test.ts` — new.
- Every existing `vi.mock('../../context/CartContext')` site under `client/src/**/__tests__/**` — extend the mock with the two new fields.
- `e2e/tests/mobile/offline-cart.spec.ts` — new.

**Signatures / shapes:**

```ts
// client/src/lib/cartCache.ts
import { CartGetResponseSchema, type CartItem } from '@storybook/shared';

const CART_CACHE_KEY = 'storybook-cart-cache';

export interface CartSnapshot {
  sessionId: string;
  items: CartItem[];
  total: number;
  cachedAt: string; // ISO
}

/** Returns null on missing/corrupt JSON, schema mismatch, or sessionId mismatch. */
export function readCartSnapshot(sessionId: string): CartSnapshot | null;
export function writeCartSnapshot(snapshot: CartSnapshot): void;
export function clearCartSnapshot(): void;
```

`readCartSnapshot` validates `{ items, total }` with `CartGetResponseSchema.safeParse`.
It **must not** write `storybook-session` — it only compares against the id passed in.

```ts
// client/src/context/CartContext.tsx — added to CartContextValue
offline: boolean;
lastSyncedAt: string | null;
```

Behaviour:
- On mount, hydrate `items`/`total` from `readCartSnapshot(sessionId)` before the first fetch.
- `fetchCart` success → `writeCartSnapshot`, `offline = false`, `lastSyncedAt = new Date().toISOString()`.
- `fetchCart` network throw → keep current state, `offline = true`. Preserve the existing
  `console.error`; do not swallow it.
- Mutations (`addToCart`, `updateQuantity`, `removeFromCart`, `clearCart`) on a network
  throw → set `offline = true` and **leave local state unchanged**. No optimistic update,
  no replay queue (spec §Alternatives explains why).
- `clearCart` success → also `clearCartSnapshot()`, so a completed checkout does not leave
  a stale cart in storage.

`Cart.tsx` while `offline`: render a banner — *"You're offline. Showing your saved cart
from <relative time>."* — with full `dark:` variants, and set `disabled` on the
quantity/remove buttons and `aria-disabled` + click suppression on the "Proceed to
Checkout" `<Link>` (a `<Link>` has no `disabled` attribute; render a disabled `<button>`
or a styled non-navigating element instead).

**Tests to write:**
- `client/src/lib/__tests__/cartCache.test.ts` — round-trip; `null` on corrupt JSON;
  `null` on session mismatch; `null` when the payload fails `CartGetResponseSchema`;
  `clearCartSnapshot` removes the key; **`storybook-session` is never written** (assert
  the key's value is untouched after every operation).
- `client/src/context/__tests__/CartContext.test.tsx` — with `fetch` stubbed to reject,
  a pre-seeded snapshot still renders items and `offline` is true; on success the
  snapshot is written and `offline` is false.
- `e2e/tests/mobile/offline-cart.spec.ts` — add an item online; `context.setOffline(true)`;
  reload `/cart`; assert the item still renders, the offline banner is visible, and the
  quantity/remove/checkout controls are disabled. Run inside `forEachTheme`.
- Wire-shape assertion required: **no server route touched.** The client-side reuse of
  `CartGetResponseSchema` is asserted by `cartCache.test.ts`.

**Manual verify:** not required — `forEachTheme` plus `setOffline` cover both themes and
the offline state.

**Done when:**
- All new unit and e2e tests pass; the existing desktop `cart-checkout.spec.ts` is
  unchanged and green.
- `npx tsc --noEmit` is clean, proving every `useCart` mock was updated.
- `localStorage['storybook-session']` behaviour is provably unchanged (the cartCache test
  asserts it).
- Client tests, typecheck, lint, build green; `dark-mode-parity-check` clean.

---

### Task 7 — Pre-merge follow-ups

**Status:** Done (2026-08-16)

**Zone:** docs (harness) · **Depends on:** none (run last)

For each ADR-worthy item in `spec.md`, ensure exactly one tracking action exists — a
matching ADR in `.code-captain/product/decisions.md` via `/create-adr`, a linked GitHub
issue, or an explicit `Deferred:` line with reasoning.

Items to discharge:
1. `vite-plugin-pwa` over Workbox-direct / hand-rolled SW / manifest-only.
2. `registerType: 'prompt'` over `autoUpdate` (money-path reasoning).
3. Offline cart as a read-only localStorage snapshot — not SW runtime-caching, not a replay queue.
4. Chromium-only mobile viewport matrix; WebKit deferred (pair with #77).
5. Mobile × dark-mode e2e assertions as the mechanical discharge of CLAUDE.md
   done-criterion #2 — **the widest-reaching item here.** It sets a harness precedent for
   all future UI work and probably warrants its own ADR plus a CLAUDE.md note, not a
   `Deferred:` line.
6. Deferred set: iOS/WebKit e2e, offline mutation queuing, offline book content,
   `Admin.tsx` mobile layout, mobile analytics instrumentation, `apple-touch-icon` PNG.

Also copy the spec's **"Deferred verification (blocked on #77)"** checklist into the PR
body so the deploy-gated checks are visible to a reviewer rather than lost in the spec.

**Done when:** `adr-tracking-check mobile-pwa` reports zero orphaned items.

## Sequencing notes

- **Task 1 is not optional and not reorderable.** It is what makes Tasks 2–4 and 6
  self-verifying. Starting layout work first means falling back to human verification for
  every subsequent task.
- **Parallel cut A:** after Task 1, Tasks 2, 3 and 4 touch disjoint component files and
  can run concurrently. They all edit `e2e/tests/mobile/smoke.spec.ts` (removing their own
  `fixme`s), so expect a trivial merge conflict there — keep the `fixme` block grouped by
  owning task to make it a clean resolution.
- **Parallel cut B:** Task 5 is independent of the layout work entirely and can run
  alongside Tasks 2–4. It should still land after Task 1 so the Playwright config it edits
  already has per-project scoping.
- **Commit/PR boundaries.** Three PRs is the natural shape:
  1. Task 1 alone — the harness, with its `fixme` list as a visible defect inventory.
  2. Tasks 2–4 — the responsive repair, ending with `smoke.spec.ts` at zero `fixme`s.
  3. Tasks 5–6 + 7 — PWA shell, offline cart, ADRs. This is the PR carrying the
     dependency approval and the deferred-verification checklist.

  Squash-merging all seven into one PR is possible but makes the dependency escalation in
  Task 5 easy to lose in the diff.
- **CI cost.** The mobile projects run only `tests/mobile/**`, and the `pwa` project only
  `tests/pwa/**`, so the desktop 28 are not re-run. The `pwa` project's `webServer` does a
  production build — that is the single largest addition to e2e wall-clock. If the e2e job
  approaches its 20-minute timeout after Task 5, raise the timeout rather than dropping the
  project, and say so in the hand-back.

## Open questions

Resolve before starting the task they gate. ADR-worthy items are **not** listed here —
they are decided in the spec and captured in Task 7.

1. **Does the user approve `vite-plugin-pwa`?** Gates Task 5 only. Tasks 1–4 and 6 proceed
   regardless (Task 6 degrades to "survives a mid-session drop" without the SW). Present
   the four options from the spec's §Alternatives.
2. **Should the Navbar's "Create a Book" CTA go icon-only below `sm`, or wrap to a second
   row?** Gates Task 2. Icon-only is more compact but must preserve the accessible name
   for `e2e/tests/create-book.spec.ts`. Default if unanswered: keep the text, shrink
   padding and gaps — text-preserving is the lower-risk option.
3. **Is the `hidden md:inline-flex` control at `BookSpread.tsx:266` needed on mobile?**
   Gates Task 4. It is desktop-only today; the developer should determine what it does and
   propose, rather than silently leaving it hidden.
4. **Is a 44 px tap target the right bar for the Navbar's icon links?** Today they are
   18 px icons in a tight row; enforcing 44 px there may force a layout the user dislikes.
   Default if unanswered: enforce 44 px on money-path controls and primary CTAs, hold nav
   icons to WCAG 2.2 AA's 24 px, and record the split explicitly in `_helpers.ts` call
   sites so it is reviewable.
