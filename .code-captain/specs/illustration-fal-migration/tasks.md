# Illustration provider migration — Fal.ai Flux Pro 1.1 (IV1 Phase 1) — task plan

> Spec: [spec.md](spec.md)
> Status: Complete — all 7 tasks Done (2026-06-05)
> Last updated: 2026-06-05
> Planner: Claude Opus 4.8 via @planner on 2026-06-04

## Overview

Seven tasks, server-heavy with one client task. The work is a provider abstraction: extract the existing OpenAI call behind an `ImageGenerator` interface (pure refactor, byte-identical), add a provider-aware "configured" check and replace the three literal `OPENAI_API_KEY` route gates, then introduce the new Fal.ai generator behind a guardrail confirmation gate, document env vars, extend server tests, correct client cost copy, and close out ADR tracking. Sequence is strict and mostly serial: the regression-safe OpenAI extraction (Task 1) lands first so any later breakage is isolated; Fal real-call wiring (Task 4) is the single point that introduces a new paid external API and carries the user-confirmation gate. Tasks 6 (client copy) and 7 (ADR tracking) are the only meaningfully parallel cuts.

## Cross-cutting constraints

Carried over from the spec — re-stated so the developer doesn't context-switch back.

- **Wire-shape (OPS.3):** No new or changed HTTP response shape. `illustrate` already returns the version list; `/generate` already returns the book. **No new Zod schema.** The only test-visible wire change is the 501 error *message string* (provider-neutral), not a field shape.
- **Auth middleware order:** No new protected route. `POST /api/books/:id/illustrate` keeps its existing `requireAuth → validate() → handler` order; only the body of the handler's gate changes.
- **Preserve exported signatures (regression-safe):** `generateIllustration()`, `generateCover()`, and `listIllustrationVersions()` keep their **exact signatures** and stay in `server/src/services/illustrations.ts`. Providers are an internal detail. Do not change the module path — `server/src/routes/__tests__/books.test.ts` mocks `'../../services/illustrations'` at the module boundary (lines 25–33, `vi.importActual` + spread, overriding only `generateIllustration`). That mock must keep binding.
- **OpenAI behavior unchanged:** With `IMAGE_PROVIDER=openai` the path must be byte-for-byte the prior behavior — same endpoint, `1024x1024` size, 120s `AbortController`, `b64_json`/`url` dual handling, `return null` on missing key, on-disk versioning via `getNextVersion`, the `illustrationVersion` row write (page path only), and the legacy-disk fallback in `listIllustrationVersions()`.
- **Persistence boundary:** versioning + Prisma row write stay in the public service functions; `ImageGenerator.generate(prompt)` returns **only `Buffer` bytes**. Note: `generateCover` writes a PNG + returns a URL but does **not** write an `illustrationVersion` row today (only `generateIllustration` does) — preserve that asymmetry.
- **Dark-mode parity:** Only `CreateBook.tsx` (Task 6) touches UI. Existing cost copy already has `dark:` variants (lines 480, 510, 515–517) — preserve them; manual-verify light + dark.
- **Migrations:** None. `illustrationVersion` rows are provider-agnostic; no Prisma schema change.
- **Guardrails touched:**
  - **New paid external API (Fal.ai)** — CLAUDE.md guardrail. Task 4 carries an explicit USER CONFIRMATION REQUIRED gate; the developer pauses for explicit user OK before activating real Fal calls / committing the `FAL_KEY` placeholder that implies activation.
  - **New dependency** — NOT in play. Raw `fetch` is chosen per ADR decision 1; no `server/package.json` entry is added. If the developer is tempted toward `@fal-ai/client`, that is a separate guardrail trip and must be escalated, not slipped in.
  - **Claude model / Anthropic SDK** — untouched. Out of scope.

## Tasks

### Task 1 — Extract `ImageGenerator` interface + `OpenAIImageGenerator` (pure refactor)

**Zone:** server
**Depends on:** none
**Parallel-safe with:** none
**Status:** Done (2026-06-05)

**Files to add or change:**

- `server/src/services/illustrations.ts` — add the `ImageGenerator` interface; wrap the existing `callOpenAIImage` body into an `OpenAIImageGenerator` implementing it. Public fns (`generateIllustration`/`generateCover`) keep calling the OpenAI path directly for now (factory comes in Task 2). No signature changes.

**Signatures / shapes:**

