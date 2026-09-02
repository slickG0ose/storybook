# Font & text-size editing — task plan

> Spec: [spec.md](spec.md)
> Status: Draft
> Last updated: 2026-09-02
> Branch: `agent/feat/per-page-font-size` (cut from `master` at be98273)
> Architect: Claude Opus 5 via @architect on 2026-09-02

## Overview

Ten tasks in four movements: **land the data shape (1–4), make the type available (5–6),
surface the control (7–8), prove it (9), close the loop (10).**

Task 1 is the gate — it carries a CLAUDE.md guardrail and must stop for confirmation
before it runs. Tasks 2 and 5 are the natural parallel cut: a pure server function and a
font-vendoring chore that share no files with each other or with Task 1. Everything from
Task 3 onward assumes the columns exist.

`**Status:** <state>` lines under each task heading are how `/execute-task` records
progress.

## Cross-cutting constraints

- **Guardrail — Prisma schema change.** Task 1 adds two columns to `Book`. Surface this
  to the user and get explicit confirmation **before** running `db:migrate`. The spec does
  not pre-approve it.
- **Guardrail — no seed change.** `server/prisma/seed.ts`, `demo-seed.ts`, and the fixture
  JSON stay untouched; the new columns take their DB defaults. If a task looks like it
  needs a seed edit, stop and hand back to the architect.
- **Wire-shape (OPS.3 / ADR-003).** `hydrateBook` spreads the whole Prisma row, so
  `font_family` and `text_size` ship on **every** book route response the moment the
  migration lands. `BookSchema` must gain them in the same commit as the migration
  (Task 1), and `server/src/routes/__tests__/books.test.ts` must pin both fields via
  `toMatchObject`. New schemas: `FontFamilySchema`, `TextSizeSchema`,
  `BookTypographyRequestSchema`, `BookTypographyResponseSchema`.
- **Auth middleware order.** The new route is `requireAuth → validate → handler`. Inside
  the handler: ownership check (404) **before** `isEditable` (403). Both orderings are
  load-bearing; see `docs/conventions/server.md`.
- **No paid API.** No `spendGate`, no `COST_CENTS` entry, no `recordUsage` anywhere in
  this plan. If a task seems to need one, something has gone wrong.
- **Dark-mode parity.** Tasks 7 and 8 add UI; every added `className` needs its `dark:`
  partner and ≥44px tap targets (`min-h-[44px] sm:min-h-0`, per `CreateBook.tsx`).
- **Migration name:** `add_book_typography`. Never edit a committed migration.
- **No `pdf.tsx` changes.** The print work is a recommendation in the spec plus a
  follow-up issue (Task 10). Any task that opens `server/src/services/pdf.tsx` is out of
  plan.

## Tasks

### Task 1 — Data shape: Prisma columns + shared vocabulary + `BookSchema`

**Status:** Done (2026-09-02)

**Zone:** multi-zone (shared + server/prisma)
**Depends on:** none
**Parallel-safe with:** Tasks 2, 5

> **Stop and confirm with the user before running the migration.** A Prisma schema change
> is a CLAUDE.md guardrail. Show the two columns and the migration name, then wait.

**Files to add or change:**
- `server/prisma/schema.prisma` — two columns on `Book`
- `server/prisma/migrations/<ts>_add_book_typography/` — generated, committed
- `shared/src/books.ts` — enums + `BookSchema` fields
- `server/src/routes/__tests__/books.test.ts` — pin the new fields

**Signatures / shapes:**

```prisma
// model Book, after style_reference_url
  // Presentation-only (#113). Non-null with defaults that reproduce the pre-#113
  // rendering exactly, so every existing row is visually unchanged. Deliberately
  // NOT snapshotted into BookVersion — see spec §Ruling 2.
  font_family String @default("fredoka")   // 'fredoka' | 'nunito' | 'atkinson' | 'lexend'
  text_size   String @default("standard")  // 'cozy' | 'standard' | 'large' | 'xlarge'
```

