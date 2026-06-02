# Theater mode (TS1) — task plan

> Spec: [spec.md](spec.md)
> Status: Draft
> Last updated: 2026-06-01
> Planner: HR4 via /plan-tasks on 2026-06-01

## Overview

Theater mode is a 4-file, UI-only client feature: widen `BookSpread` frame/footer/revise-panel and the `BookDetail` page wrapper when `?theater=1` is on the URL. State lives in the URL via React Router v7's `useSearchParams`, lifted into `BookDetail` and passed into `BookSpread` as `theater: boolean` + `onToggleTheater: () => void`. No server, shared, or e2e changes. Decomposed into **4 sequential tasks**: prop scaffolding -> layout/animation, URL state in `BookDetail`, `BookSpread` RTL tests, `BookDetail` RTL tests (extending the existing test file).

Files in play:

- `client/src/components/BookSpread.tsx` (modified)
- `client/src/pages/BookDetail.tsx` (modified)
- `client/src/components/__tests__/BookSpread.test.tsx` (NEW)
- `client/src/pages/__tests__/BookDetail.test.tsx` (modified — already exists; planner verified)

## Parallel-safe cuts

```
1 ────► 2 ────► (3 ∥ 4)
```

- Task 3 (BookSpread test) and Task 4 (BookDetail test) touch independent files and can run as parallel developer dispatches once Tasks 1 and 2 are complete. We still recommend serializing in practice — the test files are small enough that the orchestration overhead exceeds the time saved.

## Cross-cutting constraints

Carried over from the spec — re-stated for the developer.

- **Dark-mode parity (client convention).** Every new visual surface needs `dark:` partners. The new toggle button MUST have light + dark pairs for background, text, and hover. Manual verification step requires checking both modes.
- **Mobile breakpoint.** Toggle is hidden on `<md` (<768px) via `hidden md:inline-flex`. Do not render an alternative mobile affordance.
- **Animation lockstep.** All four containers that change width (page wrapper, frame, footer, revise panel) MUST use `transition-all duration-200 ease-in-out`. Same duration/easing as the existing page-flip transition so they don't visually fight if they overlap.
- **Accessibility.** Toggle is an icon-only button — `aria-label` ("Expand to theater mode" / "Exit theater mode") and `aria-pressed` are required. Pattern mirrors the existing `viewMode` toggle in `BookDetail.tsx` lines 489-511.
- **TypeScript strict, no `any`.** New props on `BookSpreadProps` must be explicit.
- **URL state, not local React state, not localStorage.** Single source of truth is `?theater=1` via `useSearchParams`. `setSearchParams(next, { replace: false })` so the browser Back button exits theater mode (creates history entries).
- **Wire-shape (OPS.3):** N/A — no server changes, no new routes. No `toMatchObject` updates needed.
- **CLAUDE.md guardrails:** none touched. No session/auth/Claude-SDK/`data.json`/paid-API changes. No user confirmation required to start.
- **Reader view (`viewMode === 'reader'`) is out of scope.** The legacy reader-view block in `BookDetail.tsx` lines 538-691 is untouched. Theater state has no effect there because the toggle lives inside `BookSpread`, which only renders when `viewMode === 'spread'`.

## Tasks

### Task 1 — Add `theater` props and layout/animation classes in `BookSpread.tsx`

**Status:** Done (2026-06-02)

**Zone:** client
**Depends on:** none
**Parallel-safe with:** none (Task 2 depends on the new prop interface)

**Files to add or change:**

- `client/src/components/BookSpread.tsx` (modified) — extend `BookSpreadProps`, derive `frameWidthClass`, swap three `max-w-[900px]` references (frame inline style at line 126, footer at line 229, revise panel at line 258), add `transition-all duration-200 ease-in-out` to the same three containers, add the `Maximize2`/`Minimize2` toggle button in the footer cluster, import the two icons from `lucide-react`. **Also add `data-testid="book-spread-frame"` to the frame `<div>`** so Task 3's RTL tests can query it stably (called out in Task 3's planner notes; landing the testid here keeps the source diff coherent).

**Signatures / shapes:**

