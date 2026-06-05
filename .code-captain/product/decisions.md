# Product & Technical Decisions Log

Append-only log. Newest entries on top. Each entry should answer: *what was decided, when, why, and what we considered instead.*

---

## ADR-006 — Image-provider abstraction & Fal.ai migration (IV1 Phase 1)

**Date:** 2026-06-05
**Status:** Accepted
**Scope:** `illustration-fal-migration` (IV1 Phase 1). Spec at [.code-captain/specs/illustration-fal-migration/spec.md](../specs/illustration-fal-migration/spec.md); backlog issue #22.

### Decision

Phase 1 of Illustration v2 migrates image generation from OpenAI `gpt-image-1` (~$0.17–0.45/image) to Fal.ai Flux Pro 1.1 (~$0.04/image, a ~5–8× cost reduction) behind a provider abstraction. Three coupled decisions, captured as a set rather than three separate ADRs — they share one feature's context and only make sense read together. Each names its trade-off honestly.

1. **Raw `fetch`, not the `@fal-ai/client` SDK.** Both `OpenAIImageGenerator` and `FalImageGenerator` call their providers via raw `fetch`. **Why:** zero new `server/package.json` dependency (no guardrail trip); Flux Pro 1.1 has a synchronous `https://fal.run/<model-id>` endpoint that returns inline in ~5–10s, well under the existing 120s `AbortController` cap, so queue polling isn't needed; both providers then share the same timeout + `Buffer` shape and the existing `globalThis.fetch` test mock works for both. **Trade-off:** if Phase 3 (LoRA fine-tuning, genuinely async/multi-minute) lands we'd hand-roll queue polling the SDK gives for free — revisit the SDK then. We own auth-header + response-shape parsing.

2. **Default provider = `fal`; fallback is env-only (no runtime auto-fallback).** `IMAGE_PROVIDER` (default `fal`) selects the generator; an operator reverts by setting `IMAGE_PROVIDER=openai`. A Fal error surfaces as the existing 500 envelope — there is **no** automatic retry against OpenAI. **Why:** default `fal` delivers the cost win this issue exists for; runtime auto-fallback would add double-billing and double-latency risk and would obscure which provider failed. **Trade-off:** a Fal outage requires a manual env flip + redeploy to fail over, rather than degrading automatically.

3. **The `ImageGenerator` interface owns only the network call; versioning + Prisma persistence stay in the public service functions.** `generate(prompt): Promise<Buffer>` returns bytes only; `generateIllustration`/`generateCover` keep owning prompt assembly, on-disk versioning, and the `illustrationVersion` row write (page path only — `generateCover` writes no row, an asymmetry preserved from before). **Why:** keeps persistence DRY and provider-agnostic, and keeps the `books.test.ts` module-boundary mock (which assumes the public fn owns the row write) valid. **Trade-off:** a future provider that needs to influence persistence (e.g. returning a provider-hosted URL instead of bytes) would need the interface widened.

### Alternative considered: `@fal-ai/client` SDK + runtime auto-fallback

Adopt the SDK for uniform queue/auth handling, and have the service automatically retry against OpenAI when Fal errors.

Rejected for Phase 1: the SDK is a new dependency (guardrail) and doesn't mock through `globalThis.fetch`, so it would force a different test strategy for near-zero Phase-1 benefit (Flux Pro 1.1 is synchronous). Runtime auto-fallback was rejected for the double-billing/latency and failure-masking reasons in decision 2. Revisit the SDK if/when Phase 3 LoRA training (genuinely async) is scheduled — that would warrant a superseding ADR.

### Consequences

- **`IMAGE_PROVIDER` is now load-bearing config.** The three former literal `process.env.OPENAI_API_KEY` route gates (`generate.ts` ×2, `books.ts` ×1) are replaced by a provider-aware `isImageGenConfigured()`; with `IMAGE_PROVIDER=fal` the system gates on `FAL_KEY`. Deploys must set both `IMAGE_PROVIDER` and the selected provider's key.
- **OpenAI remains a first-class fallback, not dead code.** Setting `IMAGE_PROVIDER=openai` restores byte-identical prior behavior; the OpenAI regression test pins this.
- **The provider boundary is the extension point for Phase 2/3.** Per-character refs (IP-Adapter, Phase 2) and LoRA (Phase 3) plug in as new generators or interface extensions; they must respect the "persistence stays in the public fn" boundary or explicitly supersede decision 3.

---

## ADR-005 — "Pre-merge follow-ups" task is conditionally emitted by the planner

