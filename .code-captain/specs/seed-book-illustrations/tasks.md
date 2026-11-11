# Seed-book illustrations — task plan

> Spec: [spec.md](spec.md)
> Status: Approved (owner, 2026-11-11 — all five Owner decisions)
> Last updated: 2026-11-11

## Overview

Eight tasks, about a day of code plus a 45-minute owner session for Task 5.

| Tasks | What | Spends money? | Writes art URLs? |
|---|---|---|---|
| 1–4 | Code: seed module, test hygiene, prompt-builder extraction, generation script | No | No |
| 5 | **GATED.** Runs the paid generation on the owner's machine | Yes | No |
| 6 | Wires the committed art into the seed, with integrity tests | No | Yes |
| 7 | Docs and full verification | No | No |
| 8 | ADR follow-ups | No | No |

Tasks 1–4 can merge, or sit green on the branch, whether or not Task 5 has run. Every task touches the server zone, so they run **one at a time**: server suites share `test.db`.

## Cross-cutting constraints

- **Owner confirmation:** Task 5 must not start until the owner has answered the five items in spec §Owner decisions. Tasks 1–4 need none.
- **Wire-shape:** no route, no `@storybook/shared` change, no new response field. `characters_json` must parse under the existing `CharacterSchema` (`shared/src/books.ts:11`). If you find yourself editing `shared/`, stop and surface it.
- **Migrations:** none. Do not touch `schema.prisma` or either migrations directory.
- **Seed stays upsert-only:**
  - never `db:reset`
  - never `deleteMany` in a seed path
  - `update:` must not include `id`, `created_by`, `deleted_at` or `created_at`
- **Seed books stay unowned.** `created_by` stays null on all 6. The whole always-set design depends on it (spec §Proposed shape).
- **Never write into `server/public/illustrations/<seed-id>/` from a test.** Use a test-only book id. Task 2 adds a guard test for this.
- **No new dependency:** `sips`, with `npx -y sharp-cli` as the fallback, both from outside any `package.json`. Do not `npm i sharp`.
- **Paid API:** only `server/scripts/generate-seed-art.ts --spend` may call a provider, and only in Task 5. Tests inject a fake generator. No test makes a live call.
- **Dark-mode parity:** no new UI. Task 7 still checks both themes in the browser, because the seed books now render art.
- **Guardrails touched:** paid API (Task 5), seed data values (Tasks 1 and 6), prod DB write via the deploy seed (merge). All are covered by spec §Owner decisions. Anything beyond them (a schema change, a new package, an R2 write) means stop and surface it.

## Tasks

### Task 1 — Extract canonical seed data and an idempotent `seedCanonicalBooks()`

**Zone:** server
**Depends on:** none
**Parallel-safe with:** none (server zone)
**Status:** Done (2026-11-11)

**Files to add or change:**
- `server/src/seed/canonicalBooks.ts` (new) — move `books` and `pages` out of `seed.ts` verbatim. Add `style_descriptor` and `characters` per book, copied from spec §Style and cast. Add `seedCanonicalBooks()`. It lives under `src/` so the server `tsconfig` (`rootDir: ./src`) typechecks it.
- `server/prisma/seed.ts` — becomes a runner: `new PrismaClient()` → `seedCanonicalBooks(prisma)` → log → disconnect. The output line stays `Seeded 6 books with pages`.
- `server/src/seed/__tests__/canonicalBooks.test.ts` (new)

**Signatures / shapes:**
```ts
import type { PrismaClient } from '@prisma/client';
import type { Character } from '@storybook/shared';

export const SEED_BOOK_IDS = [
  'luna-star-garden', 'captain-bear-submarine', 'robot-learns-to-hug',
  'dinosaur-bakery', 'cloud-painter', 'brave-little-seed',
] as const;
export type SeedBookId = typeof SEED_BOOK_IDS[number];

export interface CanonicalBook {
  id: SeedBookId;
  title: string; author: string; description: string; theme: string;
  age_range: string; cover_emoji: string; cover_color: string;
  price: number; is_featured: boolean; is_user_created: false;
  style_descriptor: string;
  characters: Character[];          // stored as JSON.stringify(...) in characters_json
  coverScene?: string;              // script-only override; NEVER written to the row
  pages: { text: string; illustration_description: string }[]; // exactly 5
}

export const CANONICAL_BOOKS: readonly CanonicalBook[];

/** Upsert-only. Same rows on every run. Never touches created_by, deleted_at,
 *  created_at, or any row whose id is not in SEED_BOOK_IDS. */
export async function seedCanonicalBooks(prisma: PrismaClient): Promise<{ books: number; pages: number }>;
```
In this task, `characters` entries carry **no** `portrait_url`. The book row gets **no** `cover_url` or pin, and pages get no `illustration_url`. Those arrive in Task 6.

