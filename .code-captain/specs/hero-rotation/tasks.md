# Hero rotation — the best-of pool — task plan

> Spec: [spec.md](spec.md)
> Status: Draft
> Last updated: 2026-08-26

## Overview

Ten tasks across shared, server, client, e2e and docs. The spine is: contract first
(Task 1), then the data the pool needs (Tasks 2–3), then the routes (Tasks 4–5), then the
client in two halves — a behaviour-free extraction (Task 6) and the rotation itself
(Task 7) — then e2e (Task 8), docs (Task 9) and the ADR sweep (Task 10).

**This plan covers population 2 (the best-of pool) only.** The personalised hero is a
separate spec and a separate PR; see spec §"Why the pool ships alone". Do not add an
auth-aware branch to anything here, however cheap it looks.

Natural parallel cuts: Task 3 (derive the artifacts) needs only Task 2's flag decision, not
its code, so it can run beside Task 4. Task 6 is client-only and independent of the whole
server chain — it can land first if you want an early green commit. Task 9 is docs and can
be written any time after Task 3.

## Cross-cutting constraints

- **Wire-shape (OPS.3):** two new response shapes, both in `@storybook/shared`.
  `GET /api/hero/pool` → `HeroPoolResponseSchema` (containing `HeroFrameSchema`).
  `PUT /api/admin/books/:id/hero-eligible` → `AdminBookHeroEligibleResponseSchema`,
  request `AdminBookHeroEligibleRequestSchema`. Both mount `validate({ request, response })`.
  Every response field is pinned by `toMatchObject` in the Supertest test.
  `BookSchema` is deliberately **not** extended — say so in the PR body.
- **Auth middleware order:** the admin route is `adminGate → validate → handler`, matching
  `PUT /api/admin/books/:id/featured`. `GET /api/hero/pool` has **no auth middleware, on
  purpose**, and must never call `getAuthUser`. That absence is load-bearing and is pinned
  by a test — do not "tidy" it by adding an optional auth read.
- **Dark-mode parity:** the hero mat, ring and art column keep their existing `dark:`
  partners verbatim. The rotating layer adds positioning and opacity classes only — no
  colour class, so no `dark:` partner is needed. If you add any coloured chrome (a fade
  scrim, a credit pill), it needs a `dark:` partner. `dark-mode-parity-check` runs on `/ship`.
- **Migrations:** one new migration, `add-hero-eligibility-and-consent`, adding
  `Book.is_hero_eligible Boolean @default(false)` and `Book.hero_consent_at DateTime?`.
  Additive only. Never edit a committed migration.
- **Guardrails touched — surface these to the user before acting:**
  1. **Seed-shape change.** `server/prisma/demo-seed-fixtures/spot-for-sunny.json` gains two
     keys (Task 2). Additive and upsert-only, but CLAUDE.md lists seed-shape changes as
     confirm-first. Ask before Task 2.
  2. **No new dependency.** Derivation is `npx -y sharp-cli` only. If it will not run, use
     the `sips` JPEG fallback **only** inside the byte budget; if neither fits, **stop and
     ask.** A server-side `sharp` install is out of scope and is a separate confirmation.
  3. Nothing else on the list: no `data.json`, no Claude model or SDK change, no paid API,
     no auth/session model change, no test deletions. Report that as a clean bill.
