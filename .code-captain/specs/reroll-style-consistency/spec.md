# Re-roll style consistency — pin the image model per book, anchor the re-roll on existing art

> Status: Draft
> Last updated: 2026-08-23
> Backlog: no dedicated issue — reported by the repo owner in manual review of [PR #83](https://github.com/slickG0ose/storybook/pull/83). Related: [#91](https://github.com/slickG0ose/storybook/issues/91) (user-facing style override, explicitly out of scope here), [#62](https://github.com/slickG0ose/storybook/issues/62) (FAL_KEY unset in Render).

## Problem

Re-rolling a page illustration on an existing book produces art that does not match the rest of the book. The cause is **image-model drift across time**, not a missing style descriptor. Book `b2fa23cf-3156-4b89-83e7-82d98c32c8b7` ("A Spot for Sunny") carries `style_descriptor = "Classic storybook illustration, soft ink outlines with watercolor washes, warm and whimsical, gentle textures, suitable for young children"`, and that descriptor **is** correctly passed to `generateIllustration` at `server/src/routes/books.ts:721`. But its pages were generated on **2026-05-19** against OpenAI `gpt-image-1`, while the re-rolls (page-4 v3, page-5 v2) ran on **2026-08-23** against **Fal Flux Pro 1.1** — the default since PR #60 landed on 2026-06-05 (`getImageGenerator()` defaults `IMAGE_PROVIDER` to `'fal'`, and no `.env` in the tree sets it). Same prompt text, different model interpretation: v1 is flat colored-pencil/watercolor with visible linework, v2 is glossy digital painting with bloom lighting. Nothing in the Prisma schema records which provider produced a book's art, so every re-roll silently adopts today's default. The book has no character portraits (no `IllustrationVersion` rows in the portrait slot ≥ 1000), so the IV2 Kontext reference path was never involved.

**Do not "fix" the style-descriptor path — it is already correct.**

## Constraints

- **Prisma schema change** → migration required. `server/prisma/schema.postgresql.prisma` is generated from `schema.prisma` by `prisma/gen-postgres-schema.mjs`; regenerate it, never hand-edit (its header says so).
- **Never edit a committed migration** (`docs/conventions/data.md`). Fix forward only.
- **Wire shapes** (OPS.3 / ADR-003): `hydrateBook` spreads the whole Prisma row and `validate()` sends the *original* body — so any new `Book` column ships to the client whether or not it is in `BookSchema`. Every new column must be added to `shared/src/books.ts` and pinned by a `toMatchObject` assertion.
- **Middleware order** on `/illustrate` stays `requireAuth → spendGate → validate → handler`; new gating is a handler-body check after the ownership/`isEditable` checks, before any provider call, so it costs nothing.
- **Regression boundary from ADR-006 dec 3 / ADR-007 dec 3:** when no reference images are passed, the generator request must stay byte-identical to today. All new prompt clauses are gated on the anchor being present.
- **Spend:** `/illustrate` is a paid route. Every provider call must remain covered by `spendGate('illustration')` + a per-iteration `checkQuota` + a `recordUsage` on success.
- **Guardrail — model swap: CONFIRMED.** Routing the common single-page re-roll from Flux Pro 1.1 to Flux Kontext changes which paid model serves the default path, which CLAUDE.md gates on explicit owner confirmation. **Approved by Nick (repo owner) on 2026-08-23.** Recorded here so the audit trail shows the guardrail was discharged, not skipped.
- **Existing tests are extended, not replaced:** `server/src/services/__tests__/illustrations.test.ts`, `server/src/routes/__tests__/books.test.ts`.

### Decisions of record (owner-ruled 2026-08-23)

| Question | Ruling |
|---|---|
| Paid-model swap: Flux Pro 1.1 → Flux Kontext on the common re-roll path | **Approved** — Nick, 2026-08-23 |
| Metered cost of an `openai`-pinned image | **25¢** (`OPENAI_IMAGE_COST_CENTS = 25`), the mid of ADR-006's $0.17–0.45 range. `COST_CENTS` stays the default table for `fal`. |
| Current Fal Kontext / `kontext/multi` pricing | **Still outstanding.** Not readable from this repo; must be re-checked before merge. If it differs from 4¢, `COST_CENTS.illustration` is updated in the same PR. |

## Proposed shape

Two mitigations, shipped together.

**(A) Pin the image provider + model on the Book.** Two new nullable columns, `image_provider` and `image_model`. They are written **lazily, on the first successful image write for that book** — not at book-create time — so the pin always describes what actually produced the art rather than what the environment happened to default to when the row was created. (A book created with `previewMode: 'text'` on 2026-05-19 and first illustrated today should pin to *today's* provider, because it has no established style to match.) Once set, the pin wins over `IMAGE_PROVIDER` for that book forever. `IMAGE_PROVIDER` degrades to "the default for books that have no art yet". That is a partial supersession of ADR-006 decision 2.

**Backfill is runtime inference with write-back, not a data migration.** A book with no pin resolves as follows, in order: (1) the earliest `IllustrationVersion.created_at` in a page slot (`page_number < 1000`); (2) failing that, the oldest `page-*.png` mtime in `public/illustrations/<bookId>/` — the same filesystem-synthesis fallback `listIllustrationVersions` already uses for pre-table books; (3) failing both, the book has **no art**, so it pins to the current environment default. For (1) and (2), a timestamp earlier than `PROVIDER_CUTOVER_AT = 2026-06-05T00:00:00Z` (the merge date of #60, `1babb2d`) infers `openai` / `gpt-image-1`; on or after infers `fal` / `fal-ai/flux-pro/v1.1`. The resolved pin is then **persisted back onto the book**, so inference runs at most once per book and the system self-heals without a migration script or a filesystem-walking backfill that Prisma's SQL-only migrations cannot express.

**(B) Anchor the targeted re-roll on the page's existing illustration.** When `/illustrate` is called with a `pageNumber` and that page already has an `illustration_url` whose file exists on disk, that URL is prepended to `referenceImages`. On the Fal path this routes to `fal-ai/flux-pro/kontext` (1 ref) or `kontext/multi` (2+); on the OpenAI path it routes to `/v1/images/edits`. Both branches already exist. The anchor is **never** applied to a bulk illustrate (`pageNumber` absent) — those pages have no prior image by definition.

The anchor applies **whether or not `feedback` is present**, but the prompt is shaped differently. With feedback, Kontext is doing exactly what it is built for: "keep style, palette and composition; change only what the instructions ask". Without feedback — a bare "Redo" — an edit model anchored on its own output risks returning a near-identical picture, which defeats "give me a different take". The prompt therefore carries an explicit variation directive in that case. **This is the trade we are accepting:** a bare re-roll will now be *less* different than it is today. That is the reported bug's fix, not a side effect — the owner asked for "match the original book's theme and style" as the default. The escape hatches are typing feedback, and #91.

### Schema / contract changes

**Prisma** (`server/prisma/schema.prisma`, model `Book`), migration `add-book-image-pin`:

```prisma
  image_provider  String?   // 'openai' | 'fal' — null until first successful image
  image_model     String?   // e.g. 'gpt-image-1' | 'fal-ai/flux-pro/v1.1'
```

Both nullable, additive, no default → SQLite `ALTER TABLE ADD COLUMN` on shared rows. No seed-shape change (`prisma/seed.ts` / `demo-seed.ts` may omit them; they default to `NULL`).

**Zod** (`shared/src/books.ts`, `BookSchema`), required-and-nullable to match "the column always ships, sometimes as null":

```ts
  image_provider: z.string().nullable(),
  image_model: z.string().nullable(),
```

**Routes:** no new routes and no new response *fields* beyond the two above. `POST /api/books/:id/illustrate` gains one new failure mode: **409** when the book's pinned provider is not configured on this server (distinct from the existing 501 "image generation not configured"). Error envelopes are exempt from response validation, and the client already renders `{ error }` verbatim via `illustrateError`, so this needs no wire-shape change and no client fetch change.

**Service signatures** gain one trailing options object rather than more positional args (the existing `generateIllustration` already takes 7):

```ts
export interface ImagePin { provider: 'openai' | 'fal'; model: string }
export interface GenerationPin { pin?: ImagePin; styleAnchor?: string | null }

generateIllustration(bookId, pageNumber, description, feedback, styleDescriptor, characters, referenceImages, opts?: GenerationPin)
generateCover(bookId, title, description, styleDescriptor, characters, referenceImages, opts?: GenerationPin)
generateCharacterPortrait(bookId, characterIndex, name, descriptor, feedback, styleDescriptor, opts?: GenerationPin)
getImageGenerator(pin?: ImagePin): ImageGenerator
isImageGenConfigured(provider?: 'openai' | 'fal'): boolean   // no arg = env default, unchanged
```

Keeping the existing positional args intact means the current tests' `mock.calls[0][6]` reference-image assertions keep working; the new options land at `[7]`.

**Spend:** `costCentsFor(kind, provider?)` is added to `server/src/services/spend.ts`, and `checkQuota` / `recordUsage` take an optional trailing provider. `COST_CENTS` stays as the default table.

### Data flow

```
owner clicks "Redo (~$0.04)" on page N
  → POST /api/books/:id/illustrate { pageNumber: N, feedback? }
  → requireAuth → spendGate('illustration') → validate → handler
  → owner check (404) → isEditable (403)
  → resolveAndPinImagePin(book):
        book.image_provider set?           → use it            (source: pin)
        else earliest page-slot IllustrationVersion.created_at (source: evidence)
        else oldest page-*.png mtime                           (source: evidence)
        else current env default                               (source: default)
        → persist via ensureBookPinned() ONLY when source = evidence
          (updateMany where image_provider = null)
  → isImageGenConfigured(pin.provider)?
        no, and no provider configured at all → 501 (unchanged)
        no, but the default provider is     → 409 "pinned to <provider>, not configured here"
  → styleAnchor = page.illustration_url, iff pageNumber && the file exists on disk
  → referenceImages = [styleAnchor, ...collectRequiredPortraitRefs(cast)].slice(0, 3)
  → checkQuota(user, 'illustration', isAdmin, now, pin.provider)
  → generateIllustration(..., referenceImages, { pin, styleAnchor })
        → getImageGenerator(pin) — the pinned generator, with its model forced
        → Fal: 1 ref → kontext, 2+ → kontext/multi;  OpenAI: /v1/images/edits
  → recordUsage(user, 'illustration', pin.provider)
  → ensureBookPinned() on the first successful image — this is where a
    book with NO prior art gets pinned, to what actually drew it
  → page.illustration_url updated, hydrated book returned
```

State lives in the DB (`Book.image_provider` / `image_model`), on disk (the anchor image), and nowhere in client state. `IMAGE_PROVIDER` remains the default for unpinned books only.

**The pin is written on evidence-based resolution, or on the first successful image — never on an env-default resolution.** An earlier draft of this block persisted unconditionally, which meant a book with no art kept whatever `IMAGE_PROVIDER` happened to be when a request *failed* (501, 409, quota denial). That is the same "records an intention rather than a fact" failure this spec rejects under *Alternatives considered → Pin at book-creation time*, and it re-creates the original bug: pin `fal` on a denied request, flip `IMAGE_PROVIDER` to `openai`, let openai draw the art, and every later re-roll routes to `fal`. Corrected in implementation and here; carry it into ADR-013.

### Files likely touched

- `server/prisma/schema.prisma` — two new `Book` columns
- `server/prisma/migrations/<ts>_add_book_image_pin/migration.sql` — generated, committed
- `server/prisma/schema.postgresql.prisma` — regenerated via `npm run db:gen-postgres-schema`
- `shared/src/books.ts` — `BookSchema` gains `image_provider`, `image_model`
- `server/src/services/imagePin.ts` — **new**: `ImagePin`, `currentImagePin()`, `resolveImagePin()`, `ensureBookPinned()`, `PROVIDER_CUTOVER_AT`
- `server/src/services/illustrations.ts` — pin-aware `getImageGenerator` / `isImageGenConfigured`; anchor-aware prompt assembly; `GenerationPin` threading
- `server/src/services/providers/fal.ts` — base model comes from the pin, not only from `FAL_IMAGE_MODEL`
- `server/src/services/spend.ts` — `costCentsFor(kind, provider)`; provider-aware `checkQuota`/`recordUsage`
- `server/src/routes/books.ts` — `/illustrate` pin resolution, 409 gate, anchor assembly; portrait route pin threading
- `server/src/routes/generate.ts` — pin new books on first successful cover/page image
- `client/src/components/BookSpread.tsx` — one-line hint under "What to change on re-roll"
- `client/src/**/__tests__/*.tsx`, `e2e/tests/*.ts` — Book fixtures gain the two keys
- `server/src/services/__tests__/illustrations.test.ts`, `server/src/routes/__tests__/books.test.ts` — extended

## Alternatives considered

### Pin at book-creation time instead of on first successful image

**Pros:** simpler — one write, in one place, in `generate.ts`.
**Cons:** records an intention rather than a fact. A book created before the cutover with `previewMode: 'text'` and illustrated today would be pinned to `gpt-image-1` and then hit the 409 path forever, for art that never existed on that provider.
**Why rejected:** the pin's whole job is to describe the art that exists. Lazy pinning makes that true by construction.

### Data-migration backfill of legacy books

**Pros:** every row is explicit after one migration; no inference code path to maintain.
**Cons:** the best available evidence is the earliest illustration timestamp, and for pre-`IllustrationVersion` books that lives in **file mtimes** — which raw SQL in a Prisma migration cannot read. Using `Book.created_at` as the SQL proxy mis-pins exactly the case that motivates this spec (created 2026-05-19, illustrated 2026-08-23).
**Why rejected:** a separate one-off script would need to be run on every environment and would silently skip any it missed. Runtime inference with write-back is self-healing and correct on the first read.

### Silently fall back to the default provider when the pinned one is unconfigured

**Pros:** the user is never blocked.
**Cons:** it re-creates the exact reported bug, silently, on precisely the books that are most vulnerable to it — and given #62 (`FAL_KEY` unset in Render, and `OPENAI_API_KEY` unset everywhere in-tree) this would be the *common* path in production, not an edge case.
**Why rejected:** a fix whose failure mode is the original bug isn't a fix. 409 with an actionable message is the honest answer; #91's override is the intended unblock.

### Anchor on the cover, or on page 1, instead of the page's own image

**Pros:** transfers style without transferring composition, so a bare re-roll cannot return a near-copy.
**Cons:** Kontext is an edit model — handing it a *different* scene invites it to import that scene's subject and staging into the page. Not every book has a cover.
**Why rejected (held as upgrade path):** if manual verification shows bare re-rolls returning near-identical images even with the variation directive, switching the bare-redo anchor to the cover is a one-function change in `resolveStyleAnchor`. Documented deliberately so the fallback is cheap.

### Anchor only when `feedback` is absent (or only when present)

**Pros:** avoids reasoning about two prompt shapes.
**Cons:** either half loses the fix. Skipping the anchor when feedback is present means the highest-intent re-roll — the one the user typed into — is the one that drifts. Skipping it when feedback is absent means a bare Redo drifts.
**Why rejected:** the drift is the bug in both cases. Two prompt shapes is a small price.

### Full options-object refactor of `generateIllustration`

**Pros:** kills a 7-going-on-9-argument positional signature with three optional nullables in a row.
**Cons:** rewrites the positional-index assertions in the existing route tests (`REF_IMAGES_ARG = 6`) inside what is otherwise a bug fix.
**Why rejected (held as follow-up):** worth doing, not worth doing here. Adding one trailing options object keeps the existing tests valid and the diff readable.

## Success criteria

- A book with `image_provider = 'openai'` generates through `OpenAIImageGenerator` even when `IMAGE_PROVIDER=fal` — asserted in `illustrations.test.ts`.
- An unpinned book whose earliest page-slot `IllustrationVersion.created_at` is before `2026-06-05` resolves to `openai` / `gpt-image-1`, and that pin is **persisted to the Book row** — asserted in `imagePin.test.ts`.
- An unpinned book with no illustrations at all resolves to the current environment default — asserted.
- `POST /api/books/:id/illustrate { pageNumber: N }` on an already-illustrated page passes that page's `illustration_url` as `referenceImages[0]` — asserted in `books.test.ts`.
- The same call **without** `pageNumber` passes no anchor, and a page with no `illustration_url` passes no anchor — asserted.
- Anchor + primary + antagonist portraits yields exactly 3 references, anchor first — asserted.
- A book pinned to an unconfigured provider returns **409**, makes **zero** provider calls, and writes **zero** `UsageLog` rows — asserted in `books.test.ts`.
- The existing "501 when image generation is not configured" test passes **unchanged**.
- The no-reference prompt string is byte-identical to today's — asserted by the existing regression test.
- `image_provider` and `image_model` appear in a `toMatchObject` pin on a `/illustrate` response (OPS.3 / Check 4).
- Server, client, and e2e suites green; no new TypeScript errors.
- **Manual (aesthetic half of done-criterion #2, per ADR-009):** re-roll page 4 of `b2fa23cf-3156-4b89-83e7-82d98c32c8b7` and confirm the result reads as the same art style as `page-4.png` v1. Re-roll it a second time with no feedback and confirm the result is not a near-copy. Verify the new hint text in both light and dark mode.

## Out of scope

- **User-facing style override** — filed as [#91](https://github.com/slickG0ose/storybook/issues/91). The seam is left deliberately: `resolveImagePin(book)` is the single choke point an override would pass through, and the 409 message is the natural place to offer it.
- **Re-rolling a whole legacy book onto today's provider** to normalise its art. Different feature, different cost profile.
- **Changing the default provider** for new books. It stays `fal`.
- **Per-page character mapping** (IV2 Phase 2 out-of-scope, unchanged) and **LoRA** (#24).
- **The full positional→options refactor** of the illustration service signatures.

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| **A bare re-roll returns a near-identical image**, so the user pays 4¢ for nothing — the class of money bug this repo has shipped before | Explicit variation directive in the prompt when `feedback` is absent; manual verification is a named success criterion; documented one-function fallback to cover-anchoring |
| **Guardrail: model swap on a paid path.** The common re-roll moves from Flux Pro 1.1 to Flux Kontext | **Discharged** — explicitly approved by Nick (repo owner) on 2026-08-23. Recorded in "Decisions of record" above and carried into ADR-013 |
| **Kontext pricing may have drifted.** ADR-007 dec 4 pinned Kontext at a flat $0.04/image from Fal docs dated 2026-06-05 — ~2.5 months stale. `kontext/multi` pricing was never separately verified | **Open — the one unresolved pre-merge item.** Not verifiable from the repo. Owner re-checks Fal's current Kontext + Kontext/multi pricing before merge; if either differs from 4¢, `COST_CENTS.illustration` is updated in the same PR |
| **openai-pinned books cost 4–11× what they are metered at.** ADR-006 put `gpt-image-1` at ~$0.17–0.45/image while `COST_CENTS.illustration` charges 4¢ — pinning makes those calls reachable again, undercounted | **Resolved:** `costCentsFor(kind, provider)` charges openai-pinned images at **25¢** (`OPENAI_IMAGE_COST_CENTS`), ruled by the owner 2026-08-23 as the mid of ADR-006's range. `COST_CENTS` stays the default table for `fal` |
| `spendGate` reserves at the default rate before the pin is known | Unchanged posture: the middleware only reserves the *first* unit, and the handler's per-iteration `checkQuota` runs with the resolved provider before any call. Note it, don't re-architect it |
| **Migration hits two schema files.** Hand-editing `schema.postgresql.prisma` puts it out of sync with its generator | Edit `schema.prisma` only, then `npm run db:gen-postgres-schema`. Never edit a committed migration |
| Anchor file missing on disk (book restored from another machine) → `toDataUri` throws → 500 | `resolveStyleAnchor` checks existence first and drops the anchor with a `console.warn` rather than failing the re-roll |
| Reference count exceeds what `kontext/multi` accepts | Anchor takes slot 0, portraits fill the rest, hard cap `MAX_REFERENCE_IMAGES = 3`. Required portraits are at most primary + antagonist, so 3 is the natural maximum; truncation only bites if a cast declares multiple primaries, and warns when it does |
| **Wire shape:** two new `Book` fields ship on every book response because `hydrateBook` spreads the row | Add both to `BookSchema` and pin them with `toMatchObject`. `validate()` sends the original body, so an unpinned field would ship silently |
| Client/e2e Book fixtures typed as `Book` stop compiling | Mechanical: add `image_provider: null, image_model: null` to each. ~11 fixtures across `client/src/**/__tests__` and `e2e/tests` |
| **`IMAGE_PROVIDER` changes meaning** — it no longer controls books that have art | Partial supersession of ADR-006 dec 2. Must be written into the ADR and into `docs/conventions/server.md`, or the next operator will flip the env var and wonder why nothing changed |
| Legacy inference is a heuristic, not a record | It is keyed on the earliest **art** timestamp, never on `Book.created_at`, and is written back once so it never silently re-decides. The cutover constant carries the #60 merge SHA in a comment |
| Re-roll now sends a full 1024² PNG data-URI per reference on top of the portraits | Pre-existing ADR-007 dec 5 trade-off; body limit is 10 MB. No change, but 3 references is the new practical ceiling |

## ADR-worthy decisions

- [ ] **Pin `image_provider` + `image_model` on `Book`, written lazily on first successful image; the pin supersedes `IMAGE_PROVIDER` for any book that has art** — partially supersedes ADR-006 decision 2
- [ ] **Legacy backfill is runtime inference with write-back** (earliest `IllustrationVersion` → file mtime → env default, against a `2026-06-05` cutover), not a data migration or a one-off script
- [ ] **A pinned-but-unconfigured provider returns 409, never a silent fallback** to the current default
- [ ] **Style anchor = the page's own current illustration, on targeted re-rolls only, applied with or without feedback** — with a variation directive when feedback is absent, accepting that a bare redo becomes less different than it is today
- [ ] **Reference precedence: anchor at index 0, required portraits after, capped at 3** — extends ADR-007 decisions 4 and 7
- [ ] **Provider-aware spend cost** (`costCentsFor(kind, provider)`) at **25¢** for openai-pinned images, because an openai-pinned image costs 4–11× a Fal one — owner-ruled 2026-08-23
- [ ] **Paid-model swap to Flux Kontext on the common re-roll path** — CLAUDE.md guardrail, approved by Nick 2026-08-23; the ADR must record the confirmation and its date
- [ ] Deferred: **an unrecognised `image_provider` value re-infers on every call and is never repaired.** Surfaced by the developer in Task 2. `ensureBookPinned`'s `where: { image_provider: null }` — the clause that stops a concurrent write from being clobbered — by construction cannot match a row holding a junk value like `'stable-diffusion'`, so such a book falls through to inference forever rather than being healed. Deliberately not widened: correctness is unaffected (inference returns the right answer every time), the cost is a few extra queries, and nothing in the codebase writes a value outside `'openai' | 'fal'`. Documented by a test. Revisit only if a bad value is ever observed in a real row.
- [ ] Deferred: **full options-object refactor** of the illustration service signatures — file as an issue or a `Deferred:` line
- [ ] Deferred: **user-facing style override** — already tracked as [#91](https://github.com/slickG0ose/storybook/issues/91)