**Date:** 2026-06-03
**Status:** Accepted
**Scope:** ADR-tracking enforcement (skill + reviewer + planner). Spec at [.code-captain/specs/adr-tracking-enforcement/spec.md](../specs/adr-tracking-enforcement/spec.md); backlog issue #53.

### Decision

The planner emits a final **"Pre-merge follow-ups"** task (whose Done-when runs `adr-tracking-check <slug>` and requires zero orphaned ADR-worthy items) **only when the spec has a non-empty `## ADR-worthy decisions` section** — not on every plan.

This is the load-bearing half of the #53 enforcement mechanism: the conditional task puts the ADR-tracking obligation into the developer's execution path (a real "Done when"), where before it lived only as the planner's punt-language and the reviewer's pre-merge backstop. The condition gates *whether the task appears at all*.

### Why

- **Adapt don't bloat.** An always-emitted task would add a no-op "nothing to track" step to every plan whose spec has zero ADR-worthy items — ceremony for the common small feature. The planner already reads the full spec at workflow step 1, so detecting a non-empty section is free.
- **The obligation belongs in the developer's path, not just the reviewer's.** #53's root finding was that no task's Done-when referenced ADR items, so a developer had no reason to action them. The conditional task fixes exactly that, without taxing plans that don't need it.
- **Defense in depth is preserved.** Even when the planner omits the task (e.g. forgets to check the section), reviewer Check 6 still catches orphaned items at `/ship`. The conditional task is the early gate; the reviewer is the backstop.

### Alternative considered: always emit the task

Unconditionally append the "Pre-merge follow-ups" task to every plan.

**Pros:** no "did the planner check the spec section?" failure mode; uniform task lists. The skill on an empty item set is a clean no-op anyway, so the task would just report "nothing to track."

**Why rejected:** it adds a no-op task to the (common) small feature whose spec flagged no ADR-worthy decisions — against the project's "adapt don't bloat" value. Reconsider if planners are observed skipping the conditional in practice; flipping to always-emit is a one-line planner-rule change.

### Consequences

- **Standing planner behavior.** `.claude/agents/planner.md` carries this as a decompose-step heuristic and shows the conditional task in its `tasks.md` template. Future planners follow it without re-deriving the rationale.
- **The skill is the single source of the rule.** `adr-tracking-check` is invoked by both the conditional developer task (early) and reviewer Check 6 (backstop) — encode once, run at two points. This follows the established reviewer-check → skill extraction pattern (the 3rd instance, after `wire-shape-check`/Check 4 and `dark-mode-parity-check`/Check 3).
- **This very spec dogfooded the rule.** `adr-tracking-enforcement` has a non-empty ADR-worthy section, so its own plan carried the Pre-merge follow-ups task (Task 5) — which produced this ADR.

---

## ADR-004 — Theater mode interaction & layout decisions

**Date:** 2026-06-02
**Status:** Accepted
**Scope:** TS1 — theater-mode feature, shipped in PR #54. Spec at [.code-captain/specs/theater-mode/spec.md](../specs/theater-mode/spec.md).

### Decision

Theater mode (widen the book spread to fill the viewport) is a UI-only client feature governed by six coupled decisions, captured here as a set rather than as six separate ADRs — they're small, share one feature's context, and reading them together is how they make sense. Each names its trade-off honestly.

1. **State lives in the URL (`?theater=1`), not React state or `localStorage`.** Derived via `useSearchParams`; `searchParams.get('theater') === '1'`. **Why:** bookmarkable, deep-link friendly, and the browser Back button exits theater mode for free (`setSearchParams(next, { replace: false })`) — no cross-tab state sync. **Trade-off:** URL pollution if more "view mode" params accumulate over time; strict `=== '1'` means `?theater=true` silently does nothing.

2. **Layout swap in place, not an overlay/portal.** Theater mode widens the existing frame, footer, revise-panel, and page-wrapper rather than rendering a modal. **Why:** simpler component tree — no focus-trap, escape-key, or scroll-lock contracts to honor; no portal. **Trade-off:** less of a "modal" immersive feel than a true full-screen overlay would give.

3. **Toggle hidden on `<md` (<768px) viewports** via `hidden md:inline-flex`; no alternative mobile affordance. **Why:** a ~90vw widen is meaningless on a 375px screen, so mobile keeps the default layout. **Trade-off:** the feature is desktop-only by design.

4. **Inline revise panel stays vertically stacked when widened** — it grows to the same `max-w` as the spread but remains below it. **Why:** smallest diff vs. the current layout; side-docking would require a new grid container. **Trade-off:** at 90vw a stacked revise panel needs more scrolling than a side-docked one would.

