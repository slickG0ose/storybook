# Error toast host — task plan

> Spec: [spec.md](spec.md)
> Status: Draft
> Last updated: 2026-08-29

## Overview

Eight tasks, client zone plus one e2e spec. Tasks 1–2 build the surface (context, then host + mount); tasks 3–5 migrate the three call-site pages one at a time, each landing its own test wrap in the same commit so the suite is never red between tasks; task 6 pins #115's "no `window.alert` remains" mechanically; task 7 is the mobile e2e discharge; task 8 is the ADR follow-up. Tasks 3, 4, and 5 touch disjoint files and are parallel-safe with each other once task 2 lands — the natural cut if this is split across branches.

Work happens on a fresh branch off `master` (suggested `feat/error-toast-host`), not on `chore/og-image-absolute-url`.

## Cross-cutting constraints

- **Wire-shape:** none. No route, no Prisma field, no Zod schema in `@storybook/shared`, no new `package.json` entry. If a task appears to need one, stop and re-spec — that is scope drift, not a missing detail.
- **Auth middleware order:** not applicable; no server change.
- **Dark-mode parity:** every element of `ErrorToastHost` needs a `dark:` partner. Write class strings out per element (the `PublishStateBar.tsx` convention) so each light class and its partner sit in one literal — that is what `dark-mode-parity-check` reads.
- **Migrations:** none.
- **ADR-011 decision 5 (`UpdateToast` is the only bottom-fixed surface):** the host is **top**-anchored. `e2e/tests/mobile/narration.spec.ts` and `e2e/tests/mobile/edit-published.spec.ts` must pass **without being edited**. If you find yourself editing either assertion, you have anchored the host at the bottom — stop.
- **Never assert toast text with a bare `getByRole('alert')`.** Inline `role="alert"` nodes already exist in `PublishStateBar` and on admin orphan rows. Scope with `within(screen.getByTestId('error-toast-host'))`.
- **Never spy on `window.alert`.** Assert on rendered text.
- **Guardrails touched:** none. No paid API, no auth/session change, no seed shape, no model or SDK change, no deleted tests. If a task seems to require one, surface it before acting.

## Tasks

### Task 1 — `ToastContext`: queue, dedupe, cap, route-clear

**Zone:** client
**Depends on:** none
**Parallel-safe with:** none (everything else builds on it)

**Files to add or change:**
- `client/src/context/ToastContext.tsx` — new; provider + hook + exported value type.
- `client/src/context/__tests__/ToastContext.test.tsx` — new; queue semantics driven through a probe component.

**Signatures / shapes:**

```ts
// client/src/context/ToastContext.tsx
export interface Toast {
  id: string;
  message: string;
}

export interface ToastContextValue {
  toasts: Toast[];
  /** Raise an assertive failure notice. No-ops if an identical message is already showing. */
  showError: (message: string) => void;
  dismiss: (id: string) => void;
}

export const MAX_TOASTS = 3;

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element;
/** Throws outside the provider, like useTheme/useAuth/useCart. */
export function useToast(): ToastContextValue;
```

Rules the implementation must obey, each with a one-line comment saying why:

1. **Ids come from a module-level counter** (`` `toast-${++seq}` ``), not `crypto.randomUUID()` — deterministic under Vitest and independent of a global that jsdom does not guarantee. The counter is the only module-level state; it is write-only and never read as state.
2. **Dedupe by exact `message`.** If the message is already in `toasts`, `showError` returns without changing state (same array identity — do not re-render).
3. **Newest first.** Prepend, then truncate to `MAX_TOASTS`, dropping the oldest.
4. **Clear on route change.** `useEffect` on `useLocation().pathname` empties the queue. This is what keeps "persist until dismissed" from becoming "persist forever" (spec ruling 3).
5. **No timers.** Nothing in this file may call `setTimeout`. The reason (an assertive announcement that expires is unusable mid-sentence for a screen-reader user; WCAG 2.2.1) goes in the file header comment, so a future "add auto-dismiss" change has to argue with it.
6. Provider returns `<>{children}<ErrorToastHost /></>` — wired in Task 2; for this task it may return `{children}` only, and Task 2 adds the host. Say so in a `TODO` the next task removes, or land Tasks 1–2 as one commit.