**Tests to write:**
- `server/src/seed/__tests__/canonicalBooks.test.ts`:
  1. Exactly the 6 ids in `SEED_BOOK_IDS`, each with 5 pages, no `created_by` field.
  2. Every `characters` array parses with `z.array(CharacterSchema)`, and each book has at least one `primary`.
  3. `coverScene` never appears in the data `seedCanonicalBooks` writes: spy on `prisma.book.upsert` args, or read the row back and check no column holds it.
  4. Run on `test.db` after `resetDatabase()`: rows match `CANONICAL_BOOKS` (title, `style_descriptor`, parsed `characters_json`).
  5. Running it twice gives identical rows, and the page count stays 30.
  6. With a seed book's `deleted_at` set first, `deleted_at` is unchanged after seeding.
  7. A user-created book inserted first is byte-identical afterwards.
- Wire-shape assertion required: no (no route change)

**Done when:** the new tests pass, `cd server && npm test` is green with no other test edited, `cd server && npx tsc --noEmit` is clean, and `cd server && npm run db:seed` prints `Seeded 6 books with pages` against `dev.db`. About 1.5 hours.

---

### Task 2 — Stop server tests touching seed-book illustration directories

**Zone:** server
**Depends on:** Task 1 (imports `SEED_BOOK_IDS`)
**Parallel-safe with:** none (server zone)
**Status:** Done (2026-11-11)

**Files to add or change:**
- `server/src/services/__tests__/illustrations.test.ts`:
  - Replace `TEST_BOOK_ID = 'luna-star-garden'` (line 23) and both `BOOK_ID = 'luna-star-garden'` blocks (lines 390 and 696; check line 845 and line 1030 too) with test-only ids such as `illustration-test-book`.
  - Each `describe` creates its own `Book` row in `beforeEach` (`prisma.book.create`) and pages as needed.
  - Do **not** add the row to `resetDatabase()`: `books.test.ts:79`, `books.test.ts:138` and `admin.test.ts:179` assert 6 books.
  - The URL regexes at lines 86, 162 and 467 follow the new id.
- `server/src/services/__tests__/pdf.test.ts` — the same treatment for `TEST_BOOK_ID` (line 7).
- `server/src/seed/__tests__/testHygiene.test.ts` (new) — the guard.

**Signatures / shapes:**
```ts
// testHygiene.test.ts — static scan, no fs writes
// For every file under server/src/**/__tests__/**/*.ts (except this one):
//   if it contains 'public/illustrations' AND any SEED_BOOK_IDS literal,
//   it must be in ALLOWLIST, else fail naming the file and the id.
const ALLOWLIST = {
  'routes/__tests__/books.test.ts':
    'removes only the page-N.png files it wrote; cannot collide with committed .jpg fixtures',
};
```

**Tests to write:**
- `testHygiene.test.ts` — passes after the rekey. Prove it can fail by temporarily reverting one file locally (do not commit the revert).
- Wire-shape assertion required: no

**Done when:**
- `cd server && npm test` is green, with the same test count plus the guard and no assertion removed.
- `git status --short server/public/illustrations/` is empty after a full server run.

About 1 hour.

---

### Task 3 — Export pure prompt builders from `illustrations.ts` (byte-identical)

**Zone:** server
**Depends on:** none (order after Task 2 only because of the server zone)
**Parallel-safe with:** none (server zone)
**Status:** Done (2026-11-11)

**Files to add or change:**
- `server/src/services/__tests__/illustrations.test.ts` — **first**, add characterisation tests. They capture the exact prompt string that `generateIllustration`, `generateCover` and `generateCharacterPortrait` pass to a mocked generator, for these cases:
  - no style / default style
  - with a style descriptor
  - with cast
  - with an anchor and no feedback
  - with an anchor and feedback
  - with an anchor and portraits

  They must pass on the **current** code before you refactor anything.
