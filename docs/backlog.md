# StoryBook Storefront — Product Backlog

Established 2026-05-14. The app is a working storefront + AI book creation tool. Core pivot: evolve from one-shot generation to a **collaborative creation workflow** with iteration loops.

**Why this matters:** This is a demo of a real product concept, not a toy. The creation workflow (story iteration + illustration iteration) is the core differentiator over competitors like Wonderbly and Hooray Heroes.

## Tier 1 — Core Creation Workflow

Sequential dependency chain — each item unblocks the next.

- [x] **T1.1** — Book versioning and draft status (draft/published lifecycle) — shipped in PR #13
- [x] **T1.2** — Story iteration/feedback workflow (read, give feedback, get revision from Claude) — shipped in PR #13, includes revert + post-revise comparison modal
- [x] **T1.3** — Illustration generation (integrate image API) — shipped earlier; PR #13 added character consistency in prompts and MyBooks unillustrated badge
- [x] **T1.4** — Illustration iteration/feedback workflow (per-page regen with feedback) — shipped in PR #13, includes persisted version metadata, history viewer with timestamps + feedback, active-version indicator

## Tier 2 — Storefront & Research

- [x] **T2.5** — Enhanced browse experience (search, better filtering, community creations, book preview) — already shipped: Home.tsx has search, theme + age range chips, Featured + Community sections, BookPreviewModal, with Home unit and e2e coverage
- [x] **T2.6** — Research: illustration APIs and cost models → `.code-captain/product/illustration-providers-and-character-consistency.md`
- [x] **T2.7** — Research: marketing strategies → `docs/marketing-research.md`
- [x] **T2.8** — Research: print/publishing options → `docs/print-publishing-research.md`

## Tier 3 — Operations & Hygiene

