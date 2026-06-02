# Theater mode (expanded book/reader view) — TS1

> Status: Draft
> Last updated: 2026-06-01
> Architect: Claude Opus 4.7 via /start-task on 2026-06-01
> Backlog: https://github.com/slickG0ose/storybook/issues/19

## Problem

The `BookSpread` component renders inside `BookDetail`'s `max-w-4xl mx-auto` page wrapper, and the book frame itself is further capped at `max-w-[900px]` (an inline `style={{ maxWidth: '900px' }}` on the frame plus a matching `max-w-[900px]` on the footer and inline revise panel). On a 1440px+ display this leaves the actual reading surface around 56-63% of viewport width — fine for a thumbnail-like preview, cramped for actually reading a finished story or evaluating a draft side-by-side with the inline revise textarea. Owners revising a draft especially want a bigger spread so the illustration on the left page is large enough to assess at a glance before deciding what to redo.

TS1 introduces a "theater mode" toggle that expands the spread to ~90% of viewport width while keeping the existing inline revise panel docked below it (vertically stacked, status quo layout, just wider). No data shape changes, no new routes — this is a pure presentation concern living in two files (`BookSpread.tsx` and `BookDetail.tsx`) and their RTL tests.

## Goal

A theater-mode toggle in the spread footer that expands the book frame from its current `max-w-[900px]` cap to `~min(90vw, 1600px)`, widens the page wrapper to `~min(95vw, 1700px)`, keeps the inline revise panel docked below the spread and widens it to match, preserves dark-mode parity, animates the width change via Tailwind transitions over ~200ms, and is hidden on viewports below `md:` (768px). State lives in the URL (`?theater=1`) so deep links, reloads, and the browser back button all work.

## Constraints

- **Dark-mode parity (client conventions).** Every new visual surface needs `dark:` partners. This is the #1 source of UI regressions in the project.
- **No data changes.** No Prisma migration, no Zod schema in `@storybook/shared`, no new server route, no wire-shape change.
- **No CLAUDE.md guardrails touched.** No session-model change, no Claude SDK swap, no new paid API, no auth change, no `data.json` shape change.
- **TypeScript strict.** Toggle state and any new prop types must be explicit; no `any`.
- **Accessibility (client conventions).** Icon-only buttons need `aria-label`. Toggle is a button; needs a name like "Expand to theater mode" / "Exit theater mode" and `aria-pressed` to advertise toggle state to screen readers (mirrors the existing `viewMode` toggle pattern in `BookDetail.tsx` line 491).
- **Reader view (`viewMode === 'reader'`) is out of scope.** The legacy reader-view block in `BookDetail.tsx` lines 538-691 has its own layout chrome; this spec only touches the `viewMode === 'spread'` path. (See Out of scope.)
- **The inline revise panel lives inside `BookSpread.tsx`** (lines 257-303). It stays where it is, in the same vertical-stack DOM position; theater mode widens it in place, no horizontal docking, no portal.

## Proposed shape

Theater mode is a **layout-swap inside `BookSpread.tsx` and `BookDetail.tsx`**, not a portal/overlay/modal. The components already own the page wrapper, book frame, footer, and inline revise panel — all four expand together when theater is on, all four collapse together when theater is off. Implementing this as an overlay would require duplicating the spread inside a fixed-position `<div>`, doubling the DOM and forking the revise panel's lifecycle. A layout swap keeps a single DOM subtree and toggles class names.

The toggle is **a new icon button in the spread footer** alongside the existing dot-indicators / page-count / "Suggest changes" cluster (`BookSpread.tsx` lines 229-254). It uses Lucide's `Maximize2` / `Minimize2` icon pair and `aria-pressed` to indicate state (mirroring the existing `viewMode` toggle on `BookDetail.tsx` lines 489-511). `aria-label` is `"Expand to theater mode"` when off, `"Exit theater mode"` when on.

### State location: URL query param `?theater=1`, lifted to `BookDetail.tsx`

Theater state lives in the URL via `useSearchParams` from React Router v7 (already in the dependency tree). Two reasons to lift the state into `BookDetail` rather than keeping it local to `BookSpread`:

1. The page-level wrapper `max-w-4xl mx-auto px-4 py-8` (`BookDetail.tsx` line 340) caps the available width before `BookSpread` ever sees it. Theater mode has to widen this wrapper too, or the frame's `max-w-[min(90vw,1600px)]` is meaningless. `BookDetail` controls that wrapper, so theater state has to be visible there.
2. URL-as-source-of-truth (`?theater=1`) means a deep link to a draft in theater mode survives reload, the browser back button works as a way to exit, and there's no localStorage migration step later if we ever decide to make it sticky.

