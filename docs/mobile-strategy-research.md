# Mobile Strategy Research — PWA now vs. native React Native later

> Research compiled 2026-08-16 for [MS1 / issue #25](https://github.com/slickG0ose/storybook/issues/25).
> **This document is a decision aid, not a commitment.** Nothing here authorises
> starting a React Native codebase. It recommends one path and names the
> conditions under which the other becomes worth revisiting.

---

## 0. TL;DR

**Recommendation: PWA now. Native RN stays on the shelf, gated on explicit triggers.**

The storefront's audience is dominated by low-frequency, gift-driven, socially-acquired
buyers. Those users arrive from a link in an Instagram or TikTok in-app browser and
convert (or don't) in one session. A native app cannot participate in that funnel
without a store round-trip, and the highest-AOV segment — grandparents 55–75 — is the
least likely group to install anything. Meanwhile Apple's IAP rules would take
15–30% of every *digital* book sale made inside an iOS app, against a $4.99 list
price where that is the whole margin.

The PWA path costs roughly one focused week and one new build-time dependency. It is
buildable and machine-verifiable today. The RN path costs 2–3 months of parity work
before it does anything the web app doesn't, plus permanent two-release-train overhead.

**Revisit RN when all of these are true**, not before:

1. Mobile web traffic exceeds ~50% of sessions **and** mobile conversion trails desktop
   by a margin that responsive fixes have failed to close.
2. A repeat-creator cohort exists (i.e. the "StoryBook Studio" subscription from
   `docs/marketing-research.md` §4 has actually shipped and retains).
3. Push notification re-engagement is a measured lever, not a hypothesis.
4. Revenue is print-weighted, not digital-weighted — so IAP commission stops being
   the dominant unit-economics term.
5. The deploy is stable and staffed (today it is not — see §6).

---

## 1. Path A — PWA now

### 1.1 Scope

Make the existing React SPA behave like an app on a phone. Four layers, roughly in
cost order:

| Layer | What it means concretely | State today |
|---|---|---|
| **Responsive correctness** | No horizontal overflow, tappable controls, readable text at 360–430 px | **Thin and uneven.** 41 breakpoint prefixes across 18 `.tsx` files, concentrated in `BookSpread` (13), `Home` (8), `BookDetail` (6). **Zero** in `Login.tsx`, `Register.tsx`, `Cart.tsx`, `BookCard.tsx` — and Cart is a money path. |
| **Installability** | Web app manifest, icon set, `display: standalone`, correct `start_url`/`scope` under the `/storybook/` GitHub Pages base | **Absent.** `client/index.html` has the viewport meta and an inline SVG favicon; no manifest, no icons, no `vite-plugin-pwa`. |
| **Offline shell** | Service worker precaching the built JS/CSS/HTML so the app boots without a network | **Absent.** No service worker of any kind. |
| **Offline data** | Last-known cart survives a dropped connection instead of rendering empty | **Absent.** `CartContext.fetchCart()` catches the failure, `console.error`s, and leaves `items` at `[]` — an offline user sees "Your cart is empty", which is worse than an error. |

Explicitly **not** in the PWA path: push notifications, background sync, camera/photo
upload, biometric auth, app-store presence.

### 1.2 Cost

**Build.** One focused week of implementation, decomposed as 6 tasks in
`.code-captain/specs/mobile-pwa/tasks.md`. Roughly:

| Work | Estimate |
|---|---|
| Mobile e2e harness (Playwright mobile viewport projects, overflow/tap-target/dark-mode helpers) | 0.5–1 day |
| Responsive repair — `Navbar`, `BookCard`, `Login`, `Register` | 0.5 day |
| Responsive repair — money path (`Cart`, `Checkout`) | 0.5 day |
| Responsive repair — `CreateBook` wizard + `BookSpread` reader (single-page mode below `md`) | 1–2 days (`BookSpread` is 563 lines and interacts with ADR-004 theater mode) |
| PWA shell — plugin, manifest, icons, update prompt | 0.5–1 day |
| Offline-tolerant cart | 0.5 day |

**Ongoing.**

- **$0 licensing, $0 store fees, no separate release train.** The PWA ships with the
  existing `deploy-pages.yml` workflow.
- **+1 CI dimension.** Mobile Playwright projects add wall-clock to the e2e job. Scoped
  to `tests/mobile/**` rather than re-running the whole desktop suite, the marginal
  cost is a few minutes per PR, not double.
- **Service-worker cache invalidation is the real recurring tax.** A stale precache is
  the classic PWA support burden ("users see an old version"). Mitigated by an explicit
  update prompt rather than silent `autoUpdate`, but it never goes to zero.
- **Responsive regression risk** on every future UI change. The mobile e2e project is
  the durable answer: it turns "did someone check this on a phone?" into a CI check.

### 1.3 What a PWA does *not* buy you

Being honest about the ceiling matters more than the pitch:

- **iOS is a second-class PWA host.** Web Push works only for home-screen-installed
  PWAs (Safari 16.4+), install requires the user to find "Add to Home Screen" in the
  share sheet — there is no install prompt — and iOS periodically evicts storage for
  apps unused for ~7 days.
- **No app-store discovery.** Zero organic install traffic from the App Store or Play.
- **No native affordances** — haptics, share sheets beyond `navigator.share`, native
  photo pickers, background audio for read-aloud.
- **Install intent from a one-shot gift buyer is near zero** regardless of how good
  the install experience is. The offline shell mostly serves the *repeat* user, who
  does not exist yet.

---

## 2. Path B — Native React Native later

### 2.1 Scope

A separate app codebase (Expo-managed RN is the realistic shape) reaching parity with
the current storefront: auth, catalog browse + filters, book detail, cart, checkout,
order confirmation, My Books, the multi-step creation wizard, and the page-spread
reader. Plus the store-only surface area the web app never needs — app icons and
splash screens, store listings and screenshots, privacy nutrition labels, age rating,
IAP entitlement plumbing, crash reporting, OTA update channel.

### 2.2 Cost

**Build.** 8–14 weeks solo to parity, and parity is the floor, not the goal — an app
that only matches the website has no reason to exist. Cost concentrates in:

| Surface | Why it's expensive in RN |
|---|---|
| `BookSpread.tsx` (563 lines) | The reader is CSS-and-DOM-native: two-column grid, inset box shadows for the gutter, `max-w-[min(90vw,1600px)]` theater sizing, page-flip transitions. None of it ports; it is a from-scratch rebuild against `react-native-reanimated` / `react-native-pager-view`. |
| `CreateBook.tsx` (690 lines) | Long multi-step form with generation polling and streaming-ish progress states. Portable in logic, fully rewritten in markup. |
| `BookDetail.tsx` (1203 lines) / `Admin.tsx` (955 lines) | Sheer volume. Admin arguably never ships to mobile at all. |
| Payments | Not yet built on web either ("Payment integration coming soon (demo mode)"). Doing it natively means Stripe web *and* IAP, not one of them. |
| Tailwind classes | ~4,550 lines of `.tsx` are styled with Tailwind utility classes. NativeWind narrows the gap but is a moving target against Tailwind v4, and the dark-mode `@custom-variant` setup in `client/src/index.css` does not transfer. |

**What *does* port:** the `@storybook/shared` Zod package (unchanged), `AuthContext`
and `CartContext` logic (swap `localStorage` for `expo-secure-store` /
`AsyncStorage`), `lib/cost.ts`, and every server route as-is. That is real, but it is
the cheap third of the work.

**Ongoing.**

| Item | Cost |
|---|---|
| Apple Developer Program | $99/yr |
| Google Play Developer | $25 one-time |
| **App Store IAP commission on digital goods** | **15% (Small Business Program, <$1M/yr) to 30%** of every digital book sold in-app |
| Release latency | 1–3 days of review per submission; hotfixes are not instant unless they fit an OTA update |
| Two release trains | Every feature lands twice, tested twice, regressed twice |
| Device/OS matrix | iOS + Android version support, physical-device testing |

The IAP line is the one that should decide this on economics alone. At the
`docs/marketing-research.md` §4 price of **$4.99 for a digital book**, Apple's cut is
$0.75–$1.50 per sale on a product whose marginal cost is already an AI generation
call. Physical print items ($24.99–$49.99) may use external payment and are unaffected —
so the app becomes *more* attractive the more print-weighted the revenue mix gets.
Today the mix is digital-weighted by default, because print doesn't exist yet (PS2).

### 2.3 The OPS.3 optionality note — and a correction

Issue #25 frames RN optionality as preserved by ADR-003's "Zod schemas as source of
truth", with `zod-to-openapi` codegen for the mobile client. `docs/backlog.md:51`
defers that dependency until a concrete trigger — "third-party API consumers,
**non-TS clients (mobile app, partner SDKs)**, or vendor-facing API documentation".

Worth being precise: **a React Native client would not actually fire that trigger.**
RN is TypeScript. It imports `@storybook/shared` directly from the workspace and gets
the exact same inferred types the web client gets, with zero codegen and zero new
dependency. The `zod-to-openapi` deferral remains correct and untouched by Path B.

The trigger fires only for a *genuinely* non-TS client — a Swift or Kotlin native app,
a partner SDK, or public API docs. If the mobile question ever resolves toward native
Swift/Kotlin rather than RN, that is when `@asteasolutions/zod-to-openapi` gets added
and ADR-003's migration path gets exercised.

So the optionality claim holds, but for a smaller reason than #25 states: ADR-003
means **any future client is cheap to type**, and RN specifically is free.

---

## 3. Target-audience overlap

Drawing on `docs/marketing-research.md` §3.

| Segment | Priority | Purchase frequency | Device reality | Would install a native app? | Served by PWA? |
|---|---|---|---|---|---|
| **Parents 28–42** | Highest volume | Repeat-capable (monthly, *if* subscription ships) | Phone-first; arrive via Instagram/TikTok in-app browsers | Maybe — the only segment that plausibly would | Yes, and it's the segment that would actually install a PWA too |
| **Grandparents 55–75** | Highest AOV ($25–$60/book) | 1–4×/yr, gift-driven | Tablet and desktop heavy; lowest app-install fluency | **No** | Yes — and responsive tablet layout matters more here than installability |
| **Gift-givers** | High | Once per occasion | Phone, arriving from a shared link | **No** — an install is an absurd ask for a single $30 purchase | Yes; this is the segment a PWA's zero-friction install-optional model exists for |
| **Teachers / educators** | Medium | Bursty, budget-constrained | School-managed Chromebooks and iPads; installs frequently blocked by MDM | **Cannot**, often | Yes — Chromebook PWA support is good, and it's the only path onto locked-down hardware |

Two structural conclusions:

1. **Three of the four segments are low-frequency.** Native app economics depend on
   repeat engagement to amortise install friction. Only the parent segment has that
   shape, and only *after* the subscription tier exists.
2. **Acquisition is link-based, not store-based.** §5 of the marketing research puts
   55% of planned spend into Instagram/TikTok organic + paid. That traffic lands in an
   in-app browser. A web app converts it in the same session; a native app asks it to
   leave, visit a store, install, and come back — with the usual order-of-magnitude
   drop-off.

The one genuine native-only capability with a business case is **push notification
re-engagement** ("your book is ready", "story of the week"). Note that a
home-screen-installed PWA gets this on Android/desktop and, since iOS 16.4, on iOS
too — so even that advantage is narrower than it was three years ago.

---

## 4. Technical fit with the current stack

**Current client:** React 19, Vite 8, Tailwind v4, React Router v7, TypeScript strict,
Lucide icons. 18 non-test `.tsx` files, ~4,550 lines. Single build target. Zero native
modules. Wire shapes come from `@storybook/shared` (Zod).

### Path A fit — high

- `vite-plugin-pwa` is the idiomatic Vite integration and wraps Workbox. It slots into
  the existing `client/vite.config.ts` plugin array beside `react()` and
  `tailwindcss()`. **It is a new `package.json` entry, which is a CLAUDE.md size-gate
  trigger and needs explicit confirmation.**
- Two existing details make this *less* trivial than a greenfield PWA and must be
  handled deliberately:
  - **Base path.** `vite.config.ts` sets `base: process.env.VITE_BASE_PATH ?? '/'`, and
    `deploy-pages.yml` builds with `VITE_BASE_PATH=/storybook/`. The manifest's
    `start_url` and `scope` and the service worker's registration scope must all be
    base-relative, or the installed app boots to a 404.
  - **SPA fallback.** `deploy-pages.yml` copies `index.html` to `404.html` because
    GitHub Pages has no router rewrite. A service worker's `navigateFallback` overlaps
    with that mechanism and must not fight it.
- Responsive work is pure Tailwind. No architectural change.
- Testing infrastructure already exists — Playwright mobile viewport projects reuse the
  same Chromium binary CI already caches, so mobile coverage costs no new browser
  download.

### Path B fit — moderate on data, poor on UI

- **Reusable as-is:** every server route, `@storybook/shared`, the auth token model,
  the UUID cart-session model, `lib/cost.ts`.
- **Not reusable:** all 4,550 lines of view code, the Tailwind v4 setup, the
  `dark:` variant strategy, React Router v7 routing, `BookSpread`'s CSS-driven page
  spread.
- **New infrastructure required:** Expo project + EAS build, secure storage, deep
  linking, push credentials, IAP entitlements, a second CI pipeline, a second e2e
  strategy (Detox or Maestro — Playwright does not cover RN).
- **Server changes RN would force:** none for correctness, but two would become
  advisable — token refresh (mobile sessions are long-lived, the current model is a
  bearer token in web storage) and image delivery sizing (`/illustrations/*` is served
  full-size by Express today, which is wasteful over cellular).

---

## 5. Side-by-side

| Dimension | PWA now | Native RN later |
|---|---|---|
| Time to first value | ~1 week | 8–14 weeks to parity |
| New dependencies | 1 build-time (`vite-plugin-pwa`) | An entire second toolchain |
| Recurring cash cost | $0 | $99/yr + $25 + 15–30% of digital sales via IAP |
| Release cadence | Continuous (existing Pages workflow) | Gated on store review |
| Code reuse from today | ~100% | ~30% (logic and contracts, not UI) |
| Reaches in-app-browser social traffic | Yes, same session | No |
| Reaches MDM-locked school devices | Yes | Usually not |
| Push notifications | Android/desktop yes; iOS only when home-screen installed | Yes, first class |
| Offline | App shell + explicit cached cart | Full, with local DB |
| App-store discovery | None | Real, but requires ASO investment to matter |
| Reversibility | Trivially removable | A sunk second codebase |

---

## 6. Blocking context — the deploy is down

Both paths are currently gated on operational reality, and this is not a footnote:

- **[#77](https://github.com/slickG0ose/storybook/issues/77)** — the Render service is
  suspended (503, `x-render-routing: suspend-by-user`) and GitHub Pages is disabled at
  the repo level. **There is no live HTTPS origin.**
- **[#78](https://github.com/slickG0ose/storybook/issues/78)** — the free Postgres is
  deleted on **2026-09-14** unless acted on, decision due **2026-09-09**.

A service worker requires a secure context. `localhost` counts, so **all PWA
development and CI verification is unblocked** — the plugin config, manifest
correctness, SW registration, precache behaviour, and offline cart all verify against
a local build. What *cannot* be verified until #77 resolves:

- A real install prompt on a real Android device
- iOS "Add to Home Screen" and standalone-mode launch
- Lighthouse PWA audit against the deployed origin under the `/storybook/` base
- That the manifest `scope` matches whatever origin Pages actually serves

The spec at `.code-captain/specs/mobile-pwa/spec.md` is deliberately sequenced so no
task is *blocked* by #77 — the deploy-dependent checks are isolated into an explicitly
deferred verification list rather than smeared across every task's done criteria.

For Path B, #77/#78 are harder blockers: shipping an app store binary that points at a
suspended API is not a thing you can do.

---

## 7. Recommendation

**Build the PWA slice now.** It is cheap, reversible, verifiable in CI, and it fixes a
present-tense defect — the cart and checkout pages have literally zero responsive
handling on a phone, which is a money-path bug independent of any mobile strategy.

**Do not start React Native.** Re-evaluate against the five triggers in §0. The
decision costs nothing to defer: ADR-003 already guarantees an RN client would type
itself for free off `@storybook/shared`, so there is no optionality being spent by
waiting.

**Cheapest next step after the PWA lands:** instrument mobile traffic share and mobile
conversion rate. Every argument in this document is currently reasoning from segment
demographics rather than from this product's own analytics, because this product has
no analytics. That is the single highest-leverage gap in the decision.

---

## Sources

- `docs/marketing-research.md` §3 (segments), §4 (pricing), §5 (channels)
- `docs/backlog.md:39–58` (ADR-003 / OPS.3 — Zod as source of truth, `zod-to-openapi` deferral)
- `.code-captain/product/decisions.md` — ADR-003, ADR-004 (theater mode reader)
- `docs/deploy-spike-render.md`, issues #77 and #78 (deploy state)
- Code inspected 2026-08-16: `client/vite.config.ts`, `client/index.html`,
  `client/src/context/CartContext.tsx`, `client/src/components/{Navbar,BookCard,BookSpread}.tsx`,
  `client/src/pages/{Login,Register,Cart,Checkout,CreateBook}.tsx`,
  `e2e/playwright.config.ts`, `.github/workflows/{pr-ci,deploy-pages}.yml`