```ts
// shared/src/books.ts
export const FontFamilySchema = z.enum(['fredoka', 'nunito', 'atkinson', 'lexend']);
export type FontFamily = z.infer<typeof FontFamilySchema>;

export const TextSizeSchema = z.enum(['cozy', 'standard', 'large', 'xlarge']);
export type TextSize = z.infer<typeof TextSizeSchema>;

// inside BookSchema — required, NOT nullable: the columns are non-null and
// hydrateBook spreads the whole row, so an absent field is drift.
  font_family: FontFamilySchema,
  text_size: TextSizeSchema,
```

**Tests to write:**
- `server/src/routes/__tests__/books.test.ts` — extend the existing `GET /api/books/:id`
  assertion to `toMatchObject({ font_family: 'fredoka', text_size: 'standard' })`.
- Wire-shape assertion required: **yes** — `BookSchema` (and by extension
  `BookWithPagesSchema`, `BookDetailResponseSchema`, `BookMineResponseSchema`,
  `BookPublishResponseSchema`, `BookReviseResponseSchema`).

**Done when:** `cd server && npm test` green (a red `validate()` 500 here means the shared
schema and the migration went out of sync), no new TS errors, `npx prisma migrate status`
clean.

---

### Task 2 — Server typography defaults: `ageBucketFor` + `defaultTypographyForAgeRange`

**Status:** Not started

**Zone:** server
**Depends on:** Task 1 (imports `FontFamily` / `TextSize` from `@storybook/shared`)
**Parallel-safe with:** Task 5

**Files to add or change:**
- `server/src/lib/typography.ts` — new
- `server/src/lib/__tests__/typography.test.ts` — new

**Signatures / shapes:**

```ts
import type { FontFamily, TextSize } from '@storybook/shared';

export type AgeBucket = 'early' | 'developing' | 'independent';

export interface Typography { font_family: FontFamily; text_size: TextSize }

/** What an untouched book renders as, and what the DB columns default to. */
export const STOREFRONT_DEFAULT: Typography = { font_family: 'fredoka', text_size: 'standard' };

/** Parses the leading integer out of an age_range string ("4-7" -> 4, "2-5" -> 2).
 *  Two divergent vocabularies exist in this repo (CreateBook.tsx vs seed.ts), so this
 *  parses rather than matches. Unparseable input buckets to 'developing' — the safe
 *  middle, never a guess at an extreme. See spec §Ruling 3. */
export function ageBucketFor(ageRange: string): AgeBucket;

/** Creation-time seed value only. NEVER used as a runtime fallback — an existing book
 *  must not change appearance because a default moved. See spec §Ruling 4. */
export function defaultTypographyForAgeRange(ageRange: string): Typography;
```

Buckets: lower bound ≤ 4 → `early`; 5–7 → `developing`; ≥ 8 → `independent`.
Defaults: `early` → `fredoka`/`large`; `developing` → `fredoka`/`standard`;
`independent` → `nunito`/`cozy`.

**Tests to write:**
- `server/src/lib/__tests__/typography.test.ts` — every value from **both** vocabularies
  (`2-4 3-6 4-7 5-9 6-10` and `2-5 3-6 4-7 4-8 5-9`) maps to the expected bucket; junk
  (`''`, `'all ages'`, `'seven'`, `'-3'`) buckets to `developing`; `STOREFRONT_DEFAULT`
  equals the Prisma column defaults.
- Wire-shape assertion required: no (pure function, no route).

**Done when:** listed tests pass, `cd server && npm test` green, no new TS errors.

---

### Task 3 — Creation-time defaults in `POST /api/generate`

**Status:** Not started

**Zone:** server
**Depends on:** Tasks 1 and 2
**Parallel-safe with:** Task 5

**Files to add or change:**
- `server/src/routes/generate.ts` — at the `prisma.book.create` near line 198, spread
  `defaultTypographyForAgeRange(ageRange)` alongside `age_range: ageRange`
