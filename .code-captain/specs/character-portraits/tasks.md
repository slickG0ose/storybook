# Per-character portrait sheet + FLUX Kontext character references (IV2 Phase 2) — task plan

> Spec: [spec.md](spec.md)
> Status: Complete — all 9 tasks Done (2026-06-05)
> Last updated: 2026-06-05
> Planner: Claude Opus 4.8 (1M context) via @planner on 2026-06-05

## Overview

Nine tasks, server-heavy with two client tasks and a closing ADR-tracking task. The spine is: land the shared wire shapes (the data-shape confirmation gate), widen the `ImageGenerator.generate` interface in a strictly regression-safe way, add the portrait service + Fal Kontext provider branch behind a paid-API note, expose the two portrait routes, thread reference portraits through `/illustrate`, then build the client Cast panel and cost copy, and finally close out the eight ADR-worthy decisions. Sequence is mostly serial because each consumer (routes, then UI) depends on the shape and interface landing first; the IV1 regression boundary (prompt-only path byte-identical, OpenAI fallback, no-portrait books still illustrate) is provable at every step. Natural parallel cuts: Task 8 (client cost copy) runs alongside the server spine, and Task 9 (ADR tracking) runs last but depends on nothing code-wise.

## Cross-cutting constraints

Carried over from the spec — re-stated so the developer doesn't context-switch back.

- **Wire-shape (OPS.3 / Check 4):** Three response shapes are touched.
  - `CharacterSchema` gains `portrait_url: z.string().nullable().optional()`. It is embedded in `BookSchema.characters` and ships in **every** hydrated book response — `portrait_url` MUST be pinned by a `toMatchObject` assertion in `books.test.ts`.
  - `POST /api/books/:id/characters/:characterIndex/portrait` → `CharacterPortraitGenerateResponseSchema` = `BookWithPagesSchema.nullable()` (mirrors `/illustrate`). Response pinned.
  - `GET /api/books/:id/characters/:characterIndex/portraits` → `CharacterPortraitVersionListResponseSchema` = `z.array(IllustrationVersionSchema)`. Response pinned.
  - Define all request/response schemas in `shared/src/books.ts`; re-export through `server/src/types.ts`. **Never** declare a wire shape in `server/src/types.ts` directly.
- **Auth middleware order (load-bearing):** Both new routes are protected and owner-gated. Mount `requireAuth → validate({request?, response}) → handler` — auth FIRST so 401/403 wins over 400. Owner check (`book.created_by !== user.id → 404`) inside the handler, mirroring `/illustrate`. Both routes 501 when `!isImageGenConfigured()`.
- **Regression-safe boundary (IV1 / ADR-006):** The widened `generate(prompt, opts?)` MUST keep the no-reference path **byte-identical**. When `opts?.referenceImages` is absent/empty, `FalImageGenerator` calls Flux Pro 1.1 exactly as today and `OpenAIImageGenerator` calls gpt-image-1 exactly as today. IV1's existing `illustrations.test.ts` OpenAI assertion and Fal prompt-only assertion MUST stay green **unchanged**. A book with no portraits MUST still illustrate — `/illustrate` does NOT 403 on missing portraits; it falls back to prompt-only. The module-boundary mock in `books.test.ts` (lines 25–33, `vi.importActual` + spread overriding `generateIllustration`) MUST keep binding; if portrait routes call a new service fn, the mock must be extended without breaking the existing override.
- **Dark-mode parity (Check 3):** Every new `className` in the `BookDetail.tsx` Cast panel needs a `dark:` partner. Mirror the existing Cast-pill styling already at `BookDetail.tsx` ~line 430–448.
- **Migrations:** **NONE.** `characters_json` is already `String?` (schema.prisma line 39); adding `portrait_url` to the JSON blob is a wire+seed shape change, not DDL. Portrait history reuses the existing `IllustrationVersion` table via a `page_number` sentinel — no new table, no new column. Do NOT run `db:migrate`. (If the sentinel proves too subtle in review, the fallback is a dedicated `CharacterPortrait` table — that WOULD be a migration and is an ADR-worthy sub-decision; do not take that path without escalating.)
- **Guardrails touched:**
  - **Data-shape change (CLAUDE.md guardrail)** — `CharacterSchema` is a wire shape on every book response; the seed-shape gains the `portrait_url` key. **Task 1 carries an explicit USER CONFIRMATION REQUIRED gate.**
  - **More paid Fal calls (CLAUDE.md guardrail)** — portrait generation + iteration is a new paid-API **cost dimension** (same vendor Fal, same $0.04/image, no new vendor). Not a new-vendor approval, but **Task 4 (live portrait generation wiring) MUST surface this paid-API-increase note** before activating real calls.
  - **New dependency** — NOT in play. Kontext is reached via the same raw `fetch` pattern as IV1 (ADR-006 decision 1). Do NOT add `@fal-ai/client`; that is a separate dependency guardrail — escalate if tempted.
  - **Claude model / Anthropic SDK** — untouched. Out of scope.

