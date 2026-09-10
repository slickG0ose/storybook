# Age-range vocabulary — one canonical enum — task plan

> Spec: [spec.md](spec.md)
> Status: Draft
> Last updated: 2026-09-09

## Overview

Seven tasks. Task 1 lands the shared vocabulary; Tasks 2–4 are all server-zone and must run
**one at a time** (two server suites share `test.db`); Task 5 is the only client work and can
run alongside any server task; Tasks 6–7 are docs and close-out. The only guardrail-gated task
is 4 (rewrites existing `Book` rows) — it needs an explicit user go-ahead before it runs.

## Cross-cutting constraints

- **Wire-shape:** `GET /api/books/age-ranges` changes its *contents* (Task 3). Response schema
  `BookFacetResponseSchema` is unchanged, but the route test must pin the response with a
  `toMatchObject`-equivalent assertion naming the exact array. `POST /api/generate` gains a
  **request** schema (`GenerateRequestSchema`); it has no response schema today and is not
  getting one here.
- **Auth / middleware order:** `POST /api/generate` becomes
  `requireAuth → validate(GenerateRequestSchema) → spendGate('story') → handler`. `validate`
  goes before `spendGate`; do not reorder `requireAuth`.
- **Dark-mode parity:** Task 5 changes only the *set* of age buttons, not their classes. The
  existing button already has `dark:` partners. Verify in both themes anyway; do not
  introduce a className without a `dark:` variant.
- **Migrations:** **none.** No `schema.prisma` change and no `migrations/` folder in this
  plan. Row convergence is a boot-time backfill (Task 4). Do not run `db:migrate` or
  `db:reset`.
- **Guardrails touched — surface these before acting:**
  1. Zod wire-shape change in `@storybook/shared` (Task 1, additive only).
  2. Rewriting existing `Book.age_range` rows (Task 4). CLAUDE.md requires user confirmation.
     Back up first: `cp server/prisma/dev.db server/prisma/dev.db.bak.db` (the `.db` suffix is
     load-bearing for `.gitignore` — see `docs/conventions/data.md`).
- **Seed values do not change.** `server/prisma/seed.ts`, `server/src/db/init.ts`,
  `server/src/__tests__/setup.ts`, and `demo-seed-fixtures/spot-for-sunny.json` already hold
  only canonical values. If you find yourself editing a seed value, stop — something is wrong.

## Tasks

### Task 1 — Canonical `AgeRangeSchema` + `GenerateRequestSchema` in `@storybook/shared`

**Zone:** shared
**Depends on:** none
**Parallel-safe with:** none (everything else imports this)

**Status:** Done (2026-09-09)

**Files to add or change:**
- `shared/src/books.ts` — add `AgeRangeSchema`, `AgeRange`, `AGE_RANGES` next to
  `FontFamilySchema` (same curated-closed-set comment style)
- `shared/src/generate.ts` — **new**, `GenerateRequestSchema`
- `shared/src/index.ts` — `export * from './generate';`

**Signatures / shapes:**
```ts
// shared/src/books.ts
export const AgeRangeSchema = z.enum(['2-5', '3-6', '4-7', '4-8', '5-9']);
export type AgeRange = z.infer<typeof AgeRangeSchema>;
/** Canonical display order for the CreateBook picker and the Home facet list. */
export const AGE_RANGES: readonly AgeRange[] = AgeRangeSchema.options;

// shared/src/generate.ts
import { z } from 'zod';
import { AgeRangeSchema } from './books';

// Every field the handler reads must be listed: z.object strips unknown keys and
// validate() replaces req.body with the parsed value, so an omission here silently
// deletes a feature. Only theme + ageRange tighten; the rest preserve today's
// tolerance because the handler already normalises them.
export const GenerateRequestSchema = z.object({
  theme: z.string().min(1),
  ageRange: AgeRangeSchema,
  additionalDetails: z.string().optional(),
  characterName: z.string().optional(),
  characters: z
    .array(
      z.looseObject({
        role: z.string().optional(),
        name: z.string().optional(),
        descriptor: z.string().optional(),
        relationship: z.string().optional(),
      }),
    )
    .optional(),
  styleDescriptor: z.string().optional(),
  styleReferenceUrl: z.string().optional(),
  previewMode: z.string().optional(),   // normalised by VALID_PREVIEW_MODES in the handler
  pageCount: z.unknown().optional(),    // normalised/clamped by normalizePageCount()
});
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;
```