```ts
interface ImageGenerator {
  readonly name: 'openai' | 'fal';
  generate(prompt: string): Promise<Buffer>;
}

// OpenAIImageGenerator wraps the current callOpenAIImage logic verbatim:
// same endpoint (api.openai.com/v1/images/generations), same body
// { model: IMAGE_MODEL, prompt, n: 1, size: '1024x1024' }, same 120s
// AbortController, same b64_json/url dual handling, same error text.
// The apiKey is read from process.env.OPENAI_API_KEY inside the generator
// (or passed in) — behavior identical to today.
class OpenAIImageGenerator implements ImageGenerator {
  readonly name = 'openai' as const;
  generate(prompt: string): Promise<Buffer> { /* moved-from callOpenAIImage */ }
}
```

**Tests to write:**

- No new test required — the existing `server/src/services/__tests__/illustrations.test.ts` (OpenAI fetch mock, asserts the version row) is the regression oracle and must stay green unchanged.
- Wire-shape assertion required: no (no route/response change in this task).

**Manual verify (if applicable):**

- None (no UI, no behavior change).

**Done when:**

- `cd server && npm test` is green with **zero** edits to existing test files.
- `OpenAIImageGenerator.generate()` produces identical bytes/behavior to the old `callOpenAIImage`.
- No TypeScript errors; the three exported signatures are unchanged.

---

### Task 2 — Add `getImageGenerator()` factory + provider-aware "configured" check; replace the three route gates; update the 501 test

**Zone:** server
**Depends on:** Task 1
**Parallel-safe with:** none
**Status:** Done (2026-06-05)

**Files to add or change:**

- `server/src/services/illustrations.ts` — add `getImageGenerator()` factory keyed on `process.env.IMAGE_PROVIDER` (default `fal`), and an exported `isImageGenConfigured()` helper that reports whether the **selected** provider's key is present. The public fns delegate the network call through `getImageGenerator().generate(prompt)`. Note: with default `fal` and no Fal generator yet, the factory in this task may temporarily fall back to / only resolve `openai` — see Open questions; safest is to land the factory returning `openai` until Task 4 registers Fal, OR land Tasks 2+4 together. (Developer/sequencing call; see Sequencing notes.)
- `server/src/routes/generate.ts` — replace the two `process.env.OPENAI_API_KEY` gates at **lines ~207 and ~224** with `isImageGenConfigured()`.
- `server/src/routes/books.ts` — replace the `OPENAI_API_KEY` gate at **lines ~637–638** with `isImageGenConfigured()` and a **provider-neutral** 501 message (e.g. `'Image generation not configured'`).
- `server/src/routes/__tests__/books.test.ts` — update the 501 test (**lines ~682–692**) assertion from `expect(res.body.error).toMatch(/OPENAI_API_KEY/)` to match the new provider-neutral message. **Do not delete the test.** Confirm the module-boundary mock (lines 25–33) still binds.

**Signatures / shapes:**

```ts
// Provider selection resolved once per call from env. Default 'fal'.
export function getImageGenerator(): ImageGenerator;

// Provider-aware replacement for the literal OPENAI_API_KEY route gates.
// Returns true iff the selected provider's key env var is set.
export function isImageGenConfigured(): boolean;
//   provider 'openai' -> !!process.env.OPENAI_API_KEY
//   provider 'fal'    -> !!process.env.FAL_KEY
```

**Tests to write:**

