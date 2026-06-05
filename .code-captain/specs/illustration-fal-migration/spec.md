# Illustration provider migration — Fal.ai Flux Pro 1.1 (IV1 Phase 1)

> Status: Accepted
> Last updated: 2026-06-04
> Architect: Claude Opus 4.8 via @architect on 2026-06-04
> Backlog: https://github.com/slickG0ose/storybook/issues/22

## Problem

Image generation today calls OpenAI `gpt-image-1` directly via raw `fetch` inside `server/src/services/illustrations.ts`. The model's token-based billing surprised us at demo time: real spend was ~$0.17–$0.45 per image (vs. our ~$0.04 paper estimate), so a 15-page Full book ran $3–$7. The research doc (`.code-captain/product/illustration-providers-and-character-consistency.md`) recommends migrating per-page and cover generation to **Fal.ai Flux Pro 1.1** at a flat ~$0.04/image — a ~5–8× cost reduction with comparable-or-better illustration quality, while keeping OpenAI available as a fallback for users who prefer its look or its stronger semantic prompt adherence.

This spec covers **Phase 1 only**: the provider abstraction + Fal.ai implementation + provider selection + cost-figure correction + regression coverage. It explicitly does **not** cover character-consistency work (IP-Adapter, character portraits, seeding) — that is Phase 2 (a separate issue) and is listed in Out of scope.

## Constraints

- **Guardrail — new paid external API.** Fal.ai is a new paid provider. Per CLAUDE.md the developer MUST pause for explicit user confirmation before wiring real Fal calls / committing a `FAL_KEY` placeholder that implies activation. The planner must emit a confirmation gate task.
- **Guardrail — new dependency (conditional).** If the `@fal-ai/client` SDK is chosen over raw `fetch`, that is a new `server/package.json` entry and a CLAUDE.md guardrail requiring confirmation. (Raw `fetch` avoids this — see Alternatives + ADR decision 1.)
- **Regression-safe for OpenAI.** The OpenAI path must keep working identically: on-disk versioning via `getNextVersion`, the `illustrationVersion` Prisma row write, cover generation, the legacy-disk fallback in `listIllustrationVersions()`, the 120s `AbortController` timeout, the `b64_json`/`url` dual-response handling, and the graceful `return null` when no key is set.
- **Preserve exported signatures.** `generateIllustration()`, `generateCover()`, and `listIllustrationVersions()` are consumed by `server/src/routes/generate.ts` and `server/src/routes/books.ts`, and are **mocked at the module boundary** by `server/src/routes/__tests__/books.test.ts` (`vi.mock('../../services/illustrations', …)`). Their signatures and module path must not change, or those mocks (and the existing service test) break.
- **Wire shapes (OPS.3).** This work changes no HTTP response shape — `illustrate` already returns the version list and `/generate` already returns the book. No new Zod schema is required. (Confirmed: routes only consume the service; the on-the-wire contract is unchanged.)
- **Claude model untouched.** Story generation stays on Anthropic; only the *image* provider changes. No Claude model/SDK change is in scope.

## Proposed shape

Introduce an `ImageGenerator` interface inside `server/src/services/illustrations.ts` (or a sibling `providers/` directory — see Files) with a single method that takes a fully-assembled prompt and returns image bytes:

```
interface ImageGenerator {
  readonly name: 'openai' | 'fal';
  generate(prompt: string): Promise<Buffer>;
}
```

Extract the current `callOpenAIImage` logic into an `OpenAIImageGenerator` that implements this interface (verbatim behavior — same endpoint, same 120s timeout, same b64/url handling). Add a new `FalImageGenerator` that calls Fal.ai Flux Pro 1.1 and returns the resulting image bytes in the same `Buffer` form.

The public functions `generateIllustration()` / `generateCover()` keep their exact signatures and keep owning all the *non-provider* concerns: prompt assembly (`formatCastPrefix`, style descriptor, "no text" rule, cover composition), directory creation, versioning, the Prisma row write, and the URL return. They delegate **only the network call** to the selected `ImageGenerator`. This keeps versioning/persistence provider-agnostic and keeps the existing module-boundary mocks valid.