- `server/src/routes/__tests__/generate.test.ts` — assert the persisted values

**Signatures / shapes:**

```ts
import { defaultTypographyForAgeRange } from '../lib/typography';
// ...
data: {
  // ...existing fields
  age_range: ageRange,
  ...defaultTypographyForAgeRange(ageRange),
}
```

Do **not** add validation of `ageRange` itself — Ruling 3 keeps that column untouched.

**Tests to write:**
- `ageRange: '3-6'` → book persists `{ font_family: 'fredoka', text_size: 'large' }`
- `ageRange: '6-10'` → `{ font_family: 'nunito', text_size: 'cozy' }`
- an unrecognised `ageRange` still creates a book, at `standard`
- Wire-shape assertion required: no new response field (Task 1 already pinned them), but
  the generate response now carries them — extend its existing `toMatchObject` rather
  than adding a new assertion block.

**Done when:** listed tests pass, `cd server && npm test` green, no new TS errors.

---

### Task 4 — `PUT /api/books/:id/typography`

**Status:** Not started

**Zone:** multi-zone (shared + server)
**Depends on:** Task 1
**Parallel-safe with:** Tasks 2, 5

**Files to add or change:**
- `shared/src/books.ts` — request/response schemas
- `server/src/routes/books.ts` — the route, mounted next to `PUT /:id/pages/:pageNumber`
- `server/src/routes/__tests__/books.test.ts` — the route's tests

**Signatures / shapes:**

```ts
// shared/src/books.ts
// .strict() so a future per-page override field cannot land silently — same reasoning
// as BookPdfRequestSchema.
export const BookTypographyRequestSchema = z.object({
  font_family: FontFamilySchema,
  text_size: TextSizeSchema,
}).strict();
export type BookTypographyRequest = z.infer<typeof BookTypographyRequestSchema>;

export const BookTypographyResponseSchema = BookWithPagesSchema;
export type BookTypographyResponse = z.infer<typeof BookTypographyResponseSchema>;
```

```ts
// server/src/routes/books.ts
router.put(
  '/:id/typography',
  requireAuth,
  validate({
    name: 'PUT /api/books/:id/typography',
    request: BookTypographyRequestSchema,
    response: BookTypographyResponseSchema,
  }),
  async (req, res) => {
    // ownership FIRST (404 for a non-owner — a 403 would confirm the book exists),
    // then isEditable (403). Presentation-only, but still a mutation on a Book row:
    // published books stay immutable. See spec §Ruling 2.
    // NO bookVersion.create and NO book.version bump — that is the ruling, not an
    // oversight. Do not "fix" it by snapshotting.
  },
);
```

**Tests to write:**
- `server/src/routes/__tests__/books.test.ts`:
  - 401 with no `Authorization` header (proves `requireAuth` precedes `validate` — send a
    bad body too, and assert 401 not 400)
  - 404 for an authenticated non-owner
  - 403 + `PUBLISHED_IMMUTABLE_ERROR` on a published book
  - 400 for `font_family: 'comic-sans'` and for an unknown extra key (`.strict()`)
  - 200 for the owner of a draft, `toMatchObject({ font_family: 'atkinson', text_size: 'large' })`
  - after a successful write, `book.version` is unchanged **and**
    `prisma.bookVersion.count({ where: { book_id } })` is unchanged
- Wire-shape assertion required: **yes** — `BookTypographyResponseSchema`
  (= `BookWithPagesSchema`), both new fields pinned.

**Done when:** listed tests pass, `cd server && npm test` green, no new TS errors.

---

### Task 5 — Vendor Atkinson Hyperlegible and Lexend

**Status:** Not started

**Zone:** client (assets + CSS)
**Depends on:** none
**Parallel-safe with:** Tasks 1–4

**Files to add or change:**
- `client/public/fonts/atkinson-hyperlegible-latin.woff2`, `-latin-ext.woff2`
- `client/public/fonts/lexend-latin.woff2`, `-latin-ext.woff2`
- `client/public/fonts/AtkinsonHyperlegible-OFL.txt`, `Lexend-OFL.txt`
- `client/public/fonts/README.md` — new table rows + versions
- `client/src/index.css` — four `@font-face` blocks + two `@theme` tokens