5. **Animate via Tailwind `transition-all duration-200 ease-in-out`** on all four widening containers. **Why:** matches the existing page-flip animation duration so the two don't visually fight; plain Tailwind utilities (`transition-all duration-200 ease-in-out`), no new dependency. **Trade-off:** animating `max-width` can be janky on some browsers — mitigated by the short 200ms duration.

6. **Test the lifted prop via a prop-capturing mock.** `BookDetail.test.tsx`'s `BookSpread` mock was upgraded to capture the `theater` prop into a module-level variable and expose `onToggleTheater` as a stub button, so the parent's URL→prop wiring is assertable without rendering the real child. **Why:** isolates the URL-state logic under test from `BookSpread`'s internals. **Trade-off:** a module-level capture variable needs a `beforeEach` reset to avoid cross-test bleed; flagged for promotion to a testing-conventions note if the pattern recurs.

### Alternative considered: full-screen overlay with local state

A `position: fixed` overlay (or React portal) toggled by component state would give a stronger "theater" feel and decouple the widened view from the document flow.

Rejected because it pulls in the full modal contract — focus management, escape-to-close, scroll-lock, and `aria-modal` semantics — for a feature whose value is simply "more horizontal room to read." Local/`localStorage` state would also forfeit the bookmark + Back-button behavior that decision 1 buys for free. If theater mode later needs to hide surrounding chrome entirely (nav, footer), revisit this — an overlay becomes the better tool and would warrant a superseding ADR.

### Consequences