- **Do not touch `client/src/assets/hero/`, `client/src/__tests__/heroAsset.test.ts`, or
  any attribute on the bundled hero `<img>`.** `git diff --stat origin/master...HEAD --
  client/src/assets/hero/ ':!*.md'` must be empty at the end (use `origin/master` — a
  local `master` ref behind #132 lists the bundled hero assets as additions).
  - **Amended 2026-08-26:** the check excludes `*.md`. Task 9 explicitly adds a
    Consumers-adjacent line to `client/src/assets/hero/README.md`, which the unnarrowed
    check would forbid. The constraint's purpose is that the *assets* and the `<img>`
    attributes are frozen; documentation about them is not.
- **Do not edit these three assertions.** If rotation makes one of them fail, the
  accessible-name rule was broken and the component is wrong, not the test:
  `client/src/pages/__tests__/Home.test.tsx:190`, `e2e/tests/home.spec.ts:17`,
  `e2e/tests/mobile/hero.spec.ts:30`.
- **Server tests and e2e cannot run concurrently** — they share a database. Run them
  separately before calling anything red.

## Tasks

### Task 1 — Wire shape: `shared/src/hero.ts` and the admin pair

**Zone:** shared
**Depends on:** none
**Parallel-safe with:** 6

**Status:** Done (2026-08-26)
> **Ruling (user, 2026-08-26): the `AdminBookListItemSchema` field moves to Task 2.**
> It is a *required* field on a `validate()`-checked response, so adding it before
> Task 2's Prisma column exists makes `GET /api/admin/books` return 500. Task 2's file
> list now carries `shared/src/admin.ts`.

**Files to add or change:**
- `shared/src/hero.ts` — new; pool frame + pool response schemas
- `shared/src/index.ts` — add `export * from './hero';`
- `shared/src/admin.ts` — hero-eligible request/response pair; extend the list item

**Signatures / shapes:**
```ts
// shared/src/hero.ts
export const HeroFrameSchema = z.object({
  id: z.string(),              // `${book_id}-p${page_number}`
  source: z.literal('pool'),   // consent seam: a personal frame cannot validate here
  src: z.string(),             // server-relative, e.g. /hero/<book_id>/p4-960.webp
  src_small: z.string(),       // 480 variant
  width: z.number().int(),
  height: z.number().int(),
  alt: z.string(),
  book_id: z.string(),
  book_title: z.string(),
});
export type HeroFrame = z.infer<typeof HeroFrameSchema>;

export const HeroPoolResponseSchema = z.object({ frames: z.array(HeroFrameSchema) });
export type HeroPoolResponse = z.infer<typeof HeroPoolResponseSchema>;

// shared/src/admin.ts
export const AdminBookHeroEligibleRequestSchema = z.object({ is_hero_eligible: z.boolean() });
export const AdminBookHeroEligibleResponseSchema = BookWithPagesSchema.extend({
  is_hero_eligible: z.boolean(),
  hero_frames_available: z.number().int(),
});
// NOTE: AdminBookListItemSchema's `is_hero_eligible` field lands in Task 2 --
// it is required, so it needs the Prisma column in the same commit.
```

Put a comment on `source` saying what it is for. It reads like dead weight in a
single-source world, and the next reader will be tempted to delete it.

**Tests to write:**
- None of its own — a schema with no consumer is not worth a test file. It is exercised by
  Tasks 4 and 5.
- Wire-shape assertion required: no (this task defines the shapes; Tasks 4/5 assert them).

**Done when:** `npx tsc --noEmit` clean in `server/` and `client/`; existing suites green.

---

### Task 2 — Prisma columns, migration, and the demo fixture's consent

**Zone:** server (data)
**Depends on:** none
**Parallel-safe with:** 1, 6

**Surface the seed-shape guardrail to the user before starting this task.**

**Status:** Done (2026-08-26)
> Seed-shape guardrail was surfaced and approved by the user before this task started.
> Migration landed as `20260826172625_add_hero_eligibility_and_consent`. Prisma's SQLite
> connector emits a `RedefineTables` (create-copy-drop-rename) block rather than
> `ALTER TABLE ADD COLUMN` for this pair; the generated SQL was kept unedited and is
> data-preserving — see the hand-back note.

**Files to add or change:**
- `shared/src/admin.ts` — `AdminBookListItemSchema` gains `is_hero_eligible: z.boolean()`
  (moved here from Task 1 by user ruling — required field, needs the column in the same
  commit or `GET /api/admin/books` 500s on response validation)
- `server/prisma/schema.prisma` — two additive columns on `Book`
- `server/prisma/migrations/<ts>_add_hero_eligibility_and_consent/` — generated
- `server/prisma/demo-seed-fixtures/spot-for-sunny.json` — `is_hero_eligible: true`,
  `hero_consent_at: "2026-08-26T00:00:00.000Z"`
- `server/prisma/demo-seed.ts` — thread both fields through `upsertFixture` (the
  `BookFixture` interface at ~line 44 and the create/update payloads at ~line 101)

**Signatures / shapes:**
```prisma
model Book {
  // ...existing fields
  is_hero_eligible Boolean   @default(false)
  hero_consent_at  DateTime?
}
```

Generate with `cd server && npm run db:migrate -- --name add-hero-eligibility-and-consent`.

The fixture is the operator consenting to the operator's own demo book — that is the only
legitimate consent write that exists today. Put that sentence in the fixture's sibling
comment or in `demo-seed.ts`, not just in the spec.

**Tests to write:**
- `server/src/__tests__/setup.ts` — no change expected; confirm `resetDatabase()` still
  seeds cleanly with the new columns.
- Wire-shape assertion required: no.

**Manual verify:**
- `cd server && npm run db:hydrate` runs clean, and the demo book comes back with both
  fields set. Take a backup first per `docs/conventions/data.md` if `dev.db` matters to you.

**Done when:** migration applies, `db:hydrate` is clean, server suite green, no TS errors.

---

### Task 3 — Derive script, the committed frames, and the served-set byte budget

**Zone:** server
**Depends on:** 2 (for which book is eligible — the decision, not the code)
**Parallel-safe with:** 4

**Status:** Done (2026-08-26)
> Three deviations from the body below, all recorded here so they are not only in a
> hand-back message:
> 1. **Pages 1 and 5, not 1 and 3.** The body's "p3" predates §Open questions, which
>    resolved to page 1 + page 5 and *rejected* page 3. Followed the resolution.
> 2. **Page 5 derived from `page-5.png`, not `page-5-v3.png`.** §Open question 1 named
>    `-v3`, but the fixture points page 5 at `page-5.png`, and "derive only from URLs the
>    fixture points at" is the harder constraint. Both were rendered and compared; they are
>    the same scene in the same style (v3 adds the backpack). **Developer judgment call —
>    owner may overrule**, in which case the fixture and the script's `FRAMES` list change
>    together in one commit.
> 3. **Directory cap pinned at 400 KB, per §Open question 2**, not the 1 MB in the body.
>    Actual total is 275,880 bytes across four images.
>
> Also required and not in the body: **`.gitignore` re-includes `server/public/hero/`.**
> `server/public/*` is ignored wholesale, so the derived artifacts were untracked and
> would have shipped as a 404 in CI and in production.

**Files to add or change:**
- `server/scripts/derive-hero-frames.sh` — new; the loop around ADR-014's command
- `server/public/hero/b2fa23cf-3156-4b89-83e7-82d98c32c8b7/p1-960.webp` + `p1-480.webp`
- `server/public/hero/b2fa23cf-3156-4b89-83e7-82d98c32c8b7/p3-960.webp` + `p3-480.webp`
  (page choice is yours from the *canonical* seeded pages — see the trap below)
- `server/public/hero/README.md` — new; provenance, budget, the command, the "flag without
  derive does nothing" note
- `server/src/index.ts` — `app.use('/hero', express.static(join(import.meta.dirname, '../public/hero')));`
  next to the existing `/illustrations` and `/uploads` mounts
- `server/src/__tests__/heroFrameAssets.test.ts` — new; mirrors `heroAsset.test.ts`

**Derivation contract:**
```
source:  server/public/illustrations/b2fa23cf-…/page-<n>.png   (read only, never modified)
crop:    none. native 1:1 preserved (ADR-014 decision 6).
out:     <book_id>/p<n>-960.webp  and  <book_id>/p<n>-480.webp
format:  WebP, --quality 72 (960) / 75 (480), --effort 6, sRGB, metadata stripped
budget:  each file <= 150 KB; server/public/hero/ total <= 1 MB; MAX_POOL_FRAMES = 5
tool:    npx -y sharp-cli …    (npx cache; nothing enters package.json or the lockfile)
```

**The `-v3`/`-v4` trap, restated because the highest version number looks safest:**
`page-4-v4.png` renders Sunny as a golden retriever — the exact defect the v2 feedback
corrected. Only derive from URLs that `spot-for-sunny.json` actually points at. Also skip
`page-4-v2.png`: it is already frame 0, and a rotation that fades to the same picture is a
bug report waiting to happen.

**Tests to write:**
- `server/src/__tests__/heroFrameAssets.test.ts` — walks `server/public/hero/` recursively;
  fails on any `.png`, on any extension outside `['.webp', '.jpg', '.md']`, on any file
  over 150 KB, and on a directory total over 1 MB. Failure messages name the file and its
  size. Copy the structure and the comments' intent from
  `client/src/__tests__/heroAsset.test.ts` — including the dotfile exemption and the
  "every file counts toward the total" rule.
- Wire-shape assertion required: no.

**Manual verify:**
- `curl -I localhost:3001/hero/b2fa23cf-…/p1-960.webp` returns 200 with
  `content-type: image/webp`.

**Done when:** files committed, budget test green, static mount serves them, server suite
green, `git diff master...HEAD -- '**/package.json' '**/package-lock.json'` empty.

---

### Task 4 — `server/src/lib/heroPool.ts` and `GET /api/hero/pool`

**Zone:** server
**Depends on:** 1, 2
**Parallel-safe with:** 3, 6

**Status:** Done (2026-08-26)
> Five things the body did not specify, recorded here rather than only in a hand-back:
> 1. **`server/src/__tests__/setup.ts` also changed** — `createTestApp()` had to mount
>    `heroRouter`, or every test in `hero.test.ts` 404s. Not in the file list; unavoidable.
> 2. **`orderBy` is `[{ created_at: 'asc' }, { id: 'asc' }]`.** The body says `created_at`
>    asc; `id` is only a tiebreak, because SQLite stores millisecond resolution and one
>    seed run can write two books in the same millisecond. Without it the "deterministic
>    ordering" that justifies the 300 s cache header is not actually deterministic.
> 3. **`width`/`height` are the constants `960`/`960`, not probed from the file.** 1:1 is
>    locked (ADR-014 decision 6) and the derive contract fixes the output at 960×960, so
>    the alternative is decoding a WebP per request via a native dependency the spec
>    explicitly refuses — to learn a constant that is already written down.
> 4. **The two cap tests write throwaway artifacts** under `server/public/hero/test-hero-*/`
>    and remove them in `afterEach`, with a defensive sweep in `beforeAll`. Only two frames
>    are committed, so a 2-per-book cap and a 5-total cap cannot otherwise be distinguished
>    from the artifact gate doing all the work. The existence of `__resetHeroFrameCache()`
>    in the body's own signature list is what makes this the intended route.
> 5. **The done-when grep and the explanatory comment conflict.** `routes/hero.ts` carries a
>    prominent comment about the missing auth read, but naming the helper in it puts a hit
>    in `grep -n 'getAuthUser' server/src/routes/hero.ts`. The comment is phrased around
>    the identifier instead, so the grep returns nothing and stays a real check.

**Files to add or change:**
- `server/src/lib/heroPool.ts` — new; the single expression of eligibility
- `server/src/routes/hero.ts` — new; the public route
- `server/src/index.ts` — `app.use('/api/hero', heroRouter);`
- `server/src/routes/__tests__/hero.test.ts` — new

**Signatures / shapes:**
```ts
// server/src/lib/heroPool.ts
// The ONLY expression of hero-pool eligibility. Mirrors AVAILABLE_BOOK_WHERE.
// hero_consent_at is what separates "good enough for the front page" (editorial,
// admin-set) from "this book's owner agreed to promotional display" (consent).
// No API writes hero_consent_at today — see .code-captain/specs/hero-rotation/spec.md.
export const HERO_POOL_WHERE = {
  deleted_at: null,
  status: 'published',
  is_hero_eligible: true,
  hero_consent_at: { not: null },
} as const;

export const MAX_POOL_FRAMES = 5;
export const MAX_FRAMES_PER_BOOK = 2;

/** First sentence of the generation prompt, capped — it describes the art, which is
 *  what alt text is for. Falls back to the book title if the description is empty. */
export function deriveAlt(illustrationDescription: string, bookTitle: string): string;

/** Reads HERO_POOL_WHERE, keeps only pages whose derived 960 artifact exists on disk,
 *  applies both caps, and returns wire-ready frames. Deterministic ordering:
 *  book created_at asc, then page_number asc. */
export async function resolveHeroPool(): Promise<HeroFrame[]>;

/** Test seam for the existsSync memo. */
export function __resetHeroFrameCache(): void;
```

```ts
// server/src/routes/hero.ts
router.get(
  '/pool',
  validate({ name: 'GET /api/hero/pool', response: HeroPoolResponseSchema }),
  async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ frames: await resolveHeroPool() });
  },
);
```

No auth middleware. No `getAuthUser`. No `req` read at all beyond the framework's own —
note the handler signature takes `_req` deliberately.

**Tests to write:**
- `server/src/routes/__tests__/hero.test.ts`:
  - **wire shape** — `toMatchObject` pinning every field of `HeroFrameSchema` on the first
    frame, and that `source === 'pool'`.
  - **auth invariance (the consent tripwire)** — the same GET with no header, with a normal
    user's bearer token, and with an admin's bearer token produces three byte-identical
    JSON bodies.
  - **consent gate** — a published book with `is_hero_eligible: true` and
    `hero_consent_at: null` is absent from the response.
  - **eligibility gate** — a consented book with `is_hero_eligible: false` is absent.
  - **availability gates** — draft and soft-deleted books are absent even with both fields set.
  - **artifact gate** — a fully eligible, consented book with no derived file yields no frame.
  - **caps** — a book with 5 illustrated pages contributes at most 2 frames; the response
    never exceeds 5 frames.
  - **empty pool** — returns `{ frames: [] }` and a 200, not a 404.
  - **`deriveAlt`** — a unit test against the real `spot-for-sunny.json` page-1 description,
    asserting a single sentence, ≤ 160 chars, and that it does not contain "AI" or "book".
- Wire-shape assertion required: **yes** — `HeroPoolResponseSchema` / `HeroFrameSchema`.

**Done when:** listed tests pass, `cd server && npm test` green, no TS errors, and
`grep -n 'getAuthUser' server/src/routes/hero.ts` returns nothing.

---

### Task 5 — `PUT /api/admin/books/:id/hero-eligible`

**Zone:** server + shared
**Depends on:** 1, 2, 4 (reuses the frame resolver for the count)
**Parallel-safe with:** 6

**Status:** Done (2026-08-26)
> One file beyond the list: **`server/src/lib/heroPool.ts` gained an exported
> `countHeroFrames(bookId, pageNumbers)`.** The artifact predicate (`heroFrameExists`,
> plus its memo) was module-private after Task 4, so the alternative was re-deriving
> `existsSync(server/public/hero/<book>/p<n>-960.webp)` inside `admin.ts` — a second
> expression of the same rule, which is the thing `heroPool.ts` exists to prevent.
> Nothing in shared changed: Task 1 already landed both schemas.
>
> **`hero_frames_available` is uncapped and consent-blind** — it counts artifacts on
> disk, ignoring `HERO_POOL_WHERE` and `MAX_FRAMES_PER_BOOK`. Reporting the pool count
> instead would answer `0` for an underived book *and* for a consented-but-draft one,
> collapsing the single distinction the number exists to make. Rationale is in the
> helper's doc comment, not only here.

**Files to add or change:**
- `server/src/routes/admin.ts` — new route, modelled line-for-line on
  `PUT /api/admin/books/:id/featured` (~line 185)
- `server/src/routes/__tests__/admin.test.ts` — extend

**Signatures / shapes:**
```ts
router.put(
  '/books/:id/hero-eligible',
  adminGate,                                   // auth BEFORE validate — 403 must beat 400
  validate({
    name: 'PUT /api/admin/books/:id/hero-eligible',
    request: AdminBookHeroEligibleRequestSchema,
    response: AdminBookHeroEligibleResponseSchema,
  }),
  async (req, res) => { /* 404 if missing; update; respond with hero_frames_available */ },
);
```

`hero_frames_available` is the count of derived artifacts found for this book — `0` means
"flagged, but nobody has run the derive script yet." That is the whole reason this response
is not just `BookWithPagesSchema`.

**This route must not write `hero_consent_at`.** An admin flagging a book is not the book
owner consenting to promotional display. If that feels like an inconvenience, it is the
feature working.

**Tests to write:**
- `server/src/routes/__tests__/admin.test.ts`:
  - **wire shape** — `toMatchObject` pinning `is_hero_eligible` and `hero_frames_available`.
  - **403 for a non-admin bearer token; 401 for no token** — with a malformed body, to prove
    auth beats validation.
  - **404 for an unknown book id.**
  - **toggling to `true` does not set `hero_consent_at`** — re-read the row and assert it is
    still null. This is the seam, asserted where the temptation lives.
  - **toggling to `false` removes the book's frames from `GET /api/hero/pool`** — the
    withdrawal lever, end to end.
- Wire-shape assertion required: **yes** — `AdminBookHeroEligibleResponseSchema`.

**Done when:** listed tests pass, `cd server && npm test` green, no TS errors.

---

### Task 6 — Extract `HeroArt` with no behaviour change

**Zone:** client
**Depends on:** none
**Parallel-safe with:** 1, 2, 4, 5

**Status:** Done (2026-08-26)

A deliberately boring commit: the diff should be a move plus a wrapper, so the rotation
commit that follows contains only rotation.

**Files to add or change:**
- `client/src/components/HeroArt.tsx` — new; the art column moved verbatim
- `client/src/pages/Home.tsx` — art column becomes `<HeroArt />`; the two asset imports and
  `HERO_ALT` move with it
- `client/src/components/__tests__/HeroArt.test.tsx` — new

**Signatures / shapes:**
```tsx
export default function HeroArt() {
  // Layer 0 is the LCP candidate. Its <img>, its src, and its attributes are never
  // mutated — rotation adds a sibling layer above it. See spec §4.
  return (
    <div className="w-full max-w-[300px] sm:max-w-[380px] lg:max-w-[440px] justify-self-center lg:justify-self-end lg:mt-4">
      <div className="p-2 sm:p-2.5 bg-white dark:bg-gray-800 rounded-[24px] shadow-card ring-1 ring-gray-200 dark:ring-gray-700">
        <div className="relative aspect-square">
          {/* frame 0 — unchanged attributes, including the pinned `sizes` */}
        </div>
      </div>
    </div>
  );
}
```

The `relative aspect-square` wrapper lands here so Task 7 adds no layout. Keep
`aspect-square` on the `<img>` as well — the existing test pairs it with the intrinsic
`width`/`height`, and removing it changes what the reserved box depends on.

**Tests to write:**
- `client/src/components/__tests__/HeroArt.test.tsx` — the same five attribute assertions
  the `Home hero art` block makes, at component level, so future hero work has a local
  test to run.
- Wire-shape assertion required: no.

**Manual verify:**
- Hero looks pixel-identical at `sm`, `lg`, and 1440 px in both themes. This task should be
  invisible.

**Done when:** `cd client && npm test` green **with `Home.test.tsx` unmodified**, `npx tsc
--noEmit` clean, `npm run lint` clean.

---

### Task 7 — The rotation itself

**Zone:** client
**Depends on:** 1, 4, 6
**Parallel-safe with:** 9

**Status:** Done (2026-08-26) — code + tests only. **The aesthetic pass is still
outstanding and is the user's**; the "Done when" clause below is not fully discharged
until they have signed off.
> Four things the body did not specify, recorded here rather than only in a hand-back:
> 1. **`client/vite.config.ts` also changed** — `/hero` was added to the dev/preview
>    proxy table beside `/illustrations`. Not in the file list, and not optional: in dev
>    `api()` returns a server-relative path, so without the proxy every rotating frame
>    loads Vite's `index.html`, fires `onerror`, and is skipped. The rotation would have
>    been invisible in local dev and in the Task 8 e2e run.
> 2. **`client/src/types.ts` also changed** — a one-line `HeroFrame` re-export, per
>    `docs/conventions/client.md` ("wire shapes come from `@storybook/shared` via
>    `client/src/types.ts`").
> 3. **The pool fetch is deferred out of the mount task** (`setTimeout(…, 0)`). A child's
>    effect runs before its parent's, so an un-deferred fetch would be issued *ahead* of
>    `Home`'s own `/api/books` call — which is both wrong for a progressive-enhancement
>    request and would have broken `Home.test.tsx`'s positional `fetch` mock, which that
>    task forbids editing.
> 4. **The crossfade passes through frame 0.** Two layers is the architecture the spec
>    fixes (and Task 8's e2e expects exactly two `<img>`s), so a pool-frame-to-pool-frame
>    dissolve is not expressible: layer 1 fades out to reveal the bundled frame, swaps
>    its already-cached `src` while invisible, and fades back in. Only `opacity` animates.
>
> The response is validated client-side with `HeroPoolResponseSchema`, following the
> precedent `client/src/lib/cartCache.ts` set with `CartGetResponseSchema` — Zod is
> already in the client bundle because of it, so this costs no new bytes.

**Files to add or change:**
- `client/src/lib/useHeroPool.ts` — new; fetch + suppression policy
- `client/src/components/HeroArt.tsx` — the rotating layer
- `client/src/components/__tests__/HeroArt.test.tsx` — extend

**Signatures / shapes:**
```ts
export const HERO_ROTATE_MS = 7000;   // dwell
export const HERO_FADE_MS = 600;      // crossfade

/** Returns [] whenever rotation must be suppressed: fetch failure, empty pool,
 *  prefers-reduced-motion: reduce, or navigator.connection?.saveData. Never throws,
 *  never suspends, never reads auth state, never sends an Authorization header. */
export function useHeroPool(): { frames: HeroFrame[] };
```

Rules the implementation must satisfy, each of which has a test below:

1. Frame 0 renders synchronously on first paint. Nothing is awaited.
2. Layer 1 is `absolute inset-0` with an opacity transition; **only opacity animates.**
3. The next frame is assigned to a preload `Image()` ~1 s before the swap; the crossfade
   starts on `load`. A frame that errors is skipped, not shown.
4. Start index is `Math.floor(Math.random() * frames.length)` once at mount.
5. Rotation pauses while `document.visibilityState === 'hidden'`.
6. **Exactly one `<img>` in the hero is ever named:** layer 0 keeps `alt={HERO_ALT}`;
   layer 1 is `alt="" aria-hidden="true"`. Do not move the accessible name onto the
   visible frame — see spec §Alternatives for why, and three pinned selectors for the cost.
7. Cross-origin URLs go through `api(frame.src)`, matching `api(page.illustration_url)`.

**Tests to write:**
- `client/src/components/__tests__/HeroArt.test.tsx`:
  - fetch **rejects** → frame 0 rendered, no second `<img>`, no unhandled rejection.
  - fetch **never resolves** → frame 0 rendered immediately (assert synchronously, before
    any `await`).
  - fetch returns **`{ frames: [] }`** → no rotation, no timer left running.
  - happy path with two frames + fake timers → layer 1 appears with `src` containing
    `/hero/`, and layer 0's `src` is **unchanged** (assert the exact same string before and
    after).
  - after rotation, `screen.getAllByRole('img')` filtered to accessible-named elements has
    length exactly 1, and `getByRole('img', { name: /bench/i })` still resolves.
  - `matchMedia('(prefers-reduced-motion: reduce)')` mocked to match → no second layer, no
    fetch-driven timer.
  - `navigator.connection.saveData = true` → same.
  - `HERO_ROTATE_MS` and `HERO_FADE_MS` pinned to `7000` / `600` so a retune is a
    deliberate edit.
- `client/src/pages/__tests__/Home.test.tsx` — **unmodified.** Its `fetch` mock returns
  `[]` for every call, which `useHeroPool` must tolerate (an array, not `{ frames }`) by
  failing closed rather than throwing.
- Wire-shape assertion required: no (client side); the shape is pinned server-side in Task 4.

**Manual verify:**
- Watch a full rotation cycle in **light and dark mode** at 1440 px and at 393 px. Confirm
  nothing below the hero moves when a frame swaps, and that the purple CTA still out-shouts
  the art on every frame — a different frame may have a different palette than the one the
  hero was composed against. This is the aesthetic half of done-criterion #2 and needs the
  user's eyes, not a test.
- Stop the server mid-rotation and reload: the hero must be exactly today's static hero.

**Done when:** listed tests pass, `cd client && npm test` green with `Home.test.tsx`
untouched, `npx tsc --noEmit` and lint clean, and the user has signed off on the aesthetic pass.

---

### Task 8 — e2e: rotation happens, and nothing shifts

**Zone:** e2e
**Depends on:** 3, 4, 7
**Parallel-safe with:** 9

**Files to add or change:**
- `e2e/tests/hero-rotation.spec.ts` — new

**Tests to write:**
- **rotation occurs** — poll the second hero `<img>`'s `src` until it contains `/hero/`,
  with a timeout comfortably over `HERO_ROTATE_MS`.
- **zero CLS across a swap** — capture the hero mat's `boundingBox()` before and after the
  swap and assert it is identical. This is the measured form of the CLS claim.
- **the LCP frame never changes** — record layer 0's `src` at load and after a rotation;
  assert equality.
- **the rotating frame actually decoded** — `naturalWidth > 0`, the same broken-box guard
  `home.spec.ts:22` uses.
- **exactly one named hero image** — `page.getByRole('img', { name: /bench/i })` still
  resolves to exactly one element after rotation.
- Run the accessible-name checks under `forEachTheme` per ADR-009 if you put any of this at
  a mobile project; otherwise state in the file header which half of done-criterion #2 it
  claims (correctness only — the aesthetic half is Task 7's manual pass).
- Wire-shape assertion required: no.

**Also confirm, without editing them:** `e2e/tests/home.spec.ts`,
`e2e/tests/mobile/hero.spec.ts`, and `e2e/tests/dark-mode.spec.ts` are green with a
**hydrated** database — i.e. with the pool non-empty, which is the state that would expose
an accessible-name regression.

**Done when:** `cd e2e && npm test` green (run alone — not concurrently with the server
suite), and the three existing specs are byte-identical to `master`.

---

### Task 9 — Documentation

**Zone:** docs
**Depends on:** 3, 4
**Parallel-safe with:** 7, 8

**Status:** Done (2026-08-26)
> `server/public/hero/README.md` already existed from Task 3, so this extended and
> corrected it rather than rewriting: added the `.gitignore` re-include trap, exact
> per-frame bytes, and the fact that the README's own bytes count toward the 400 KB
> total. The directory figure is quoted as "275,880 across the four images, plus this
> README" rather than a single number, because a single number goes stale on every edit
> to the file it appears in.
>
> Two judgment calls worth a ruling:
> 1. **`docs/conventions/server.md` has no general routes table** — the only one is the
>    auth table under §Auth. Rather than invent a second table, the two hero routes were
>    added to it and the table reintroduced as "the auth routes, plus any route elsewhere
>    whose auth requirement is itself load-bearing", which is exactly what
>    `GET /api/hero/pool`'s deliberate no-auth is.
> 2. **`client/src/assets/hero/README.md`'s Consumers line is now stale** — it says the
>    assets are imported by `Home.tsx`, but Task 6 moved the imports to `HeroArt.tsx`.
>    Left as-is because the dispatch said to add one line and touch nothing else; the
>    added paragraph names `HeroArt.tsx`, so the file is not misleading, only imprecise.
>    One-line fix if wanted.

**Files to add or change:**
- `server/public/hero/README.md` — provenance table, the derive command, the byte budget and
  its actual numbers, the `-v3`/`-v4` trap, and the "setting the flag without deriving does
  nothing" note
- `client/src/assets/hero/README.md` — add one **Consumers**-adjacent line: this frame is
  now frame 0 of a rotation and its `<img>` is never re-`src`ed. Do not touch anything else
  in that file, and do not change any byte under that directory.
- `docs/conventions/server.md` — add `GET /api/hero/pool` and
  `PUT /api/admin/books/:id/hero-eligible` to the routes table; one line under wire-shapes
  noting the `source` literal as a deliberate discriminator.
- `.code-captain/specs/hero-rotation/notes.md` — replace the placeholder plan with the real
  task list and record any surprises.

**Done when:** `heroAsset.test.ts`'s provenance assertion still passes (the book ID must
survive your edit), root suite green.

---

### Task 10 — Pre-merge follow-ups

**Zone:** docs (harness) · **Depends on:** none (run last)

For each ADR-worthy item in `spec.md`, ensure exactly one tracking action exists — a
matching ADR entry, a linked issue, or an explicit `Deferred:` line with reasoning:

- **ADR-015** (delivery + eligibility signal) — write via `/create-adr`. Next free number
  is 015; re-read `.code-captain/product/decisions.md` first, because the `hero-visual`
  plan originally said "ADR-013" and had to be renumbered mid-flight.
- **ADR-016** (the consent seam) — write it, or fold it into ADR-015 as a grouped decision
  set per the ADR-014 precedent and say in ADR-015 that you did.
- **Population 1** — #127 must **stay open**. Either open a child issue for the personalised
  hero or add a comment on #127 recording that this PR closes population 2 only and that
  population 1 is blocked on the server-side derivation decision.
- **Deferred:** admin UI toggle; attribution/credit line (and the a11y upgrade that rides
  with it); popularity-derived ordering; PWA runtime caching for `/hero/*`.
- **Accepted cost:** rotating frames are `aria-hidden` decorative.

**Done when:** `adr-tracking-check hero-rotation` reports zero orphaned items, and the PR
body carries the spec link, the plan link, and the agent ownership trail.

## Sequencing notes

- **Commit boundaries.** Tasks 1–5 are a coherent server-side commit set; Task 6 is its own
  commit precisely because it should be a no-op; Task 7 is the feature. If Task 7 needs to
  be reverted under review, 1–6 are still shippable and inert — the columns default to
  not-eligible, so a merged-but-unrotating hero is exactly today's hero.
- **One PR.** The pieces are not independently useful to a user, and the consent seam is
  only legible when the schema, the `where` fragment, and the tests are read together.
- **Run the server suite and the e2e suite separately.** They share a database and a
  parallel run fails spuriously.
- **Task 3 before Task 4's tests will be meaningful** — the artifact-gate test needs at
  least one real derived file on disk.

## Open questions — RESOLVED 2026-08-26

All three were put to the repo owner before any task started. None are open.

1. **Pool frames: `page-1.png` and `page-5.png`.** Both were rendered at 420px and
   reviewed before choosing. `page-1` is the dynamic, architectural shot (kids bursting
   through a red door); page 5 is the wide group scene under the tree. Neither reads
   as a near-duplicate of frame 0's bench mid-shot.
   - **Amended 2026-08-26 (owner ruling):** this originally named `page-5-v3.png`. It
     conflicted with the harder rule that a pool frame must come from a URL
     `spot-for-sunny.json` actually points at — the fixture points page 5 at
     `page-5.png`. The fixture wins: a hero frame that is not in the book it advertises
     is a small lie. v3 is the same scene, style and cast; it adds Sunny's backpack and
     reframes the tree. Neither has the `-v4` defect.
   - **`page-3-v2.png` was rejected**, not merely unchosen: it is a single centred figure
     with a downcast expression, compositionally the closest of the three to frame 0, and
     at hero scale it reads as "sad kid alone".
   - **Watch item on `page-1`:** the red door is a large saturated area, and ADR-014
     established the purple CTA as the hero's only cool-saturated element. If the door
     competes with the CTA in the Task 8 human pass, swap `page-1` for `page-3-v2` and
     record the swap — do not quietly restyle the CTA to compensate.
   - Avoid the `-v4` revision entirely (it renders Sunny as a dog).

2. **Served-directory cap: 400 KB, not 1 MB.** Two frames at ~170 KB fit with a little
   room. Rationale from the owner: a cap permitting 5 frames when 2 ship is decoration, not
   a guard — the hero-visual budget test earned its keep by sitting close enough to bite.
   Raise it deliberately when a third frame is added, in the same commit that adds it.

3. **Keep `Cache-Control: public, max-age=300` on the pool route.** Accepted as a new
   precedent with eyes open: no other route in this codebase sets a cache header. It is
   justified by the cold-Render case the whole split-budget design exists to survive.
   Note it in ADR-015 so the precedent is discoverable rather than incidental.