- Update existing 501 test to assert the provider-neutral message string.
- Add a unit assertion that `isImageGenConfigured()` flips correctly per `IMAGE_PROVIDER` + key presence (can live in `illustrations.test.ts` or a small `routes` test — developer's call).
- Wire-shape assertion required: no (501 is an error envelope, exempt; only the message string changes).

**Manual verify (if applicable):**

- None (server-only).

**Done when:**

- `cd server && npm test` green, including the updated 501 test.
- All three literal `OPENAI_API_KEY` route gates are gone, replaced by `isImageGenConfigured()`.
- The module-boundary mock in `books.test.ts` still binds (the suite that uses it passes).
- No TypeScript errors; the three exported service signatures unchanged.

---

### Task 3 — Add env vars to `server/.env.example`

**Zone:** server (docs/config)
**Depends on:** Task 2 (so the var names match what the factory/check read)
**Parallel-safe with:** Task 6
**Status:** Done (2026-06-05) — inline (trivial config edit, main session)

**Files to add or change:**

- `server/.env.example` — add the provider selector + Fal placeholders, keep OpenAI as fallback.

**Signatures / shapes:**

```bash
# Image generation provider selector: fal | openai (defaults to fal)
IMAGE_PROVIDER=fal

# Fal.ai API key — illustration generation (default provider)
FAL_KEY=

# Optional: Fal image model override (defaults to fal-ai/flux-pro/v1.1)
# FAL_IMAGE_MODEL=fal-ai/flux-pro/v1.1

# OpenAI API key — illustration generation (fallback provider)
OPENAI_API_KEY=

# Optional: OpenAI image model override (defaults to gpt-image-1)
# OPENAI_IMAGE_MODEL=gpt-image-1
```

**Tests to write:**

- None (config file).
- Wire-shape assertion required: no.

**Manual verify (if applicable):**

- Confirm `.env.example` is the placeholder file (empty `FAL_KEY=`), NOT a real key. (Real-key activation is Task 4's gated concern.)

**Done when:**

- `server/.env.example` documents `IMAGE_PROVIDER`, `FAL_KEY` (empty), optional `FAL_IMAGE_MODEL`, and retains `OPENAI_API_KEY` + optional `OPENAI_IMAGE_MODEL`.
- No TypeScript errors (n/a, but build stays green).

---

### Task 4 — Add `FalImageGenerator` (raw fetch to Flux Pro 1.1) — **paid-API confirmation gate**

**Zone:** server
**Depends on:** Task 2 (factory must exist to register Fal)
**Parallel-safe with:** none
**Status:** Done (2026-06-05)

> **USER CONFIRMATION REQUIRED — new paid external API (CLAUDE.md guardrail).**
> Fal.ai is a new paid provider. Before writing real Fal network calls and before committing the `FAL_KEY` placeholder in a way that implies activation, the developer MUST pause and get explicit user OK. Do not activate Fal silently. (The `.env.example` placeholder in Task 3 is empty and inert; this gate is about the live call path here.) Per ADR decision 1, use **raw `fetch`** — do NOT add `@fal-ai/client` (that is a separate dependency guardrail; escalate if tempted).

**Files to add or change:**

- `server/src/services/providers/fal.ts` — NEW. `FalImageGenerator implements ImageGenerator`. (Co-locating in `illustrations.ts` is acceptable per spec for Phase 1 — developer's call; a sibling file is cleaner.)
- `server/src/services/illustrations.ts` — register Fal in `getImageGenerator()` so `IMAGE_PROVIDER=fal` resolves to it.

**Signatures / shapes:**

```ts
class FalImageGenerator implements ImageGenerator {
  readonly name = 'fal' as const;
  // Calls Fal.ai Flux Pro 1.1 synchronous REST endpoint via raw fetch.
  // - Model id from process.env.FAL_IMAGE_MODEL || 'fal-ai/flux-pro/v1.1'.
  // - Auth header: `Authorization: Key ${process.env.FAL_KEY}` (Fal convention).
  // - 120s AbortController parity (mirror OPENAI_IMAGE_TIMEOUT_MS).
  // - Pass an equivalent square size (parity with OpenAI 1024x1024).
  // - Fal response shape is { images: [{ url }] } (NOT { data: [{ b64_json|url }] }).
  //   Parse images[0].url, then fetch the URL and return Buffer.from(arrayBuffer()).
  // - Non-ok responses throw with status + snippet, mirroring the OpenAI error path.
  generate(prompt: string): Promise<Buffer>;
}
```

**Tests to write:**

- Covered in Task 5 (the Fal-path service test). This task may add a focused unit test for `FalImageGenerator.generate()` (fetch mocked with `{ images: [{ url }] }` + a second fetch returning image bytes) if the developer prefers to test the provider in isolation before the integration assertion.
- Wire-shape assertion required: no (internal provider; no route response change).

**Manual verify (if applicable):**

- **Only after user confirmation:** with `IMAGE_PROVIDER=fal` and a real `FAL_KEY`, generate one cover and one page → confirm PNGs land in `server/public/illustrations/<bookId>/` and the page generation writes an `illustrationVersion` row, observably identical in shape to the OpenAI path.

**Done when:**

- User has explicitly confirmed Fal.ai activation (gate above satisfied) before any real-key run.
- `getImageGenerator()` returns `FalImageGenerator` when `IMAGE_PROVIDER=fal`.
- `cd server && npm test` green (Fal path covered via mocked fetch in Task 5).
- Raw `fetch` only — no new `server/package.json` entry.
- No TypeScript errors; the three exported service signatures unchanged.

---

### Task 5 — Extend `illustrations.test.ts` for the Fal path + provider selection

**Zone:** server
**Depends on:** Task 4
**Parallel-safe with:** none
**Status:** Done (2026-06-05)

**Files to add or change:**

- `server/src/services/__tests__/illustrations.test.ts` — add a Fal-path case: set `IMAGE_PROVIDER=fal` + `FAL_KEY=fal-test`, mock `globalThis.fetch` to return a **Fal-shaped** response (`{ images: [{ url }] }`) on the generate call and image bytes on the URL download, then assert `generateIllustration` writes the **same** `illustrationVersion` row (version 1, matching `url`, matching `feedback`) and returns a `/illustrations/...` URL — identical contract to the existing OpenAI assertion. Keep the existing OpenAI test untouched and green (regression). Restore env + fetch in `afterEach` (mirror the existing teardown).

**Signatures / shapes:**

```ts
// Fal-shaped generate response, then a bytes download on images[0].url.
// Reuse FAKE_PNG_B64 -> Buffer for the download leg.
globalThis.fetch = vi.fn()
  .mockResolvedValueOnce(new Response(JSON.stringify({ images: [{ url: 'https://fal.example/img.png' }] }), { status: 200 }))
  .mockResolvedValueOnce(new Response(Buffer.from(FAKE_PNG_B64, 'base64'), { status: 200 }));
```

**Tests to write:**

- Fal-path `generateIllustration` test: asserts the same row + URL contract as OpenAI.
- (Optional) a cover-path Fal assertion: `generateCover` returns `/illustrations/<id>/cover.png` and writes the PNG but writes **no** `illustrationVersion` row (preserve the existing asymmetry).
- Wire-shape assertion required: no (service-layer test; the DB row + URL contract are the assertions).

**Manual verify (if applicable):**

- None (covered by mocked tests; live verification is Task 4's gated step).

**Done when:**

- `cd server && npm test` green with both an OpenAI-path and a Fal-path assertion of the `illustrationVersion` row + URL contract.
- The existing OpenAI test is unchanged and still passes.
- No TypeScript errors.

---

### Task 6 — Correct/parameterize client cost copy in `CreateBook.tsx`

**Zone:** client
**Depends on:** none (independent of server tasks; copy reflects the active-provider per-image basis)
**Parallel-safe with:** Task 3, and with server Tasks 1–5 (different zone, no shared file)
**Status:** Done (2026-06-05) — browser manual-verify (light + dark) PENDING user

**Files to add or change:**

- `client/src/pages/CreateBook.tsx` — parameterize the per-image cost figure from a single client-side constant so there's one place to update (spec Risk: "cost copy drifts again"). Touch points: line ~490 (`$0` Quick copy), ~498 (`~$0.04` Cover), ~506 (`(pageCount + 1) * 0.04` Full), ~511 ("Each later click is ~$0.04"). Flux Pro 1.1 ≈ $0.04 (matches the displayed number), so the user-facing figure may not move — but the per-image constant must be named/centralized, and copy that *names the cost basis* should reflect the active provider. Preserve existing `dark:` variants (lines 480, 510, 515–517).

**Signatures / shapes:**

```ts
// One constant, used by all four cost strings, so a future provider/price
// change is a one-line edit. Phase 1 has no per-request UI provider picker,
// so this is a build-time constant, not wired to a server response.
const PER_IMAGE_COST_USD = 0.04;
```

**Tests to write:**

- `client/src/pages/__tests__/CreateBook.test.tsx` (if a peer test exists for this page, extend it; otherwise a focused render assertion) — assert the Full-mode cost string scales with `pageCount` and the per-image constant. Keep it light; this is copy, not logic.
- Wire-shape assertion required: no (client copy).

**Manual verify (if applicable):**

- Open Create Book wizard, step to the preview-mode cards. Confirm Quick/Cover/Full cost copy reads correctly and the Full figure scales with page count.
- **Verify in both light and dark mode** (CLAUDE.md done criterion 2).

**Done when:**

- `cd client && npm test` green.
- Per-image cost is sourced from a single constant; all four copy sites read from it.
- Existing `dark:` variants preserved; verified light + dark in browser.
- No TypeScript errors.

---

### Task 7 — Pre-merge follow-ups (ADR tracking)

**Zone:** docs (harness)
**Depends on:** none (run last, after the feature tasks land)
**Parallel-safe with:** Task 6
**Status:** Done (2026-06-05) — ADR-006 (grouped, decisions 1–3) + Deferred line (#4); adr-tracking-check reports zero orphaned items

The spec's `## ADR-worthy decisions` section flags **four** items. Ensure each has exactly one tracking action — a matching ADR in `.code-captain/product/decisions.md`, a linked follow-up issue, or an explicit `Deferred:` line with reasoning:

1. Integration approach: raw `fetch` over `@fal-ai/client` SDK for Phase 1.
2. Default provider = `fal`, fallback is env-only (no runtime auto-fallback).
3. `ImageGenerator` interface owns only the network call; versioning + Prisma persistence stay in the public service functions.
4. No server-side cost-constant / spend-gate module in Phase 1 ("F4b" does not exist) — likely a `Deferred:` line per the spec's own framing.

**Done when:**

- `adr-tracking-check illustration-fal-migration` reports **zero orphaned items**.
- The tracking decision for each of the four items is recorded (ADR written / issue linked / `Deferred:` line added).

---

## Sequencing notes

- **Strict serial spine: Task 1 → 2 → 4 → 5.** This is deliberate (spec + planner guidance): the OpenAI extraction (Task 1) lands first and keeps every existing test green with zero behavior change, so if a regression appears later it's isolated to a single step. Fal is not introduced until Task 4.
- **Tasks 2 + 4 may be bundled into one PR/dispatch if the factory default `fal` would otherwise resolve to a non-existent generator.** Two clean options:
  - (a) Land Task 2 with the factory resolving `openai` regardless until Task 4 registers Fal, then flip the default-`fal` resolution in Task 4; or
  - (b) Commit Tasks 2 and 4 together so `IMAGE_PROVIDER=fal` is meaningful the moment the default is `fal`.
  Either preserves "OpenAI tests stay green through Task 1–2." Developer picks based on the confirmation-gate timing (Task 4 may stall on user OK — option (a) lets Task 2 ship independently).
- **Task 3 (env) and Task 6 (client copy) are parallel-safe** with the server spine — different files/zones. Task 6 has no server dependency at all and can be dispatched concurrently.
- **PR cuts (suggested):** Tasks 1+2 (refactor + gate swap + 501 test) as one PR; Tasks 4+5 (Fal generator + Fal test) as a second PR behind the confirmation gate; Task 3 can ride with either; Task 6 (client) as its own small PR; Task 7 closes out before the final merge. Mirrors the recent illustration-feature cadence (small, behavior-scoped commits).
- **e2e:** The spec lists `e2e/tests/illustration-history.spec.ts` (confirmed present) as a regression check that illustrate/version-history flows still render regardless of provider. Because Phase 1 changes **no** wire shape and providers mock through `globalThis.fetch`, existing e2e specs should cover this without a net-new spec. Run `cd e2e && npm test` before the final merge; if a net-new provider-aware e2e spec is wanted, that is a **@qa hand-off**, not a `@developer` task. See Open questions.

## Implementation questions (resolved during execution)

These were "resolve before dispatching the developer" questions — all now closed by the work. They are implementation/sequencing questions, **not** ADR-worthy decisions (those live in the spec's `## ADR-worthy decisions` section and are tracked by Task 7 / ADR-006).

- **Fal auth header + endpoint exact shape.**
  **Resolved (Task 4):** pinned against `fal.ai/models/fal-ai/flux-pro/v1.1/api` (2026-06-05) in a `fal.ts` code comment — `POST https://fal.run/<model-id>`, `Authorization: Key ${FAL_KEY}`, body `{ prompt, image_size: 'square_hd', num_images: 1, output_format: 'png' }`, response `{ images: [{ url }] }`.
- **Factory sequencing choice (option a vs b above).**
  **Resolved:** option (a) — Task 2 shipped the factory resolving `openai` until Task 4 registered Fal, so the confirmation gate on Task 4 never blocked the gate-swap refactor.
- **e2e: existing coverage vs net-new @qa spec.**
  **Resolved:** existing `e2e/tests/illustration-history.spec.ts` is sufficient — Phase 1 changes no wire shape and providers mock through `globalThis.fetch`. No net-new @qa spec commissioned. Run `cd e2e && npm test` before the final merge as the regression check.