**Tests to write:**
- `client/src/context/__tests__/ToastContext.test.tsx` — via a probe component with buttons that call `showError`/`dismiss` and render `toasts.map(t => t.message)`:
  - a raised message appears in the queue;
  - a second, identical message does not add a second entry;
  - two different messages both appear, newest first;
  - a fourth distinct message drops the oldest (`toasts.length === MAX_TOASTS`);
  - `dismiss(id)` removes exactly that entry;
  - navigating (`MemoryRouter` + a `<Link>` or `useNavigate` in the probe) empties the queue;
  - `useToast()` outside `ToastProvider` throws.
- Wire-shape assertion required: **no** — no server route.

**Done when:** those tests pass, `cd client && npm test` green, `npx tsc --noEmit` clean.

---

### Task 2 — `ErrorToastHost` + mount in `main.tsx`

**Zone:** client
**Depends on:** Task 1
**Parallel-safe with:** none

**Files to add or change:**
- `client/src/components/ErrorToastHost.tsx` — new; presentation only, reads `useToast()`.
- `client/src/context/ToastContext.tsx` — provider renders `<ErrorToastHost />` after `{children}`.
- `client/src/main.tsx` — wrap `<AuthProvider>` in `<ToastProvider>` (inside `ThemeProvider`, outside `AuthProvider`).
- `client/src/components/__tests__/ErrorToastHost.test.tsx` — new.

**Signatures / shapes:**

```tsx
// Renders nothing at all when the queue is empty — same posture as UpdateToast.
// Positioning: top-anchored, deliberately NOT bottom (spec: ADR-011 decision 5 keeps
// UpdateToast as the only bottom-fixed surface; two independently-authored fixed
// surfaces in the same 60px of a phone screen is the bug that invariant prevents).
<div data-testid="error-toast-host" className="fixed inset-x-3 top-20 z-40 sm:inset-x-auto sm:right-6 sm:top-20 sm:w-96 flex flex-col gap-2">
  {toasts.map(t => (
    <div
      key={t.id}
      role="alert"            /* implies aria-live="assertive": this is the answer to
                                 something the user just did, not an offer like
                                 UpdateToast's role="status" / aria-live="polite" */
      data-testid="error-toast"
      className="... border-red-200 dark:border-red-800 bg-white dark:bg-gray-800 ..."
    >
      <AlertTriangle size={16} aria-hidden="true" className="..." />
      <p className="...">{t.message}</p>
      <button aria-label="Dismiss error" onClick={() => dismiss(t.id)} className="min-h-11 ...">
        <X size={18} />
      </button>
    </div>
  ))}
</div>
```

- The wrapper carries **no** `aria-live` — a live region wrapping `role="alert"` children double-announces. Comment it.
- `top-20` clears the `sticky top-0 z-50` `h-16` navbar; `z-40` keeps the host under the navbar and under the `focus:z-[60]` skip link.
- Mirror `UpdateToast`'s treatment otherwise: full-bleed compact card at mobile width, `sm:` desktop card, `min-h-11` dismiss target, `transition-colors`, rounded card with a shadow.
- Error tone, not amber: red border/icon in both themes, with `dark:` partners on every colour class.

**Tests to write:**
- `client/src/components/__tests__/ErrorToastHost.test.tsx` (render inside `MemoryRouter` + `ToastProvider`, drive through a probe that calls `showError`):
  - renders nothing when the queue is empty (`queryByTestId('error-toast-host')` is null);
  - a raised message renders inside the host, and the card has `role="alert"`;
  - the host wrapper has no `aria-live` attribute;
  - the dismiss button has the accessible name `Dismiss error` and removes the card when clicked;
  - three messages render three cards, newest first;
  - dark parity smoke: the card's `className` contains a `dark:` partner for each of background, border, and text (assert on the string, the same shape `dark-mode-parity-check` reads).
- Wire-shape assertion required: **no**.

**Manual verify:**
- Not meaningfully verifiable until a real call site exists — do it at the end of Task 5, in both light and dark mode.

**Done when:** listed tests pass, `cd client && npm test` green, `npx tsc --noEmit` clean, `npm run build` in `client/` succeeds.

---

### Task 3 — MyBooks: 2 alerts → toasts

**Zone:** client
**Depends on:** Task 2
**Parallel-safe with:** Tasks 4, 5