- `server/src/services/illustrations.ts` — extract the prompt assembly at lines 390–431, 600–604 and 664–666 into exported pure functions. The public generators call them. Nothing else changes.

**Signatures / shapes:**
```ts
export const DEFAULT_STYLE = 'Whimsical, colorful, warm, suitable for young children';

export function buildIllustrationPrompt(input: {
  description: string;
  feedback?: string;
  styleDescriptor?: string | null;
  characters?: Character[];
  referenceImages?: string[];
  styleAnchor?: string | null;
}): string;

export function buildCoverPrompt(input: {
  title: string; description: string;
  styleDescriptor?: string | null; characters?: Character[];
}): string;

export function buildPortraitPrompt(input: {
  name: string; descriptor?: string; feedback?: string; styleDescriptor?: string | null;
}): string;
```

**Tests to write:**
- The characterisation tests above, plus direct calls to each builder that assert the same strings.
- Every pre-existing prompt assertion in `illustrations.test.ts` and `routes/__tests__/books.test.ts` passes **unedited**.
- Wire-shape assertion required: no

**Done when:** `cd server && npm test` is green, `npx tsc --noEmit` is clean, and the diff to existing assertions is empty. About 1.5 hours.

---

### Task 4 — Seed-art planner and generation CLI (dry-run by default)

**Zone:** server
**Depends on:** Tasks 1 and 3
**Parallel-safe with:** none (server zone)
**Status:** Done (2026-11-11)

**Files to add or change:**
- `server/src/seed/seedArt.ts` (new) — the planner, the cost/cap logic, and the runner, with the generator and the converter injected.
- `server/scripts/generate-seed-art.ts` (new) — CLI. Run as `cd server && npx tsx scripts/generate-seed-art.ts [--spend] [--max-images N] [--redo <id>:<slot>]… [--compress-only] [--only <id>]`.
- `server/src/seed/canonicalBooks.ts` — add `SEED_ART_PIN` and the path helpers below.
- `server/src/seed/__tests__/seedArt.test.ts` (new)
- `.gitignore` — add `server/.seed-art/`. Do **not** add the fixture re-includes yet; those come in Task 6.

**Signatures / shapes:**
```ts
// canonicalBooks.ts
export const SEED_ART_PIN = { provider: 'fal', model: 'fal-ai/flux-pro/v1.1' } as const satisfies ImagePin;
export const SEED_ART_FORMAT = 'jpg' as const;
export const seedCoverUrl    = (id: SeedBookId) => `/illustrations/${id}/cover.jpg`;
export const seedPageUrl     = (id: SeedBookId, n: number) => `/illustrations/${id}/page-${n}.jpg`;
export const seedPortraitUrl = (id: SeedBookId, characterIndex: number) =>
  `/illustrations/${id}/portrait-${1000 + characterIndex}.jpg`;

// seedArt.ts
export type SeedArtSlot = { kind: 'portrait'; characterIndex: number } | { kind: 'cover' } | { kind: 'page'; page: number };
export interface SeedArtJob { bookId: SeedBookId; slot: SeedArtSlot; prompt: string; references: string[] }

export const SEED_ART_ABSOLUTE_MAX_IMAGES = 60;

/** Pure. Order per book: portraits (primary role only) → cover → pages 1..5.
 *  Skips a slot when its raw cache PNG OR committed JPEG exists, unless named in `redo`.
 *  Prompts come ONLY from buildPortraitPrompt / buildCoverPrompt / buildIllustrationPrompt.
 *  Cover uses book.coverScene ?? book.description. References = composeReferenceImages(null,
 *  collectRequiredPortraitRefs(cast-with-staged-portrait-urls)). */
export function planSeedArt(books: readonly CanonicalBook[], exists: (absPath: string) => boolean,
  opts?: { redo?: string[]; only?: SeedBookId[] }): SeedArtJob[];

export function planCostCents(jobs: SeedArtJob[]): number; // jobs.length * costCentsFor('illustration', 'fal')

export async function runSeedArt(jobs: SeedArtJob[], deps: {
  generate: (prompt: string, references: string[]) => Promise<Buffer>; // CLI: getImageGenerator(SEED_ART_PIN).generate
  toJpeg: (pngPath: string, jpgPath: string) => Promise<void>;          // CLI: sips -s format jpeg -s formatOptions 82
  maxImages: number;
}): Promise<SeedArtManifestEntry[]>;
```

