# Error toast host — one visible failure surface for #115 and #114

> Status: Draft
> Last updated: 2026-08-29
> Backlog: [#115](https://github.com/slickG0ose/storybook/issues/115) (window.alert, 8 call sites) · [#114](https://github.com/slickG0ose/storybook/issues/114) (illustration errors invisible when scrolled)

## Problem

Two issues, one defect: an action fails and the user does not reliably see it. #115 delivers six admin failures and two "take this book out of the catalog" failures through `window.alert()` — a blocking, unstyleable, un-themeable browser dialog that reads as unfinished software. #114 delivers illustration-generation failures into a `<span>` in the book-edit header; the buttons that trigger those failures (per-page **Regenerate** in the reader view, the **Redo** controls in `BookSpread`) sit hundreds of pixels below it, so a user who has scrolled to the page they are re-rolling gets no signal at all. Both want the same thing the app does not have: a non-blocking notification surface that is visible regardless of scroll position and honours the theme.

## Constraints

- **Client zone only.** No Prisma migration, no Zod schema in `@storybook/shared`, no new `package.json` entry. Nothing in the design requires one — every failure message already exists as a client-side string.
- **Dark-mode parity is load-bearing** (`docs/conventions/client.md`). Every element of the new surface needs a `dark:` partner; `dark-mode-parity-check` will be run against the diff.
- **ADR-011 decision 5 is an app-wide layout invariant:** "`UpdateToast` remains the app's only bottom-fixed surface." It is pinned by computed-style assertions in `e2e/tests/mobile/narration.spec.ts:68` and `e2e/tests/mobile/edit-published.spec.ts` (`expectNotFixed`). Both assertions must stay green **without being edited**.
- **`UpdateToast` is not refactored here.** It is driven by `useRegisterSW` state rather than imperative calls; folding it into an error host would couple a PWA concern to a failure concern. Recorded as a `Deferred:` line, not done.
- **No new modal contract.** ADR-004 decision 2 and `PublishStateBar`'s header comment already rejected overlays for this class of UI: focus trap, escape-to-close, scroll lock, `aria-modal`, and a portal is too much machinery for a sentence of text.
- Tests assert on **rendered text**, never on a spy over `window.alert`.

## Proposed shape

A `ToastProvider` holds a small queue of failure messages and renders its own `ErrorToastHost`. Any component calls `const { showError } = useToast()` and passes the string it would previously have handed to `window.alert()` or written into a local error state. The host paints each message as a fixed-position card that cannot scroll away.

**State lives in a React context, not a module singleton.** The codebase already shares cross-cutting state through exactly one idiom — `ThemeContext`, `AuthContext`, `CartContext`, chained in `main.tsx` — and `docs/conventions/testing.md` documents both ways of handling that in tests (wrap the real provider, or `vi.mock` the hook with a typed factory). Every call site here is an event handler inside a component, so nothing needs to raise a toast from module scope, which is the one thing a context cannot do and a store module can. A module singleton would also carry state across tests in the same file unless explicitly reset — a footgun this codebase does not currently have anywhere. `ToastContextValue` is exported so `vi.mock` factories can be annotated per the convention.

**The provider renders the host itself.** `ToastProvider` returns `<>{children}<ErrorToastHost /></>` rather than exposing the host for separate mounting. Mounting the provider without the host would be a silent failure mode — `showError` would succeed and nothing would appear — and it also means every test that wraps a page in the real provider gets the rendered text for free, which is exactly the assertion #115 asks for. `main.tsx` gains one wrapper, directly inside `ThemeProvider` and outside `AuthProvider`, so any provider or page can raise a toast. It depends only on the router (for `useLocation`), which is already outermost.

**The host is top-anchored, and that is the load-bearing positioning decision.** `UpdateToast` is `fixed inset-x-3 bottom-3 z-50`, and ADR-011 decision 5 made "nothing else is bottom-fixed" an invariant precisely because two independently-authored fixed surfaces fighting over the same ~60 px of a phone screen is a bug generator, and z-index tuning between them is worse. Anchoring the error host below the sticky navbar (`fixed inset-x-3 top-20 z-40`, `sm:` restoring a right-aligned card) means the collision cannot occur, the invariant stays literally true, and both e2e assertions that pin it pass untouched. It also makes co-occurrence legible: a failure at the top, a "new version is ready" offer at the bottom, neither obscuring the other. The cost is a dismiss button further from a phone thumb — accepted, because these toasts are read far more often than they are dismissed, and they also clear themselves on navigation. Everything else about the visual treatment follows `UpdateToast`: full-bleed compact card at mobile width, desktop card restored at `sm:`, `min-h-11` on the dismiss control, `transition-colors`, class strings written out per element so each light class and its `dark:` partner sit in one literal.

**Errors are assertive, and each toast owns its own `role="alert"`.** `UpdateToast` is `role="status"` / `aria-live="polite"` because it is an offer the user may ignore. A failed action is not an offer — it is the answer to something the user just did, and it must interrupt. `role="alert"` carries an implicit `aria-live="assertive"`, so the wrapper is a plain `<div data-testid="error-toast-host">` with no live semantics of its own; a live region wrapping `role="alert"` children double-announces in several screen readers. The code says why, per ruling 2.

### Rulings on the four open questions

**1. Persist until dismissed. No auto-dismiss timer.** An assertive announcement that vanishes mid-sentence is worse than no announcement: a screen-reader user gets a truncated interruption with no way to re-read it, and WCAG 2.2.1 (Timing Adjustable) is squarely about content that expires on its own. A user who alt-tabs during a 120 s Fal request and returns to a dismissed toast has learned nothing at all. The costs of persistence — screen clutter, stale messages — are handled by the cap, the dedupe, and the route-change clear below, all of which are deterministic and testable in a way a timer is not.

**2. A stack, newest first, capped at 3, deduped by message.** Admin can fire several failures in quick succession (three rows toggled while offline), and a single-slot toast would silently discard all but the last, which is the same "you did not see the failure" defect in a new costume. The cap keeps the stack from walking off-screen; when a fourth arrives the oldest is dropped. Dedupe is by exact message text: three identical `"Couldn't update featured state…"` messages are one fact, and repeating it three times is noise, not information. Newest first means the newest message is nearest the top anchor.

**3. Toasts clear on route change.** `"Couldn't restore that user."` is meaningless on `/cart`. The provider watches `useLocation().pathname` and empties the queue when it changes — a rule that is one `useEffect` and one test, and that keeps persistence (ruling 1) from becoming permanence.

**4. For #114, the toast replaces the inline block; it does not supplement it.** The `{illustrateError && <span…>}` in the book-edit header is deleted and the state with it. Supplementing would state one failure twice in two places with different visual weight — the exact thing the task brief warns against — and would also break three existing `BookDetail` tests that use `screen.getByText`, since the string would match two nodes. **Only `illustrateError` moves.** `portraitError` renders inside the character card whose button raised it, `reviseError` renders inside `BookSpread`'s revise panel, `orphanRowError` renders on the admin row being deleted, and `PublishStateBar`'s `error` prop renders inside the bar — all four are already at the point of action and are already themeable. Moving them would trade a precise location for a generic one.

### Correction to #115's stated scope

The issue names three test files that "assert on it". Verified against the tree, that list is wrong in both directions:

- `client/src/components/__tests__/PublishStateBar.test.tsx:156` uses `getByRole('alert')` against `PublishStateBar`'s **own inline** error node. It has nothing to do with `window.alert` and **needs no change**.
- `client/src/pages/__tests__/Admin.test.tsx` has **no** `window.alert` spy at all. Its `getByRole('alert')` at line 471 is the orphan-row inline error. The six admin alert paths are currently **untested** — this work adds coverage rather than rewriting it.
- `client/src/pages/__tests__/MyBooks.test.tsx:241` is the only real alert spy in the suite, and the only assertion that must be rewritten.

Three files still change, but they are `MyBooks.test.tsx`, `Admin.test.tsx`, and `BookDetail.test.tsx` — the last because those pages now require the provider in their render tree.

### Schema / contract changes

**None.** No route, no Prisma field, no Zod schema in `@storybook/shared`, no new dependency. There is no OPS.3 wire-shape obligation attached to this work, because no server response shape is created or changed. If any task appears to need one, that is a signal the task has drifted out of scope — stop and re-spec rather than adding it quietly.

### Data flow

```
user clicks a failing action (Admin restore / MyBooks withdraw / BookDetail regenerate)
  → page handler catches !res.ok or a thrown fetch error
  → showError("Couldn't …")            [context, no network]
  → ToastProvider queue: dedupe by text → prepend → truncate to 3
  → ErrorToastHost renders one role="alert" card per entry, fixed below the navbar
  → user reads it; dismisses it, or navigates and the queue empties
```

All state is in-memory and per-session. Nothing is persisted, nothing is fetched, nothing touches `localStorage` — in particular **not** `storybook-session`, `storybook-auth`, or `storybook-theme`.

### Files likely touched

- `client/src/context/ToastContext.tsx` — **new.** `ToastProvider`, `useToast`, exported `ToastContextValue`; queue, dedupe, cap, route-clear.
- `client/src/components/ErrorToastHost.tsx` — **new.** Presentation only; reads the context, renders the fixed stack.
- `client/src/main.tsx` — wrap `<AuthProvider>` in `<ToastProvider>`.
- `client/src/pages/MyBooks.tsx` — 2 `window.alert` call sites → `showError` (lines 65, 70).
- `client/src/pages/Admin.tsx` — 6 `window.alert` call sites → `showError` (lines 230, 236, 249, 255, 316, 322).
- `client/src/pages/BookDetail.tsx` — delete `illustrateError` state (line 101) and its inline render (lines 730–732); `handleIllustrate`'s catch calls `showError`.
- `client/src/context/__tests__/ToastContext.test.tsx` — **new.** Queue semantics.
- `client/src/components/__tests__/ErrorToastHost.test.tsx` — **new.** Rendering, a11y, dark parity.
- `client/src/__tests__/noWindowAlert.test.ts` — **new.** Source-tree guard for #115's "Done when".
- `client/src/pages/__tests__/{MyBooks,Admin,BookDetail}.test.tsx` — provider wrap + assertions on visible text.
- `e2e/tests/mobile/error-toast.spec.ts` — **new.** Both themes, both mobile projects, overflow + tap targets.

## Alternatives considered

### A module-level store with `useSyncExternalStore`

**Pros:** callable from outside React (a fetch wrapper, an error boundary, `apiBase.ts`); no provider to forget; no test wrapping.
**Cons:** a second state-sharing idiom in a codebase that has exactly one; module state survives between tests in a file unless explicitly reset; the escape hatch it buys is unused — all nine call sites are event handlers inside components.
**Why rejected:** it solves a problem this feature does not have, at the price of a precedent every future contributor has to choose between. Held as the upgrade path if a non-component caller (a global fetch wrapper, say) ever needs to raise a toast.

### Generalise `UpdateToast` into the shared host now

**Pros:** one bottom-fixed surface, one visual language, no positioning question at all.
**Cons:** `UpdateToast` is driven entirely by `useRegisterSW`'s `needRefresh` tuple, not by imperative calls; merging means either the host imports a PWA hook or the PWA concern learns about a generic queue. It also puts a service-worker dependency in the render path of every error message, and `virtual:pwa-register/react` is a virtual module that client tests would then have to stub everywhere.
**Why rejected (held as upgrade path):** recorded as a `Deferred:` line. The natural trigger is a third notification kind — at that point one host with a `kind` discriminator is clearly cheaper than three.

### Bottom-anchored error toasts stacked above `UpdateToast`

**Pros:** matches the existing toast's position exactly; thumb-reachable dismiss on mobile.
**Cons:** requires either z-index negotiation between two independently-authored fixed surfaces — which ADR-011 decision 5 explicitly names as a bug generator — or a shared offset custom property, which means editing `UpdateToast` after all. It would also make the two `position !== 'fixed'` e2e assertions read as narrower than their comments claim.
**Why rejected:** the invariant is cheap to keep and expensive to re-litigate.

### Scroll-to-error on failure (one of #114's own suggestions)

**Pros:** no new component; reuses the error region that already exists.
**Cons:** it yanks the viewport away from what the user was looking at, it is hostile on a phone, it does nothing for #115, and a user who scrolls back down loses the message again.
**Why rejected:** it treats the symptom (the message is off-screen) rather than the cause (the message is in document flow).

### Per-page inline error regions (#115's other suggestion)

**Pros:** no shared state at all; each page owns its own copy.
**Cons:** three near-identical implementations to keep in dark-mode parity, and on `/admin` the region would sit above a long scrolling table — reintroducing #114's exact defect on a second page.
**Why rejected:** the two issues share a cause; two solutions would re-derive it.

### Auto-dismiss after N seconds

**Pros:** self-cleaning; the conventional toast behaviour users expect.
**Cons:** an assertive announcement that expires is unusable for a screen-reader user mid-sentence and for anyone who looked away during a long request; timers make tests time-dependent.
**Why rejected:** see ruling 1. The route-change clear provides the self-cleaning without the failure mode.

## Success criteria

- `grep -rn "window.alert" client/src` returns nothing outside `__tests__` — pinned by `client/src/__tests__/noWindowAlert.test.ts`, not by a human running grep.
- `MyBooks.test.tsx` asserts the withdrawal-failure message is **visible in the DOM**; no `vi.spyOn(window, 'alert')` remains in the client suite.
- `Admin.test.tsx` covers all three previously-untested admin failure paths (restore user, restore book, toggle featured) by visible text, and its existing orphan-row `getByRole('alert')` test still passes.
- A failure raised while scrolled to the bottom of `/book/:id` is visible without scrolling — asserted in `e2e/tests/mobile/error-toast.spec.ts` at both mobile viewports, in both themes.
- `e2e/tests/mobile/narration.spec.ts` and `e2e/tests/mobile/edit-published.spec.ts` pass **unmodified** — the bottom-fixed invariant survives.
- `cd client && npm test`, `npx tsc --noEmit`, lint, and build all green; `cd e2e && npm test` green.

## Out of scope

- Retry affordances ("Try again" inside the toast).
- An error-reporting/telemetry backend.
- Success, info, or warning toast variants. `showError` is the only entry point and `Toast` carries no `kind` field; adding one on spec is how a two-state component becomes a design system.
- Merging `UpdateToast` into the host.
- Migrating `portraitError`, `reviseError`, `orphanRowError`, or `PublishStateBar`'s `error` prop — all already at the point of action.
- `window.confirm` at its five remaining call sites. Confirmations are a different problem (they need a return value) and `MyBooks.tsx:52` already documents why its confirm stays.
- Toast queue persistence across reloads.

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| A second fixed surface breaks ADR-011 decision 5's invariant | Host is **top**-anchored at `z-40`, below the `z-50` sticky navbar. `UpdateToast` remains the only *bottom*-fixed surface; both pinning e2e assertions stay green unmodified. Task 8 files the ADR amendment recording that the invariant now reads "the only bottom-fixed surface" and why. |
| `getByRole('alert')` becomes ambiguous once a toast can co-exist with an inline `role="alert"` (Admin orphan rows, `PublishStateBar`) | Host carries `data-testid="error-toast-host"`; every toast assertion is scoped with `within(screen.getByTestId('error-toast-host'))`. Never a bare `getByRole('alert')` for toast text. |
| Three page test files break at once when `useToast` starts throwing outside its provider | Tasks 3–5 each wrap their own page's render helper in the **real** `ToastProvider` (not a mock) in the same task that introduces the call — the wrap and the call land together, so no task leaves the suite red. |
| Dark-mode parity on a brand-new surface | Class strings written out per element (the `PublishStateBar` convention that `dark-mode-parity-check` reads), plus an RTL assertion on the card's className and an e2e pass in both themes. |
| Assertive live region double-announcing | `role="alert"` on each toast card only; the wrapper has no `aria-live`. Stated in a code comment so it is not "tidied" later. |
| Toast could overlap the sticky navbar or overflow at 360 px | `top-20` clears the 64 px navbar; `e2e/tests/mobile/error-toast.spec.ts` runs `expectNoHorizontalOverflow` and `expectTapTargets` under both mobile projects. |
| The e2e spec needs a *failing* illustration call — a paid API | Failure is injected with `page.route` (the established pattern in `e2e/tests/_editPublished.ts`, `admin.spec.ts`, `version-history.spec.ts`). **No paid call is made, and none may be added.** |
| Scope creep into a general notification system | `showError(message: string)` is the whole API. No `kind`, no options bag, no timeout parameter. |
| Guardrails | None of CLAUDE.md's confirm-first guardrails are touched: no `data.json`, no seed shape, no Claude model or SDK version, no paid API, no auth/session change, no deleted tests. The session UUID model is untouched — this feature reads and writes no `localStorage` key. |

## ADR-worthy decisions

- [ ] **Toast state lives in a React context provider that renders its own host**, not a module singleton and not per-page inline regions — write via `/create-adr` after spec approval.
- [ ] **Error toasts are top-anchored at `z-40`; ADR-011 decision 5's invariant now reads "`UpdateToast` is the only *bottom*-fixed surface"** — an amendment to a standing invariant, and the reason the two `position !== 'fixed'` e2e assertions still mean what their comments say.
- [ ] **Failure toasts persist until dismissed or until the route changes; no auto-dismiss timer** — the accessibility reasoning (assertive announcements must not expire) is what a future "add a 5 s timeout" PR needs to argue against.
- [ ] **`illustrateError`'s inline block is replaced, not supplemented**, and the four other inline error regions deliberately stay inline because they are already at the point of action.
- [ ] `Deferred:` merging `UpdateToast` into the shared host; success/info/warning variants; retry affordances; error telemetry; toast persistence across reloads; migrating the remaining inline error regions. Each is listed in **Out of scope** with its reasoning, and the natural trigger for the first is a third notification kind.