## Tasks

### Task 1 — Shared schema: add `portrait_url` to `CharacterSchema` + portrait endpoint schemas — **data-shape confirmation gate**

**Zone:** shared (+ seed-shape note)
**Depends on:** none
**Parallel-safe with:** Task 8
**Status:** Done (2026-06-05)

> **USER CONFIRMATION REQUIRED — data-shape change (CLAUDE.md guardrail).**
> `CharacterSchema` is embedded in every hydrated Book response (OPS.3 / ADR-003), and this adds a key to the seeded `characters_json` shape. Before changing the shared schema, the developer MUST pause and get explicit user OK. `.nullable().optional()` keeps legacy blobs valid and there is NO Prisma migration — but the shape change still trips the guardrail. Confirm with the user, then proceed.

**Files to add or change:**

- `shared/src/books.ts` — add `portrait_url` to `CharacterSchema`; add the four new portrait schemas (below).
- `server/src/types.ts` — re-export the new schemas (thin re-export only; no server-local shape).
- `client/src/types.ts` — picks up `portrait_url` automatically via the `@storybook/shared` re-export; confirm no manual edit needed.

**Signatures / shapes:**

```ts
// CharacterSchema — ONE new field. nullable so the wire can carry explicit
// null; optional so legacy characters_json blobs without the key still validate.
export const CharacterSchema = z.object({
  role: CharacterRoleSchema,
  name: z.string(),
  descriptor: z.string().optional(),
  relationship: z.string().optional(),
  portrait_url: z.string().nullable().optional(),   // NEW
});

// POST /api/books/:id/characters/:characterIndex/portrait
export const CharacterPortraitGenerateRequestSchema = z.object({
  feedback: z.string().optional(),                  // mirrors BookIllustrateRequestSchema
});
export const CharacterPortraitGenerateResponseSchema = BookWithPagesSchema.nullable();

// GET .../portraits — reuse the exact IllustrationVersionSchema shape
export const CharacterPortraitVersionListResponseSchema = z.array(IllustrationVersionSchema);
// (No standalone CharacterPortraitVersionSchema needed — it IS IllustrationVersionSchema.)
```

**Tests to write:**

- None net-new in this task (the wire-shape `toMatchObject` assertions land in Tasks 5/6 with the routes that emit the shapes). The shared package is source-only; type inference is the contract.
- Wire-shape assertion required: deferred to Tasks 5/6 (`portrait_url` pinned in the books detail/list assertion; the two new route responses pinned with their handlers).

**Manual verify (if applicable):**

- None (schema-only).

**Done when:**

- User has explicitly confirmed the data-shape change (gate above satisfied).
- `CharacterSchema` carries `portrait_url: z.string().nullable().optional()`.
- The three portrait request/response schemas exist in `shared/src/books.ts` and are re-exported from `server/src/types.ts`.
- `cd server && npm test` and `cd client && npm test` stay green (no consumer reads the field yet, so existing book responses still validate — the optional key is backward-compatible).
- No TypeScript errors anywhere; `client/src/types.ts` picks up the field with no manual edit.

---