`BookDetail` derives `theater` from `searchParams`, passes it to `BookSpread` as a `theater: boolean` prop, and passes the toggle callback as `onToggleTheater: () => void`. `BookSpread` applies the wider max-width classes to the frame, footer, and revise panel when the prop is true; `BookDetail` widens its own page wrapper concurrently.

### Mobile behavior: toggle hidden below `md:`

The toggle button is hidden on viewports below the `md:` breakpoint (768px) via `hidden md:inline-flex`. On phones the spread is already at full width; the toggle would be a control that doesn't change anything, which is worse than not showing it at all. If a user manually adds `?theater=1` to the URL on mobile, the `max-w-[min(90vw,1600px)]` classes still apply but have no visible effect (the existing mobile layout already saturates the viewport).

### Animation: Tailwind transitions over ~200ms

The frame, page wrapper, footer, and revise panel get `transition-all duration-200 ease-in-out` so the max-width change animates smoothly. This matches the existing page-flip animation duration on the inner grid, so if both are mid-flight they stay in lockstep visually. No JS-driven animation, no `requestAnimationFrame`, no library — just two CSS classes per element.

### Component diff sketch

`BookSpread.tsx`:

```tsx
interface BookSpreadProps {
  // ...existing props
  theater: boolean;
  onToggleTheater: () => void;
}

const frameWidthClass = theater
  ? 'max-w-[min(90vw,1600px)]'
  : 'max-w-[900px]';

// frame:
<div
  className={`relative mx-auto bg-amber-100 dark:bg-gray-800 rounded-2xl shadow-2xl border border-amber-200 dark:border-gray-700 transition-all duration-200 ease-in-out ${frameWidthClass}`}
  // (the existing inline `style={{ maxWidth: '900px' }}` is removed; gradient style stays)
>

// footer (line 229):
<div className={`flex flex-col md:flex-row items-center justify-between mt-4 gap-3 mx-auto transition-all duration-200 ease-in-out ${frameWidthClass}`}>

// inline revise panel (line 258):
<div className={`mt-4 bg-white dark:bg-gray-800 rounded-2xl p-5 mx-auto border-2 border-purple-200 dark:border-purple-800 transition-all duration-200 ease-in-out ${frameWidthClass}`}>

// new toggle button in the footer cluster (hidden on <md):
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

`BookDetail.tsx`:

```tsx
import { useSearchParams } from 'react-router-dom';
// ...
const [searchParams, setSearchParams] = useSearchParams();
const theater = searchParams.get('theater') === '1';
const toggleTheater = () => {
  const next = new URLSearchParams(searchParams);
  if (theater) next.delete('theater');
  else next.set('theater', '1');
  setSearchParams(next, { replace: false }); // back-button works
};

// page wrapper (line 340):
<div
  className={`mx-auto px-4 py-8 transition-all duration-200 ease-in-out ${
    theater ? 'max-w-[min(95vw,1700px)]' : 'max-w-4xl'
  }`}
>

// pass theater into BookSpread:
<BookSpread
  // ...existing
  theater={theater}
  onToggleTheater={toggleTheater}