**Signatures / shapes:**

```css
/* @theme, alongside --font-display / --font-body */
  --font-atkinson: 'Atkinson Hyperlegible', sans-serif;
  --font-lexend: 'Lexend', sans-serif;
```

Follow the README's existing procedure exactly: request the css2 URL with a modern
browser User-Agent (a bare curl UA gets legacy TTF), take the `latin` and `latin-ext`
URLs, copy `OFL.txt` from `github.com/google/fonts/ofl/<family>/OFL.txt`, and record the
version in the table. Family names in `@font-face` must match the `@theme` values
**exactly** — a typo silently falls back to system sans.

**Verify the licence file on each release you actually download.** The spec assumes OFL
1.1 for both; if either turns out otherwise, stop and hand back rather than vendoring it.

**Do NOT add these to the `<link rel="preload">` pair in `client/index.html`.** Unused
`@font-face` families are never fetched; preloading them is the one way to make them cost
every visitor bytes.

**Manual verify:** `npm run dev:client`, DevTools Network filtered to Font — confirm only
the two Fredoka/Nunito latin faces load on the Home page, and that an Atkinson face loads
only once something on screen uses it.

**Done when:** `cd client && npm run build` succeeds, no font 404s, README table updated.

---

### Task 6 — Client typography resolver + Tailwind class maps

**Status:** Not started

**Zone:** client
**Depends on:** Tasks 1 and 5
**Parallel-safe with:** none (Tasks 7–8 import from here)

**Files to add or change:**
- `client/src/lib/typography.ts` — new
- `client/src/lib/__tests__/typography.test.ts` — new

**Signatures / shapes:**

```ts
import type { FontFamily, TextSize } from '@storybook/shared';

/** Only the fields the resolver reads — so a raw Book, a hydrated one, or a test
 *  fixture are all assignable. */
export interface TypographySource { font_family: FontFamily; text_size: TextSize }

/** `page` is the seam for per-page overrides (spec §Ruling 1). Unused in v1 —
 *  deliberately present so the override lands as a one-line change, not a signature
 *  change through every call site. */
export function resolveTypography(
  book: TypographySource,
  page?: Partial<TypographySource>,
): string;

export const FONT_LABELS: Record<FontFamily, string>;   // chip labels
export const SIZE_LABELS: Record<TextSize, string>;
```

Class maps — the `md:` variants must be literal strings, not interpolated, or Tailwind's
scanner will not emit them:

| `text_size` | classes |
|---|---|
| `cozy` | `text-sm md:text-base leading-relaxed` |
| `standard` | `text-base md:text-lg leading-relaxed` |
| `large` | `text-lg md:text-xl leading-loose tracking-wide` |
| `xlarge` | `text-xl md:text-2xl leading-loose tracking-wide` |

| `font_family` | class |
|---|---|
| `fredoka` | `font-display` |
| `nunito` | `font-body` |
| `atkinson` | `font-atkinson` |
| `lexend` | `font-lexend` |

Colour classes (`text-gray-700 dark:text-gray-200`) stay constant across every token.

**Tests to write:**
- `client/src/lib/__tests__/typography.test.ts`:
  - **the pin:** `resolveTypography({ font_family: 'fredoka', text_size: 'standard' })`
    equals `'text-base md:text-lg text-gray-700 dark:text-gray-200 leading-relaxed font-display'`
    — the exact string at `BookSpread.tsx:573` today. This test *is* the no-visual-change
    guarantee; if it needs editing, something is wrong.
  - every one of the 16 combinations returns a non-empty string containing both a
    `dark:` colour class and exactly one `font-*` class
  - the unused `page` argument does not change the result in v1
- Wire-shape assertion required: no.

**Done when:** listed tests pass, `cd client && npm test` green, no new TS errors.