Provider selection is resolved once via a `getImageGenerator()` factory keyed on `process.env.IMAGE_PROVIDER` (`'fal'` | `'openai'`), defaulting to `fal` (see ADR decision 2). The "is image gen configured?" check moves from a literal `OPENAI_API_KEY` test to a provider-aware check (the selected provider's key is present). This is load-bearing: `generate.ts` lines 207/224 and `books.ts` line 637 currently gate on `process.env.OPENAI_API_KEY` directly and would silently skip Fal generation if left as-is.

### Schema / contract changes

- **No Prisma schema change.** `illustrationVersion` rows are provider-agnostic (they store url/version/feedback). No migration.
- **No Zod / wire-shape change.** No route response shape changes.
- **Env vars** (`server/.env.example`):
  - Add `IMAGE_PROVIDER=fal` (selector; documented values `fal` | `openai`).
  - Add `FAL_KEY=` (Fal.ai standard env var name; placeholder, empty).
  - Add optional `FAL_IMAGE_MODEL` override (default the Flux Pro 1.1 endpoint id, e.g. `fal-ai/flux-pro/v1.1`), mirroring the existing optional `OPENAI_IMAGE_MODEL`.
  - Keep `OPENAI_API_KEY` and optional `OPENAI_IMAGE_MODEL` (fallback provider).
- **"F4b" cost constants — see Risks / the finding below.** There is no server-side cost constant module today. The only cost figures live as **UI strings in `client/src/pages/CreateBook.tsx`** (the `0.04` per-image multiplier at lines ~498, 506, 511, and the `$0` Quick-mode copy). Cost-constant work in scope = correcting/parameterizing those client figures to reflect the active provider's per-image cost (Flux Pro 1.1 ≈ $0.04, which happens to match the existing displayed `0.04` — so the user-facing number may not even need to move; the copy that *names* the cost basis does).

### Data flow

Unchanged end-to-end, provider swapped underneath:

1. User picks a preview mode (Quick / Cover / Full) in `CreateBook`, or clicks Generate/Illustrate on `BookDetail`.
2. Client → `POST /api/generate` (cover + pages for Full) or `POST /api/books/:id/illustrate` (single page).
3. Route checks provider-configured (was: `OPENAI_API_KEY` present; now: selected provider's key present) → calls `generateIllustration()`/`generateCover()`.
4. Service assembles the prompt, calls `getImageGenerator().generate(prompt)` → bytes from Fal (default) or OpenAI.
5. Service writes the PNG to `public/illustrations/<bookId>/` and returns the `/illustrations/...` URL. For per-page illustrations (`generateIllustration`) it also computes the next version and writes the `illustrationVersion` Prisma row; `generateCover` writes `cover.png` and returns the URL but does **not** write a version row (preserve this asymmetry).
6. Response shape is identical regardless of provider.

### Files likely touched

- `server/src/services/illustrations.ts` — add `ImageGenerator` interface; extract `OpenAIImageGenerator`; add `getImageGenerator()` factory; route the network call through it. Keep public fn signatures.
- `server/src/services/providers/fal.ts` — NEW. `FalImageGenerator` (Flux Pro 1.1 call + bytes retrieval + 120s timeout parity). (Or co-locate in `illustrations.ts` if the team prefers a single file for Phase 1 — planner/dev call.)
- `server/src/services/providers/openai.ts` — NEW (optional). Extracted OpenAI generator if splitting files; otherwise stays inline in `illustrations.ts`.
- `server/src/routes/generate.ts` — replace the two `process.env.OPENAI_API_KEY` gates (lines ~207, 224) with a provider-aware "image gen configured" check.
- `server/src/routes/books.ts` — replace the `OPENAI_API_KEY` gate + 501 message (lines ~637–638) with a provider-aware check + provider-neutral error text.
- `server/.env.example` — add `IMAGE_PROVIDER`, `FAL_KEY`, optional `FAL_IMAGE_MODEL`.
- `client/src/pages/CreateBook.tsx` — correct/parameterize the per-image cost copy (lines ~490, 498, 506, 511) to reflect the active-provider cost basis.
- `server/src/services/__tests__/illustrations.test.ts` — extend to cover Fal path (mock `fetch` with a Fal-shaped response) and provider selection; keep the OpenAI assertions.
- `server/src/routes/__tests__/books.test.ts` — update the 501 test (it asserts `/OPENAI_API_KEY/` in the error text at line ~691) to the provider-neutral message; confirm the module-boundary mock still binds.
- `e2e/tests/illustration-history.spec.ts` (+ peers) — regression check that the illustrate flow still renders versions regardless of provider; QA owns any net-new spec.

## Alternatives considered

### Integration approach: raw `fetch` vs. `@fal-ai/client` SDK

**Raw `fetch` (recommended).**
**Pros:** Zero new dependencies (no guardrail trip for a dep). Mirrors the existing OpenAI code exactly, so the `OpenAIImageGenerator` and `FalImageGenerator` share the same 120s-`AbortController` + `Buffer` shape and the test harness (`globalThis.fetch` mock) works for both. Fal's Flux Pro 1.1 has a **synchronous** REST endpoint (`fal.run` / direct POST) that returns the result inline for fast models (~5–10s), well under our 120s cap — so queue polling is not required for Phase 1.
**Cons:** If we later adopt slow/queued models (LoRA training in Phase 3) we'd hand-roll queue polling that the SDK gives for free. We own auth-header + response-shape details.

**`@fal-ai/client` SDK.**
**Pros:** Handles queue submit/poll/webhook, streaming, and auth uniformly; ergonomic for the async queue API.
**Cons:** New `server/package.json` dependency → CLAUDE.md confirmation gate. Doesn't mock through `globalThis.fetch`, so the existing test pattern would need a different mock strategy (module mock of the SDK). Heavier than Phase 1 needs.

**Recommendation:** **Raw `fetch`** for Phase 1. Flux Pro 1.1's synchronous endpoint fits inside the existing timeout and mock infrastructure with near-zero new surface area. Revisit the SDK if/when Phase 3 LoRA training (genuinely async, multi-minute) lands. Captured as ADR decision 1.

### Default provider: `fal` vs `openai`

**Default `fal` (recommended).** The issue says "replace … keep OpenAI as a fallback," which implies Fal is the new default. Lowest cost, solves the stated pain.
**Default `openai`.** Safer no-op for existing deploys (nothing changes until someone flips the env), but fails to deliver the cost win this issue exists for.

**Recommendation:** Default `IMAGE_PROVIDER=fal`. Fallback is **env-only** for Phase 1 (operator sets `IMAGE_PROVIDER=openai` to revert) — **not** runtime auto-fallback on a Fal error. Runtime fallback adds double-billing and double-latency risk and obscures failures; a Fal error should surface as the existing 500 envelope, same as an OpenAI error does today. Captured as ADR decision 2.

### Where versioning/persistence lives: in the public fn vs. in each provider

**In the public fn (recommended).** `generateIllustration`/`generateCover` keep owning disk writes + Prisma rows; providers only return bytes. Keeps persistence DRY and the module-boundary mocks intact.
**In each provider.** Each generator writes its own file/row. **Rejected:** duplicates versioning logic, risks divergence, and breaks the existing test mock that assumes the public fn owns the row write.

## Success criteria

- `cd server && npm test` passes, including a new test that exercises the **Fal** path (fetch mocked with a Fal-shaped response) and asserts the same `illustrationVersion` row + URL contract as the OpenAI path.
- The 501-when-unconfigured test passes against a provider-neutral error message (no longer hard-codes `OPENAI_API_KEY`).
- With `IMAGE_PROVIDER=fal` + a real `FAL_KEY`, generating a cover and a page produces PNGs on disk and `illustrationVersion` rows, observably identical in shape to the OpenAI path.
- With `IMAGE_PROVIDER=openai`, behavior is byte-for-byte the prior OpenAI behavior (regression check).
- `cd client && npm test` passes; cost copy reflects the active provider, verified in light **and** dark mode.
- `cd e2e && npm test` green — the illustrate / version-history flows still render.
- No TypeScript errors; `generateIllustration`/`generateCover`/`listIllustrationVersions` signatures unchanged.

## Out of scope

- **Character consistency (Phase 2):** IP-Adapter, per-character portraits, `imageUrl` on characters, deterministic seeding, the new `/characters/:role/portrait` endpoint. Separate issue.
- **Per-book / per-request provider choice in the UI.** Phase 1 is env-config only. No wizard provider picker.
- **Runtime auto-fallback** from Fal to OpenAI on error (explicitly rejected above for Phase 1).
- **LoRA / fine-tune (Phase 3)** and any switch to the `@fal-ai/client` SDK that Phase 3 might motivate.
- **A server-side cost-constant module / spend gate ("F4b").** No such module exists today (see finding). Phase 1 corrects the existing client-side cost *copy* only; building a real spend-gate is a separate effort and should be its own spec if scheduled.
- **Migrating existing OpenAI-generated images.** Existing books keep their on-disk PNGs untouched; only new generations use the new provider.

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| **New paid API (Fal.ai)** activated without confirmation | Planner emits an explicit "confirm Fal.ai usage with user" gate task before any real-key wiring; spec flags it as a CLAUDE.md guardrail. |
| **New dependency** if SDK is chosen | Recommend raw `fetch` (no dep). If the team overrides to the SDK, that itself is a confirmation gate. |
| Provider gate left as literal `OPENAI_API_KEY` in routes | Replace all three gates (`generate.ts` ×2, `books.ts` ×1) with a provider-aware check; without this, `IMAGE_PROVIDER=fal` would silently no-op when `OPENAI_API_KEY` is unset. |
| 501 test hard-codes `/OPENAI_API_KEY/` error text | Update to a provider-neutral message + matching assertion; don't delete the test. |
| Module-boundary mock in `books.test.ts` breaks if the export path/signature changes | Keep `generateIllustration`/`generateCover` in `services/illustrations.ts` with identical signatures; providers are an internal detail. |
| Fal response shape differs from OpenAI (Fal returns `images: [{ url }]`, not `data: [{ b64_json \| url }]`) | `FalImageGenerator` owns its own response parsing + image download to `Buffer`; the public fn never sees the difference. |
| Fal request may be async/queued for some models | Flux Pro 1.1 has a synchronous endpoint under the 120s cap; Phase 1 uses it. Queue handling deferred with the SDK decision. |
| Image size/aspect parity (OpenAI uses `1024x1024`; cover wants top room for title) | Pass an equivalent square size to Fal; cover composition stays prompt-driven as today. Note any Flux-specific size param in the provider impl. |
| Dark-mode parity on the touched `CreateBook` cost copy | Existing copy already has `dark:` variants (verified at lines ~510, 652–653); preserve them when editing. |
| Cost copy drifts from real spend again | Parameterize the per-image figure from a single client-side constant tied to the active provider so there's one place to update. |

## ADR-worthy decisions

- [ ] **Integration approach: raw `fetch` over `@fal-ai/client` SDK for Phase 1.** Hard-to-reverse-ish (sets the provider-call pattern); recommendation is raw `fetch`. Write as ADR after spec approval.
- [ ] **Default provider = `fal`, fallback is env-only (no runtime auto-fallback).** Changes the system default behavior and the failure-handling contract; capture the chosen semantics as an ADR.
- [ ] **`ImageGenerator` interface owns only the network call; versioning + Prisma persistence stay in the public service functions.** Architectural boundary that future providers (Phase 2/3) must respect; worth an ADR.
- [ ] **No server-side cost-constant / spend-gate module introduced in Phase 1 ("F4b" does not exist).** Recording this as a deliberate deferral so the surfaced gap is tracked rather than silently dropped (reviewer Check 6). Either an ADR or a `Deferred:` line in tasks.md.