- **`?theater=1` is now a load-bearing URL contract.** Any future "view mode" params should follow the same strict-equality, Back-button-friendly pattern; watch for URL-param accumulation (decision 1's trade-off) and consolidate if a third view param appears.
- **Page-wrapper widens regardless of `viewMode`.** Per the spec's Resolved Question #1, the wrapper widens whenever `?theater=1` is present even in reader view; this is intentional (harmless horizontal-whitespace change) and avoids special-casing. Reviewer treats AC#7 as referring to reader-view *visual rendering*, not wrapper width.
- **The prop-capture test pattern (decision 6) is a candidate testing convention.** If it recurs in other parent→child prop-wiring tests, promote it into `docs/conventions/testing.md` rather than re-deriving it per test file.

---

## ADR-003 — Zod schemas as source of truth for client/server type sharing

**Date:** 2026-05-18
**Status:** Accepted
**Scope:** OPS.3 — wire-shape contracts across all 5 server domains (orders, cart, books, admin, test). Shipped across PRs #22, #23, #24.

### Decision

Adopt Zod schemas (in a source-only `@storybook/shared` workspace package) as the single source of truth for every client/server wire contract. Server routes validate request bodies via a `validate()` Express middleware that consumes the schemas; client and server both import inferred TypeScript types from the same schemas.

Layout:

```
shared/src/
  orders.ts, cart.ts, books.ts, admin.ts, test.ts   ← Zod schemas per domain
  index.ts                                           ← re-exports

server/src/middleware/validate.ts                   ← Express middleware
client/src/types.ts                                   ← re-exports wire shapes from @storybook/shared
server/src/types.ts                                   ← re-exports wire shapes + adds DB/auth-only shapes
```

When OpenAPI's specific capabilities become valuable later (multi-language SDKs, vendor-facing docs, mock servers), generate the OpenAPI spec **from** the existing Zod schemas via `@asteasolutions/zod-to-openapi` or `zod-openapi`. Zod remains the source of truth in every future state — this is **not** "Zod now, OpenAPI rewrite later."

### Why

- **Runtime validation + compile-time inference from one declaration.** `z.object({...})` produces both an Express-validatable schema and a TS type via `z.infer<typeof Schema>`. No drift, no codegen step.
- **OpenAPI's killer features only pay off with non-TS clients or external consumers** — multi-language SDK generation, Swagger UI, mock servers, partner docs. None are on the storefront's near-term roadmap. Adopting OpenAPI now is enterprise tax for capabilities we don't yet use.
- **Refactor-safety.** TS rename-symbol propagates schema changes across client/server in one operation. OpenAPI-first generated TS types are less ergonomic and don't refactor with the source.
- **Forward-compatible.** When a non-TS client (mobile, partner SDK) lands, the migration is "add `zod-to-openapi`," not "rewrite the contract layer."

### Alternative considered: OpenAPI-first

Define the API in `openapi.yaml`, generate TS types and a validation layer from the spec.

Why rejected for the current phase:

- **Enterprise tax without benefit.** OpenAPI is built for cross-language API contracts and external consumers. The storefront has neither today.
- **Less ergonomic generated types.** Codegen produces verbose TS that doesn't compose well with the rest of the codebase. Zod's `z.infer<typeof Schema>` produces idiomatic types.
- **Separate runtime layer.** Validation isn't bundled — you add `ajv` or similar. Zod combines both responsibilities cleanly.

**Reconsider trigger:** a non-TS client lands on the roadmap, or external API consumers/partners need formal docs. At that point we generate OpenAPI *from* Zod — zero contract rewrite, just an additional output.

### Consequences

- **Zod schemas live in `@storybook/shared`** — a source-only workspace package with no build step. Both client and server link it via `"@storybook/shared": "*"`.
- **Auth middleware order rule.** `requireAuth` / `adminGate` runs **before** `validate()` so 401/403 wins over 400. This is now load-bearing — any new protected route must keep this order.
- **Server `types.ts` is split-shape.** `server/src/types.ts` re-exports wire shapes from `@storybook/shared` and *adds* DB-row + auth shapes that stay server-local. `client/src/types.ts` re-exports the same wire shapes only.
- **Pre-existing type drift fixed during migration.** `is_featured` and `is_user_created` were `number` in legacy `server/types.ts`; both are now `boolean` (matching Prisma + Zod). Not a wire-shape change — a latent bug surfaced and corrected.
- **OpenAPI generation is deferred indefinitely.** Add `@asteasolutions/zod-to-openapi` only when a concrete trigger lands. The Zod schemas are forward-compatible — no rework cost when that trigger fires.

---

## ADR-002 — Character cast persisted as JSON column, not separate table

**Date:** 2026-05-14
**Status:** Accepted
**Scope:** MVP-1 of the illustration/authoring upgrade (see [roadmap.md](roadmap.md))

### Decision

Persist the character cast on `Book.characters_json` (a `String?` column holding a JSON-encoded array) rather than introducing a `Character` table with a foreign key to `Book`.

Shape:

```ts
type Character = {
  role: 'primary' | 'antagonist' | 'supporting';
  name: string;
  descriptor?: string;
  relationship?: string;
};
```

### Why

- **Matches an existing precedent.** `BookVersion.pages_json` already encodes structured data as JSON in a column. Following the same pattern keeps the schema small and the mental model consistent.
- **No query pressure.** We do not search, filter, or aggregate by character. Characters are always loaded with their parent Book.
- **Migration is additive and reversible.** One nullable column; no FKs, no joins to update, no risk to existing rows.
- **Caps are small.** Max 6 characters per book (enforced at the UI) keeps the JSON blob tiny — typically well under 1 KB.

### Alternative considered: separate `Character` table

A normalized `Character` table with a FK to `Book` would be more "correct" if any of these become true later:
- We want to query characters across books (e.g. "all books featuring a character named Luna").
- Characters carry their own per-page state (which pages they appear on, screen time, etc.).
- We need referential integrity from other entities (e.g. character ↔ reference photo).

If those needs land, migration is straightforward: read `characters_json`, write rows to a new `Character` table, drop the column. We accept that re-migration cost as cheap insurance for the simpler initial design.

### Consequences

- **Hydration helper required.** `server/src/routes/books.ts` exports `hydrateBook()` which parses `characters_json` into `characters: Character[]` on every read. All GET/POST/PUT response builders must funnel through it (already wired in this commit).
- **No DB-level validation of character shape.** The hydrator tolerates bad JSON by returning `[]`. The server route validates the shape on write via `normalizeCharacters()` in [generate.ts](../../server/src/routes/generate.ts).
- **Phase 2 work (character reference photos) needs this revisited.** If photos attach per-character with their own URL/metadata, the JSON blob may need to expand or be split out. Flag a follow-up ADR at that point.

---

## ADR-001 — Documented harness on the upstream Code Captain template

**Date:** 2026-05-14
**Status:** Accepted with deferred upgrade — see [harness-backlog.md](harness-backlog.md)

### Decision

Continue running on the local project-specific `.claude/agents/` (booksmith, qa, storefront) rather than installing `npx @devobsessed/code-captain` v0.6.0.

### Why

Demo is the day after this decision was made (2026-05-15). The full template install adds 4 new generic agents, 7 commands, 6 skills, an `.mcp.json`, and a `.code-captain/` directory structure — substantial diff with non-zero risk of conflict with the existing custom agents. Not worth the rollback risk this close to a stakeholder demo.

### What we adopted *from* the template anyway

- The `.code-captain/product/` directory convention (this file, plus [roadmap.md](roadmap.md)). Lightweight; matches what the template would have produced via `plan-product`.

### What's deferred

See [harness-backlog.md](harness-backlog.md) for the full list of upstream items worth revisiting after the demo.