---

### Task 7 — `BookSpread` consumes the resolved class

**Status:** Not started

**Zone:** client
**Depends on:** Task 6
**Parallel-safe with:** none

**Files to add or change:**
- `client/src/components/BookSpread.tsx` — `StoryText`'s `<p>` className at line 573
- `client/src/components/__tests__/BookSpread.test.tsx` — extend

**Signatures / shapes:**

`StoryText` already takes a `className` for its wrapper `<div>`; add a separate
`textClassName: string` prop for the `<p>`, resolved once at the top of `BookSpread` from
`book` and passed down through both call sites (lines ~241 and ~295). Resolving once
rather than per-spread keeps the two panels in sync by construction.

The hard-coded string at line 573 is **replaced**, not appended to — the resolver already
emits the colour classes.

**Tests to write:**
- `client/src/components/__tests__/BookSpread.test.tsx`:
  - a book with `fredoka`/`standard` renders the story `<p>` with today's exact class
    string (the second half of the no-visual-change pin, this time through the component)
  - a book with `atkinson`/`xlarge` renders `font-atkinson` and `text-xl md:text-2xl`
  - the narration highlight spans still render inside the same `<p>` (regression: the
    highlight path shares that element)
- Wire-shape assertion required: no.

**Manual verify:** open a book in the reader, light and dark, and confirm the text is
pixel-identical to `master` before any picker exists.

**Done when:** listed tests pass, `cd client && npm test` green, no new TS errors.

---

### Task 8 — `TypographyControls` picker + `BookDetail` wiring

**Status:** Not started

**Zone:** client
**Depends on:** Tasks 4, 6, 7
**Parallel-safe with:** none

**Files to add or change:**
- `client/src/components/TypographyControls.tsx` — new
- `client/src/pages/BookDetail.tsx` — the PUT call + pass the handler into `BookSpread`
- `client/src/components/BookSpread.tsx` — render the controls in the owner/draft rail
- `client/src/components/__tests__/TypographyControls.test.tsx` — new
- `client/src/pages/__tests__/BookDetail.test.tsx` — extend

**Signatures / shapes:**

```tsx
interface TypographyControlsProps {
  fontFamily: FontFamily;
  textSize: TextSize;
  onChange: (next: { font_family: FontFamily; text_size: TextSize }) => Promise<void>;
  saving: boolean;
}
```

Presentational only — no fetch inside the component (same rule as `PublishStateBar`).
`BookDetail` owns the `PUT /api/books/:id/typography` call and replaces its `book` state
with the response.

Visible **only** when `isOwner && isDraft`, matching every other editing affordance in the
rail. Two chip rows (4 family, 4 size), each chip mirroring the existing `CreateBook.tsx`
chip classes — including `min-h-[44px] sm:min-h-0` and the
`bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300` unselected pair.

Each family chip renders its own label **in its own family**, so the picker previews the
choice.

**Tests to write:**
- `TypographyControls.test.tsx`: renders 8 chips; the active pair carries the selected
  styling; clicking a family chip calls `onChange` with the *current* size preserved (and
  vice versa); chips are disabled while `saving`
- `BookDetail.test.tsx`: a chip click issues `PUT /api/books/:id/typography` with both
  fields and re-renders from the response; a failed PUT surfaces the error toast and does
  not leave the UI showing the unsaved choice
- `BookSpread.test.tsx`: controls absent for a non-owner, absent on a published book
- Wire-shape assertion required: no (client-side).

**Manual verify:** in the browser, as the owner of a draft, cycle all four sizes and all
four families in **both** light and dark mode; confirm no chip loses contrast in dark and
that the reader text updates live.

**Done when:** listed tests pass, `cd client && npm test` green, lint + typecheck clean.

---

### Task 9 — e2e: typography survives both themes at a mobile viewport

**Status:** Not started

**Zone:** e2e
**Depends on:** Task 8
**Parallel-safe with:** none

**Files to add or change:**
- `e2e/tests/mobile/typography.spec.ts` — new