**Files to add or change:**
- `client/src/pages/MyBooks.tsx` — replace `window.alert` at lines 65 and 70 with `showError(...)`, same copy verbatim. `window.confirm` at line 52 **stays** — the header comment there already explains why, and it is out of scope.
- `client/src/pages/__tests__/MyBooks.test.tsx` — wrap `renderMyBooks` in the real `ToastProvider` (inside `MemoryRouter`); rewrite the alert-spy test.

**Signatures / shapes:**

```ts
const { showError } = useToast();
// ...
} else {
  showError("Couldn't take that book out of the catalog. It may already be a draft — refresh to see the latest state.")
}
} catch {
  showError("Couldn't take that book out of the catalog. Check your connection and try again.")
}
```

**Tests to write:**
- `client/src/pages/__tests__/MyBooks.test.tsx`:
  - rewrite `'explains a failed withdrawal in the same vocabulary'` (currently at line ~238, using `vi.spyOn(window, 'alert')` at line 241) to assert the message is visible: `within(screen.getByTestId('error-toast-host')).getByText(/take that book out of the catalog/i)`. Keep the existing "still Published — the card did not lie" assertion.
  - **Delete the `alertSpy` entirely.** No `vi.spyOn(window, 'alert')` may remain in this file.
  - add: the network-failure branch (fetch rejects) raises the "Check your connection" toast.
- Wire-shape assertion required: **no**.

**Done when:** `cd client && npm test` green, `npx tsc --noEmit` clean, and `grep -rn "spyOn(window, 'alert')" client/src/pages/__tests__/MyBooks.test.tsx` returns nothing.

---

### Task 4 — Admin: 6 alerts → toasts, and three untested paths get tests

**Zone:** client
**Depends on:** Task 2
**Parallel-safe with:** Tasks 3, 5

**Files to add or change:**
- `client/src/pages/Admin.tsx` — replace `window.alert` at lines 230, 236, 249, 255, 316, 322 with `showError(...)`, copy verbatim. The three `window.confirm` calls stay. `orphanRowError` stays inline — it is already on the row being acted on.
- `client/src/pages/__tests__/Admin.test.tsx` — wrap `renderAdmin` (line ~290) in the real `ToastProvider`; add three failure-path tests.

**Signatures / shapes:** identical substitution pattern to Task 3. `useToast()` is called at the top of the `Admin` component, above the `authLoading` / `!user` / `role !== 'admin'` early returns, so hook order is unconditional.

**Tests to write:**
- `client/src/pages/__tests__/Admin.test.tsx` — three new tests, all scoped with `within(screen.getByTestId('error-toast-host'))`:
  - restore-user failure (non-ok response) shows `/Couldn't restore that user/i` and the row keeps its deleted state;
  - restore-book failure shows `/Couldn't restore that book/i`;
  - toggle-featured failure shows `/Couldn't update featured state/i` and the row's featured state does not flip.
  - one of the three should exercise the `catch` branch (fetch rejects) rather than the `!res.ok` branch, so both messages per handler are covered.
- **Regression:** the existing `'shows an inline error on the row when the delete fails'` test (line ~458, bare `getByRole('alert')` at line 471) must still pass unmodified. If it starts failing on multiple matches, a toast is being raised where an inline row error belongs — fix the source, not the test.
- Wire-shape assertion required: **no**.

**Done when:** `cd client && npm test` green, `npx tsc --noEmit` clean, and `grep -n "window.alert" client/src/pages/Admin.tsx` returns nothing.

---

### Task 5 — BookDetail: illustration errors move to the toast (#114)

**Zone:** client
**Depends on:** Task 2
**Parallel-safe with:** Tasks 3, 4

**Files to add or change:**
- `client/src/pages/BookDetail.tsx`:
  - delete the `illustrateError` state (line 101) and both `setIllustrateError` calls in `handleIllustrate` (~lines 509, 534);
  - delete the inline render at lines 730–732 (`{illustrateError && <span className="text-sm text-red-500 dark:text-red-400">…</span>}`);
  - `handleIllustrate`'s `catch` calls `showError(err instanceof Error ? err.message : 'Illustration failed')`.
  - **Do not touch** `portraitError`, `reviseError`, or `pdfError` — all three render at their point of action (spec ruling 4).