/>
```

The page-wrapper max-width is slightly wider than the book-frame max-width (95vw vs 90vw) so the frame has breathing room on both sides at theater zoom. The 1600px / 1700px ceilings prevent the spread from blowing up uselessly on 4K displays — past ~1600px the spread is wider than the human eye can scan in one sweep.

### CSS / className strategy

- **Tailwind v4 with arbitrary-value class** (`max-w-[min(90vw,1600px)]`) — Tailwind v4 supports `min()` inside arbitrary-value brackets without a config file change.
- **No new CSS file, no `@apply`** — keep className-only, consistent with the rest of the codebase.
- **Dark variants:** the theater toggle button has `bg-/text-/hover:` light + dark pairs mirroring the existing "Suggest changes" button (`BookSpread.tsx` lines 246-253). No new dark surfaces; this is reusing existing color tokens.
- **Transition class on every container** whose width changes (frame, footer, revise panel, page wrapper). Same duration (200ms) and easing (ease-in-out) everywhere so they expand in lockstep.

### Toggle interaction

1. User clicks the `Maximize2` button in the footer.
2. `BookSpread` calls `onToggleTheater` (lifted callback).
3. `BookDetail` updates `?theater=1` via `setSearchParams`.
4. React Router re-renders `BookDetail` with `theater=true`.
5. Page wrapper widens to `max-w-[min(95vw,1700px)]`; `BookSpread` receives the new prop and widens the frame + footer + revise panel to `max-w-[min(90vw,1600px)]`.
6. Transition animates over 200ms.
7. To exit: user clicks the now-`Minimize2` button, hits the browser Back button, or removes `?theater=1` from the URL.

### Focus management

When the toggle is clicked, do **not** steal focus or pop a focus trap (this isn't a modal). The toggle button itself keeps focus naturally because the click event lands on it; the `aria-pressed` flip on the same element is what screen readers announce. Same pattern as the existing `viewMode` toggle.

## Schema / data shape changes

**None.** Confirmed:

- No Prisma migration.
- No new Zod schema in `shared/src/`.
- No change to `BookWithPages`, `Page`, `IllustrationVersion`, `BookVersion` wire shapes.
- No new server route. No change to `/api/books/:id` response.

## Wire-shape changes

**None.** This is a presentation-only feature. No `toMatchObject` updates required, no new wire-shape assertion.

## Files likely touched

Final list, refined against the locked design:

- **`client/src/components/BookSpread.tsx`** — add `theater` and `onToggleTheater` to the `BookSpreadProps` interface; replace the three `max-w-[900px]` / inline `maxWidth: 900px` references (frame ~line ~120ish, footer line 229, revise panel line 258) with a `frameWidthClass` constant that swaps on `theater`; add `transition-all duration-200 ease-in-out` to those same four containers (frame, footer, revise panel — the page wrapper is in `BookDetail`); add the `Maximize2`/`Minimize2` toggle button to the footer cluster after the existing "Suggest changes" button (or before — bikeshed during implementation); import `Maximize2`, `Minimize2` from `lucide-react`.
- **`client/src/pages/BookDetail.tsx`** — add `useSearchParams` import from `react-router-dom`; derive `theater` from the URL; build `toggleTheater` callback; pass both into `BookSpread`; widen the page wrapper conditionally on line 340; add `transition-all duration-200 ease-in-out` to that wrapper. The existing `viewMode` toggle UI (lines 489-511) sits unchanged — theater mode does not interact with reader view (see Out of scope).
- **`client/src/components/__tests__/BookSpread.test.tsx`** — **new file.** RTL test asserting:
  - Toggle button renders with `aria-label="Expand to theater mode"` and `aria-pressed="false"` when `theater={false}`.
  - When `theater={true}`, `aria-label` is `"Exit theater mode"` and `aria-pressed="true"`.
  - Clicking the toggle calls the `onToggleTheater` mock.
  - When `theater={true}`, the rendered book frame has the `max-w-[min(90vw,1600px)]` class applied; when `theater={false}`, `max-w-[900px]` is applied. Assert via `className` substring match.
  - The toggle button has `hidden md:inline-flex` (assert substring on `className`).
  - Dark-mode classes are present on the toggle button (`dark:` substring check, mirroring the project's existing approach).
- **`client/src/pages/__tests__/BookDetail.test.tsx`** — **new file.** Tests that mounting `BookDetail` inside `<MemoryRouter initialEntries={[{ pathname: '/book/:id', search: '?theater=1' }]}>` results in `theater={true}` being passed to `BookSpread`, and the page wrapper has `max-w-[min(95vw,1700px)]` applied. Mounting without `?theater=1` results in `theater={false}` and `max-w-4xl`. Mocks `fetch` for the book load (mirroring patterns in the existing test setup).
- **No new utility file, no new hook, no context provider, no new types module.** Theater state is small enough to live in `BookDetail` directly; the `theater: boolean` prop addition to `BookSpreadProps` is a one-line interface change in the same file.

**Not touched:**
- `client/src/components/__tests__/BookCard.test.tsx`, `Navbar.test.tsx` — unrelated.
- `server/**`, `shared/**`, `e2e/**` — out of scope.
- `client/src/context/**` — no provider needed.

## ADR-worthy decisions

These are choices worth pinning via `/create-adr` after spec approval so future agents don't re-litigate. Each is hard-to-undo in the sense that reversing means rewriting the toggle's whole story (not the literal class change).

- [ ] **Theater state lives in the URL (`?theater=1`), not local React state or localStorage** — state-location choice. Implies bookmark-ability and back-button support are first-class, and the toggle is never sticky across navigations. Reversing means migrating any deep links and any sticky-state behavior added on top.
- [ ] **Layout swap, not overlay/portal** — theater mode widens the existing DOM subtree rather than rendering a fullscreen-modal duplicate. Implies the inline revise panel stays in its current DOM position and lifecycle. Reversing (moving to a portal) means re-wiring the inline revise panel's props and lifecycle.
- [ ] **Toggle hidden on viewports below the `md:` breakpoint (<768px)** — UX choice. Implies the affordance has no presence on phones. Reversing is a one-line className change but it's the kind of thing that drifts if not pinned.
- [ ] **Inline revise panel stays vertically stacked when theater is on (not horizontally docked as a sibling column)** — layout choice. Keeps the change one-shape-of-DOM. If a follow-up spec ever proposes horizontal docking, this ADR is the prior decision being revisited.
- [ ] **Animate via Tailwind transitions (`transition-all duration-200 ease-in-out`)** — animation choice. Implies no JS-driven animation, no animation library, no FLIP technique. Reversing (e.g., switching to Framer Motion for theater expand) is a meaningful library addition.

## Acceptance criteria

Testable, observable behaviors a reviewer can verify each resolved decision against:

1. **Toggle is visible on `md:` and up** in the spread footer, in the same cluster as the dot-indicators, page-count text, and existing "Suggest changes" button (the last is only present when the user is the owner of a draft; the theater toggle is always present on `md:` and up regardless of owner/draft state). The toggle has `aria-label="Expand to theater mode"` when off, `aria-label="Exit theater mode"` when on, and `aria-pressed` reflects current state. (Resolves Q1 ergonomics.)

2. **Toggle is hidden on `<md` (<768px) viewports.** The element has `hidden md:inline-flex` classes. The mobile layout is otherwise unchanged. (Resolves Q3.)

3. **Clicking the toggle updates the URL.** Toggling on adds `?theater=1` to the current URL; toggling off removes it. `setSearchParams` is called with `{ replace: false }` so each toggle creates a history entry, meaning the browser **Back button exits theater mode**. Reloading the page with `?theater=1` lands in theater mode. (Resolves Q2.)

4. **Clicking the toggle expands the book frame, footer, and revise panel** from `max-w-[900px]` to `max-w-[min(90vw,1600px)]`. The page wrapper widens from `max-w-4xl` to `max-w-[min(95vw,1700px)]`. The inline revise panel (when open) widens to match the frame. The vertical stack order (frame → footer → revise panel) is unchanged — only widths change. (Resolves Q1 layout.)

5. **Width changes animate over ~200ms.** All four containers (page wrapper, frame, footer, revise panel) have `transition-all duration-200 ease-in-out` so the expand/collapse is smooth, not snap. The duration matches the existing page-flip animation so they stay in lockstep if they ever overlap. (Resolves Q5.)

6. **Dark-mode parity.** Both states (theater on, theater off) work cleanly in both light and dark mode. The new toggle button has `dark:` classes for background, text, and hover states. No new visual surface lacks a `dark:` partner.

7. **Reader-view is untouched.** When `viewMode === 'reader'` (the legacy reader view in `BookDetail.tsx` lines 538-691), no theater behavior applies; the toggle is not rendered in that mode (it lives inside `BookSpread` which only renders for `viewMode === 'spread'`). (Resolves Q4.)

8. **RTL test for `BookSpread`** asserts: toggle renders with correct `aria-label` and `aria-pressed` for both `theater={true}` and `theater={false}`; clicking calls `onToggleTheater`; correct width class appears on the frame for each state; `hidden md:inline-flex` present on the toggle; `dark:` substring present in the toggle's className.

9. **RTL test for `BookDetail`** asserts: arriving at the route with `?theater=1` passes `theater={true}` into `BookSpread` and applies `max-w-[min(95vw,1700px)]` to the page wrapper; arriving without it passes `theater={false}` and applies `max-w-4xl`.

10. **Manual verification.** Reviewer:
    - opens a draft book in both light and dark mode,
    - toggles theater mode on and off, confirming the spread, page wrapper, and inline revise panel all widen together with a smooth animation,
    - confirms the URL updates to/from `?theater=1`,
    - confirms the back button exits theater mode,
    - shrinks the browser to <768px and confirms the toggle disappears,
    - confirms `npm run lint` and `tsc` are clean in `client/`.

11. **No new TypeScript errors. No new lint warnings.**

12. **No e2e test needed** for this MVP — the toggle is UI-only and the RTL tests cover the interaction. Add an e2e later if theater mode becomes part of a multi-step flow that's worth pinning at the integration layer.

## Out of scope

- **Native browser fullscreen API** (`element.requestFullscreen()`). That would dim the OS chrome and is overkill for "wider than 56%". Theater here means ~90vw, not OS-fullscreen.
- **Reader-view theater mode.** The legacy reader view (`viewMode === 'reader'`) has its own layout in `BookDetail.tsx` lines 538-691. Adding theater there is a follow-up spec.
- **Horizontally-docking the inline revise panel as a right-side column.** Spec keeps the panel vertically stacked. Horizontal docking is a future spec / a meaningful layout change, not scope creep into this one.
- **Sticky / localStorage-backed theater preference.** URL-only for MVP. No sticky-across-visits behavior.
- **Mobile theater mode.** Toggle hidden below `md:`. No alternative mobile affordance.
- **Customizable theater width** (slider, "Tiny / Cozy / Theater / Fullscreen" presets). One width, fixed at `min(90vw, 1600px)`.
- **Theater for the version-diff modal** (`BookDetail.tsx` lines 824-916). It already opens at `max-w-5xl` and `max-h-[90vh]`; that's a separate dialog with its own size story.
- **Keyboard shortcut for theater toggle** (e.g. `T` to toggle, `Esc` to exit). Discoverability question, not blocking MVP; revisit if user feedback asks for it.
- **Server-rendered preference** (e.g. a `users.theater_default` column). No data changes.

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| Dark mode parity gap on the new toggle button — easy to forget the `dark:` partner classes. | RTL test asserts presence of `dark:` substring on the toggle's className. Manual verification step #10. Reviewer skill `dark-mode-parity-check` will catch it on the PR diff if implemented. |
| URL state collides with another query param someone adds later (e.g. `?view=` or `?page=`). | `?theater=1` is namespaced; very unlikely to collide. If it ever does, the planner can rename without changing the spec's design. |
| The book frame's inline `style={{ backgroundImage: 'linear-gradient(...)' }}` (the spine gradient) is computed against the element's width. At `min(90vw, 1600px)`, the spine could end up off-center for some viewport sizes if the gradient stops aren't proportional. | The existing gradient uses percentage stops, so it scales naturally. Verify during manual review; if it looks wrong, switch to a fixed-position spine pseudo-element. Low-likelihood, easy fix. |
| Inline revise panel widening too far makes the textarea a usability problem (very long lines hurt readability). | The textarea is `h-24 resize-none` and `w-full`. At 1600px max-width that's ~140 chars per line, which is wide but not unusable. If reviewers push back, add `max-w-3xl` inner cap on the textarea itself; spec leaves this as a tunable. |
| Page-flip animation (`transition-all duration-200 ease-in-out` on the inner grid) and theater-expand animation could overlap if the user toggles while flipping. | Both are 200ms with the same easing; even if they overlap, the end states are stable. Accept; revisit only if reviewer reports a glitch. |
| `useSearchParams` from React Router v7 returns a stable setter, but the test setup must mount inside `<MemoryRouter initialEntries={[...]}>` to exercise it. | Documented in the test file pattern above. Mirrors the existing Navbar/BookCard tests which wrap in `<MemoryRouter>`. |
| Theater toggle adds another button to a footer that already has dot-indicators + page-count + "Suggest changes" — risk of footer cluttering on small `md:` screens (768-900px). | The existing footer is `flex flex-col md:flex-row` and items justify-between, so it already collapses to a column on narrow screens. Adding one icon button to the row at `md:` and up is tested visually during manual verification step #10. If it overflows, tuck the toggle into the dots cluster instead. |
| Surfaced gap: there is **no e2e test** in this spec. If theater mode later becomes part of a critical purchase or revise flow, the lack of e2e coverage means a regression could ship. | Tracked here. Re-evaluate at follow-up spec time. Not a blocker for MVP. |
| Surfaced gap: `BookDetail.test.tsx` is a **new file** — the spec assumes RTL test infrastructure for that page does not yet exist. If a planner discovers it already exists, the test additions should merge into the existing file rather than create a duplicate. | Planner verifies during sequencing. Low-cost discovery. |