**Signatures / shapes:**

Use the existing helpers from `e2e/tests/mobile/_helpers.ts` — `forEachTheme`,
`expectNoHorizontalOverflow`, `expectTapTargets`. This spec claims the **correctness**
half of done-criterion #2 (ADR-009); state that in a header comment. The aesthetic half
stays with the manual verify in Task 8.

**Tests to write:**
- `forEachTheme`: owner opens a draft, sets `xlarge` + `atkinson`, reader text reflects it,
  `expectNoHorizontalOverflow(page)` holds — `xlarge` at a 375px viewport is the most
  likely place for the layout to break
- `expectTapTargets(page, '[data-testid="typography-chip"]')`
- a published (non-owner) book shows no picker and renders at the book's stored typography
- Wire-shape assertion required: no.

**Done when:** `cd e2e && npm test` green.

---

### Task 10 — Pre-merge follow-ups

**Status:** Not started

**Zone:** docs (harness) · **Depends on:** none (run last)

For each ADR-worthy item in `spec.md`, ensure exactly one tracking action exists — a
matching ADR, a linked issue, or an explicit `Deferred:` line with reasoning:

1. `/create-adr` for **Ruling 1** (book-level, per-page deferred), folding in Ruling 4
   (non-null defaults, age values at creation only) if it reads thin alone.
2. `/create-adr` for **Ruling 2** (presentation-only, excluded from `BookVersion`), and
   **cross-link it into [#89](https://github.com/slickG0ose/storybook/issues/89)** — if
   #89 later sweeps typography into `pages_json`, this ruling is overturned silently.
3. File the print follow-up as a sub-issue of
   [#27](https://github.com/slickG0ose/storybook/issues/27): register the four families in
   `pdf.tsx`, and measure overflow for all four size tokens at the 8.5"×8.5" trim. Link
   spec §Print assessment, including the @react-pdf WOFF2/variable-font caveat.
4. File the `age_range` vocabulary divergence (`CreateBook.tsx:26` vs `seed.ts`) as a
   standalone bug, linking spec §Ruling 3.
5. Comment on [#113](https://github.com/slickG0ose/storybook/issues/113) that the title is
   now inaccurate (book-level shipped, per-page deferred), and record the OpenDyslexic
   hold-back for Nick to overrule.

**Done when:** `adr-tracking-check per-page-font-size` reports zero orphaned items.

## Sequencing notes

- **Task 1 is a hard gate.** It stops for a guardrail confirmation. Nothing downstream of
  it can start meaningfully, because `FontFamily` / `TextSize` don't exist until it lands.
- **Tasks 2 and 5 are the parallel cut** — a pure server function and a font-vendoring
  chore. Task 5 shares no file with anything else in the plan and can run at any point
  before Task 6.
- **Commit boundaries.** Tasks 1–4 are a coherent server-side PR on their own: the columns
  exist, the route works, nothing user-visible has changed. If the branch needs splitting,
  split there. Tasks 5–9 are the client half.
- **Task 6's pin test is the safety net for the whole feature.** If it ever needs editing
  to pass, the no-visual-change constraint has been broken — stop, don't update the
  expectation.
- **Task 9 is the last chance to catch a layout break.** `xlarge` at 375px is the case
  most likely to overflow; if it does, the fix is in the size scale (Task 6), not in the
  spec.

## Open questions

Both were resolved by Nick on 2026-09-02, before Task 1 ran. Kept here as the record.

- **~~The migration needs Nick's confirmation before Task 1 runs.~~** **Confirmed.** The
  two additive columns on `Book`, with DB defaults `'fredoka'` / `'standard'` and no
  seed-data change, are approved. The guardrail is discharged.
- **~~OpenDyslexic in or out of v1?~~** **Out** — the spec's recommendation stands. The
  curated enum is the four families in the spec's table and no fifth value. Revisit on
  request; widening the enum after this ships is a wire-shape change, so it needs its own
  slice rather than an amendment here.