If `z.looseObject` is not the right Zod 4 spelling in this repo's version, use whatever
existing shared schema does pass-through — the requirement is that an entry with a junk
`role` survives parsing so `normalizeCharacters()` can drop it, exactly as today.

**Tests to write:**
- `server/src/lib/__tests__/ageRangeVocabulary.test.ts` (new; server zone because it reads the
  seed file) — reads `server/prisma/seed.ts` as text, extracts every `age_range: '<value>'`
  literal, asserts each is in `AGE_RANGES` and that the extracted set equals `AGE_RANGES`.
  This is the anti-drift catch-net; model it on the existing test that pins
  `STOREFRONT_DEFAULT` against `schema.prisma`.
- Wire-shape assertion required: no (no route touched in this task).

**Done when:** `cd server && npm test` and `cd client && npm test` green, no new TS errors,
and nothing imports `AGE_RANGES` yet except the new test.

---

### Task 2 — `validate()` on `POST /api/generate`

**Zone:** server
**Depends on:** 1
**Parallel-safe with:** 5 (never with 3 or 4 — server suites share `test.db`)

**Status:** Done (2026-09-09)

**Files to add or change:**
- `server/src/routes/generate.ts` — import `validate` + `GenerateRequestSchema`; mount as
  `router.post('/', requireAuth, validate({...}), spendGate('story'), handler)`; narrow
  `GenerateRequestBody.ageRange` to `AgeRange`
- `server/src/routes/__tests__/generate.test.ts` — fixture sweep + new cases
- `server/src/routes/__tests__/spend.test.ts:339` — `ageRange: '5-7'` → `'5-9'`

**Signatures / shapes:**
```ts
router.post(
  '/',
  requireAuth,
  validate({ name: 'POST /api/generate', request: GenerateRequestSchema }),
  spendGate('story'),
  async (req: Request, res: Response) => { /* unchanged body */ },
);
```
Keep the handler's `if (!theme || !ageRange || !primary)` check — Zod now covers the first
two, but the "at least one primary character" half is a cross-field rule and stays.

**Tests to write:**
- `generate.test.ts` — `VALID_BODY.ageRange: '5-7'` → `'5-9'` (same `developing` bucket, so no
  typography assertion moves; update the comment at line ~201 that names `'5-7'`).
- `generate.test.ts` — rejects an off-vocabulary `ageRange`: `'6-10'`, `'2-4'`, and
  `'all ages'` each return 400 with `error: expect.any(String)`, **and** assert
  `await prisma.book.count()` is unchanged so nothing is persisted.
- `generate.test.ts` — replace the existing "unrecognised ageRange still creates a book at
  standard" case (line ~307): it now asserts a 400 instead. The tolerant-parse behaviour it
  covered still lives in `server/src/lib/__tests__/typography.test.ts` and stays there.
- `generate.test.ts` — the `it.each` typography table (line ~281): drop the `'6-10'` and
  `'8-12'` rows, keep/extend with canonical values only (`'3-6'` → `fredoka`/`large`,
  `'5-9'` → `fredoka`/`standard`). Leave a comment pointing at the spec's `Deferred:` item for
  why `independent` has no route-level row.
- `generate.test.ts` — **strip guard:** one test posting a full-fat body (every optional field
  populated: `additionalDetails`, `characters`, `styleDescriptor`, `styleReferenceUrl`,
  `previewMode`, `pageCount`) asserting the created book still carries `style_descriptor`,
  `style_reference_url`, and the right `characters_json` — proving `GenerateRequestSchema`
  doesn't strip a field the handler needs.
- `generate.test.ts` — the missing-fields test at line ~134 (`{ theme: 'space' }`) now gets
  Zod's message; assert `{ error: expect.any(String) }` and status 400.
- Wire-shape assertion required: no new response shape; the 400 envelope is pinned the normal
  way (`toMatchObject({ error: expect.any(String) })`).