### Task 2 — Widen `ImageGenerator.generate(prompt, opts?)` interface; no-reference path byte-identical

**Zone:** server
**Depends on:** none (interface widening is independent of the shared schema)
**Parallel-safe with:** Task 1, Task 8
**Status:** Done (2026-06-05)

**Files to add or change:**

- `server/src/services/illustrations.ts` — widen the `ImageGenerator` interface signature; update `OpenAIImageGenerator.generate` and the public-fn call sites to accept/forward the optional `opts`. Keep behavior identical when `opts` is absent.
- `server/src/services/providers/fal.ts` — widen `FalImageGenerator.generate` signature to accept `opts` (branch logic lands in Task 3; here just accept and ignore-when-empty so the no-reference path stays byte-identical).

**Signatures / shapes:**

```ts
export interface ImageGenerator {
  readonly name: 'openai' | 'fal';
  generate(prompt: string, opts?: { referenceImages?: string[] }): Promise<Buffer>;
}
// referenceImages = list of on-disk illustration paths (e.g.
// '/illustrations/<bookId>/portrait-<slot>.png'). When absent/empty, EVERY
// generator must behave exactly as today (regression-safe). Resolution of the
// paths to data-URIs/URLs is a generator-internal concern (Task 3).
```

**Tests to write:**

- No net-new test required here. The existing `illustrations.test.ts` OpenAI assertion and Fal prompt-only assertion are the regression oracle — they call `generate(prompt)` with no opts and MUST stay green **unchanged**.
- Wire-shape assertion required: no (internal interface; no route change).

**Manual verify (if applicable):**

- None (no behavior change when opts absent).

**Done when:**

- The interface and both implementations accept the optional second arg.
- `cd server && npm test` green with **zero** edits to existing test files (regression proof).
- No TypeScript errors; public service fn signatures still callable as before.
- This extends/supersedes ADR-006 decision 3 — recorded in Task 9, not here.

---

### Task 3 — `FalImageGenerator` Kontext branch + `OpenAIImageGenerator` image-input + reference plumbing (data-URI)

**Zone:** server
**Depends on:** Task 2
**Parallel-safe with:** none
**Status:** Done (2026-06-05)

**Files to add or change:**

- `server/src/services/providers/fal.ts` — when `opts.referenceImages` is non-empty: route to `fal-ai/flux-pro/kontext` (single ref → body `{ image_url, prompt, ... }`) or `fal-ai/flux-pro/kontext/multi` (2+ refs → body `{ image_urls: [...], prompt, ... }`). When empty/absent: Flux Pro 1.1, byte-identical to today. Response shape is the same `{ images: [{ url }] }` either way. Resolve each `/illustrations/...` path to bytes and pass as a base64 data URI (recommended option b) so Fal needn't reach `localhost`.
- `server/src/services/providers/openai.ts` — when `opts.referenceImages` is non-empty: use gpt-image-1's image-input slot; when absent: no-op, byte-identical to today. (Note: the spec's "Files likely touched" says openai.ts was extracted in IV1; if it is still inline in `illustrations.ts`, branch there instead — developer confirms file location.)

**Signatures / shapes:**

```ts
// Model ids pinned from Fal docs 2026-06-05 (spec "Fal model selection"):
//   single ref  -> fal-ai/flux-pro/kontext        body { image_url, prompt }
//   2+ refs     -> fal-ai/flux-pro/kontext/multi   body { image_urls: string[], prompt }
//   no ref      -> fal-ai/flux-pro/v1.1 (default, unchanged)
// Both Kontext models are flat $0.04/image and return { images: [{ url }] }.
// Reference plumbing (option b): read each portrait file -> base64 data URI
// (data:image/png;base64,...) -> pass as image_url / image_urls entry.
// Keep the 120s AbortController parity. Branch on referenceImages?.length.
```

**Tests to write:**

- Extend `server/src/services/__tests__/illustrations.test.ts` (or a focused provider test): a Kontext-path case — set `IMAGE_PROVIDER=fal`, pass `referenceImages`, mock `fetch` to assert the request hits the **kontext** model id and carries `image_url`/`image_urls`, returns `{ images: [{ url }] }`, downloads bytes. Keep the existing prompt-only Fal + OpenAI assertions untouched and green (regression gate).
- Wire-shape assertion required: no (internal provider; no route response shape).