- `client/src/pages/__tests__/BookDetail.test.tsx` — wrap `renderBookDetail` in the real `ToastProvider`; scope the three existing illustrate-error assertions to the host.

**Signatures / shapes:** no new types. `showError` replaces a `useState` setter one-for-one; the error strings come from the existing `errorMessageFromResponse` helper and are unchanged.

**Tests to write:**
- `client/src/pages/__tests__/BookDetail.test.tsx` — the three existing tests at ~lines 551, 566, 583 (`non-JSON body`, `server error field`, `empty 2xx`) keep their exact expectations but assert inside the host: `within(screen.getByTestId('error-toast-host')).getByText(/…/i)`. They currently pass with a bare `getByText`, which would also pass if the message were still inline — scoping them is what makes them prove the fix.
- Add: a per-page regenerate failure (call the same mocked `POST /illustrate` from a page-level control) raises a toast — this is #114's actual repro path, and the header block it used to render into no longer exists.
- Wire-shape assertion required: **no**.

**Manual verify:**
- `/book/:id` as owner on a draft, in **both light and dark mode**: force an illustrate failure, scroll to the bottom of the page, confirm the toast is visible and legible, dismiss it, and confirm navigating away clears any remaining toast. This is the aesthetic half of done-criterion #2; Task 7 covers the correctness half.

**Done when:** `cd client && npm test` green, `npx tsc --noEmit` clean, `grep -n "illustrateError" client/src` returns nothing.

---

### Task 6 — Pin "no `window.alert` in client source"

**Zone:** client
**Depends on:** Tasks 3, 4, 5
**Parallel-safe with:** Task 7

**Files to add or change:**
- `client/src/__tests__/noWindowAlert.test.ts` — new.

**Signatures / shapes:**