**Done when:** `cd server && npm test` green, no new TS errors.

---

### Task 3 — `GET /api/books/age-ranges` serves `DISTINCT ∩ canonical`

**Zone:** server
**Depends on:** 1
**Parallel-safe with:** 5 (never with 2 or 4)

**Status:** Done (2026-09-09)

**Files to add or change:**
- `server/src/routes/books.ts` — the `/age-ranges` handler (~line 141)
- `server/src/routes/__tests__/books.test.ts` — new describe block beside the existing
  `GET /api/books/themes` one (~line 131). There is **no** test for `/age-ranges` today

**Signatures / shapes:**
```ts
// Response schema unchanged: BookFacetResponseSchema (z.array(z.string())).
// Contents narrow: only canonical values, in AGE_RANGES order, and only those that
// actually have a book behind them. A stray row can no longer render a filter chip.
const present = new Set(books.map(b => b.age_range));
res.json(AGE_RANGES.filter(r => present.has(r)));
```
`/themes` is deliberately untouched — theme has no canonical enum and is not this issue.

**Tests to write:**
- `books.test.ts` — with the canonical seed catalog, returns exactly
  `['2-5', '3-6', '4-7', '4-8', '5-9']` in that order (wire-shape assertion for this route).
- `books.test.ts` — insert a book with `age_range: '6-10'` directly via Prisma; assert the
  route omits it while `GET /api/books?age_range=6-10` still returns that book (the row is
  shoppable by direct query, just not advertised as a facet).
- `books.test.ts` — a soft-deleted book's age range is still excluded (the existing
  `deleted_at: null` filter must survive the rewrite).
- Wire-shape assertion required: **yes** — `BookFacetResponseSchema` / `GET /api/books/age-ranges`.

**Manual verify (if applicable):**
- Home page filter chips render the canonical five, light and dark mode.

**Done when:** `cd server && npm test` green, no new TS errors.

---

### Task 4 — Boot-time backfill for legacy rows  ⚠️ guardrail — confirm before running

**Zone:** server
**Depends on:** 1
**Parallel-safe with:** 5 (never with 2 or 3)

**Status:** Done (2026-09-09) — user go-ahead given, `dev.db` backed up, and the local
run confirmed a true no-op (md5 identical before and after, verified twice
independently). Deviation from the manual-verify wording: the service logs nothing on
a clean pass, matching `emailBackfill.ts` / `reconcileAdmins()`, which log only when
there is something to report. The 0/0 result was proven by direct invocation instead.

> **Stop and surface before executing.** This task writes to existing `Book` rows — a CLAUDE.md
> guardrail. Get an explicit user go-ahead, and back up first:
> `cp server/prisma/dev.db server/prisma/dev.db.bak.db`.
> Local `dev.db` was verified on 2026-09-09 to hold **zero** affected rows (9 books:
> `4-7`×3, `3-6`×3, `5-9`, `4-8`, `2-5`), so locally this is expected to be a no-op —
> confirm that with a read-only query before you write any code, and report it.

**Files to add or change:**
- `server/src/services/ageRangeBackfill.ts` — **new**, modelled on `services/emailBackfill.ts`
- `server/src/index.ts` — call it beside `backfillUserEmails()` (~line 145), same
  fire-and-forget, self-reporting, never-fatal shape
- `server/src/services/__tests__/ageRangeBackfill.test.ts` — **new**

**Signatures / shapes:**
```ts
/** Legacy client vocabulary → canonical. Both sides of each pair bucket identically in
 *  ageBucketFor(), so no book's typography can move: 2-4 and 2-5 are both `early`
 *  (lower bound ≤ 4); 6-10 and 5-9 are both `developing` (5–7). */
export const LEGACY_AGE_RANGE_MAP: Record<string, AgeRange> = {
  '2-4': '2-5',
  '6-10': '5-9',
};

export interface AgeRangeBackfillResult {
  /** book ids rewritten this boot, with from/to. */
  rewritten: Array<{ id: string; from: string; to: AgeRange }>;
  /** Off-vocabulary values NOT in the map — reported, never guessed at. */
  unmapped: Array<{ id: string; age_range: string }>;
}

export async function backfillBookAgeRanges(): Promise<AgeRangeBackfillResult>;
```
Rules: no `deleted_at` filter (tombstoned books get restored, and a stale value would come
back with them); rewrite **only** the two mapped values; never delete or merge a row; a
failure is logged, never fatal.

