# Per-character portrait sheet + IP-Adapter character references (IV2 Phase 2)

> Status: Accepted
> Last updated: 2026-06-05
> Architect: Claude Opus 4.8 (1M context) via @architect on 2026-06-05
> Backlog: https://github.com/slickG0ose/storybook/issues/23

## Problem

Characters drift visibly between pages of the same book today. The cast is passed to image generation only as a text prefix (`formatCastPrefix` in `services/illustrations.ts` — "Cast (keep these characters visually consistent): ..."), and diffusion models are stochastic: the same descriptor produces a different face on every page. The book reads as "AI-glued-together" rather than authored. IV1 (#22, ADR-006) migrated image gen to Fal Flux Pro 1.1 behind an `ImageGenerator` interface but explicitly deferred the consistency fix. This spec is Phase 2 of the research roadmap's recommended "Approach 1: character sheet + IP-Adapter": generate one canonical portrait per cast member, let the user iterate on each, then feed those portraits as reference images into every page generation so the same characters appear across all pages.

## Constraints

- **CLAUDE.md guardrail — data-shape change.** This changes `CharacterSchema` (a wire shape shipped in every hydrated Book response, OPS.3/ADR-003) and adds a Prisma migration. The planner must emit a user-confirmation step and a migration/seed step; wire-shape assertions (reviewer Check 4) apply to every changed response.
- **CLAUDE.md guardrail — more paid Fal calls.** Per-character generation + per-character iteration is a new paid-API cost dimension on top of per-page. No new *vendor* is added (still Fal), so this is a cost increase, not a new-API approval — but it must be called out and represented in client cost copy.
- **ADR-006 boundary.** The `ImageGenerator` interface today is `generate(prompt: string): Promise<Buffer>` and "owns ONLY the network call." ADR-006 decision 3 says a provider needing to influence inputs "would need the interface widened." Phase 2 is that future — widening `generate()` to accept reference images. This **extends/supersedes ADR-006 decision 3** and needs its own ADR.
- **ADR-002 precedent.** Character cast is deliberately JSON-on-`Book` (`characters_json`), not a table, "matches an existing precedent (`pages_json`)... no query pressure... migration is additive and reversible." Any departure must re-argue ADR-002.
- **Regression-safe boundary (ADR-006 consequences).** OpenAI must remain a working fallback (`IMAGE_PROVIDER=openai`). The widened interface must keep the no-reference `generate(prompt)` path byte-identical for callers that pass no references.
- **No server-side spend-gate (F4b deferral, ADR-006).** Cost lives only as client copy (`PER_IMAGE_COST_USD` in `CreateBook.tsx`). This spec does NOT add a server spend-gate.
- **Flux Pro 1.1 cannot take reference images.** Its `https://fal.run/fal-ai/flux-pro/v1.1` endpoint is prompt-only. The consistency mechanism requires a *different Fal model* (see "Fal model selection" below). This is the single most important grounding finding.

## Proposed shape

Phase 2 has four moving parts: a place to store portraits, a new generator capability, two new server endpoints, and a wizard step.

**1. Storage — extend the embedded JSON (recommended fork resolution, see Alternatives).** Add an optional `portrait_url?: string` to `CharacterSchema`. Per-character portrait *version history* reuses the existing `IllustrationVersion` table by overloading `page_number` with a sentinel-coded "portrait slot" rather than adding a new table — see "Schema / contract changes." This keeps ADR-002's JSON-cast decision intact (the cast stays a blob; we add one field) while reusing the page-illustration history machinery that already does exactly this job for pages.

**2. Generator — widen the interface for reference images.** `ImageGenerator.generate` gains an optional second argument: `generate(prompt: string, opts?: { referenceImages?: string[] }): Promise<Buffer>`. `referenceImages` is a list of **on-disk illustration paths** (e.g. `/illustrations/<bookId>/portrait-primary.png`) that the generator resolves to absolute file URLs Fal can fetch, OR uploads — see "Reference-image plumbing." When `referenceImages` is absent/empty, every generator behaves exactly as today (regression-safe). `FalImageGenerator` switches model based on whether references are present: prompt-only → Flux Pro 1.1 (unchanged); with references → Flux Kontext (single or `/multi`). `OpenAIImageGenerator` with references uses gpt-image-1's image-input slot; without, unchanged.

**3. Server — two new endpoints.** A portrait-generation endpoint (`POST /api/books/:id/characters/:role/portrait`) generates/regenerates one character's portrait (optionally with feedback), writes the file, records an `IllustrationVersion` row in the portrait slot, and updates that character's `portrait_url` inside `characters_json`. A list endpoint (`GET /api/books/:id/characters/:role/portraits`) returns that character's portrait history for the iterate-UI. Page generation (`generateIllustration`/`generateCover` and the `/illustrate` route) is updated to collect the portraits of the characters relevant to each page and pass them as `referenceImages`.

**4. Wizard — portraits happen *after* book creation, on the book-draft page, not inside the pre-creation wizard.** This is a structural fork the issue underspecified: the `CreateBook` wizard builds the cast entirely client-side **before any book row exists** (no book ID until `/api/generate` returns). Portrait generation needs a persisted book + character to hang a `portrait_url` and `IllustrationVersion` rows on. So the "generate + iterate + approve portraits" step lives on the **book-draft view** (`BookDetail.tsx`, draft state) as a new "Cast" panel, gating page-illustration. The wizard's `previewMode` gains the implication that "Full" no longer auto-illustrates pages until portraits are approved (see "Approve-cast gate semantics").

### Fal model selection (pinned from current docs, 2026-06-05)

Flux Pro 1.1 (current default) is **prompt-only** — confirmed against `fal.ai/models/fal-ai/flux-pro/v1.1`. Two reference-capable Fal models were evaluated against current docs:

| Model | id | Reference input | Price | Response shape | Notes |
|---|---|---|---|---|---|
| FLUX Kontext [pro] | `fal-ai/flux-pro/kontext` | single `image_url` + `prompt` | **$0.04/image** (flat) | `{ images: [{ url, ... }], ... }` — same as Flux Pro 1.1 | Purpose-built: "preserve unique characters across different scenes" without fine-tuning |
| FLUX Kontext [pro] multi | `fal-ai/flux-pro/kontext/multi` | `image_urls` **array** + `prompt` | **$0.04/image** (flat) | same | Experimental multi-image; for pages with 2+ characters in frame |
| FLUX.1 [dev] general i2i | `fal-ai/flux-general/image-to-image` | IP-Adapter (`image_url` + HF `path` + `image_encoder_path` + `scale`) | ~$0.075/megapixel (NOT flat) | `{ images, seed, ... }` | The literal "IP-Adapter" of the research doc, but requires HF model paths as config, single image only, and per-MP pricing that breaks the research's flat-$0.04 cost model |

**Recommendation: FLUX Kontext, not literal IP-Adapter.** The research doc named "IP-Adapter" as the *mechanism*, but the better-fitting Fal product in current docs is **Kontext** — it is purpose-built for cross-scene character preservation, holds the flat $0.04/image price the research's entire cost model assumes, returns the **same response shape** the existing `FalImageGenerator` already parses (`images[0].url`), and needs no HuggingFace path/encoder config. Use `fal-ai/flux-pro/kontext` for single-character references and `fal-ai/flux-pro/kontext/multi` (the `image_urls`-array variant) when a page has 2+ relevant characters. The literal `flux-general` IP-Adapter endpoint is rejected: per-megapixel pricing reopens the cost-shock problem IV2 exists to close, and the HF-path config is operational surface we don't want. **The spec's wire/UI design is mechanism-agnostic** — `referenceImages: string[]` works for either; only `FalImageGenerator`'s internals choose the model. If the team prefers literal IP-Adapter for max likeness, that is a one-file change inside the provider plus a price-copy update.

Portrait generation itself (the canonical character sheet) is prompt-only — it has no reference yet — so portraits are generated on **Flux Pro 1.1** (the existing path). Only *page* generation, which references the approved portraits, uses Kontext.

### Schema / contract changes

**`shared/src/books.ts` — `CharacterSchema`:**

```ts
export const CharacterSchema = z.object({
  role: CharacterRoleSchema,
  name: z.string(),
  descriptor: z.string().optional(),
  relationship: z.string().optional(),
  portrait_url: z.string().nullable().optional(),   // NEW — canonical portrait, null/absent until generated
});
```

`portrait_url` is `.nullable().optional()` so (a) legacy `characters_json` blobs without the key still validate, and (b) the hydrated wire shape can carry an explicit `null`. Because `CharacterSchema` is embedded in `BookSchema.characters` and `BookVersionSchema.characters_json`, this is a **wire-shape change on every book response** — Check 4 wire-shape assertions must pin `portrait_url` in books.test.ts.

**`shared/src/books.ts` — new portrait endpoints' request/response schemas:**

- `CharacterPortraitGenerateRequestSchema` — `{ feedback?: string }` (regenerate-with-feedback, mirrors `BookIllustrateRequestSchema`'s `feedback`).
- `CharacterPortraitGenerateResponseSchema` — `BookWithPagesSchema.nullable()` (return the full hydrated book so the client re-renders the cast with the new `portrait_url`; mirrors the illustrate handler's return).
- `CharacterPortraitVersionSchema` / `...ListResponseSchema` — reuse the exact `IllustrationVersionSchema` shape (`{ url, version, created_at, feedback }`) since history rows are stored in the same table.

**Prisma (`server/prisma/schema.prisma`) — `IllustrationVersion` overload, NO new table.** Portrait history rows live in `IllustrationVersion` using a reserved `page_number` sentinel range that can never collide with a real page (pages are 1..15, capped by `MAX_PAGES`). Encode the portrait slot from the character's *role index* with a large negative or high offset, e.g. `page_number = -1 (primary) / -2 (antagonist-N) / ...` OR a fixed offset like `1000 + roleSlot`. The `@@unique([book_id, page_number, version])` constraint then gives free per-character version numbering for free, exactly as it does for pages. **The migration is the slot convention only if we choose a column** — see the open decision below; the leading recommendation needs **no schema migration at all** because it reuses the existing table and an existing nullable column shape, plus the additive JSON field which is not a DB column change. (`characters_json` is already `String?`.)

> Important nuance: adding `portrait_url` to the JSON blob is **NOT a Prisma migration** — `characters_json` is already a `String?` column; we're changing the *shape of the JSON inside it*, which is a seed/data-shape concern, not a DDL change. The only thing that *could* require a migration is promoting history to a dedicated `CharacterPortrait` table (rejected — see Alternatives). So under the recommended design, **there is no `schema.prisma` migration**; there IS a seed-shape change (`portrait_url` key) and a wire-shape change (`CharacterSchema`).

**Sentinel-slot risk:** overloading `page_number` is a readability cost. If the planner/dev finds the sentinel too subtle, the fallback is a dedicated `CharacterPortrait` table (additive migration, mirrors `IllustrationVersion`). Flagged as an ADR-worthy sub-decision.

**New routes (`server/src/routes/books.ts`):**

- `POST /api/books/:id/characters/:role/portrait` — `requireAuth → validate({request, response}) → handler`. Owner-gated like every other mutation here. Generates a portrait for the character matching `:role` (and disambiguates when multiple share a role — see "what is a required character"). 501 if `!isImageGenConfigured()`, mirroring `/illustrate`.
- `GET /api/books/:id/characters/:role/portraits` — `requireAuth → validate(response) → handler`. Lists portrait history.

`:role` alone is insufficient when a book has two supporting characters. Use `:role` plus an index or, cleaner, a stable character key. **Recommend** addressing by **array index into the hydrated `characters`** (`:characterIndex`) instead of `:role`, since names aren't guaranteed unique and roles repeat. Final param shape is an ADR-worthy sub-decision; the issue's `:role` phrasing doesn't survive multi-supporting-cast.

### Reference-image plumbing

Portraits are written to `server/public/illustrations/<bookId>/portrait-<slot>.png` (next to page illustrations). Page generation needs to hand Fal a URL it can fetch. Two sub-options the planner must pick between (flagged, not decided here):

- **(a) Public URL** — pass `${PUBLIC_BASE_URL}/illustrations/<bookId>/portrait-<slot>.png`. Simple, but requires the server to be reachable by Fal (fine in prod; in local dev Fal can't reach `localhost` — would need a tunnel or fallback to prompt-only).
- **(b) Inline upload** — read the portrait bytes and pass as a base64 data URI / Fal file upload. Works in local dev, more bytes per request.

Recommend **(b) data-URI/upload for robustness in local dev**, since the demo runs locally; note the request-size implication (portraits are ~1024² PNGs). This is a generator-internal concern hidden behind `referenceImages: string[]` (paths), so the route layer is unaffected by the choice.

### Data flow

1. User completes the `CreateBook` wizard → `POST /api/generate` creates the draft book with `characters_json` (no `portrait_url` yet) → navigates to `/book/:id` (draft).
2. On the draft `BookDetail`, a new **Cast panel** lists each character with a "Generate portrait" button. Click → `POST /api/books/:id/characters/:index/portrait` → server runs `generateCharacterPortrait()` (prompt = name + descriptor + style descriptor, prompt-only on Flux Pro 1.1) → writes file → inserts `IllustrationVersion` (portrait slot) → patches `characters_json[index].portrait_url` → returns hydrated book.
3. User iterates: "Regenerate" with feedback → same endpoint with `{ feedback }` → new version row, `portrait_url` repoints to the newest. History viewable via the list endpoint (revert reuses the existing illustration-revert pattern, optional for Phase 2 — see Out of scope).
4. User clicks **"Approve cast"** → client-side gate flips (see gate semantics). 
5. Page illustration (`POST /api/books/:id/illustrate`) now collects, for each page, the `portrait_url`s of that page's relevant characters and passes them as `referenceImages` → `FalImageGenerator` routes to Kontext (single or multi) → consistent characters across pages.

### Approve-cast gate semantics

The gate is **a soft, client-side gate, not a server enforcement** (consistent with the F4b no-server-gate posture). Concretely:

- **Page illustration is allowed without approved portraits** (the `/illustrate` route does NOT 403 when portraits are missing) — it simply falls back to today's text-only-cast behavior (prompt-only, no references). This preserves the regression-safe path and means a user who skips portraits gets exactly today's product, no worse.
- The **client** nudges: the draft `BookDetail` shows "Approve cast to illustrate with consistent characters" and disables the bulk-illustrate button until either (a) every required character has a `portrait_url`, or (b) the user explicitly clicks "Skip portraits — illustrate anyway." So the gate is *encouraging*, not *blocking*.
- "Approve cast" is a **client UI state** (e.g. a local flag or a query param), not a new persisted book field — there is no `cast_approved` column. Rationale: approval is a one-time workflow nudge, not durable state worth a migration; if the user reloads, the presence of `portrait_url` on every character is itself the signal that the cast is "ready." Adding a persisted approval flag is an explicit non-goal (Out of scope).
- **"Required character"** for the gate = **primary + antagonist roles**. Supporting characters get an *optional* "Generate portrait" affordance but do not block approval. Rationale: research open-question #5 flags that non-human/secondary subjects vary in IP-Adapter quality, and primary+antagonist are the identity-critical, recurring figures; forcing portraits for every walk-on supporting character multiplies cost for marginal consistency benefit. This is an ADR-worthy product decision (cost vs. completeness).

### Cost class representation

Character iteration is a new cost dimension but the **per-image price is identical** ($0.04 — portraits on Flux Pro 1.1, page-with-reference on Kontext are both $0.04). So **reuse `PER_IMAGE_COST_USD`**; do not introduce a second price constant. Add new copy builders in `CreateBook.tsx` (or a shared cost-copy module) that *count* portrait images:

- A "portrait step" cost note: `~$(charCount × PER_IMAGE_COST_USD)` for generating one portrait per required character, plus "each regenerate is ~$0.04" (mirrors `laterClickCostNote`).
- The Cast panel on `BookDetail` shows the per-portrait `$0.04` next to each Generate/Regenerate button, reusing `fmtUsd(PER_IMAGE_COST_USD)`.

Because Kontext and Flux Pro 1.1 are both $0.04, no cost-copy *figure* changes — only new *counting* copy is added. If the team later picks the per-megapixel `flux-general` IP-Adapter for pages, page cost copy would need a second constant; that's part of why Kontext is recommended.

### Files likely touched

- `shared/src/books.ts` — add `portrait_url` to `CharacterSchema`; add portrait endpoint request/response schemas.
- `server/src/services/illustrations.ts` — widen `ImageGenerator.generate` signature; add `generateCharacterPortrait()`; thread `referenceImages` through `generateIllustration`/`generateCover`; portrait-slot version helper.
- `server/src/services/providers/fal.ts` — accept `referenceImages`; route to `fal-ai/flux-pro/kontext` / `.../kontext/multi` when present, Flux Pro 1.1 when absent; reference-image plumbing (data-URI or public-URL).
- `server/src/services/providers/openai.ts` — (extracted in IV1) accept `referenceImages` via gpt-image-1 image-input; no-op when absent to stay regression-safe.
- `server/src/routes/books.ts` — `hydrateBook` already round-trips the JSON (no change needed for the new key); add the two portrait routes; update `/illustrate` to collect per-page reference portraits.
- `server/src/routes/generate.ts` — `characters_json` write is unchanged (portrait_url is added later); confirm `previewMode: 'full'` page-gen still works without portraits (regression path).
- `server/src/types.ts` — re-export new schemas (no new server-local shape needed).
- `client/src/pages/BookDetail.tsx` — new Cast panel: per-character portrait generate/regenerate/iterate UI + approve-cast gate; dark-mode variants required.
- `client/src/pages/CreateBook.tsx` — portrait-step cost copy (counting builders); reuse `PER_IMAGE_COST_USD`.
- `client/src/types.ts` — picks up `portrait_url` via `@storybook/shared` re-export (no manual change if it re-exports).
- `server/prisma/seed.ts` / `demo-seed.ts` — only if any seeded book's `characters_json` should carry `portrait_url`; otherwise unchanged (legacy-tolerant schema means absent key is fine). **No `schema.prisma` migration under the recommended design.**
- `server/src/routes/__tests__/books.test.ts` — wire-shape assertions for `portrait_url`; integration tests for the two new routes (mock the generator at the module boundary as IV1's tests do).

## Alternatives considered

### Schema fork A — Promote characters to a real Prisma `Character` table

Give each character a row with `portrait_url`, and a `CharacterPortrait` history table FK'd to it.

**Pros:**
- Natural home for `portrait_url` and per-character version rows (real FKs, no JSON surgery).
- Sets up Phase 3 (LoRA per character) which wants stable per-character identity.
- Removes the `characters_json` parse-on-every-read hydration.

**Cons:**
- Directly reverses ADR-002, which chose JSON specifically because there's no query pressure and the cast is always loaded with its book. Phase 2 adds no query pressure — we never search characters.
- Large blast radius: `hydrateBook`, `generate.ts` write, `BookVersion.characters_json` snapshot/restore (revise + version-restore both snapshot `characters_json`), and the `BookVersionSchema` wire shape all assume JSON. A table forces a data migration of every existing book's cast AND a rework of the version-snapshot mechanism (which currently captures the cast as a JSON string in `BookVersion`).
- A migration that backfills existing rows is the kind of hard-to-reverse change the architect is meant to flag.

**Why rejected (held as Phase 3 upgrade path):** ADR-002's reconsider-trigger ("characters carry their own per-page state," "referential integrity from other entities") is what Phase 3's LoRA + per-page character mapping would actually hit. Phase 2 needs exactly one new field. Promote the table **when Phase 3 lands**, as a deliberate ADR-002 supersession, not as a side effect of adding a portrait URL.

### Schema fork B — Embedded `portrait_url` + dedicated `CharacterPortrait` history table

Keep the cast in JSON (add `portrait_url`), but store portrait version history in a NEW table mirroring `IllustrationVersion`.

**Pros:**
- History is explicit and self-documenting; no `page_number` sentinel overloading.
- Additive migration (new table, no existing-row changes).

**Cons:**
- A whole new table + migration to duplicate machinery `IllustrationVersion` already provides (versioned, FK-cascade'd, per-(book,slot) unique image history with feedback).
- Two near-identical history tables to maintain, two list endpoints with copy-pasted logic.

**Why considered as the fallback:** This is the clean fallback if the `page_number` sentinel overload (recommended) proves too subtle in review. It's strictly more code but more legible. The planner should treat "sentinel overload vs. new table" as a single ADR-worthy sub-decision and pick during planning.

### Generator fork — runtime model auto-detect vs. explicit reference flag

Have `FalImageGenerator` always call Kontext and pass an empty reference list when there are none, vs. branching on `referenceImages?.length`.

**Pros (always-Kontext):** one code path.
**Cons:** Kontext requires an input image; it's not a drop-in for prompt-only text-to-image. Portrait generation (no reference yet) genuinely needs Flux Pro 1.1. So the branch is unavoidable.

**Why rejected:** Kontext is image-to-image; there's no reference for the first portrait. Branch on presence of references — Flux Pro 1.1 for prompt-only, Kontext for reference-bearing. This also preserves the IV1 regression test (prompt-only path stays byte-identical).

### Mechanism fork — literal IP-Adapter (`flux-general`) vs. Kontext

Covered in "Fal model selection." Kontext recommended; `flux-general` IP-Adapter rejected on per-megapixel pricing + HF-path config. Held as a swap-in if max likeness is needed.

## Success criteria

- A draft book's Cast panel renders one row per character; clicking "Generate portrait" produces a portrait image and the row shows it (verified in browser, light + dark).
- "Regenerate" with feedback produces a new portrait version; history is listable; `portrait_url` repoints to the newest.
- After approving the cast, bulk page illustration produces visibly more consistent characters page-to-page than the text-only-cast baseline (qualitative; A/B per research open-question #4).
- `CharacterSchema.portrait_url` is pinned by a `toMatchObject` wire-shape assertion in `books.test.ts` (Check 4 passes).
- `generate(prompt)` with no references is byte-identical to the IV1 path: the existing OpenAI regression test and Fal prompt-only test still pass unchanged.
- `IMAGE_PROVIDER=openai` still works end-to-end (portrait + page reference paths both honor the provider switch).
- A book with NO portraits still illustrates (falls back to prompt-only) — no 403, no regression for users who skip the step.
- `npm test` green in server + client; `db:hydrate` loads cleanly with the `portrait_url` seed-shape key present-or-absent.

## Out of scope

- **Phase 3 (#24): per-character LoRA / fine-tune.** Explicitly deferred per ADR-006 and the research roadmap.
- **Promoting characters to a Prisma table.** Held as the Phase 3 upgrade path (see Alternatives).
- **A persisted `cast_approved` book field.** Approval is a client-side workflow nudge; no migration.
- **Server-side spend-gate / budget enforcement.** Stays deferred (F4b/ADR-006). Cost is client copy only.
- **Portrait *revert* UI** (pointing `portrait_url` back at an older version). The history *list* is in scope for iteration; full revert can mirror the existing illustration-revert pattern in a follow-up if the iterate-loop proves it's needed. Flag, don't build.
- **Per-page character mapping UI** (letting the user say which characters appear on which page). Phase 2 uses a heuristic: pass all required-character portraits as references to every page (or, if Kontext-single is chosen, the primary's portrait). Precise per-page casting is a later refinement.
- **Exposing provider/model choice to end users.** Stays env-config (ADR-006).
- **Non-human/antagonist portrait quality tuning.** Research open-question #5 flags IP-Adapter generalizes unevenly to non-faces; Phase 2 ships it and evaluates, doesn't special-case.

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| `CharacterSchema` change is a wire-shape change on every book response (OPS.3/ADR-003) | `.nullable().optional()` keeps legacy blobs valid; pin `portrait_url` with a Check-4 wire-shape assertion in books.test.ts; planner emits the data-shape-change confirmation step. |
| Widening `ImageGenerator.generate` could break IV1's regression-safe boundary | Make the 2nd arg optional; no-reference path stays byte-identical; keep IV1's OpenAI + Fal prompt-only tests passing as the regression gate. Supersede ADR-006 dec 3 with a new ADR. |
| Flux Pro 1.1 can't take references; wrong-model assumption would waste effort | Pinned: portraits on Flux Pro 1.1 (prompt-only), page-with-reference on `fal-ai/flux-pro/kontext` / `.../kontext/multi` ($0.04, same response shape). `flux-general` IP-Adapter rejected on per-MP pricing. |
| Fal can't reach `localhost` to fetch a portrait URL in local dev | Recommend data-URI/upload plumbing (option b) so references travel in the request body, not as a URL Fal must fetch. |
| More paid Fal calls (portrait gen + iteration) — cost increase (CLAUDE.md guardrail) | Same $0.04/image; reuse `PER_IMAGE_COST_USD`; add counting cost copy; note primary+antagonist-only requirement caps portrait count. Planner surfaces the paid-API-increase note. |
| `page_number` sentinel overload in `IllustrationVersion` is subtle/error-prone | Fallback is a dedicated `CharacterPortrait` table (Alternative B); decide during planning as an ADR-worthy sub-decision. Reserve a slot range that can't collide with 1..15 pages. |
| `BookVersion` snapshots `characters_json` (revise + restore) — portraits now ride along | Confirm restore behavior: restoring an old snapshot restores old `portrait_url`s (which may point at files that still exist on disk — acceptable, same as page illustration_url restore). Test the revise/restore path with `portrait_url` present. |
| `:role` route param can't address two same-role characters | Recommend `:characterIndex` (array index into hydrated `characters`) instead of `:role`; finalize as ADR-worthy sub-decision. |
| Multi-character page + Kontext-single mismatch | Use `.../kontext/multi` (`image_urls` array) when a page references 2+ portraits; single-character pages use `fal-ai/flux-pro/kontext`. |
| Dark-mode parity on the new Cast panel | Every new className in `BookDetail.tsx`'s Cast panel needs a `dark:` partner (reviewer Check 3 / dark-mode-parity skill). |

## ADR-worthy decisions

- [ ] **Schema fork: embedded `characters_json` + `portrait_url` (recommended) vs. promoted `Character` table.** Recommend embedded — keeps ADR-002 intact, one field, no migration. Promote in Phase 3 as a deliberate ADR-002 supersession. (Supplements/cites ADR-002.)
- [ ] **Portrait version-history storage: overload `IllustrationVersion.page_number` with a portrait-slot sentinel (recommended) vs. dedicated `CharacterPortrait` table.** Recommend sentinel-overload (zero new table, reuses cascade + unique-version machinery); table is the legible fallback.
- [ ] **Widen `ImageGenerator.generate` to `generate(prompt, opts?: { referenceImages? })`.** Extends/supersedes **ADR-006 decision 3** ("interface owns only the network call"). New ADR required; cite ADR-006.
- [ ] **Fal model for character references: `fal-ai/flux-pro/kontext` (+ `/multi`) (recommended) vs. literal IP-Adapter `fal-ai/flux-general/image-to-image`.** Recommend Kontext — flat $0.04, same response shape, purpose-built for character preservation, no HF-path config. Pinned from Fal docs 2026-06-05.
- [ ] **Reference-image plumbing: data-URI/upload (recommended for local-dev robustness) vs. public URL.** Recommend data-URI so Fal needn't reach `localhost`.
- [ ] **Approve-cast gate is a client-side soft nudge, not server-enforced; no persisted `cast_approved` field.** Consistent with F4b no-server-gate posture.
- [ ] **"Required character" = primary + antagonist only; supporting characters get optional portraits.** Product/cost decision; cite research open-question #5.
- [ ] **Portrait route addressing: `:characterIndex` (recommended) vs. `:role`.** `:role` can't disambiguate multiple same-role characters.
