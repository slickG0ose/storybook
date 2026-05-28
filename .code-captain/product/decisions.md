# Product & Technical Decisions Log

Append-only log. Newest entries on top. Each entry should answer: *what was decided, when, why, and what we considered instead.*

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