**CLI behaviour:**
- **Refuses** (exit 1, with a message) when:
  - `STORAGE_BACKEND` is set to anything but `local`
  - `!isImageGenConfigured('fal')` and `--spend` is set
  - planned jobs > `--max-images` (default = planned count)
  - planned jobs > 60
- **Without `--spend`:** prints one line per job (book, slot, model it will hit, reference count) and the total `N images × 4¢ = $X.XX`, then exits 0. No network, no writes.
- **With `--spend`:** for each job, call the provider, then **immediately** write `server/.seed-art/<id>/<slot>.png`, before any other step. A portrait is also copied to the local storage key `<id>/portrait-<slot>.png`, so `toDataUri` resolves it as a reference for the same book's later jobs. Then convert every cached PNG to JPEG in `server/public/illustrations/<id>/`, and delete the staged `portrait-*.png` from the public directory.
- **Missing raw portrait:** if a portrait's raw PNG is missing from the cache but its committed JPEG exists, rebuild the PNG with `sips -s format png` ($0) before the dependent jobs.
- **Writes `server/src/seed/seed-art-manifest.json`,** one entry per slot:
  ```ts
  {
    bookId, slot, file, bytes, width, height,
    model, // 'fal-ai/flux-pro/v1.1' | 'fal-ai/flux-pro/kontext' | 'fal-ai/flux-pro/kontext/multi'
    prompt, generatedAt,
  }
  ```
- **A redone portrait** prints `WARNING: <id> pages were drawn against the previous portrait; redo them too if they drift.`
- **`sips` missing:** print the `npx -y sharp-cli` fallback command and exit 1. Never install anything.
- **No DB:** the CLI makes no Prisma query. Spend metering is deliberately not called (spec §Spend gates).

**Tests to write:**
- `server/src/seed/__tests__/seedArt.test.ts`, with no live provider and a temp directory for every write:
  1. A full plan with nothing on disk is 43 jobs: 7 portraits, 6 covers, 30 pages.
  2. Robot pages carry 2 references; every other book's pages carry 1; portraits carry 0.
  3. The Luna cover prompt contains the `coverScene` text and not "Storm King".
  4. Existing cache or JPEG → that slot is skipped. `redo` re-adds it.
  5. `planCostCents(43 jobs) === 172`.
  6. `runSeedArt` with a fake `generate` writes the cache before calling `toJpeg`, and stops before job `maxImages + 1`.
  7. A `generate` that throws on job 3 leaves jobs 1–2 cached, and a re-plan then skips them.
- Wire-shape assertion required: no

**Manual verify:** `cd server && npx tsx scripts/generate-seed-art.ts` (no `--spend`) prints 43 jobs and `$1.72`, and changes no file (`git status` is clean).

**Done when:** the tests pass, `cd server && npm test` is green, `npx tsc --noEmit` is clean, and the dry run behaves as above. About 3 hours.

---

### Task 5 — GATED: generate, review and commit the seed art (spends about $1.72, cap $2.40)

> **Do not start without the owner's explicit yes to spec §Owner decisions 1, 4 and 5.** An agent may run the dry run and stop there. The `--spend` run is the owner's, or an agent's only with a written owner instruction in the session. Agent or developer messages do not count as consent.

**Status:** Done (2026-11-11) — 43 images generated, $1.72 spent, 0 redos. 43 JPEGs, all 1024×1024, 15,645,515 bytes total, largest 576,011 bytes (`cloud-painter/page-4.jpg`); 10 files exceed 500 KB. Owner reviewed the contact sheet and said "Commit as is", accepting two flagged images (`luna-star-garden:cover` title reads "STAR ARDEN"; `brave-little-seed:page-4` is off-brief) and painted title text on some covers. Task 6 budgets: ≤ 600 KB per file, ≤ 17 MB total.

**Zone:** ops (owner machine) · **Depends on:** Task 4 · **Parallel-safe with:** none