**Tests to write:**
- `ageRangeBackfill.test.ts` — rewrites `2-4` → `2-5` and `6-10` → `5-9`, returns them in
  `rewritten`.
- `ageRangeBackfill.test.ts` — leaves `all ages` / `3-5` untouched and reports them in
  `unmapped` (the never-guess rule).
- `ageRangeBackfill.test.ts` — rewrites a soft-deleted book too.
- `ageRangeBackfill.test.ts` — no-op on the canonical seed catalog: zero `rewritten`, zero
  `unmapped`, and running it twice changes nothing (idempotent).
- `ageRangeBackfill.test.ts` — typography is untouched by a rewrite: assert the rewritten
  book's `font_family`/`text_size` columns are byte-identical before and after, and that
  `ageBucketFor('2-4') === ageBucketFor('2-5')` and `ageBucketFor('6-10') === ageBucketFor('5-9')`.
- Wire-shape assertion required: no (service, not a route).

**Manual verify (if applicable):**
- After the user's go-ahead and the `dev.db` backup: start the dev server once and confirm the
  boot log reports 0 rewritten / 0 unmapped, and that `sqlite3 server/prisma/dev.db
  "SELECT age_range, COUNT(*) FROM Book GROUP BY age_range;"` is unchanged from the
  pre-run reading.

**Done when:** listed tests pass, `cd server && npm test` green, no new TS errors, and the
local no-op is confirmed against the actual `dev.db`.

---

### Task 5 — `CreateBook.tsx` reads the canonical list

**Zone:** client
**Depends on:** 1
**Parallel-safe with:** 2, 3, or 4 (different zone, different test DB)

**Status:** Done (2026-09-09) — mechanical half only; the aesthetic manual-verify
(light/dark legibility of the selected chip, 44px tap targets at mobile) is still
outstanding and needs a human.

**Files to add or change:**
- `client/src/lib/ageRanges.ts` — **new**, thin re-export so a page never imports
  `@storybook/shared` directly (call-graph rule). Mirrors `client/src/lib/cost.ts`
- `client/src/pages/CreateBook.tsx` — delete the literal at line 26, import from
  `../lib/ageRanges`; button rendering at line ~449 is otherwise unchanged
- `client/src/pages/__tests__/CreateBook.test.tsx` — no age-range coverage exists today

**Signatures / shapes:**
```ts
// client/src/lib/ageRanges.ts
// The canonical vocabulary lives in @storybook/shared so client and server cannot
// diverge (#172). Re-exported here because pages must not import shared directly and
// AGE_RANGES is a value, not a type, so it cannot ride the client/src/types.ts barrel.
export { AGE_RANGES } from '@storybook/shared';
export type { AgeRange } from '@storybook/shared';
```

**Tests to write:**
- `CreateBook.test.tsx` — renders exactly one button per entry of `AGE_RANGES` (iterate the
  imported constant; do **not** re-type the literals in the test, or the drift catch-net has a
  hole), and renders no button for the retired `2-4` / `6-10`.
- `CreateBook.test.tsx` — clicking an age button selects it and lets step 2 advance.
- Wire-shape assertion required: no.

**Manual verify (if applicable):**
- `npm run dev`, walk `/create` step 2: five age chips, correct labels, selected state legible
  in **both** light and dark mode; tap targets still 44px on a mobile viewport.

**Done when:** `cd client && npm test` green plus typecheck/lint/build, no new TS errors.

---

### Task 6 — Retire the "two divergent vocabularies" narration

**Zone:** docs (plus one server docblock)
**Depends on:** 1, 2, 3, 4, 5
**Parallel-safe with:** none (it describes the finished state)

**Status:** Done (2026-09-09) — the done-when grep over `server client docs` is empty;
remaining hits live only in `.code-captain/specs/`, which the criterion allows as history.