```ts
import { Maximize2, Minimize2 /* + existing imports */ } from 'lucide-react'

interface BookSpreadProps {
  // ...existing 11 props
  theater: boolean;
  onToggleTheater: () => void;
}

// inside the component body, near the top:
const frameWidthClass = theater
  ? 'max-w-[min(90vw,1600px)]'
  : 'max-w-[900px]';

// frame (line ~120): remove the inline `style={{ maxWidth: '900px' }}` width
// piece (keep the gradient backgroundImage), and add frameWidthClass + transition
// to the className. Spec leaves the inline gradient style alone.

// footer (line 229):
<div className={`flex flex-col md:flex-row items-center justify-between mt-4 gap-3 mx-auto transition-all duration-200 ease-in-out ${frameWidthClass}`}>

// revise panel (line 258):
<div className={`mt-4 bg-white dark:bg-gray-800 rounded-2xl p-5 mx-auto border-2 border-purple-200 dark:border-purple-800 transition-all duration-200 ease-in-out ${frameWidthClass}`}>

// new toggle button — placed after the "Suggest changes" button in the footer
// cluster so it stays adjacent to other CTAs:
<button
  type="button"
  onClick={onToggleTheater}
  aria-label={theater ? 'Exit theater mode' : 'Expand to theater mode'}
  aria-pressed={theater}
  className="hidden md:inline-flex items-center justify-center w-9 h-9 rounded-lg text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-gray-700 hover:bg-amber-200 dark:hover:bg-gray-600 cursor-pointer border-none"
>
  {theater ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
</button>
```

**Resolved inline (planner notes):**

- The spec specifies the `Maximize2`/`Minimize2` Lucide pair — no bikeshed needed. ADR-worthy item #5 in the spec already pins Tailwind transitions; no alternative library considered.
- Toggle button placement: **after** the "Suggest changes" button. Rationale: keeps action affordances grouped on the right; the dot indicators and page-count text stay on the left as the visual focus. The existing footer is `justify-between`, so two-end layout still holds.
- The frame element keeps its inline `style={{ backgroundImage: 'linear-gradient(...)' }}` (spine gradient — see Risks in spec). Only the `maxWidth: '900px'` width portion of the inline style is dropped; width moves to className via `frameWidthClass`.

**Tests to write:**

- None in this task — Task 3 owns the RTL test file. (Tasks split so the source change lands first and tests follow as a focused diff.)
- Wire-shape assertion: N/A (no server response touched).

**Manual verify:**

- Not in this task — the component still expects new props that no caller passes yet. After Task 2 lands, manual verify per Task 2's checklist.

**Done when:**

- `BookSpread.tsx` compiles cleanly with the two new props in `BookSpreadProps` (`tsc --noEmit` in `client/` has no new errors).
- The three `max-w-[900px]` literal occurrences are gone from the file (`grep -n 'max-w-\[900px\]' client/src/components/BookSpread.tsx` returns nothing); the inline `maxWidth: '900px'` is gone from the frame style.
- The new toggle button is in the JSX with `aria-label`, `aria-pressed`, and `hidden md:inline-flex` classes.
- `npm run lint` in `client/` is clean.
- Existing client tests still pass (`cd client && npm test`) — the test file in Task 3 doesn't exist yet, but Task 4 (which modifies the existing `BookDetail.test.tsx`) hasn't run either, so the existing BookSpread mock still satisfies `BookDetail.test.tsx`. **Heads-up:** if any test outside the scope renders `BookSpread` directly without the mock, it will break here because `theater` and `onToggleTheater` are now required. The existing `BookDetail.test.tsx` mocks `BookSpread` to a stub div (line 119), so it's unaffected. The planner verified no other test imports `BookSpread` directly.

---

### Task 2 — Lift `theater` URL state in `BookDetail.tsx` and widen the page wrapper

**Status:** Done (2026-06-02)

**Zone:** client
**Depends on:** Task 1 (needs the new `BookSpreadProps` shape)
**Parallel-safe with:** none

**Files to add or change:**

- `client/src/pages/BookDetail.tsx` (modified) — add `useSearchParams` import from `react-router-dom`, derive `theater` from the URL, build `toggleTheater` callback, pass both props into the existing `<BookSpread>` JSX usage, widen the page wrapper at line 340 conditionally on `theater`, add `transition-all duration-200 ease-in-out` to that wrapper.

**Signatures / shapes:**

```ts
import { useSearchParams /* + existing */ } from 'react-router-dom'

// inside BookDetail component body, alongside the existing useParams/useNavigate calls:
const [searchParams, setSearchParams] = useSearchParams()
const theater = searchParams.get('theater') === '1'
const toggleTheater = () => {
  const next = new URLSearchParams(searchParams)
  if (theater) next.delete('theater')
  else next.set('theater', '1')
  setSearchParams(next, { replace: false }) // back-button exits theater mode
}

// page wrapper at line 340:
<div
  className={`mx-auto px-4 py-8 transition-all duration-200 ease-in-out ${
    theater ? 'max-w-[min(95vw,1700px)]' : 'max-w-4xl'
  }`}
>

// where <BookSpread ... /> is rendered (under the existing viewMode === 'spread' branch):
<BookSpread
  // ...existing 11 props
  theater={theater}
  onToggleTheater={toggleTheater}
/>
```