**Manual verify (if applicable):**

- None in this task (live Kontext call verified in Task 7's bulk-illustrate manual step, after portraits exist).

**Done when:**

- With references present, the Fal path calls the correct Kontext model id (single vs multi) and the OpenAI path uses the image-input slot.
- With references absent/empty, BOTH paths are byte-identical to today (existing tests green unchanged).
- Reference paths are resolved to data-URIs (option b); no dependency on Fal reaching `localhost`.
- `cd server && npm test` green; no new `server/package.json` entry; no TypeScript errors.

---

### Task 4 — Service: `generateCharacterPortrait()` + portrait-slot version helper — **paid-API-increase note**

**Status:** Done (2026-06-05)

**Zone:** server
**Depends on:** Task 2 (widened interface), Task 1 (for the `portrait_url` shape it ultimately feeds, though the patch into `characters_json` happens in the route)
**Parallel-safe with:** none

> **Paid-API note (CLAUDE.md guardrail — more paid Fal calls).**
> Portrait generation + per-character iteration is a new paid-API **cost dimension** (same vendor Fal, same $0.04/image — portraits run on Flux Pro 1.1). Not a new-vendor approval, but the developer MUST surface this cost-increase note to the user before wiring the live portrait-generation call path. (Cost copy lands client-side in Task 8.)

**Files to add or change:**

- `server/src/services/illustrations.ts` — add `generateCharacterPortrait()`; add a portrait-slot version helper that mirrors `getNextVersion` but keys on the sentinel `page_number`; portraits write to `server/public/illustrations/<bookId>/portrait-<slot>.png`. Thread `referenceImages` through `generateIllustration`/`generateCover` (add the optional param so the route can pass per-page reference portraits in Task 6).

**Signatures / shapes:**

```ts
// Portrait slot sentinel: encode from the character's index/role-slot into a
// page_number range that can NEVER collide with real pages (1..15, MAX_PAGES).
// Recommended: a fixed high offset, e.g. PORTRAIT_SLOT_BASE = 1000; slot =
// PORTRAIT_SLOT_BASE + characterIndex. The existing @@unique([book_id,
// page_number, version]) then gives free per-character version numbering.
// (Negative range is the alternative; pick one and comment it loudly — the
// sentinel readability cost is an ADR-worthy sub-decision, Task 9.)
const PORTRAIT_SLOT_BASE = 1000;

export async function generateCharacterPortrait(
  bookId: string,
  characterIndex: number,
  name: string,
  descriptor: string | undefined,
  styleDescriptor: string | null | undefined,
  feedback?: string,
): Promise<string | null>;
// prompt-only (name + descriptor + style), generated on Flux Pro 1.1 (no
// reference yet). Writes portrait-<slot>.png, inserts an IllustrationVersion
// row in the portrait slot, returns the new /illustrations/... url.
// Returns null if !isImageGenConfigured() (mirrors generateIllustration).

// generateIllustration / generateCover gain an optional trailing param:
//   referenceImages?: string[]   // forwarded to generate(prompt, { referenceImages })
```

**Tests to write:**

- `illustrations.test.ts` — a `generateCharacterPortrait` case: asserts a portrait PNG is written, an `IllustrationVersion` row lands in the sentinel slot (correct `page_number`, version 1, matching url/feedback), and the returned url. A second call with `{ feedback }` produces version 2 in the same slot.
- Assert portraits use the **prompt-only** Flux Pro 1.1 path (no reference), not Kontext.
- Wire-shape assertion required: no (service layer; DB row + url contract are the assertions).

**Manual verify (if applicable):**

- None here (live verification is Task 6/7 once the route + UI exist).

**Done when:**

- Paid-API-increase note surfaced to user.
- `generateCharacterPortrait()` writes file + sentinel-slot `IllustrationVersion` row + returns url; iteration produces incrementing versions in the same slot.
- `generateIllustration`/`generateCover` accept and forward `referenceImages` (still byte-identical when not passed).
- `cd server && npm test` green; existing tests unchanged; no TypeScript errors.

---

### Task 5 — Server routes: `POST .../portrait` (gen/regen) + `GET .../portraits` (history) + wire-shape assertions

**Status:** Done (2026-06-05)

**Zone:** server
**Depends on:** Task 1 (schemas), Task 4 (service fn)
**Parallel-safe with:** none

**Files to add or change:**

- `server/src/routes/books.ts` — add the two routes; reuse `hydrateBook` (no change needed — it already round-trips `characters_json`, so the new `portrait_url` key rides along). Address by **`:characterIndex`** (array index into hydrated `characters`), NOT `:role` — names/roles aren't unique (spec ADR sub-decision; recommended). The POST handler: owner-gate → 501 if `!isImageGenConfigured()` → call `generateCharacterPortrait()` → patch `characters_json[index].portrait_url` to the new url → return hydrated book. The GET handler lists that character's portrait history via the slot.
- `server/src/services/illustrations.ts` — add `listCharacterPortraitVersions(bookId, characterIndex)` reusing the `listIllustrationVersions` machinery against the sentinel slot (or generalize the existing fn to take an arbitrary slot).
- `server/src/routes/__tests__/books.test.ts` — integration tests for both routes + **wire-shape assertions**. Extend the module-boundary mock (lines 25–33) to also mock `generateCharacterPortrait`/`listCharacterPortraitVersions` without breaking the existing `generateIllustration` override.

**Signatures / shapes:**

```ts
// POST /api/books/:id/characters/:characterIndex/portrait
//   requireAuth -> validate({ request: CharacterPortraitGenerateRequestSchema,
//                             response: CharacterPortraitGenerateResponseSchema }) -> handler
//   owner-gate (book.created_by !== user.id -> 404); 501 if !isImageGenConfigured()
//   returns hydrated BookWithPages (.characters[index].portrait_url repointed)

// GET /api/books/:id/characters/:characterIndex/portraits
//   requireAuth -> validate({ response: CharacterPortraitVersionListResponseSchema }) -> handler
//   owner-gate; returns IllustrationVersion[] for that character's slot
```

**Tests to write:**

- POST: generates a portrait, returns hydrated book, `res.body.characters[index].portrait_url` is a `/illustrations/...` string. **Wire-shape assertion** pinning `portrait_url` (and the rest of the character shape) here — this satisfies Check 4 for `CharacterSchema`.
- POST with `{ feedback }`: repoints `portrait_url` to the new version.
- POST 501 when `!isImageGenConfigured()`; 404 for non-owner; 401 unauth (auth-before-validate).
- GET: returns the portrait version list; **wire-shape assertion** pinning `{ url, version, created_at, feedback }`.
- Wire-shape assertion required: **yes** — `CharacterPortraitGenerateResponseSchema` (the `portrait_url` field on `characters[]`) and `CharacterPortraitVersionListResponseSchema`.

**Manual verify (if applicable):**

- Covered by the Cast-panel manual verify in Task 7 (the route is exercised through the UI there).

**Done when:**

- Both routes mounted with `requireAuth → validate → handler` order; owner-gated; 501 when image gen unconfigured.
- `portrait_url` is pinned by a `toMatchObject` assertion in `books.test.ts` (Check 4).
- Both new route responses are wire-shape-pinned.
- The existing module-boundary mock still binds; all prior `books.test.ts` tests stay green.
- `cd server && npm test` green; no TypeScript errors.

---

### Task 6 — Thread per-page reference portraits through `/illustrate`; confirm no-portrait fallback

**Zone:** server
**Depends on:** Task 3 (Kontext branch), Task 5 (portraits exist + `portrait_url` populated)
**Parallel-safe with:** none
**Status:** Done (2026-06-05)

**Files to add or change:**

- `server/src/routes/books.ts` — update the `/illustrate` handler (~lines 660–679): for each page, collect the `portrait_url`s of that page's relevant characters and pass them as `referenceImages` to `generateIllustration`. Phase 2 heuristic (no per-page character mapping UI): pass all **required-character** (primary + antagonist) portraits that exist; if none exist, pass nothing → prompt-only fallback. Resolve `portrait_url` (a `/illustrations/...` web path) to the on-disk path the provider expects.
- `server/src/routes/generate.ts` — confirm `previewMode: 'full'` page-gen still works with NO portraits (regression path). Likely no code change — just a confirming test.

**Signatures / shapes:**

```ts
// In /illustrate, per page:
//   const refs = hydratedBook.characters
//     .filter(c => /* required role + has portrait_url */)
//     .map(c => c.portrait_url!)        // /illustrations/<id>/portrait-<slot>.png
//   await generateIllustration(book.id, page.page_number, desc, fb, style,
//                              hydratedBook.characters, refs.length ? refs : undefined);
// refs empty -> generateIllustration forwards no referenceImages -> Flux Pro 1.1
// prompt-only (today's behavior, no 403, no regression).
```

**Tests to write:**

- `books.test.ts` — illustrate WITH portraits present: assert `generateIllustration` (mocked) is called with a non-empty `referenceImages` arg.
- illustrate WITHOUT portraits: assert it is called with no/empty `referenceImages` and still returns 200 with illustrated pages (no 403) — the regression-safe fallback.
- Wire-shape assertion required: no net-new shape (`/illustrate` response unchanged — `BookWithPagesSchema.nullable()`); the `portrait_url`-on-characters pin from Task 5 covers the field.

**Manual verify (if applicable):**

- Covered in Task 7 (bulk-illustrate after approving cast) — qualitative consistency check, light + dark.

**Done when:**

- `/illustrate` passes required-character portraits as `referenceImages` when present; passes nothing when absent.
- A book with NO portraits still illustrates (200, no 403) — explicit regression test green.
- `IMAGE_PROVIDER=openai` path still honored (provider switch respected for the reference path).
- `cd server && npm test` green; no TypeScript errors.

---

### Task 7 — Client Cast panel on draft `BookDetail.tsx` + approve-cast soft gate (dark-mode parity)

**Zone:** client
**Depends on:** Task 5 (routes), Task 1 (`portrait_url` on the wire)
**Parallel-safe with:** Task 8 (different file in same zone — coordinate, low conflict)
**Status:** Done (2026-06-05) — manual-verify PENDING (browser, light + dark)

**Files to add or change:**

- `client/src/pages/BookDetail.tsx` — new **Cast panel** in the draft view (`isDraft && isOwner`, near the existing Cast pills ~line 430). Per character: portrait thumbnail (or placeholder), "Generate portrait" / "Regenerate" (with feedback input) buttons calling `POST /api/books/:id/characters/:index/portrait`, and an iterate/history affordance reading `GET .../portraits`. Approve-cast **soft gate**: disable the bulk-illustrate button until every **required** character (primary + antagonist) has a `portrait_url`, OR the user clicks "Skip portraits — illustrate anyway." Show the nudge copy "Approve cast to illustrate with consistent characters." Approval is **client UI state only** — no persisted `cast_approved` field. Per-portrait `$0.04` shown next to each button via `fmtUsd(PER_IMAGE_COST_USD)` (imported from CreateBook's cost module or a shared cost-copy module — see Open questions).

**Signatures / shapes:**

```tsx
// All new classNames need a dark: partner (Check 3). Mirror the existing Cast
// pill styling at BookDetail.tsx ~430-448 and existing card/button surfaces.
// Icon-only buttons need aria-label (e.g. "Generate portrait for <name>").
// "Required character" = role === 'primary' || role === 'antagonist'.
// Supporting characters get an optional Generate affordance, don't block approval.
// Fetch uses the relative '/api/...' form + Authorization: Bearer header.
```

**Tests to write:**

- `client/src/pages/__tests__/BookDetail.test.tsx` (extend if present) — Cast panel renders one row per character; required character without a portrait disables bulk-illustrate; "Skip portraits" enables it; clicking Generate fires the POST with the right index. Mock fetch per testing.md.
- Wire-shape assertion required: no (client; the server side pins the shape).

**Manual verify (if applicable):**

- Open a draft book's BookDetail, generate a portrait for each character, confirm the thumbnail renders and the row updates. Regenerate with feedback → new version. Approve cast → bulk-illustrate enabled → illustrate and eyeball character consistency vs the text-only baseline.
- **Verify in BOTH light and dark mode** (CLAUDE.md done criterion 2 + Check 3).

**Done when:**

- Cast panel renders, generate/regenerate/iterate work end-to-end against the routes.
- Approve-cast soft gate behaves: required-portrait completeness OR explicit skip enables bulk-illustrate; never server-enforced.
- Every new className has a `dark:` partner; verified in browser light + dark.
- `cd client && npm test` green; no TypeScript errors.

---

### Task 8 — Client portrait-step cost copy in `CreateBook.tsx` (reuse `PER_IMAGE_COST_USD`)

**Status:** Done (2026-06-05)

**Zone:** client
**Depends on:** none (copy only; reuses the existing constant)
**Parallel-safe with:** server Tasks 1–6, and Task 7 (different file)

**Files to add or change:**

- `client/src/pages/CreateBook.tsx` — add portrait-counting cost-copy builders reusing the existing `PER_IMAGE_COST_USD` (line ~49) and `fmtUsd` (line ~51); do NOT add a second price constant (Kontext and Flux Pro 1.1 are both $0.04). A "portrait step" note: `~$(requiredCharCount × PER_IMAGE_COST_USD)` for one portrait per required character, plus "each regenerate is ~$0.04" (mirror `laterClickCostNote` at line ~60). Preserve existing `dark:` variants.

**Signatures / shapes:**

```ts
// Reuse PER_IMAGE_COST_USD + fmtUsd. New counting builder, e.g.:
export const portraitStepCostNote = (requiredCharCount: number): string =>
  `~${fmtUsd(requiredCharCount * PER_IMAGE_COST_USD)} to generate one portrait per ` +
  `required character. Each regenerate is ~${fmtUsd(PER_IMAGE_COST_USD)}.`;
// No new constant; no user-facing figure changes (still $0.04/image).
```

**Tests to write:**

- `client/src/pages/__tests__/CreateBook.test.tsx` — assert the portrait cost note scales with the required-character count and reads from `PER_IMAGE_COST_USD`. Light test, copy not logic.
- Wire-shape assertion required: no.

**Manual verify (if applicable):**

- Confirm the portrait cost note renders and scales; **verify light + dark**.

**Done when:**

- Portrait cost copy added, sourced from the single existing constant; no second price constant introduced.
- `cd client && npm test` green; `dark:` variants preserved; no TypeScript errors.

---

### Task 9 — Pre-merge follow-ups (ADR tracking — 8 items)

**Zone:** docs (harness)
**Depends on:** none (run last, after the feature tasks land)
**Parallel-safe with:** Task 8
**Status:** Done (2026-06-05) — ADR-007 (grouped, decisions 1–8; supersedes ADR-006 dec 3, supplements ADR-002); adr-tracking-check reports zero orphaned items

The spec's `## ADR-worthy decisions` section flags **eight** items. Ensure each has exactly one tracking action — a matching ADR in `.code-captain/product/decisions.md`, a linked follow-up issue, or an explicit `Deferred:` line with reasoning. Note two items modify existing ADRs and likely warrant **real ADRs**, not Deferred lines:

1. **Schema fork: embedded `characters_json` + `portrait_url` vs. promoted `Character` table.** Cites/supplements **ADR-002** — likely a real ADR re-affirming ADR-002 for Phase 2 and naming the Phase-3 supersession trigger.
2. **Portrait version-history storage: `IllustrationVersion.page_number` sentinel overload vs. dedicated `CharacterPortrait` table.** Recommended sentinel; record the decision.
3. **Widen `ImageGenerator.generate` to `generate(prompt, opts?)`.** Extends/**supersedes ADR-006 decision 3** — needs its own ADR citing ADR-006.
4. **Fal model for references: `fal-ai/flux-pro/kontext` (+ `/multi`) vs. literal IP-Adapter `flux-general`.** Record (Kontext recommended; pinned from Fal docs 2026-06-05).
5. **Reference-image plumbing: data-URI/upload vs. public URL.** Record (data-URI recommended).
6. **Approve-cast gate is client-side soft nudge, not server-enforced; no persisted `cast_approved` field.** Record (consistent with F4b posture).
7. **"Required character" = primary + antagonist only.** Product/cost decision; cite research open-question #5.
8. **Portrait route addressing: `:characterIndex` vs. `:role`.** Record (`:characterIndex` recommended).

**Done when:**

- `adr-tracking-check character-portraits` reports **zero orphaned items**.
- The tracking decision for each of the eight items is recorded (ADR written / issue linked / `Deferred:` line added). Items 1 and 3 are written as real ADRs (citing ADR-002 and superseding ADR-006 decision 3 respectively), per the spec's framing.

---

## Sequencing notes

- **Serial spine: Task 1 → 2 → 3 → 4 → 5 → 6.** Each consumer depends on the prior shape/interface landing. Task 1 (shared schema, behind the data-shape gate) and Task 2 (interface widening) are independent of each other and can land in either order, but both must precede the routes. Task 6 (reference threading through `/illustrate`) is last in the server spine because it needs both the Kontext branch (Task 3) and populated `portrait_url`s (Task 5).
- **Regression provability at each step:** Tasks 2, 3, and 4 each keep the IV1 prompt-only/OpenAI tests green unchanged; Task 6 adds the explicit no-portrait-still-illustrates test. Do not let any task edit the existing IV1 regression assertions.
- **Parallel cuts:** Task 8 (client cost copy) has no server dependency and can be dispatched concurrently with the entire server spine. Task 7 (Cast panel) and Task 8 are both client/`pages` but different files — low conflict, can run alongside each other once Tasks 1+5 land. Task 9 (ADR tracking) runs last.
- **PR cuts (suggested, mirroring the IV1 cadence — small, behavior-scoped):** Task 1 (shared shape, gated) as its own small PR so the wire change is isolated and reviewable. Tasks 2+3+4 (interface + provider branch + portrait service) as one server PR behind the paid-API note. Tasks 5+6 (routes + reference threading) as a second server PR. Task 7 (Cast panel) as a client PR. Task 8 can ride with Task 7 or ship alone. Task 9 closes out before final merge.
- **e2e:** The Cast-panel + bulk-illustrate flow is a net-new user-facing flow that crosses zones and exercises new routes — a candidate for a net-new Playwright spec. Per the harness, net-new e2e specs are a **@qa hand-off**, not a `@developer` task. See Open questions — decide whether to commission a `@qa` portrait-flow spec or rely on Task 7's RTL coverage + existing illustration-history e2e for Phase 2.

## Implementation questions (resolved during execution)

These were "resolve before dispatching the developer" questions — all now closed by the work. They are implementation/sequencing questions, **not** ADR-worthy decisions (those live in the spec's `## ADR-worthy decisions` section and are tracked by Task 9 / ADR-007).

- **Cost-copy module location (Task 7 ↔ Task 8).**
  **Resolved:** extracted `PER_IMAGE_COST_USD` + `fmtUsd` + `portraitStepCostNote` to `client/src/lib/cost.ts` (Task 8); both `CreateBook.tsx` and the Cast panel import from there — no page-to-page import.
- **Cast-panel e2e: @qa hand-off or not?**
  **Resolved:** `@qa` hand-off for the happy-path flow, scoped so it does not depend on live Fal calls (CI has no `FAL_KEY`, so portrait generation gates to 501 there). Dispatched after the feature lands; Task 7's RTL tests cover the component logic in the meantime.
- **`/illustrate` per-page reference heuristic (Task 6).**
  **Resolved:** pass ALL required-character (primary+antagonist) portraits that exist as references to every page → `kontext/multi` when 2+, `kontext` single when 1, prompt-only fallback when 0 (Task 6, via the shared `collectRequiredPortraitRefs` helper).