**Files to add or change:**
- `server/src/lib/typography.ts` — the §Ruling 3 docblock (lines ~8–13) currently states the
  repo carries two vocabularies. Rewrite: there is now one canonical enum, `ageBucketFor()`
  **keeps** its tolerant parse deliberately (legacy rows, restored versions, prod rows the
  backfill reported as unmapped), and the `independent` bucket remains unreachable — link the
  spec's `Deferred:` item. **Do not change `ageBucketFor()`'s logic.**
- `server/src/lib/__tests__/typography.test.ts` — keep the `2-4` / `6-10` cases (they are
  tolerance tests, not vocabulary claims); relabel them as retired-legacy values.
- `docs/conventions/call-graph.md` — add `client/src/lib/ageRanges.ts` to the list of client
  files allowed to import from `@storybook/shared`, with the one-line reason (it re-exports a
  value, not a type).

**Tests to write:**
- None new. Confirm `server/src/lib/__tests__/typography.test.ts` still passes unchanged in
  behaviour.
- Wire-shape assertion required: no.

**Done when:** `cd server && npm test` green, no new TS errors, and no file in the repo still
claims two age-range vocabularies (`grep -rn "divergent vocabular" server client docs` is
empty except the spec's history section).

---

### Task 7 — Pre-merge follow-ups

**Zone:** docs (harness) · **Depends on:** none (run last)

**Status:** Done (2026-09-10) — ADR-023 (canonical vocabulary, write-only enforcement, and
the facet route folded in as its third part) and ADR-024 (boot-time backfill, because prod
deploys with `db push`) written to `.code-captain/product/decisions.md`. The `Deferred:` item
for #113's `independent` bucket was already written and stays as-is. Both `tasks.md` open
questions closed with their resolutions in place.

For each ADR-worthy item in `spec.md`, ensure exactly one tracking action exists — a matching
ADR, a linked issue, or an explicit `Deferred:` line with reasoning. Expected shape here:
two `/create-adr` entries (canonical vocabulary + write-only enforcement; boot-time backfill
because prod runs `db push`), one that may fold into the first (the facet route), and one
already-written `Deferred:` (#113's `independent` bucket — do **not** convert it into work).

**Done when:** `adr-tracking-check age-range-vocabulary` reports zero orphaned items.

## Sequencing notes

- **Tasks 2, 3, and 4 are all server-zone and must not run concurrently** — two server suites
  share `server/test.db`. Task 5 is the only safe parallel partner for any of them.
- Natural commit boundaries: Task 1 alone (shared contract), Tasks 2–4 individually (each is a
  behaviour change with its own tests), Task 5 alone (client), Task 6 (docs).
- Task 4 is the only one that can be blocked waiting on the user. If the go-ahead is slow, run
  Tasks 5 and 6's non-Task-4-dependent parts first — but do not open the PR without 4, or the
  enum ships while stale rows keep rendering the old facets.
- Do not run `db:migrate`, `db:reset`, or any seed script during this plan. Nothing here
  changes the schema or the seed values.

## Open questions

- **Prod row counts are unknown.** ~~Nobody in this worktree can query the deployed Postgres.~~
  **Resolved by design, confirmation pending deploy (2026-09-10).** Still unqueryable from
  here — no prod credentials in the worktree. It does not block: the backfill is a no-op when
  nothing matches, rewrites only the two mapped values, and reports anything else rather than
  guessing. Local `dev.db` was verified a true no-op (md5 identical before and after). The
  proof-of-life log line added after Task 4 makes the next production boot self-reporting, so
  the answer arrives without anyone running a query. **Tracking:** the deploy itself, and
  [#78](https://github.com/slickG0ose/storybook/issues/78), which may replace that database
  before the question can be asked.
- **`z.looseObject` spelling** — ~~confirm against the repo's Zod 4 version when writing Task 1.~~
  **Resolved in Task 1 (2026-09-09).** Zod resolves to 4.4.3 in this worktree and
  `z.looseObject` is correct. Verified behaviourally rather than by existence: a `characters`
  entry `{ role: 'junk', name: 'Nope', extra: 1 }` survives parsing with `extra` intact, so
  `normalizeCharacters()` still does the dropping instead of the schema 400ing the request.
  No in-repo precedent existed — every other shared schema is `z.object` or `.strict()`.