**Resolved inline (planner notes):**

- `searchParams.get('theater') === '1'` is the canonical "boolean from URL" pattern. Other values (`?theater=true`, `?theater=`) intentionally do not activate theater mode — strict equality keeps the URL predictable for bookmarking and Back-button navigation.
- `setSearchParams(next, { replace: false })` (default behavior) is the spec's explicit choice so Back exits theater mode. Do not change to `{ replace: true }`.

**Tests to write:**

- None in this task — Task 4 owns the test additions for `BookDetail.test.tsx`.

**Manual verify:**

- Run `npm run dev` from repo root; open a draft book detail page in the browser at `http://localhost:5173/book/<id>` (use a seed draft you own as a logged-in user).
- **Light mode:** click the new toggle in the spread footer. Confirm: (a) URL gains `?theater=1`; (b) page wrapper widens; (c) book frame widens; (d) revise panel (when open) widens; (e) all four animate over ~200ms, no snap; (f) `Maximize2` icon swaps to `Minimize2`.
- **Dark mode:** repeat all of the above after toggling the theme via the existing theme toggle. The toggle button background/text/hover all need `dark:` partners and should be visually correct.
- **Mobile:** shrink the browser window below 768px (or use DevTools responsive mode). Confirm the toggle button is no longer rendered. The spread should look identical to its pre-feature mobile layout.
- **Back button:** click the toggle to enter theater mode, then click the browser Back button. Confirm theater mode exits and URL drops `?theater=1`.
- **Deep link:** navigate manually to `http://localhost:5173/book/<id>?theater=1`. Confirm the page loads in theater mode immediately.
- **Reader view check:** click "Reader view" (the legacy `viewMode` toggle on `BookDetail.tsx` lines 489-511). Confirm theater controls are not visible (they live inside `BookSpread`, which doesn't render in reader view). Confirm the page wrapper width does NOT change with `?theater=1` while reader view is active — **planner note:** the spec's Acceptance Criterion #7 ("reader-view is untouched") is ambiguous here. The page wrapper widens whenever `?theater=1` is present regardless of `viewMode`, because the wrapper is outside the `viewMode` branch in `BookDetail.tsx`. This is the spec's intended behavior (the wrapper widening is harmless in reader view and avoids special-casing). If reviewer pushes back, gate the wrapper widening on `viewMode === 'spread'`. Flagged below as an open question.

**Done when:**

- All manual verify steps pass in both light and dark mode.
- `tsc --noEmit` in `client/` is clean.
- `npm run lint` in `client/` is clean.
- `cd client && npm test` is green (existing 44+ tests still pass; the `BookSpread` mock in `BookDetail.test.tsx` already swallows the new required props because it's `default: () => <div data-testid="book-spread" />` and ignores them).
- The URL round-trips correctly (toggle on -> `?theater=1` present, toggle off -> param removed).

---

### Task 3 — New RTL test file for `BookSpread`

**Status:** Done (2026-06-02)

**Zone:** client (tests)
**Depends on:** Tasks 1 and 2
**Parallel-safe with:** Task 4 (different test file, no shared mocks)

**Files to add or change:**

- `client/src/components/__tests__/BookSpread.test.tsx` (NEW) — RTL test file mirroring the patterns in `BookCard.test.tsx`. Mock `apiBase` if needed (the component imports `api` from `../lib/apiBase` for illustration calls) — easier to pass minimal book data and assert only on rendering / aria / className, not on any async behavior. No router wrapping needed (component doesn't use any router hooks directly).

**Signatures / shapes:**

```ts
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import BookSpread from '../BookSpread'
import type { BookWithPages } from '../../types'

const mockBook: BookWithPages = {
  // ... mirror the minimal shape from BookCard.test.tsx / BookDetail.test.tsx
  // (id, title, status: 'draft', version: 1, pages: [<2 pages>], all wire fields filled)
}

function renderSpread(props: Partial<React.ComponentProps<typeof BookSpread>> = {}) {
  return render(
    <BookSpread
      book={mockBook}
      isOwner
      isDraft
      illustrating={false}
      onIllustratePage={vi.fn()}
      onRevise={vi.fn()}
      revising={false}
      theater={false}
      onToggleTheater={vi.fn()}
      {...props}
    />,
  )
}
```

**Tests to write:**

In a single `describe('BookSpread — theater toggle', ...)` block, cover the spec's Acceptance Criteria #1, #2, #4, #8:

1. **`renders the toggle with aria-label "Expand to theater mode" and aria-pressed="false" when theater is off`** — `getByRole('button', { name: /expand to theater mode/i })`; assert `aria-pressed` attribute is `"false"`.
2. **`renders the toggle with aria-label "Exit theater mode" and aria-pressed="true" when theater is on`** — rerender with `theater={true}`; same selectors flipped.
3. **`calls onToggleTheater when the toggle is clicked`** — `fireEvent.click` on the toggle; assert the `vi.fn()` mock was called once.
4. **`applies the wide frame width class when theater is on`** — when `theater={true}`, query the frame container (use a `getByRole`/`getByTestId` or className substring match — see planner note below) and assert its `className` contains `max-w-[min(90vw,1600px)]`.
5. **`applies the narrow frame width class when theater is off`** — same as above but assert `max-w-[900px]` is in the className.
6. **`hides the toggle on viewports below md via hidden md:inline-flex`** — query the toggle (even when `hidden` it's in the DOM) and assert `className` contains both `hidden` and `md:inline-flex`.
7. **`includes dark-mode classes on the toggle button`** — assert the toggle's `className` contains `dark:` substring (mirrors project's existing dark-mode parity assertion approach).

**Resolved inline (planner notes):**

- The frame container has no `role` or `data-testid` today. **Add a `data-testid="book-spread-frame"`** to the frame `<div>` in `BookSpread.tsx` during Task 1, OR scope the className assertion via the toggle button's parent traversal. **Recommendation:** add the `data-testid` in Task 1 — it's a one-line addition and makes the test stable. Adjust Task 1's "Files to add or change" mentally to include this; the planner is calling this out here rather than amending Task 1 because it's a test-driven need.
- No need to wrap in `<MemoryRouter>` — `BookSpread` itself uses no router hooks (verified: only `BookDetail` uses `useSearchParams`).
- No need to mock `CartContext` / `AuthContext` — `BookSpread` doesn't consume them.

**Manual verify (if applicable):**

- N/A — tests are themselves the verification.

**Done when:**

- `cd client && npm test -- BookSpread.test.tsx` is green with all 7 tests passing.
- `cd client && npm test` is green overall (no regressions in other test files).
- The new file follows the same import/format conventions as `BookCard.test.tsx`.

---

### Task 4 — Extend `BookDetail.test.tsx` with theater-mode URL tests

**Status:** Done (2026-06-02)

**Zone:** client (tests)
**Depends on:** Tasks 1 and 2
**Parallel-safe with:** Task 3

**Files to add or change:**

- `client/src/pages/__tests__/BookDetail.test.tsx` (modified — **file already exists**; planner verified). Add a new `describe('BookDetail — theater mode', ...)` block at the end. Re-use the existing `setupFetchMock`, `mockUser`, `baseBook`, `renderBookDetail` helpers in the file, but generalize `renderBookDetail` to accept an optional initial `search` query string (see signatures below).

**Signatures / shapes:**

```ts
// Modify the existing renderBookDetail helper to take an optional search param:
function renderBookDetail(opts: { search?: string } = {}) {
  return render(
    <MemoryRouter initialEntries={[`/book/book-1${opts.search ?? ''}`]}>
      <Routes>
        <Route path="/book/:id" element={<BookDetail />} />
      </Routes>
    </MemoryRouter>
  )
}

// The existing BookSpread mock is at line 119:
//   vi.mock('../../components/BookSpread', () => ({
//     default: () => <div data-testid="book-spread" />,
//   }))
//
// Replace it with a richer mock that captures and exposes the theater prop:
let capturedTheaterProp: boolean | undefined
vi.mock('../../components/BookSpread', () => ({
  default: (props: { theater: boolean; onToggleTheater: () => void }) => {
    capturedTheaterProp = props.theater
    return (
      <div data-testid="book-spread">
        <button onClick={props.onToggleTheater} aria-label="theater-toggle-stub">
          theater={String(props.theater)}
        </button>
      </div>
    )
  },
}))
```

**Tests to write:**

In a new `describe('BookDetail — theater mode', ...)` block, cover the spec's Acceptance Criteria #3, #4, #9:

1. **`passes theater=false to BookSpread and applies max-w-4xl when URL has no theater param`** — `renderBookDetail()`; wait for fetches to settle; assert the captured `theater` prop is `false` AND the page wrapper element has `max-w-4xl` in its className (find via the wrapper containing the BookSpread stub).
2. **`passes theater=true to BookSpread and applies max-w-[min(95vw,1700px)] when URL has ?theater=1`** — `renderBookDetail({ search: '?theater=1' })`; same checks flipped.
3. **`adds ?theater=1 to the URL when the toggle callback runs`** — `renderBookDetail()`; click the stub button (which invokes `onToggleTheater`); assert the URL/search-params updated. Use `useLocation` via a small router-helper component injected into `<Routes>`, OR assert that the captured `theater` prop is now `true` on the next render (preferred — simpler).
4. **`removes ?theater=1 from the URL when the toggle callback runs while theater is on`** — start with `?theater=1`, click the stub button, assert `theater` prop is now `false`.
5. **`back-button-style navigation exits theater mode`** — this is harder to test cleanly with `MemoryRouter`'s history; **planner recommendation:** skip this as an RTL test. Manual verification step in Task 2 already covers it. Document the omission in a `// NOTE:` comment in the test file.

**Resolved inline (planner notes):**

- The existing test file uses `vi.restoreAllMocks()` in `beforeEach`/`afterEach`. The new `describe` block should reset `capturedTheaterProp = undefined` in `beforeEach` to prevent cross-test bleed.
- The existing `setupFetchMock` helper is sufficient for the theater tests — they need the book to load so `BookDetail` reaches the spread-rendering branch.
- `viewMode` defaults to `'spread'` in `BookDetail`, so the BookSpread mock will render without needing to click the "Reader view" toggle first.
- The "wider mock" (capturing the prop, exposing the toggle as a stub button) replaces the existing minimal mock. Verify after the change that none of the existing 9-ish tests in the file regress — they treat the mock as an opaque `data-testid="book-spread"` so they should all still pass.

**Manual verify (if applicable):**

- N/A.

**Done when:**

- `cd client && npm test -- BookDetail.test.tsx` is green with all existing tests plus the 4 new tests passing.
- `cd client && npm test` is green overall.
- The new `describe` block follows the same patterns as the surrounding three describe blocks in the file.

---

## Sequencing notes

- **Task 1 must land before Task 2** because Task 2 starts passing the new `theater` / `onToggleTheater` props that don't exist on `BookSpreadProps` yet. If you really want to commit Task 1 in isolation, the developer can default `theater = false` and `onToggleTheater = () => {}` at the component level temporarily — but recommend just shipping Tasks 1+2 in the same commit/PR. They're tightly coupled and small.
- **Tasks 1+2 should land before Tasks 3+4.** The tests directly assert on behavior introduced in Tasks 1+2. Writing tests-first would require a temporary scaffold and adds work.
- **Suggested PR cut:** one PR covering all 4 tasks. The feature is small (4 files, ~150 LoC including tests) and the tests are tightly bound to the source changes. Splitting into multiple PRs adds review overhead without clarity gain.
- **Suggested commit cadence inside the PR:** (a) Task 1 + Task 2 as one commit (source change), (b) Task 3 + Task 4 as a second commit (tests). Reviewer can read source first and tests second, which matches the natural review order.

## Resolved questions

1. **Page-wrapper widening in reader view.** ~~Was: should the wrapper widen regardless of `viewMode`?~~ **Resolved 2026-06-01 (user):** ship as spec'd (option a) — the page wrapper widens whenever `?theater=1` is present, regardless of `viewMode`. The widening is a horizontal-whitespace adjustment with no visible effect in reader view (the reader controls its own column width). Avoiding the conditional keeps the implementation simpler. Reviewer should treat AC#7 as referring to reader-view *visual rendering*, not the wrapper width.

2. **Toggle visibility for non-owners / non-drafts.** Acceptance Criterion #1 says "the theater toggle is always present on `md:` and up regardless of owner/draft state". Settled in the spec — developer should **not** wrap the toggle in `isOwner && isDraft` (unlike the adjacent "Suggest changes" button at lines 245-253).

## ADR-worthy items beyond the spec's existing 5

The spec already flagged 5 ADR-worthy items (URL state, layout-swap not overlay, mobile hide, vertical-stack revise panel, Tailwind transitions). **One additional ADR-worthy item emerged during decomposition:**

- **Test mocking pattern for the lifted prop.** Task 4 replaces the minimal `BookSpread` mock in `BookDetail.test.tsx` with a richer one that captures the `theater` prop into a module-level variable. This is a small but reusable pattern for "test that a parent passes a prop to a child component" — worth pinning as an ADR (or at least a testing-conventions addition) if HR4 sees this pattern emerging in other tests. **Not blocking** — defer to the reviewer or future-spec author.

The original 5 ADR-worthy items remain in the spec and should be created via `/create-adr` post-spec-approval and before this plan executes, OR captured as a follow-up issue. Tracking them per the "surfaced gaps need tracking" memory.
