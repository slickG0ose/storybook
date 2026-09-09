# Age-range vocabulary — one canonical enum

> Status: Accepted
> Last updated: 2026-09-09
> Backlog: [#172](https://github.com/slickG0ose/storybook/issues/172)

## Problem

`Book.age_range` is a free-text `String` and two places in the repo disagree about what may
go in it. `client/src/pages/CreateBook.tsx:26` offers `2-4 3-6 4-7 5-9 6-10`;
`server/prisma/seed.ts` writes `2-5 3-6 4-7 4-8 5-9`. Three values overlap. The result is
user-visible in both directions: `2-5` and `4-8` are shoppable but uncreatable, and an author
who picks `2-4` or `6-10` lands their book in a facet no other book occupies. Nothing stops
it — `POST /api/generate` has no `validate()` at all and checks only that `ageRange` is
truthy (`server/src/routes/generate.ts:122`), and `GET /api/books/age-ranges` derives the
Home filter from `SELECT DISTINCT`, so it faithfully renders whatever drift is in the table.
Surfaced while implementing [#113](https://github.com/slickG0ose/storybook/issues/113); see
`.code-captain/specs/per-page-font-size/spec.md` §Ruling 3 and ADR-020 for why #113 routed
around it instead of fixing it.

## Constraints

- **The seed list is canonical** — `2-5`, `3-6`, `4-7`, `4-8`, `5-9`. User ruling, 2026-09-09
  (`notes.md`). `2-4` and `6-10` are dropped. Verified: `server/prisma/seed.ts`,
  `server/src/db/init.ts`, `server/src/__tests__/setup.ts`, and
  `server/prisma/demo-seed-fixtures/spot-for-sunny.json` already hold only canonical values,
  so **no seed value changes** — this constraint is already satisfied on disk.
- **Wire-shape (OPS.3 / ADR-003):** any changed route response needs its Zod schema in
  `@storybook/shared` and a `toMatchObject` assertion in the route test.
- **Guardrail — data shape:** a new Zod enum in `@storybook/shared` plus a rewrite of existing
  `Book.age_range` rows. CLAUDE.md requires user confirmation before either runs.
- **Prod does not run Prisma migrations.** `render.yaml`'s `buildCommand` is
  `prisma db push --accept-data-loss` against `schema.postgresql.prisma`, then `seed.ts`.
  There is no `migrate deploy` anywhere in the deploy path, so a `migrations/` folder would
  apply locally and in `test.db` and **never in production**. This decides the migration
  mechanism (below), and it is the single most load-bearing fact in this spec.
- **Zone conventions** — `docs/conventions/{server,client,testing,data}.md`; cross-zone blast
  radius from `docs/conventions/call-graph.md` §"`@storybook/shared` — the schema seam".

## Proposed shape

One `z.enum` in `@storybook/shared` becomes the vocabulary, and it gates **writes only**. The
client's button list is generated from it, and `POST /api/generate` gains its first
`validate()` with that enum on `ageRange`. Neither side can pick a value the other rejects,
because there is only one list.

The **read** shape stays `z.string()`. `BookSchema.age_range` is validated on every
storefront list and detail response; narrowing it to the enum would mean one un-migrated
Postgres row, one hand-inserted row, or one restored `BookVersion` turns the catalog into a
500 in dev and a warning-plus-served-body in prod. That is a bad trade for a presentation
facet. The posture is the same one already used for `User.email`: normalise on write,
converge stored rows separately, leave the read path tolerant. `ageBucketFor()` in
`server/src/lib/typography.ts` keeps its tolerant leading-integer parse for exactly the same
reason and needs no logic change — only its docblock, which currently narrates the two
vocabularies, goes stale.

Existing rows converge through a **boot-time backfill** in the style of
`server/src/services/emailBackfill.ts`, not a Prisma migration and not a one-shot script.
Given `db push` in `render.yaml` a migration folder cannot reach prod at all, and Render's
free plan has no shell to run a one-shot script from — a boot-time pass is the only mechanism
that converges both the local `dev.db` and the deployed Postgres without a new deploy step.
It is self-limiting: once writes are enum-gated no new off-vocabulary row can appear, so the
steady state is one `findMany` and zero writes per boot, forever. The mapping is
`2-4 → 2-5` and `6-10 → 5-9` and **nothing else**. Any other off-vocabulary value (a
hand-inserted `all ages`, a `3-5` test fixture that escaped) is **reported, not rewritten** —
same discipline as `backfillUserEmails()` reporting collisions rather than guessing.

`GET /api/books/age-ranges` keeps deriving from the table but **intersects the result with
the canonical enum and returns it in canonical order**. Serving the raw enum instead would
show the shopper facets with zero books behind them; serving raw `SELECT DISTINCT` is what
made the drift user-visible in the first place. The intersection keeps the useful property
(only facets that have books) while making it structurally impossible for a stray row to
render a filter chip. Sorting by enum order also retires an incidental lexicographic `.sort()`
that happens to be right today only because every value starts with a distinct digit.

### Schema / contract changes

| Where | Change |
|---|---|
| `shared/src/books.ts` | **new** `AgeRangeSchema = z.enum(['2-5','3-6','4-7','4-8','5-9'])`, `type AgeRange`, and `AGE_RANGES` (a `readonly AgeRange[]` from `AgeRangeSchema.options`, in canonical display order) |
| `shared/src/generate.ts` | **new file** — `GenerateRequestSchema` (`ageRange: AgeRangeSchema`), re-exported from `shared/src/index.ts` |
| `shared/src/books.ts` — `BookSchema.age_range` | **unchanged**, stays `z.string()`. Deliberate; see above |
| `shared/src/books.ts` — `BookFacetResponseSchema` | **unchanged**, still `z.array(z.string())`. The facet route's *contents* narrow; its wire shape does not |
| `server/prisma/schema.prisma` | **unchanged**. `age_range` stays `String`; SQLite has no enum type and the read path must stay tolerant. No migration folder |
| `POST /api/generate` | gains `validate({ name, request: GenerateRequestSchema })`, mounted `requireAuth → validate → spendGate('story') → handler` |

Middleware order: `validate` goes **before** `spendGate`. A malformed body should be rejected
before the request touches quota accounting, and `spendGate` reads only `res.locals.user`, so
nothing depends on the body being parsed first.

### Rulings on `GenerateRequestSchema`'s tolerance

`validate()` replaces `req.body` with the parsed value, and `z.object` strips unknown keys —
so the schema must list **every** field the handler reads or that field silently disappears.
It lists: `theme`, `ageRange`, `additionalDetails`, `characterName`, `characters`,
`styleDescriptor`, `styleReferenceUrl`, `previewMode`, `pageCount`.

Only `theme` and `ageRange` tighten. Everything else preserves today's behaviour exactly:

- **`characters`** stays permissive (loose objects, all fields optional). `normalizeCharacters()`
  already filters entries with a bad `role` or a missing `name` rather than rejecting the
  request; a strict `CharacterSchema` here would convert those silent drops into 400s, which
  is a different contract change riding along on this one.
- **`previewMode` / `pageCount`** keep their existing normalisers (`VALID_PREVIEW_MODES`
  fallback to `'quick'`, `normalizePageCount()` clamp to 3–15). Typed loosely in the schema so
  a junk value still normalises rather than 400s. Tightening them is defensible and is **not
  this issue** — out of scope, below.
- **"at least one primary character"** stays a handler check. It is a cross-field rule over
  the legacy `characterName` path and the `characters` array, not expressible in the field
  schema without restructuring both.

### Data flow

```
CreateBook.tsx  ──imports──▶ client/src/lib/ageRanges.ts ──re-exports──▶ @storybook/shared AGE_RANGES
     │ renders one button per canonical value
     ▼
POST /api/generate  ──▶ requireAuth ──▶ validate(GenerateRequestSchema) ──▶ spendGate ──▶ handler
                                              │ 400 on an off-list ageRange
                                              ▼ prisma.book.create({ age_range })  ← now provably canonical

server boot ──▶ backfillBookAgeRanges()  → rewrites 2-4/6-10, reports anything else off-list
Home.tsx ──▶ GET /api/books/age-ranges  → DISTINCT ∩ AGE_RANGES, canonical order
```

`CreateBook.tsx` is a page, and `docs/conventions/call-graph.md` forbids a page importing
`@storybook/shared` directly. `AGE_RANGES` is a **value**, not a type, so it cannot go through
the types-only `client/src/types.ts` barrel. It reaches the page via a small
`client/src/lib/ageRanges.ts` — the same shape as `client/src/lib/cost.ts`, which
`CreateBook.tsx` already imports from at line 6. That adds one entry to the call-graph's list
of files allowed to import from shared directly.

### Files likely touched

- `shared/src/books.ts` — `AgeRangeSchema`, `AGE_RANGES`
- `shared/src/generate.ts` (new) + `shared/src/index.ts` — `GenerateRequestSchema`
- `server/src/routes/generate.ts` — `validate()` mounted; `GenerateRequestBody` narrows
- `server/src/routes/books.ts` — `/age-ranges` intersects + canonical order
- `server/src/services/ageRangeBackfill.ts` (new) + `server/src/index.ts` — boot-time converge
- `server/src/lib/typography.ts` — docblock only; `ageBucketFor()` logic unchanged
- `client/src/lib/ageRanges.ts` (new), `client/src/pages/CreateBook.tsx:26` — one list
- `server/src/routes/__tests__/{generate,books,spend}.test.ts`,
  `client/src/pages/__tests__/CreateBook.test.tsx`,
  `server/src/lib/__tests__/typography.test.ts` — fixtures + new assertions
- `docs/conventions/call-graph.md` — shared-import exception list

## Alternatives considered

### Narrow `BookSchema.age_range` to the enum

**Pros:** one schema, enforced on read and write; drift becomes impossible to serve.
**Cons:** response validation runs on `GET /api/books`, `/mine`, `/:id`, publish/unpublish. A
single legacy row — including one in prod, which we cannot inspect from here — turns the
storefront list into a 500 in dev and a logged warning in prod. The failure mode is the whole
catalog, not one book.
**Why rejected:** the enum's job is to stop bad writes; the read path's job is to serve what
is stored. Held as an upgrade path once the backfill has been observed reporting zero
off-vocabulary rows in prod for a while.

### Prisma data migration (`UPDATE Book SET age_range = ...`)

**Pros:** runs once, leaves no permanent code, is the obvious answer for a data fix.
**Cons:** it would never run in production. `render.yaml` deploys with `prisma db push`, not
`migrate deploy`, so the `migrations/` folder is inert there. It would converge `dev.db` and
`test.db` and quietly leave prod exactly as it is.
**Why rejected:** wrong mechanism for this deploy topology. Worth revisiting if the deploy
ever moves to `migrate deploy` — and that move is its own issue.

### One-shot script under `server/scripts/`

**Pros:** explicit, runs only when a human runs it, matches the "user approves the migration"
guardrail most literally.
**Cons:** Render's free plan gives no shell, so reaching prod means adding it to
`buildCommand` — i.e. a boot-time backfill with worse ergonomics and a deploy-config edit.
**Why rejected:** strictly dominated by the boot-time service, which is also the pattern this
repo already has precedent for.

### `GET /api/books/age-ranges` serves the canonical enum outright

**Pros:** simplest possible route; filter is stable regardless of catalog contents.
**Cons:** shows facets with zero books behind them. Clicking `4-8` on an empty catalog yields
an empty grid, which reads as a broken filter.
**Why rejected:** the facet route's contract is "what you can actually shop," and that should
stay true.

## Success criteria

- `POST /api/generate` with `ageRange: '6-10'` (or `'all ages'`, or absent) returns **400**
  and creates no `Book` row; with `'5-9'` it still returns 200.
- `CreateBook.tsx` renders exactly five age buttons, and their labels are derived from
  `AGE_RANGES` rather than a local literal — asserted by a client test that iterates the
  shared constant, so a future divergence fails the test rather than shipping.
- A test asserts every `age_range` literal in `server/prisma/seed.ts` is a member of
  `AGE_RANGES` — the anti-drift catch-net, mirroring the existing test that pins
  `STOREFRONT_DEFAULT` against `schema.prisma`.
- `GET /api/books/age-ranges` returns canonical order and omits any off-vocabulary row that is
  present in the table, with a `toMatchObject`-style wire-shape assertion.
- `backfillBookAgeRanges()` rewrites `2-4 → 2-5` and `6-10 → 5-9`, leaves every other value
  untouched, reports the ones it left, and is a no-op on a converged table.
- No book's typography changes as a result of the backfill: `2-4` and `2-5` both bucket
  `early` (lower bound ≤ 4), `6-10` and `5-9` both bucket `developing` (5–7). Assert this
  explicitly — it is the property that makes the rewrite safe for already-published books.
- Server, client, and e2e suites green; no new TypeScript errors.

## Out of scope

- **Tightening `previewMode` / `pageCount` validation.** Both have working normalisers; making
  them strict is a separate contract change.
- **A response schema for `POST /api/generate`.** The route returns a hydrated book with pages
  and has never had one; adding it is worthwhile and is not this issue.
- **Validating the `?age_range=` query param on `GET /api/books`.** `validate()` covers
  `req.body` only. An off-list query yields an empty list, which is already correct behaviour.
- **Making #113's `independent` typography bucket reachable** — see Deferred, below.
- **A case-insensitive or CHECK constraint at the database level.** SQLite/Postgres divergence,
  and `db push` deployment, make that its own piece of work.
- **Any `schema.prisma` change or migration folder.** There is none in this spec.

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| Prod `Book` rows cannot be inspected from this worktree (no DB credentials; free Postgres expires 2026-09-14). Unknown whether any `2-4`/`6-10` rows exist there | The backfill is written to be a no-op when nothing matches and to *report* rather than rewrite anything outside the two known legacy values. Local `dev.db` verified 2026-09-09: 9 books across `4-7`×3, `3-6`×3, `5-9`, `4-8`, `2-5` — **zero affected rows** |
| Adding `validate()` changes the 400 body for a request missing `theme`/`ageRange` from the handler's sentence to Zod's `Invalid request body: …` | Existing test at `server/src/routes/__tests__/generate.test.ts:134` asserts status plus a string `error`; update it deliberately in the same task |
| `z.object` strips unknown keys, so an omitted field in `GenerateRequestSchema` silently removes a feature (e.g. `styleReferenceUrl` → style refs stop working) | Schema field list is enumerated in this spec; the task requires a test that a full-fat body round-trips every field into the created book |
| Off-vocabulary fixtures already in server tests (`'5-7'` in `generate.test.ts:40` and `spend.test.ts:339`) will start 400ing | Task 2 sweeps them to `'5-9'`, which buckets `developing` — the same bucket `'5-7'` had, so no typography assertion moves |
| Guardrail: rewriting existing `Book` rows needs user confirmation before it runs | Task 4 is gated — the developer must surface it and get an explicit go, and must `cp dev.db dev.db.bak.db` (per `docs/conventions/data.md`) before booting with the backfill |
| Guardrail: Zod wire-shape change in `@storybook/shared` | Additive only. No existing schema field's type changes; `BookSchema` and `BookFacetResponseSchema` are untouched |
| Dark-mode parity | No new UI surface — the existing age buttons already carry `dark:` variants (`CreateBook.tsx:454-457`); only the set of labels changes. Manual verify in both themes anyway |
| `docs/conventions/call-graph.md` gains a shared-import exception (`client/src/lib/ageRanges.ts`) | Task 6 updates it; leaving it stale is exactly the drift that doc exists to prevent |
| No paid API, model, or SDK change | None of the CLAUDE.md paid-API guardrails apply. `POST /api/generate` stays `requireAuth` + `spendGate('story')`-gated; this spec only makes it reject bad input *earlier* |

## ADR-worthy decisions

- [ ] **The canonical age-range vocabulary is the seed list, and the enum gates writes only** —
  `2-5 3-6 4-7 4-8 5-9`; `BookSchema.age_range` stays `z.string()` on the read path so one
  legacy row cannot 500 the catalog. Hard to reverse: it fixes a user-facing vocabulary and a
  validation posture. Write via `/create-adr` after spec approval.
- [ ] **Existing rows converge via a boot-time backfill, not a Prisma migration** — because
  `render.yaml` deploys with `prisma db push`, no `migrations/` folder ever runs in production.
  This constraint is non-obvious, affects every future data fix in this repo, and deserves to
  be written down once. Write via `/create-adr` after spec approval.
- [ ] **`GET /api/books/age-ranges` serves `DISTINCT ∩ canonical`, in enum order** — not raw
  DISTINCT (which is how the drift became user-visible) and not the bare enum (which would
  advertise empty facets). Can fold into the first ADR if the reviewer prefers one entry.
- [ ] **#113's `independent` typography bucket stays unreachable** —
  `Deferred:` the canonical vocabulary tops out at `5-9`, and `independent` needs a lower bound
  ≥ 8, so no book the app can produce reaches `nunito`/`cozy`. It stays unit-tested-only in
  `server/src/lib/__tests__/typography.test.ts`. Deliberately not fixed here: making it
  reachable means *widening* the vocabulary (adding e.g. `8-12`), which is a product decision
  about who the store sells to, not a validation bug. Revisit by adding a band to
  `AgeRangeSchema` — one edit, now that there is one list.