```ts
// Reads the real source tree. Use the path form, not new URL(..., import.meta.url) —
// Vite's asset-import-meta-url transform rewrites the latter and it throws under Vitest.
// Worked example: client/src/__tests__/heroAsset.test.ts.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
// Walk *.ts/*.tsx under SRC, skipping any path segment named __tests__.
// Assert: no file contains `window.alert(` or a bare `alert(` call.
```

Report offending files by path in the failure message — a bare boolean tells the next
contributor nothing.

**Tests to write:**
- `client/src/__tests__/noWindowAlert.test.ts` — asserts the offender list is empty. This is issue #115's "Done when" turned into a check that runs on every PR instead of a grep someone remembers to run.
- Wire-shape assertion required: **no**.

**Done when:** the test passes against the migrated tree, and fails if `window.alert(` is reintroduced into a non-test file (verify by temporarily adding one locally, then reverting — do not commit the probe).

---

### Task 7 — Mobile e2e: the toast is visible from the bottom of the page, in both themes

**Zone:** e2e
**Depends on:** Task 5
**Parallel-safe with:** Task 6

**Files to add or change:**
- `e2e/tests/mobile/error-toast.spec.ts` — new. Model it on `e2e/tests/mobile/edit-published.spec.ts`.

**Signatures / shapes:**

```ts
import { expectNoHorizontalOverflow, expectTapTargets, forEachTheme, PRIMARY_TAP_MIN } from './_helpers';
import { BOOK_ID, ILLUSTRATED_PAGES, installBookMocks, registerOwner, seedAuth, deleteUsers } from '../_editPublished';

// installBookMocks({ status: 'draft', createdBy: user.id, pages: ILLUSTRATED_PAGES, token })
// then this spec's own failure injection — NO paid call is made:
await page.route(`**/api/books/${BOOK_ID}/illustrate`, route =>
  route.fulfill({ status: 500, contentType: 'application/json',
                  body: JSON.stringify({ error: 'Fal image request timed out after 120s' }) }));

const host = page.getByTestId('error-toast-host');
```

Shape of the run, inside `forEachTheme`:
1. Seed auth, install mocks, go to `/book/${BOOK_ID}`.
2. Scroll to the bottom of the page (`page.mouse.wheel` or `scrollIntoViewIfNeeded` on the footer) — this is #114's repro condition.
3. Click a page-level regenerate/redo control.
4. `await expect(host).toBeVisible()` and assert the message text — **without scrolling back up**.
5. `expectNoHorizontalOverflow(page)`.
6. `expectTapTargets(page, '[data-testid="error-toast-host"] button', PRIMARY_TAP_MIN)` — the explicit control list, per ADR-009, never "all buttons".
7. Assert the host does not overlap the navbar: its bounding box `y` is greater than or equal to the navbar's `y + height`.
8. Dismiss, assert the host is gone; then navigate and assert a fresh toast does not survive the route change.

Set `test.setTimeout(120_000)` — two themes × two mobile projects, same shape as the neighbouring specs.

**Tests to write:**
- `e2e/tests/mobile/error-toast.spec.ts` — as above.
- **Regression, run explicitly:** `e2e/tests/mobile/narration.spec.ts` and `e2e/tests/mobile/edit-published.spec.ts` pass **unmodified**. They assert `position !== 'fixed'` on the grounds that `UpdateToast` is the only bottom-fixed surface; a top-anchored error host keeps that true. If either goes red, the host was anchored wrong.
- Wire-shape assertion required: **no**.

**Manual verify:**
- Covered by the spec run itself for the correctness half of done-criterion #2 (both themes, both mobile viewports, overflow + tap targets). The aesthetic half is Task 5's browser check — say which half you are claiming in the PR body.

**Done when:** `cd e2e && npm test` green. Note that server tests and e2e share a database and **cannot run concurrently** — run e2e alone before calling it red.

---

### Task 8 — Pre-merge follow-ups

**Zone:** docs (harness) · **Depends on:** none (run last)

For each ADR-worthy item in the spec, ensure exactly one tracking action exists — a matching ADR, a linked issue, or an explicit `Deferred:` line with reasoning:

1. Toast state in a context provider that renders its own host.
2. Top-anchored at `z-40`, and the resulting re-reading of ADR-011 decision 5 (`UpdateToast` is the only *bottom*-fixed surface). **This one is the most important:** a future reader of `narration.spec.ts`'s comment must be able to find out why a second fixed surface exists and why that assertion still means what it says.
3. Persist-until-dismissed, no auto-dismiss timer, with the accessibility reasoning.
4. `illustrateError` replaced rather than supplemented; the four other inline error regions stay inline.
5. The `Deferred:` list (merging `UpdateToast`; success/info variants; retry; telemetry; persistence across reloads; migrating remaining inline regions).

Items 1–4 are one grouped ADR, following the ADR-004/006/007/008/010/011 precedent of numbered decisions with stated trade-offs. Item 5 is a `Deferred:` line in the spec, already written — do not also file issues for it, or one item gets two tracking actions.

Also close the loop on #115 and #114 in the PR body: both are fixed by this one branch, and #115's stated list of three affected test files was wrong (see spec §"Correction to #115's stated scope") — say so, so the next reader does not go looking for a `PublishStateBar` change that never happened.

**Done when:** `adr-tracking-check error-toast-host` reports zero orphaned items.

## Sequencing notes

- **Commit boundaries:** Tasks 1–2 are one natural commit (the provider is inert until the host exists). Tasks 3, 4, 5 are one commit each — each is a self-contained page migration plus its own test wrap, so the suite is green at every commit. Tasks 6–8 are one commit.
- **Parallel cut:** after Task 2 lands, Tasks 3/4/5 touch disjoint files (`MyBooks`, `Admin`, `BookDetail` and their tests) and can be done in any order or concurrently. Task 6 needs all three; Task 7 needs only Task 5.
- **One PR.** The two issues share a cause and a surface; splitting them would mean shipping a toast host with one consumer and then a second PR that only adds call sites.
- **Run e2e alone.** Server tests and e2e share a database — a concurrent run fails spuriously.
- Branch off `master`, not off `chore/og-image-absolute-url`.

## Open questions

None blocking. The four questions the brief raised are ruled on in the spec (§"Rulings on the four open questions") and their reasoning is carried into the ADR-worthy list, not left here.

One thing to watch during Task 5 rather than decide now: `handleIllustrate` currently resets `illustrateError` to `''` at the start of every attempt, so a retry visibly clears the previous failure. With toasts, a stale failure from the previous attempt stays on screen while the retry runs. If that reads badly in the Task 5 manual verify, the fix is a `dismiss()` of the previous id at the top of the handler — not a timer. Record what you chose in the PR body.