- [x] **OPS.1** — Replace demo-seed examples. Shipped 2026-05-19 with a fixture-driven seed (`server/prisma/demo-seed-fixtures/*.json` + committed PNGs at `server/public/illustrations/{book-id}/`). One demo book ("A Spot for Sunny") rather than the original 3-5; richer test data stays in your local `dev.db` per the preservation pattern in CLAUDE.md. See [Completed work](#completed-work) for the rationale and non-obvious conventions.
- [x] **OPS.2** — Admin role on User, soft-delete on User and Book, admin-only API surface to inspect/clean orphaned state. Initial implementation shipped 2026-05-15 in commit `f5751de` (off-backlog); finish-and-verify pass (cart soft-delete filter + orphan cleanup endpoint) shipped 2026-05-19 in PR #27. See [Completed work](#completed-work) for non-obvious conventions.
- [x] **OPS.4** — `server/.env.example` documenting `DATABASE_URL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (required) plus `OPENAI_IMAGE_MODEL` and `PORT` (optional, commented). Shipped 2026-05-20.
- [x] **OPS.5** — `.claude/settings.local.json` added to root `.gitignore`. Shipped 2026-05-20.
- [x] **OPS.3** — Implement client/server type-sharing via Zod, with OpenAPI as a forward-compatible upgrade path. Shipped 2026-05-18 across PRs #22 (foundation + `orders.ts`), #23 (`cart.ts`), and #24 (`books.ts`/`admin.ts`/`test.ts`). See [Completed work](#completed-work) for non-obvious conventions.

  **Context.** `client/src/types.ts` and `server/src/types.ts` are hand-maintained duplicates with no compile-time link. Drift surfaced as a real production bug in OrderConfirmation (`book_title` vs `title` — order summary rendered empty book titles to every customer). Wire-shape assertions in `.claude/agents/qa.md` are an interim catch-net; this item is the structural fix.

  **Decision (2026-05-18):** **Zod schemas as the source of truth.** When OpenAPI's specific benefits become valuable (third-party API consumers, non-TS clients, vendor-facing docs), generate the OpenAPI spec FROM the existing Zod schemas via `@asteasolutions/zod-to-openapi` or `zod-openapi`. This is NOT "Zod now, OpenAPI rewrite later" — the Zod schemas remain the source of truth in every future state.

  **Why this over OpenAPI-first:** OpenAPI's killer features (multi-language SDK generation, Swagger UI docs, mock servers) only pay off when you have non-TS clients or external API consumers. None are on the storefront's near-term roadmap. Adopting OpenAPI now means paying the toolchain tax (codegen pipelines, less ergonomic generated TS types, separate runtime-validation layer) for capabilities that aren't yet useful. Zod gives runtime validation, end-to-end TS inference, IDE-refactor-safety, and a low-friction migration path to OpenAPI when needed.

  **Implementation plan:**
  1. Add Zod schemas (`z.object({...})`) for each route's request body and response shape, colocated with the route or in a shared `shared/` package
  2. Mount Zod validation middleware on the server (validates request payloads, types response shapes)
  3. Export `type Foo = z.infer<typeof FooSchema>` and import from both client and server
  4. Delete duplicated definitions from `client/src/types.ts` and `server/src/types.ts`
  5. Apply the wire-shape assertion convention to remaining under-asserted routes during migration: `cart.ts` GET, `books.ts` GET/PUT/POST endpoints, `admin.ts`, `test.ts`. Start with `orders.ts` since the drift bug is fresh in context.

  **Deferred:** OpenAPI generation. Add `zod-to-openapi` only when there's a concrete need — third-party API consumers, non-TS clients (mobile app, partner SDKs), or vendor-facing API documentation. Zod schemas from step 1 are forward-compatible — no rework cost when this trigger fires.

  **Rejected alternatives:**
  - **OpenAPI-first** — enterprise tax for capabilities not yet needed. Generated TS types are less ergonomic than Zod inference. Runtime validation requires a separate layer. Reconsider if/when a non-TS client or external API consumer lands on the roadmap.
  - **tRPC** — best DX for monorepo-only TS, but harder to expose the API to non-TS clients later. Doesn't fit the "potential to grow into mobile/partners" framing.
  - **Co-located response types** (server route exports the type, client imports via relative path) — cheap, but creates an unusual cross-zone TS dependency that conflicts with the zone-ownership model in CLAUDE.md.
  - **Status quo + assertions everywhere** (the original option (a)) — catches drift earlier but doesn't prevent it. Useful as an interim only.

  **Substantial refactor — recommend a fresh session.** Migration touches every API surface; suggest going route-by-route rather than big-bang.

## Future directions

Aspirational, not committed. Captured so structural decisions today stay forward-compatible.

- **Mobile / non-TS clients.** If the storefront proves out as a real product, a native mobile companion (RN, Swift, or Kotlin) is an avenue worth exploring. This is part of why OPS.3 chose Zod-as-source-of-truth with a Zod → OpenAPI upgrade path: when a non-TS client lands, we generate the OpenAPI spec from existing Zod schemas via `@asteasolutions/zod-to-openapi` rather than rewriting the contract layer. No work today, just preserving the optionality.

- **Illustration character grounding.** The OPS.1 spike hit a real quality issue: the image model invented a golden retriever puppy on page 4 when the story introduced "Sunny" (a girl) by name without a visual descriptor. The generator only requires the *primary* character to have a descriptor; supporting characters and antagonists referenced by name are invented per-illustration with no continuity. For demo polish — or to claim "character consistency" as a product strength — anchor named characters to "human child" by default in the illustration prompt, and consider promoting all named characters to required descriptors at story-generation time. Not blocking; T1.4 (illustration iteration) provides the per-page regen escape hatch.

## Working notes

Update this section as work proceeds. Subagents read from here.

### agent/chore/ops4-ops5-and-ts-fixes — 2026-05-20

**Backlog:** OPS.4 (`server/.env.example`) + OPS.5 (gitignore `.claude/settings.local.json`) + folded-in fix for pre-existing TS errors in `client/src/components/BookSpread.tsx` and `client/src/pages/__tests__/Home.test.tsx` (no backlog ID — surfaced during `/ship` of PR #27).
**Owner:** main (all inline — qualifies under the 1-line-fixes exception in CLAUDE.md).

**Plan**
- [x] **OPS.4** — Created `server/.env.example` with `DATABASE_URL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` as required, `OPENAI_IMAGE_MODEL` and `PORT` commented out as optional overrides. Vars sourced by grepping `process.env.*` in `server/src/`.
- [x] **OPS.5** — Added `.claude/settings.local.json` to root `.gitignore` after `.DS_Store`.
- [x] **TS fix — BookSpread.tsx** — `spreads[spreadIndex]` is `SpreadKind | undefined` under `noUncheckedIndexedAccess`. Added `if (!spread) return null` after the lookup with a comment explaining `canNext`/`canPrev` keep the index in bounds. Unblocks discriminated-union narrowing on `spread.kind` throughout the JSX.
- [x] **TS fix — Home.test.tsx** — `getAllByRole('button', { name: 'All' })[0]` returns `HTMLElement | undefined`. Added `!` non-null assertion (length is already asserted on the line above).
- [x] **Verify** — client tsc clean, client tests 40/40, client lint clean, client build clean, server tests 104/104, server tsc clean.

**Note:** Tier 3 OPS.4/OPS.5 checkboxes marked `[x]` in this PR (matches OPS.1 pattern in PR #26 — small enough to bundle implementation + close-out).

## Completed work

### OPS.2 — Admin role + soft-delete + orphan cleanup (shipped 2026-05-19)

Two-phase delivery. Schema migration (`User.role`, `User.deleted_at`, `Book.deleted_at`), `requireAdmin` helper, `adminGate` middleware, the bulk of `/api/admin/*` routes (list users/books incl. soft-deleted, restore endpoints, featured toggle, list orphan illustration dirs), shared Zod schemas, client `<Admin />` page, and tests all landed off-backlog in commit `f5751de` (2026-05-15). PR #27 (2026-05-19) closed two gaps the original commit left: cart hydration didn't filter soft-deleted books, and admin could see orphan dirs but couldn't clean them.

**Non-obvious conventions worth preserving** (future contributors — read these before extending the admin surface or touching soft-delete read paths):

- **Cart silent-hide for soft-deleted books.** `GET /api/cart/:sessionId` uses a Prisma relation filter (`where: { session_id, book: { deleted_at: null } }`) — items pointing at tombstoned books just disappear on next fetch. No banner, no 4xx. POST to add a soft-deleted book returns 404 (same as not-found). Don't replace this with a "1 item no longer available" banner without an explicit product call; the UX choice was deliberate (demo-scope, less surface to test).
- **Orphan-of-orphan deletion is allowed.** `DELETE /api/admin/orphan-illustrations/:id` 409s only when the dir matches a LIVE book row (`deleted_at IS NULL`). Dirs whose books are soft-deleted remain deletable — they're orphans of orphans, and the listing endpoint already includes them. If you tighten the 409 to "any matching book row," you'll break the listing's semantics.
- **Receipts intentionally include soft-deleted books.** `orders.ts` reads do NOT filter `deleted_at`. This is correct: `OrderItem` snapshots `title` and `price` at checkout, so receipts must render regardless of later book state. The inverse of the cart pattern — don't unify them.
- **Email tombstone.** `User.email` stays full `@unique`. Soft-deleted users' emails are reserved and can't be re-registered until admin restores or hard-deletes. Conscious choice (the admin owns the tombstone). If email reuse becomes a need, switch to a partial unique index `(email) WHERE deleted_at IS NULL` via raw SQL — Prisma doesn't generate partial indexes natively.
- **Admin bootstrap is sqlite-only by design.** Only path to a first admin is `server/prisma/demo-seed.ts` upserting `demo@storybook.local` with `role: 'admin'`. No promote API exists. Adding one (`PUT /api/admin/users/:id/role` or similar) was explicitly rejected — keeps the role-escalation attack surface at zero. Promote a second admin via `sqlite3` or `prisma studio` when actually needed.
- **`adminGate` is role-aware, not env-token-gated.** `server/src/routes/admin.ts:70-82` — calls `getAuthUser` (401 if missing) then `requireAdmin` (403 if role !== 'admin') in one middleware. Emits the correct status code itself instead of chaining `requireAuth` + a separate role gate. Lives parallel to `requireAuth` (used in `books.ts`); both coexist. Auth middleware order rule from OPS.3 still applies — `adminGate` runs BEFORE `validate()` so 401/403 wins over 400.
- **Path-traversal defense is layered.** The orphan-delete endpoint guards against `..`, `/`, `\`, `\0` in the path component AND uses `path.resolve` + prefix check on the resolved path. Either guard alone would catch most attacks; both together mean a future regression in one doesn't unlock it.
- **`resetDatabase()` doesn't need OPS.2-specific logic.** Prisma column defaults (`role = 'user'`, `deleted_at = null`) supply the new columns on every fresh seed. The test reset works as-is. See header comment at `server/src/__tests__/setup.ts:26-32`.
- **Schema migration was purely additive.** `20260517232231_add_admin_role_and_soft_delete` adds columns + defaults — no `prisma migrate reset` required. Existing rows backfill to `role='user'`, `deleted_at=null`. No index on `deleted_at` — at demo scale the SQLite query plan won't change; revisit if data volume grows.

**Deferred for follow-up backlog items:**
- `DELETE /api/admin/users/:id` (admin-driven user soft-delete) — no user-facing self-delete exists either; defer until there's a real workflow that needs it.
- `GET /api/admin/orders` — useful operator surface, not blocking OPS.2.
- Indexes on `deleted_at` columns — defer until query plans show they matter.

### OPS.1 — Demo-seed refresh (shipped 2026-05-19)

Replaced the rejected stub-pointer + vision-rewrite approach in `server/prisma/demo-seed.ts` with a fixture-driven seed. One demo book ("A Spot for Sunny") committed at `server/prisma/demo-seed-fixtures/spot-for-sunny.json` + 6 PNG illustrations (~13.7MB) at `server/public/illustrations/b2fa23cf-3156-4b89-83e7-82d98c32c8b7/`. Original backlog asked for 3-5 books; scope reframed to 1 because the storefront-fresh-clone use case only needs proof that Community renders content, while richer testing belongs in a developer's local `dev.db` (preservation pattern documented in CLAUDE.md).

**Non-obvious conventions worth preserving:**

- **Two `.gitignore` files contribute** — root `.gitignore` AND `server/.gitignore`. The PNG path lived under the server's ignore. When adding future demo books, update BOTH gitignores and use `dir/*` + `!dir/subdir/` form, NOT `dir/`, because gitignore cannot re-include children of an ignored directory.
- **Add new demo books by appending a fixture file + re-include line** — drop a new JSON in `server/prisma/demo-seed-fixtures/`, commit PNGs at `server/public/illustrations/{stable-uuid}/`, and add a `!server/public/illustrations/{stable-uuid}/` line to both gitignores. Seed picks it up automatically (reads the directory).
- **`db:reset` does NOT auto-run any seed** — no `prisma.seed` field in `server/package.json`. To repopulate after a reset, chain `db:reset && db:seed && db:seed-demo` yourself.
- **Demo books are owned by the demo user** — the seed resolves `created_by` to `demo@storybook.local`'s id so the demo book appears in MyBooks when logged in as the demo user (showcases more functionality than an unowned community book would).
- **Local books survive `db:seed` and `db:seed-demo`** — both are upsert-only. Only `db:reset` is destructive. See CLAUDE.md "Local dev.db" section for the preservation pattern (auto-snapshot + manual `cp` fallback).
- **Page-4 of "A Spot for Sunny" uses the regenerated illustration** — `Page.illustration_url` is `/illustrations/.../page-4-v2.png`. Original v1 had a content-mismatch (image model invented a dog instead of a girl named Sunny). The fixture captures only v2; v1 is not on disk. Worth knowing if anyone wonders why the file naming is irregular.

**Adjacent fix folded into this PR — generate.ts JSON parse fragility:**
Spike attempt 1 failed at `server/src/routes/generate.ts:162` with `SyntaxError: Expected ',' or '}' after property value in JSON`. Anthropic returns malformed JSON occasionally (unescaped quotes/apostrophes in long story strings). The route's fallback at lines 156-166 just re-tried `JSON.parse` on the same content extracted via regex — didn't repair anything. Added `jsonrepair` as a real fallback in a new shared helper at `server/src/services/parseAiJson.ts`. Applied to both `generate.ts` and `books.ts` revise endpoints (same bug class). 8 new unit tests, all 93 server tests pass. Folded into this PR because it directly unblocked the OPS.1 spike.

### OPS.3 — Zod client/server type sharing (shipped 2026-05-18)

Migrated every server route to Zod schemas in `shared/src/*.ts` validated by a `validate()` Express middleware. Across PRs #22, #23, #24, all 5 domains (orders / cart / books / admin / test) now validate request bodies and response wire shapes against schemas in the `@storybook/shared` source-only workspace package. `client/src/types.ts` and `server/src/types.ts` re-export wire shapes from `@storybook/shared`; server-only DB-row and auth shapes stay local.

**Non-obvious conventions worth preserving** (future contributors and follow-up agents — read these before adding routes or extending the schemas):

- **Dates over the wire: use `z.string()`, not `z.date()`.** Prisma hands back `Date` instances, but the response middleware validates the post-`JSON.stringify` wire shape, which is ISO strings. `z.date()` will pass in unit tests against raw JS objects and fail in integration tests against the actual response.
- **Auth middleware runs BEFORE `validate()`.** `requireAuth` (books.ts) and `adminGate` (admin.ts) are mounted before the per-route validators so 401/403 always wins over 400. Auth'd user is threaded through `res.locals.user`. Don't move the auth check inside handlers — that ordering leaks schema info to unauthenticated callers.
- **Request-error message format is `Invalid request body: <field>: <zod-message>`.** Tests that pin error strings need to match this prefix. See `server/src/middleware/validate.ts` (`summarizeIssues()`). The doubled-field-name pattern (`bookId: bookId is required`) is awkward but consistent — polish item if anyone wants to revisit.
- **Re-export, don't delete.** `types.ts` files on both client and server keep their existing symbol names by re-exporting from `@storybook/shared` rather than being deleted. This preserves the legacy `Store` interface (server) and 20+ client import sites. `AdminBook` (client) is an extension of shared `Book` to keep room for client-only admin fields.
- **`is_featured` and `is_user_created` are `boolean`, not `number`.** Prisma schema and shared Zod agree on `boolean`; the legacy server `types.ts` had them as `number` — that was a pre-existing bug fixed during migration, not a wire-shape change.
- **Server-only DB-row shapes stay in `server/src/types.ts`:** `CartItemRow` (the unhydrated DB shape, distinct from the wire `CartItem`), `LegacyBook` / `LegacyPage` (dormant JSON-store seed in `db/init.ts`), `User` / `AdminUser` (auth). These never reach `@storybook/shared`.
- **OpenAPI is deferred.** Add `@asteasolutions/zod-to-openapi` only when a concrete non-TS client or external API consumer lands. The Zod schemas are forward-compatible.

**Worktree-setup improvements folded in along the way:**
- `scripts/worktree-setup.mjs` (run via `npm run setup:worktree`) — copies `server/.env` and `server/prisma/dev.db` into a freshly-created worktree so agent worktrees are immediately runnable after `npm install`.
- `e2e` is now part of the root `workspaces` array so `cd e2e && npm test` works without a separate install.
- `.claude/commands/start-task.md` bakes the hydration step into the standard task kickoff flow.