**Steps:**
1. `cd server && npx tsx scripts/generate-seed-art.ts`. Confirm 43 jobs and $1.72.
2. `cd server && npx tsx scripts/generate-seed-art.ts --spend`. Takes about 10 minutes at about 10 seconds an image.
3. Owner reviews all 43 JPEGs: `open server/public/illustrations/{luna-star-garden,captain-bear-submarine,robot-learns-to-hug,dinosaur-bakery,cloud-painter,brave-little-seed}/`. Check character consistency across a book's pages, that no image contains text, and that the content suits the age range.
4. Redo rejects: `--spend --redo <id>:<slot>`. The script stops at 60 images total, counted per run, so keep a tally: total spend must stay ≤ $2.40.
5. Record the measured totals (file count, total bytes, largest file, dimensions) in the `Status:` line of this task. Feed them into Task 6's budget constants.

**Files produced:** 43 JPEGs under `server/public/illustrations/<id>/`, plus `server/src/seed/seed-art-manifest.json`. **Not committed in this task.** They are untracked until Task 6 adds the re-includes.

**Done when:** the owner has approved every image, `ls server/public/illustrations/*/` shows exactly the 43 expected names and no `.png`, and the measured totals are recorded. About 45 minutes, including review.

---

### Task 6 — Wire committed art into the seed, with integrity tests

**Status:** Done (2026-11-11)

**Zone:** server
**Depends on:** Task 5
**Parallel-safe with:** none (server zone)

**Files to add or change:**
- `server/src/seed/canonicalBooks.ts`:
  - each primary character's `portrait_url` is set to `seedPortraitUrl(...)`
  - `seedCanonicalBooks` now also writes `cover_url: seedCoverUrl(id)`, `image_provider` and `image_model` from `SEED_ART_PIN`, and `characters_json` including `portrait_url`, in both `create` and `update`
  - each page upsert writes `illustration_url: seedPageUrl(id, n)` in both `create` and `update`
- `.gitignore` — six `!server/public/illustrations/<id>/` lines under the existing Sunny line (`.gitignore:27`), and the comment updated to say seed books live here too.
- `server/src/seed/__tests__/seedArtFixtures.test.ts` (new)
- `server/src/seed/__tests__/canonicalBooks.test.ts` — extend.
- Stage the 43 JPEGs and the manifest. Run `git status --short server/public/illustrations/` and confirm all 43 show as added.

**Signatures / shapes:**
```ts
// seedArtFixtures.test.ts — budgets from Task 5's measured totals, with ~15% headroom,
// never above these ceilings:
const MAX_SINGLE_BYTES = 500 * 1024;
const MAX_TOTAL_BYTES  = 15 * 1024 * 1024;
```

**Tests to write:**
- `seedArtFixtures.test.ts`:
  1. Every URL the seed would write (6 covers, 30 pages, 7 portraits) maps to an existing file under `ILLUSTRATIONS_DIR` (`server/src/services/storage.ts:47`) that starts with the JPEG magic bytes `FF D8 FF`.
  2. Each file ≤ `MAX_SINGLE_BYTES`, and the total ≤ `MAX_TOTAL_BYTES`.
  3. Each seed directory contains **only** referenced files: no `.png`, no strays.
  4. `.gitignore` contains `!server/public/illustrations/<id>/` for all 6 ids.
  5. `seed-art-manifest.json` has one entry per committed file, and every `model` starts with `fal-ai/`.
- `canonicalBooks.test.ts` additions:
  1. After `seedCanonicalBooks` on `test.db`, all 6 books have a non-null `cover_url` and `image_provider === 'fal'`, and all 30 pages have a non-null `illustration_url`.
  2. `resolveImagePin(book)` returns `SEED_ART_PIN` with the explicit pin, without inferring from mtime.
  3. Seeding twice is still identical.
  4. `created_by` stays null.
- `server/src/__tests__/setup.ts` is **not** changed. Server tests keep art-less seed books, so tests about the no-art path are unaffected.
- Wire-shape assertion required: no (no route change). `GET /api/books/luna-star-garden` already pins `cover_url` / `characters` as nullable fields.

**Done when:** the new tests pass, `cd server && npm test` is green, `npx tsc --noEmit` is clean, and `cd server && npm run db:seed` against `dev.db` prints `Seeded 6 books with pages` and runs a second time without error. About 1.5 hours.

---

### Task 7 — Docs, full e2e run, browser check in both themes

**Zone:** multi-zone (docs and verification)
**Depends on:** Task 6
**Parallel-safe with:** none

