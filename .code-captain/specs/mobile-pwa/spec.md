# Mobile PWA slice (MS2)

> Status: Draft
> Last updated: 2026-08-16
> Architect: Claude Opus 5 via @architect on 2026-08-16
> Research: [docs/mobile-strategy-research.md](../../../docs/mobile-strategy-research.md) (MS1, issue #25)
> Backlog: Mobile + Series milestone — https://github.com/slickG0ose/storybook/issues

## Problem

The storefront has never been checked on a phone. `client/src/pages/Cart.tsx`,
`Checkout.tsx` (1 breakpoint), `Login.tsx`, `Register.tsx`, and
`components/BookCard.tsx` carry **zero or near-zero** responsive handling, and the
`Navbar` packs a logo, four links, a gradient CTA pill, a theme toggle, a cart icon
and an auth control into one un-wrapped flex row. Cart and Checkout are the money
path. `BookSpread.tsx` renders a fixed `grid grid-cols-2` two-page spread, so at a
360 px viewport each "page" is under 180 px wide before its `pl-14` gutter padding —
the reader, the product's centrepiece, is unusable on a phone.

There is also no way to *notice* any of this: `e2e/playwright.config.ts` declares
exactly one project (`chromium`, desktop default viewport). Mobile breakage is
currently invisible to CI and can only be found by a human holding a phone.

MS1 (`docs/mobile-strategy-research.md`) recommends the PWA path over native RN. This
spec is the buildable slice of that recommendation: make the existing SPA correct on a
phone, provably and continuously, then make it installable and offline-tolerant.

## Constraints

- **Autonomy is a first-class requirement.** CLAUDE.md done-criterion #2 requires
  manual browser verification in both light and dark mode. This feature is 100% UI, so
  that criterion would gate every task on a human. The design's answer is to land
  machine-checkable mobile assertions **first** (Task 1) and let Tasks 2–6 discharge
  criterion #2 mechanically. §"Autonomy ledger" below states, per task, exactly what is
  machine-verified and what genuinely still needs eyes.
- **New dependency (CLAUDE.md size-gate trigger).** `vite-plugin-pwa` is a new entry in
  `client/package.json`. The developer **must escalate to the user before installing**.
  Alternatives are listed rather than silently chosen — see §Alternatives.
- **Deploy is down.** #77 (Render suspended, Pages disabled) means there is no HTTPS
  origin. `localhost` is a secure context, so all SW/manifest work verifies locally.
  Deploy-dependent checks are quarantined in §"Deferred verification (blocked on #77)"
  and are **not** part of any task's "Done when".
- **Dark-mode parity (client conventions).** Every new or changed UI surface needs
  `dark:` variants on every state.
- **No server routes change.** No new/changed route response ⇒ OPS.3 wire-shape rules
  do not apply to the server. They *are* reused client-side: the offline cart snapshot
  is validated with the existing `CartGetResponseSchema` from `@storybook/shared`. If
  any task finds itself editing `server/src/routes/**`, stop and hand back to the
  architect — that changes the risk profile.
- **Cart session model is load-bearing (CLAUDE.md guardrail).** The offline work adds a
  *new* localStorage key (`storybook-cart-cache`). It must not read, write, rotate or
  reinterpret `storybook-session`. Touching that key requires user confirmation.
- **GitHub Pages base path.** `vite.config.ts` uses `base: process.env.VITE_BASE_PATH ?? '/'`
  and `deploy-pages.yml` builds with `VITE_BASE_PATH=/storybook/`. Manifest `start_url`
  and `scope`, SW registration scope, and `navigateFallback` must all be base-relative.
  A hardcoded `/` boots the installed app to a 404 in production.
- **`deploy-pages.yml` copies `index.html` to `404.html`** as the SPA fallback. The
  service worker's `navigateFallback` must complement that, not fight it.
- **CI installs Chromium only.** `.github/workflows/pr-ci.yml` runs
  `npx playwright install --with-deps chromium`. Any device descriptor whose
  `defaultBrowserType` is `webkit` would silently require a workflow change and a
  bigger browser cache. This design stays on Chromium.
- **TypeScript strict, no `any`.**

## Proposed shape

Six tasks in three movements: **measure, then fix, then extend.**

**Movement 1 — make mobile breakage visible (Task 1).** Add two Playwright projects
driving Chromium at mobile viewports, scoped by `testMatch` to `e2e/tests/mobile/**`
so they do not re-run the 28 desktop specs and roughly double the CI e2e job. Add a
helper module exporting three assertions that turn "looks broken on a phone" into
CI-checkable propositions:

- `expectNoHorizontalOverflow(page)` — `document.documentElement.scrollWidth` must not
  exceed `window.innerWidth` (1 px tolerance). This is the single highest-value mobile
  assertion; it catches the Navbar row, the Cart flex row, and any fixed-width element.
- `expectTapTargets(page, selector)` — every matched interactive element's bounding box
  is at least 44×44 CSS px (Apple HIG; WCAG 2.2 AA's floor is 24×24, we hold the
  higher bar on money-path controls).
- `forEachTheme(page, fn)` — runs a body twice, seeding `localStorage['storybook-theme']`
  to `light` then `dark` and reloading, so every mobile assertion is a **mobile × theme**
  assertion. This is what mechanically discharges "verified in both light and dark".

Task 1 also lands `mobile/smoke.spec.ts` walking the eight user-reachable routes. Some
of those assertions are **expected to fail today** — that is the point. A red suite
cannot merge, so Task 1 records the empirically-failing routes as `test.fixme()` with
the owning task number in the annotation. Tasks 2–4 delete their own `fixme`s as they
fix the underlying layout. The `fixme` list is the work queue, and its emptiness is the
completion signal.

**Movement 2 — fix the layouts (Tasks 2–4).** Tailwind-only changes, ordered by risk:
chrome and auth first (Task 2), money path second (Task 3), the two heavyweight
surfaces last (Task 4 — `CreateBook`'s 690-line wizard and `BookSpread`'s 563-line
reader, which needs a genuine single-page mode below `md` rather than a squeezed
two-page grid). Nothing here changes component contracts or data flow.

**Movement 3 — installable and offline (Tasks 5–6).** `vite-plugin-pwa` in
`generateSW` mode produces a Workbox service worker precaching the built app shell,
plus a `manifest.webmanifest`. PWA options live in a standalone `client/pwa.config.ts`
module rather than inline in `vite.config.ts`, so a fast Vitest unit test can pin the
manifest fields (`start_url: '.'`, `scope: '.'`, `display: 'standalone'`, icons,
theme colors) without spawning a build. Registration uses `registerType: 'prompt'` with
a small `UpdateToast` component — not `autoUpdate`, because an automatic reload can fire
mid-checkout.

The service worker deliberately does **not** cache `/api/*`. Offline cart data comes
from an explicit application-level snapshot (`client/src/lib/cartCache.ts`) written by
`CartContext` on every successful fetch and read back on mount. That keeps personal
data out of an opaque SW cache, makes the behaviour unit-testable with RTL, and works
even before the SW activates. Offline is **read-only**: mutations are refused with an
`offline` flag surfaced through the context, and `Cart.tsx` renders a banner plus
disabled controls rather than letting a user believe a quantity change stuck.

### Schema / contract changes

**Server:** none. No route added, changed, or removed. No Prisma migration.

**`@storybook/shared`:** no new schemas. The existing `CartGetResponseSchema` is
imported *client-side* to validate the localStorage snapshot on read — a stale or
hand-edited cache must not be able to crash the app.

**`CartContextValue` (client-internal, `client/src/context/CartContext.tsx`)** gains
two read-only fields:

```ts
interface CartContextValue {
  // ...existing: items, total, sessionId, addToCart, updateQuantity,
  //               removeFromCart, clearCart, fetchCart
  offline: boolean;            // last fetch/mutation failed at the network layer
  lastSyncedAt: string | null; // ISO timestamp of the last successful fetch
}
```

This is not a wire shape — it never crosses the network — but it is a breaking change
for any test that hand-mocks `useCart()`. Existing mocks in
`client/src/**/__tests__/**` must be updated in the same task.

**New localStorage key:**

```ts
// client/src/lib/cartCache.ts
const CART_CACHE_KEY = 'storybook-cart-cache';

interface CartSnapshot {
  sessionId: string;    // must match the live storybook-session UUID or the snapshot is discarded
  items: CartItem[];
  total: number;
  cachedAt: string;     // ISO
}

export function readCartSnapshot(sessionId: string): CartSnapshot | null;
export function writeCartSnapshot(snapshot: CartSnapshot): void;
export function clearCartSnapshot(): void;
```

`readCartSnapshot` validates `{ items, total }` with `CartGetResponseSchema.safeParse`
and returns `null` on any failure or session mismatch. `storybook-session` itself is
never written by this module.

### Data flow

**Offline cart read path:**

```
mount → CartContext reads storybook-session (unchanged)
      → readCartSnapshot(sessionId) → hydrate items/total optimistically, offline=true-until-proven
      → fetchCart() → GET /api/cart/:sessionId
            ├─ ok  → setItems/setTotal, writeCartSnapshot(...), offline=false, lastSyncedAt=now
            └─ throw → keep hydrated snapshot values, offline=true
```

**Offline cart write path:** `addToCart` / `updateQuantity` / `removeFromCart` /
`clearCart` attempt the request; a network-layer throw sets `offline = true` and leaves
local state untouched (no optimistic mutation, no replay queue). `Cart.tsx` disables
its `+` / `−` / remove controls and the "Proceed to Checkout" link while `offline` is
true, above an offline banner.

**PWA shell:** `main.tsx` mounts `<UpdateToast />` (which consumes
`useRegisterSW` from `virtual:pwa-register/react`) inside the existing provider chain.
Precached assets are served by Workbox; `/api/*` and `/illustrations/*` are on the
`navigateFallbackDenylist` and have no runtime caching entry, so they pass through to
the network untouched.

### Files likely touched

**e2e**
- `e2e/playwright.config.ts` — add `mobile-pixel` (393×851) and `mobile-small` (360×740) projects; add `testIgnore: 'mobile/**'` to the existing `chromium` project; add a `pwa` project + a third `webServer` entry on `:4173`.
- `e2e/tests/mobile/_helpers.ts` — new; the three assertions above.
- `e2e/tests/mobile/smoke.spec.ts` — new; per-route overflow + tap-target × theme.
- `e2e/tests/mobile/money-path.spec.ts` — new; full add→cart→checkout→confirmation at 360 px.
- `e2e/tests/pwa/install.spec.ts` — new; manifest fetch, SW registration, offline reload.

**client — layout**
- `client/src/components/Navbar.tsx` — the dense flex row.
- `client/src/components/BookCard.tsx` — zero breakpoints today.
- `client/src/pages/Login.tsx`, `Register.tsx` — zero breakpoints today.
- `client/src/pages/Cart.tsx` — zero breakpoints; single flex row per item must stack.
- `client/src/pages/Checkout.tsx` — one breakpoint; verify the `grid md:grid-cols-2` collapse and control sizing.
- `client/src/pages/CreateBook.tsx` — wizard steps, option grids, sticky actions.
- `client/src/components/BookSpread.tsx` — single-page mode below `md`; interacts with ADR-004 theater mode.

**client — PWA**
- `client/package.json` — `vite-plugin-pwa` devDependency (**escalate first**).
- `client/vite.config.ts` — mount the plugin with options imported from `pwa.config.ts`.
- `client/pwa.config.ts` — new; exported, unit-testable options object.
- `client/public/icons/icon.svg`, `client/public/icons/maskable-icon.svg` — new.
- `client/src/components/UpdateToast.tsx` — new; `needRefresh` prompt, dark-mode paired.
- `client/src/main.tsx` — mount `<UpdateToast />`.
- `client/src/__tests__/pwaOptions.test.ts` — new; pins manifest fields.

**client — offline cart**
- `client/src/lib/cartCache.ts` — new.
- `client/src/context/CartContext.tsx` — hydrate, snapshot, `offline`, `lastSyncedAt`.
- `client/src/pages/Cart.tsx` — offline banner + disabled controls.
- `client/src/context/__tests__/CartContext.test.tsx` — new.
- existing `useCart` mocks across `client/src/**/__tests__/**` — extend for the two new fields.

**docs**
- `.code-captain/product/decisions.md` — ADRs from Task 7.

## Autonomy ledger

The honest per-task answer to "can `/execute-task` finish this without a human looking
at a screen?"

| Task | Machine-verified | Genuinely needs a human eyeball |
|---|---|---|
| 1 — mobile e2e harness | **Fully.** The harness asserts on itself; a helper that mis-measures fails its own fixture test. | No. |
| 2 — Navbar/BookCard/Login/Register | **Correctness, fully**: no overflow at 360 and 393 px, tap targets ≥44 px, both themes, plus the `dark-mode-parity-check` skill on the diff. | **Aesthetics only.** Machine checks cannot tell "wrapped tidily" from "wrapped into an ugly three-row stack". Non-blocking; Playwright screenshots are attached as artifacts for optional review. |
| 3 — Cart/Checkout money path | **Fully**, including a complete add→cart→checkout→order-confirmed run at 360 px in both themes. | Aesthetics only, as above. |
| 4 — CreateBook + BookSpread reader | **Structurally**: overflow, tap targets, both themes, and a behavioural assertion that below `md` exactly one page panel is visible and next/prev advance by one page. | **Yes, weakly.** Reading comfort — line length, illustration crop, whether page-flip animation feels right on a small screen — is a judgement call. ADR-004 theater mode's interaction on mobile is worth a real look. Recommend a human pass before merge; do not block task completion on it. |
| 5 — PWA shell | **Locally, fully**: manifest served with expected fields, SW registers and activates, precached shell boots with the network cut, update toast renders. | **Yes, deferred** — real install on a real device, iOS Add-to-Home-Screen, Lighthouse against the deployed origin. All blocked on #77; see below. |
| 6 — Offline cart | **Fully.** RTL unit tests for snapshot read/write/validate, plus Playwright `context.setOffline(true)` for the banner, disabled controls, and preserved items. | **No** for the coded behaviour. Real-world flaky-network (partial responses, captive portals) is out of scope, not deferred. |

**Bottom line:** Tasks 1, 2, 3 and 6 are fully autonomous. Task 5 is autonomous for
everything reachable at `localhost`. Task 4 is autonomous for correctness but should
get a human read-through before merge — it is the one place where "passes" and "good"
genuinely diverge.

### Deferred verification (blocked on #77)

These are **not** in any task's "Done when". They belong to the PR description as an
explicit outstanding list, to be discharged once the deploy is restored:

- [ ] Android Chrome shows an install prompt on the deployed origin
- [ ] iOS Safari Add-to-Home-Screen launches in standalone mode with the correct icon
- [ ] Lighthouse PWA audit passes against `https://slickg0ose.github.io/storybook/`
- [ ] Manifest `scope` / `start_url` resolve correctly under the `/storybook/` base in production
- [ ] Service worker does not serve a stale shell after a real Pages redeploy

## Alternatives considered

### PWA tooling

#### `vite-plugin-pwa` (proposed)

**Pros:** Purpose-built for Vite; handles `base` propagation into the manifest and SW
scope, which is exactly the `/storybook/` trap this project would otherwise fall into.
Generates the manifest, injects the `<link rel="manifest">`, ships a typed
`virtual:pwa-register/react` hook, and has a `devOptions` switch so the SW stays off in
the dev server used by the existing e2e suite. Wraps Workbox — no bespoke caching code.
**Cons:** A new dependency and a build-time abstraction; a Workbox major bump arrives
transitively; the virtual-module import needs a `vite-env.d.ts` reference for strict TS.
**Status:** recommended, **pending user confirmation.**

#### Workbox directly (`workbox-build` + a custom `sw.ts`)

**Pros:** One less abstraction; full control of the precache manifest.
**Cons:** Still a new dependency (so it does not dodge the guardrail), and it hands back
every problem the plugin solves: base-path propagation, manifest authoring, HTML
injection, dev/prod SW toggling, and a hand-rolled registration hook. More code to own
for no capability gain.
**Why rejected:** strictly more work, same dependency cost.

#### Hand-rolled service worker, zero dependencies

**Pros:** No new `package.json` entry — sidesteps the size-gate escalation entirely.
**Cons:** The precache manifest must list Vite's content-hashed output filenames, which
change every build; keeping that list correct means writing a post-build script that
parses `dist/.vite/manifest.json` — i.e. reimplementing the bad half of Workbox. Stale
caches are the most common PWA failure mode and hand-rolled invalidation is where they
come from.
**Why rejected:** the dependency is the cheap part; correctness is not.

#### No service worker — manifest only

**Pros:** Genuinely zero dependencies. A manifest plus icons is enough for Chromium
installability; the app is "installable" but not offline-capable.
**Cons:** Drops the offline app shell, so Task 6's offline cart has nothing to render
into — a cold offline launch shows the browser's dinosaur, not a cached cart.
**Status:** **held as a fallback.** If the user declines the dependency, Tasks 1–4 and a
manifest-only Task 5 still deliver most of the value; Task 6 degrades to "cart survives
a mid-session network drop" rather than "cart survives a cold offline launch".

### Mobile e2e device matrix

#### Two Chromium viewport projects — 393×851 and 360×740 (proposed)

**Pros:** Reuses the Chromium binary CI already caches, so no workflow change and no
extra browser download. 360 px is the tight real-world case that actually catches
overflow; 393 px matches Pixel 5 / iPhone 13-class devices.
**Cons:** Chromium emulation cannot reproduce WebKit-specific behaviour — `100vh`
address-bar accounting, `env(safe-area-inset-*)`, iOS service-worker storage eviction.
**Status:** proposed, with the WebKit gap recorded as a known limitation.

#### Adding a WebKit project (`devices['iPhone 13']` as-shipped)

**Pros:** Real Safari engine — the only way to catch iOS-specific layout and SW bugs.
**Cons:** `devices['iPhone 13'].defaultBrowserType` is `webkit`, so
`.github/workflows/pr-ci.yml` must install and cache a second browser, lengthening
every PR run. Given that #77 means nothing is deployed to test on iOS anyway, the
payoff is deferred.
**Status:** **held as an upgrade path** — pair it with the #77 restoration, not with this
slice.

### Offline cart strategy

#### Explicit localStorage snapshot, read-only offline (proposed)

**Pros:** Deterministic and unit-testable; keeps personal cart data out of an opaque SW
cache; works before the SW activates; no conflict-resolution surface.
**Cons:** Duplicates a little state; an offline user cannot change quantities.

#### Workbox `StaleWhileRevalidate` on `GET /api/cart/:sessionId`

**Pros:** Nearly free — a few lines of `runtimeCaching`.
**Cons:** Puts a user's cart in the Cache Storage API keyed by URL, which on a shared
device outlives a logout; and it is invisible to RTL, so the behaviour can only be
tested through a browser.
**Why rejected:** less testable, worse privacy posture, for a marginal code saving.

#### Queued offline mutations with replay on reconnect

**Pros:** The genuinely app-like experience — change quantities on the subway.
**Cons:** Needs conflict resolution against a server-authoritative cart. A replayed
"increase quantity" against a cart the server changed produces a wrong total on a money
path, and there is no idempotency key on the cart routes to lean on.
**Why rejected (held as upgrade path):** correct queuing is its own spec, and it would
require server-side changes — which this spec explicitly excludes.

### Service-worker update strategy

#### `registerType: 'prompt'` + `UpdateToast` (proposed)

**Pros:** No reload without user consent, so a new deploy cannot reload the page
mid-checkout; the toast is a plain component and unit-testable.
**Cons:** One more small UI surface, which means one more dark-mode surface.

#### `registerType: 'autoUpdate'`

**Pros:** Zero UI, users always current.
**Cons:** vite-plugin-pwa's autoUpdate calls `skipWaiting` and reloads when the new
worker takes control. On `/checkout` with a filled form, that discards user input.
**Why rejected:** unacceptable on a money path for a cosmetic simplification.

## Success criteria

1. `cd e2e && npm test` runs the desktop `chromium` project **plus** `mobile-pixel` and
   `mobile-small`, and is green.
2. `e2e/tests/mobile/smoke.spec.ts` contains **zero** `test.fixme()` entries by the end
   of Task 4 — every route passes overflow + tap-target assertions at 360 px and 393 px
   in **both** light and dark mode.
3. A full add→cart→checkout→order-confirmed run completes at a 360 px viewport in both
   themes (`e2e/tests/mobile/money-path.spec.ts`).
4. Below `md`, `BookSpread` renders exactly one page panel, and next/prev advance one
   page at a time.
5. A production build emits `dist/manifest.webmanifest` and a Workbox service worker;
   `client/src/__tests__/pwaOptions.test.ts` pins `start_url`, `scope`, `display`,
   `theme_color`, and the icon list.
6. Against `vite preview`, `navigator.serviceWorker.getRegistration()` resolves and, with
   `context.setOffline(true)`, a reload still renders the app shell rather than a browser
   error page.
7. With the network offline, `/cart` renders the previously-fetched items, shows an
   offline banner, and disables quantity/remove/checkout controls.
8. `cd client && npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run build` are
   all green; `cd server && npm test` is untouched and green.
9. `dark-mode-parity-check` reports no missing `dark:` partner on the diff.

## Out of scope

- Push notifications (any platform), background sync, Web Share.
- Offline **mutation** of the cart — offline is read-only by design.
- Offline access to book *content* (page images, reader) — shell only.
- Any React Native work. MS1 recommends against it; see `docs/mobile-strategy-research.md`.
- `Admin.tsx` mobile layout. It is 955 lines, admin-only, and desktop-appropriate; the
  mobile smoke spec should skip `/admin` rather than `fixme` it.
- Server changes of any kind, including image-size negotiation for cellular.
- Restoring the deploy (#77) or resolving the database expiry (#78).
- Analytics/instrumentation of mobile traffic share — flagged in MS1 §7 as the highest-
  leverage follow-up, but it is its own issue.

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| **The autonomy gate.** CLAUDE.md done-criterion #2 demands human verification in both themes; a 100%-UI feature would stall on it every task. | Task 1 lands `forEachTheme` + overflow + tap-target assertions before any UI changes, so Tasks 2–6 discharge criterion #2 mechanically. The §Autonomy ledger states per task what is machine-checked and what is not — Task 4 is flagged as genuinely wanting eyes. |
| **New dependency (`vite-plugin-pwa`) is a CLAUDE.md size-gate trigger.** | Task 5 begins with an explicit escalation; the developer must not run `npm install` before the user approves. §Alternatives lists three options plus a manifest-only fallback so the user is choosing, not rubber-stamping. |
| **#77: no live HTTPS origin.** Install prompts, iOS ATHS, and Lighthouse cannot be exercised. | `localhost` is a secure context, so all SW work verifies locally against `vite preview`. Deploy-dependent checks are quarantined in §"Deferred verification" and excluded from every "Done when". No task is blocked. |
| **#78: database deleted 2026-09-14.** E2E needs a seeded DB. | Local/CI e2e runs against SQLite (`dev.db`/`test.db`) and is unaffected. Only the deferred production checks touch the Postgres instance. |
| **A service worker leaking into the dev server would flake the existing 28 desktop e2e tests** via stale precached assets. | `devOptions.enabled: false`. PWA e2e runs as a separate project against a `vite preview` build on `:4173` (its own `webServer` entry), so `:5173` never registers a worker. |
| **Base-path trap.** A manifest with `start_url: '/'` boots the installed app to a 404 under `/storybook/`. | `start_url` and `scope` are `'.'` (base-relative); `pwaOptions.test.ts` pins both. The production-base check is on the deferred list because only a real Pages deploy proves it. |
| **`navigateFallback` vs. the `404.html = index.html` SPA fallback** in `deploy-pages.yml`. | `navigateFallback: 'index.html'` with `/api/` and `/illustrations/` on the denylist. The workflow's 404 copy stays as the non-SW fallback for first-visit deep links. Both are exercised on the deferred list. |
| **Adding `offline`/`lastSyncedAt` to `CartContextValue` breaks hand-mocked `useCart()` in existing client tests.** | Task 6 updates every `vi.mock('../../context/CartContext')` site in the same change; `npx tsc --noEmit` catches any missed one. |
| **The cart snapshot is adjacent to the load-bearing UUID session guardrail.** | `cartCache.ts` may only *read* `storybook-session` for a match check, never write or rotate it, and stores under a distinct `storybook-cart-cache` key. If the developer finds themselves editing session issuance, that is a guardrail hit requiring user confirmation. |
| **Stale/corrupt snapshot crashing the cart.** | `readCartSnapshot` validates with `CartGetResponseSchema.safeParse` and returns `null` on mismatch — reusing OPS.3's schema client-side without touching the server. |
| **Mobile projects doubling e2e CI time.** | `testMatch: 'mobile/**'` on the mobile projects and `testIgnore: 'mobile/**'` on `chromium`. Mobile specs are a focused subset, not a rerun of the desktop suite. Chromium-only, so no extra browser download. |
| **`BookSpread.tsx` is 563 lines and encodes ADR-004 theater-mode interaction.** | Task 4 is scoped to a `md`-breakpoint single-page mode, additive to the existing desktop behaviour; desktop specs (`book-detail.spec.ts`, `version-history.spec.ts`) must stay green as the regression fence. If a change would alter desktop theater-mode behaviour, hand back — that is an ADR-004 amendment, not this spec. |
| **Tap-target ≥44 px may conflict with existing dense chrome** (e.g. Navbar's `w-8 h-8` quantity buttons and 18 px icon links). | Enforce 44 px on money-path and primary-nav controls; the helper takes an explicit selector list rather than "all buttons", so exceptions are visible in code and reviewable rather than silently waived. |
| **No server route should change.** | Stated as a constraint; if a task implies one, stop and re-dispatch the architect — OPS.3 wire-shape obligations would then attach. |

## ADR-worthy decisions

*Discharged by Task 7 on 2026-08-16. Each item carries exactly one tracking action.*

- [x] **`vite-plugin-pwa` over Workbox-direct / hand-rolled SW / manifest-only** — **ADR-010 decision 1.** New dependency, hard to reverse once the build depends on it. The user was shown all four options and explicitly approved the plugin before `npm install` ran; the ADR records the approval, not just the choice.
- [x] **`registerType: 'prompt'` over `autoUpdate`** — **ADR-010 decision 2.** Deliberate rejection of automatic reload on a money path.
- [x] **Offline cart as a read-only localStorage snapshot, not SW runtime-caching and not a replay queue** — **ADR-010 decision 3.** Sets the offline data-consistency posture for everything that follows; the queued-mutation alternative is held as a named upgrade path.
- [x] **Chromium-only mobile viewport matrix; WebKit deferred** — **ADR-009**, §Decision (device matrix) and §Alternative considered. A knowingly accepted iOS coverage gap with an explicit revisit trigger: #77 restored, or the first iOS-specific bug report.
- [x] **Mobile × dark-mode e2e assertions as the mechanical discharge of CLAUDE.md done-criterion #2** — **ADR-009**, plus a note in CLAUDE.md §Done criteria #2 pointing at it. The correctness half of the criterion is discharged mechanically; the aesthetic half stays human and is named per task in §Autonomy ledger.
- [x] **Deferred:** each item below is deferred deliberately, with its reason and its reopen trigger. None is in any task's "Done when".
  - **Offline mutation queuing** — needs conflict resolution against a server-authoritative cart with no idempotency key on the cart routes; a replayed quantity change produces a wrong total on a money path. Its own spec, and it requires the server changes this one excludes. *Reopen when* offline quantity editing is an actual product requirement.
  - **Offline access to book content** (page images, reader) — shell-only by design; precaching illustrations would put every book a user opened into Cache Storage with no eviction policy. *Reopen when* offline reading is asked for, alongside a storage-budget decision.
  - **`Admin.tsx` mobile layout** — 955 lines, admin-only, desktop-appropriate. The mobile smoke spec skips `/admin` rather than `fixme`ing it, so this is a skip with a reason and not a hidden failure. *Reopen when* admin work is done from a phone.
  - **Mobile analytics instrumentation** — MS1 §7 calls it the highest-leverage follow-up, but it is its own issue and needs a decision on an analytics vendor. *Reopen* as a Mobile + Series issue.
  - **`apple-touch-icon` raster PNG** — the icon set is SVG-only, which Chromium accepts and iOS Add-to-Home-Screen does not. Untestable while #77 stands. *Reopen with* #77; it is a one-file addition.
  - **iOS/WebKit e2e coverage** is *not* deferred here — it is decided in **ADR-009** (device matrix), listed only for continuity with the original bullet.