**Files to add or change:**
- `docs/conventions/data.md`:
  - §The big picture: the seed line becomes "6 illustrated books with pages, art committed under `server/public/illustrations/<id>/`".
  - New subsection under §Illustration storage, **"Seed-book art"**, covering:
    - the JPEG format and why it is safe (seed books are unowned)
    - always-set on re-seed
    - the regeneration command and the `--redo` and `--compress-only` flags
    - the raw cache in `server/.seed-art/`
    - "never write into a seed-book directory from a test"
  - §Local-disk fallback: generalise "the fixture book `b2fa23cf-…`" to the fixture books, and name both the Sunny and the seed directories.
- `render.yaml` — comments only:
  - lines 10–12: committed seed-book art also ships in the bundle
  - lines 47–51: "would be overwritten on the next deploy" now covers art too
- `.code-captain/specs/seed-book-illustrations/spec.md` — set `Status:` when the owner accepts.
- CLAUDE.md: no edit needed. It names no fixture count. Re-check with `grep -n "fixture" CLAUDE.md`.

**Tests to run:**
- `cd server && npm test`, `cd client && npm test`, `cd e2e && npm test` — after `cd server && npm run db:hydrate`, all green. No e2e assertion is edited or deleted. If `mobile/reader.spec.ts` or `mobile/narration.spec.ts` (both on `luna-star-garden`) fail on overflow or tap targets now that art renders, that is a real layout bug: fix it, and surface it in the hand-back.

**Manual verify (light and dark):**
- Home: the three Featured covers show art, and the cards keep their size.
- `/book/luna-star-garden`: cover art in the header, and art on spreads 1–5.
- `/book/robot-learns-to-hug` in Reader view: Bolt and Maya look consistent across pages.
- Download the PDF for one seed book while signed in: the pages embed the art. This is the JPEG path in `pdf.tsx`.
- Narrow mobile viewport: no horizontal scroll on the reader.

**Done when:** all three suites are green and the browser check is done in both themes. About 1 hour.

---

### Task 8 — Pre-merge follow-ups

**Zone:** docs (harness) · **Depends on:** none (run last)

For each ADR-worthy item in spec.md, make sure exactly one tracking action exists:

1. **Committed JPEG fixtures for seed-book art.** Write ADR-037 via `/create-adr` (Scope: `seed-book-illustrations`), covering format, location, serving under both backends, and the byte budget.
2. **Seed-owned, always-set art, no `IllustrationVersion` rows, valid only while seed books stay unowned.** Fold this into ADR-037 as a second decision, or write ADR-038 if the owner wants it separate.
3. **Offline scripts gate spend themselves instead of calling `checkQuota`/`recordUsage`.** Write an ADR, or a `Deferred:` line if the owner rules it a one-off and not a pattern.

**Done when:** `adr-tracking-check seed-book-illustrations` reports zero orphaned items.

## Sequencing notes

- **Order:** 1 → 2 → 3 → 4 → **[owner gate]** 5 → 6 → 7 → 8. Strictly serial, because every code task is server-zone and shares `test.db`.
- **Tasks 2 and 3 do not depend on each other.** If you are short on time, run 3 before 2. Never run them at the same time.
- **Cut line:**
  - Tasks 1–4 can ship as one PR (`agent/feat/seed-book-illustrations`). It adds style and cast to prod's seed books, which is harmless and invisible because the art fields stay null.
  - Tasks 5–8 then ship as a second PR.
  - One PR for everything is fine if the owner runs Task 5 promptly.
- **Merging Task 6 is the prod release.** The next Render deploy runs `seed.ts` and writes the URLs to Neon. Check after deploy: `curl -sI https://<render-host>/illustrations/luna-star-garden/cover.jpg` → `200`, then load the live home page.
- **Every developer needs `cd server && npm run db:hydrate`** after pulling Task 6 to see the art locally. The e2e preflight does not check for it.

## Open questions

- **Style and cast table (spec §Style and cast).** Deferred: the proposed descriptors are used unless the owner edits them before Task 5. They are seed values, so changing them later costs a Task 5 redo of the affected book: about 7 images for most books, 8 for robot.
- **Robot cast: Maya as `primary` (2 references, Kontext-multi) or `supporting` (1 reference).** Deferred: `primary` by default. She appears on 3 of 5 pages and is half of the hug.
