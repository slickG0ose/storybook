# CLAUDE.md

Guidance for Claude Code sessions working in StoryBook Storefront.

## Project

AI-powered children's book store. React + Express + Claude API. Working storefront with creation workflow being built out. Demo-grade product concept.

**Current focus:** see [GitHub Issues](https://github.com/slickG0ose/storybook/issues), grouped by milestone (Foundation, Harness Rebuild, Tier 2 Storefront, Illustration v2, Mobile + Series, Print/Subscription). The pre-migration backlog at [docs/backlog.md](docs/backlog.md) is preserved as a read-only archive of completed-work conventions (OPS.1–3) — do not add new items there.

## Layout

| Directory | Stack | Conventions |
|-----------|-------|-------------|
| `client/` | React 19, Vite 8, Tailwind 4, TS | [docs/conventions/client.md](docs/conventions/client.md) |
| `server/` | Express 4, TS, Anthropic SDK | [docs/conventions/server.md](docs/conventions/server.md) |
| `shared/` | Zod schemas, source-only workspace package | [docs/conventions/server.md](docs/conventions/server.md) §wire-shapes |
| `e2e/` | Playwright 1.52, TS | [docs/conventions/testing.md](docs/conventions/testing.md) |
| `docs/` | Backlog archive, research notes, conventions | — |

Stack details, patterns, and zone-specific conventions live in `docs/conventions/{server,client,testing,data}.md`. Agents read these on demand — they're the source of truth, not duplicated into agent prompts. For edges that cross a zone boundary — which page calls which route, which router pulls which service, what a `@storybook/shared` schema change touches — read [docs/conventions/call-graph.md](docs/conventions/call-graph.md) instead of grepping all four workspaces.

## Branching

Trunk-based off `master`. Short-lived branches, squash-merge PRs. **Never `git commit` directly on `master`** — the local `.claude/hooks/guard-bash.sh` blocks it (exit 2), and GitHub branch protection rejects the push regardless. Prefixes follow conventional commits — the type before the slash drives changelog grouping and lets you scan `git log` at a glance.

| Prefix | Use for |
|--------|---------|
| `feat/` | New user-facing capability |
| `fix/` | Bug fix |
| `chore/` | Tooling, deps, config — no user-facing change |
| `docs/` | Documentation only |
| `test/` | Tests only |
| `refactor/` | Internal restructure, no behavior change |

Descriptor is kebab-case and scope-y, not a sentence: `feat/illustration-iteration`, `fix/cart-session-leak`, `chore/bump-anthropic-sdk`.

**Agent worktree branches** prefix with `agent/` first: `agent/feat/illustration-iteration`, `agent/fix/...`. Distinguishes agent-driven work from yours in `git log` and PR lists. The `/start-task` command creates these automatically.

## Build & run

```bash
npm run dev                          # both client (:5173) and server (:3001)
npm run dev:client
npm run dev:server
```

## Local dev.db

Prisma + SQLite. Snapshot/seed/restore conventions live in [docs/conventions/data.md](docs/conventions/data.md). `db:hydrate` is upsert-only and safe to run; `db:reset` is the only destructive op and requires user confirmation.

## Testing

```bash
npm test                             # Vitest — harness suite at repo root (51 tests)
cd server && npm test                # Vitest + Supertest (408 tests)
cd client && npm test                # Vitest + RTL (333 tests)
cd e2e && npm test                   # Playwright (147 tests)
cd e2e && npm run test:headed
cd e2e && npm run test:ui
```

Counts are a **snapshot, measured 2026-08-30** — they drift with every PR that adds a test and nothing enforces them. Treat a mismatch as a stale doc, not a missing suite. The previous figures (44 / 233 / 215 / 106) had drifted far enough that server was understating by 175 tests, which is the kind of gap that makes a reader doubt the run rather than the doc.

## CI

`.github/workflows/pr-ci.yml` runs on every PR. Four jobs — the three test jobs start together, E2E waits on two of them:

| Job | Covers |
|-----|--------|
| Harness tests | `guard-bash` hook behavior + the `.claude/` resolution snapshot |
| Server tests | Vitest + Supertest |
| Client tests | Vitest + RTL, plus typecheck, lint, and build |
| E2E | Playwright (uploads a report artifact on failure) |

Other workflows: `codeql.yml` (security scanning), `deploy-pages.yml` (client → GitHub Pages, `workflow_dispatch` only), `deploy.yml` (placeholder).

**All four jobs are required status checks** — a red PR cannot merge. `strict_required_status_checks_policy` is `false`, so a branch does **not** have to be rebased onto the latest `master` before merging.

The ruleset pins each check by its **job name**, so renaming a job in `pr-ci.yml` renames the check GitHub waits for. Rename one without updating the ruleset and every PR sits blocked on a check that will never report. The harness job was renamed in #66 (`Harness tests (.claude/ schema + references + hook behavior)` → `Harness tests (guard-bash behavior + resolution snapshot)`). **Re-read 2026-09-02: the pinned name did follow** — all four ruleset contexts match the four `name:` fields in `pr-ci.yml` exactly. Re-check with `gh api repos/slickG0ose/storybook/rulesets/16755005 --jq '.rules[]|select(.type=="required_status_checks").parameters.required_status_checks[].context'` against `grep -n '^    name:' .github/workflows/pr-ci.yml`.

Note the E2E job declares `needs: [server-tests, client-tests]`. When either dependency fails, E2E is *skipped* rather than failed — but the failing dependency is itself required, so a skipped E2E can never wave a PR through.

**Merge protection on `master` is a repository *ruleset* (`develop-policy`), not classic branch protection** — `gh api repos/.../branches/master/protection` returns 404 even though the branch is protected. Read it with `gh api repos/slickG0ose/storybook/rulesets`. It enforces: PR required, the four status checks above, no force-push, no deletion, Copilot review on push, and CodeQL gating at `errors` / `high_or_higher`.

One thing it deliberately does **not** enforce: **approving reviews** (`required_approving_review_count: 0`). GitHub forbids approving your own PR, so on a solo repo any non-zero value deadlocks every merge. Copilot review is the practical substitute.

**Drift watch (re-audited 2026-09-02, [#36](https://github.com/slickG0ose/storybook/issues/36)):** both claims below are still live, and the window has widened.

- **Copilot review is configured but not firing.** The ruleset carries `copilot_code_review` with `review_on_push: true`, yet no PR since #65 (2026-06-11) has drawn one — every PR from #66 through #177 merged with zero reviews. The stated substitute for approvals is not operating, so `required_approving_review_count: 0` currently means *no review gate at all*. This is a delivery failure, not a config gap: flipping settings will not fix it.
- **`allowed_merge_methods` is still `["merge", "squash", "rebase"]`.** Squash-only remains convention here, not enforcement, though nothing has landed as a merge commit since #54.

Correcting an earlier note: **reading the ruleset does not need admin.** `gh api repos/slickG0ose/storybook/rulesets` and `.../rulesets/16755005` both return in full with an ordinary token — only *writing* it does. Re-audit freely; the write is the part that waits on the owner.

Server deploy is Render, auto-deploying on push to `master` via `render.yaml`. Client CORS is locked to `CORS_ORIGIN` (set in the Blueprint); unset in production means every origin is allowed plus a startup warning. See [docs/deploy-spike-render.md](docs/deploy-spike-render.md).

## Spend gates

AI calls cost real money, so every paid operation is metered and capped. Code lives in [server/src/services/spend.ts](server/src/services/spend.ts); the Express middleware is [server/src/middleware/spendGate.ts](server/src/middleware/spendGate.ts) (`spendGate(kind)`, mounted per route).

- **Per-call cost** is a fixed table, not a measured value: `COST_CENTS = { story: 6, illustration: 4, cover: 4 }`. Update it when model pricing moves — a stale figure makes the caps silently wrong.
- **Two windows, both UTC:** a per-user daily cap and a global monthly ceiling.
- `checkQuota()` decides; `recordUsage()` writes the `UsageLog` row. A route must call both — gating without recording lets spend run away.

| Env var | Default | Meaning |
|---------|---------|---------|
| `QUOTA_DAILY_PER_USER_CENTS` | `50` | Per-user, per-UTC-day ceiling |
| `QUOTA_MONTHLY_GLOBAL_CENTS` | `2000` | Global, per-UTC-month ceiling |
| `QUOTA_ADMIN_BYPASS` | `true` | Admins may exceed the **daily** cap. Never applies to the monthly ceiling — nobody bypasses that. |

A malformed limit falls back to the default rather than to `Infinity`, so a typo can't disable the gate.

## Registration allowlist and admin bootstrap

Two independent env vars, both read at server start, and it is worth keeping them straight: `ALLOWLIST_BOOTSTRAP_EMAILS` decides **who may create an account**, `ADMIN_BOOTSTRAP_EMAILS` decides **which existing accounts hold `role: 'admin'`**. Being promotable does not imply being allowed to register — a listed admin still needs an allowlist entry to sign up in the first place.

### Registration allowlist

Registration is **closed by default**. An address must be on the `AllowedEmail` table before `POST /api/auth/register` will accept it. Code: [server/src/services/allowlist.ts](server/src/services/allowlist.ts).

- Admin endpoints in [server/src/routes/admin.ts](server/src/routes/admin.ts): `GET /api/admin/allowlist`, `POST /api/admin/allowlist`, `DELETE /api/admin/allowlist/:email`.
- `bootstrapAllowlist()` runs once at server start and seeds from `ALLOWLIST_BOOTSTRAP_EMAILS` (comma-separated) **only while the table is empty**, so a fresh deploy isn't locked out of its own signup. It no-ops afterwards, and a failure is logged rather than fatal. Practical consequence: seed **every** address you want in that first window — once one row exists the var is inert forever, and later additions go through the admin UI.
- `AllowedEmail.email` is normalised (trim + lowercase) on both write and check, so casing can't create an allowlist bypass.

### Admin bootstrap

`ADMIN_BOOTSTRAP_EMAILS` (comma-separated) is the source of truth for who is an admin. Code: [server/src/services/adminBootstrap.ts](server/src/services/adminBootstrap.ts).

- **Reconciled on every boot, not seeded once.** `bootstrapAllowlist()`'s empty-table guard is unavailable here — the `User` table is never empty once anyone registers. So removing an address **demotes** that admin on the next restart, and an admin promoted by hand (psql, or a local `demo-seed.ts` run) is demoted too. That is the point: revoking admin is an env edit, never a code deploy.
- **Three guards against a fat-fingered edit:** unset or blank is a total no-op; set-but-unparseable (`,,`) is a total no-op plus a warning; demotion writes `role: 'user'` and nothing else — account, books, orders, and token survive.
- Because those guards make "clear the var" inert, reaching **zero admins** takes the literal value `ADMIN_BOOTSTRAP_EMAILS=none`. That is the lever for going live with no standing admin access.
- It **never creates a user** and never holds a password. Order of operations: allowlist the address → they register normally → restart promotes them.
- Leave it **unset** in local `.env`, so the `demo@storybook.local` admin from `db:seed-demo` survives.

### `User.email` normalisation

Normalised (trim + lowercase) on write in `/register` and on lookup in `/register` and `/login`. `backfillUserEmails()` ([server/src/services/emailBackfill.ts](server/src/services/emailBackfill.ts)) lowercases legacy rows at boot, electing one row per collision group — live beats tombstone, older `created_at` breaks a tie — and reports the rest rather than merging or deleting.

`User.email` is `@unique`, but string equality is **case-sensitive** in both Postgres and SQLite, so that index alone does not stop `Nick@G.com` and `nick@g.com` from coexisting. Closing that at the database level needs a case-insensitive index (`citext` or `lower(email)`), which is Postgres-only and unrunnable while a collision exists — tracked as a follow-up, not done here.

**Tests must opt an address in explicitly** via the `allowEmail()` helper in `server/src/__tests__/setup.ts`. That is deliberately not a bypass flag — a test that forgets it fails exactly the way a real un-allowlisted signup does.

## How work flows (hybrid harness)

Non-trivial work flows through a three-role chain: design → execute → review before anything merges.

| Role | Dispatched via | Produces |
|------|----------------|----------|
| **architect** | `@architect` Agent call (re-dispatch to revise) | `.code-captain/specs/<slug>/spec.md` **and** `tasks.md` (3–12 ordered tasks) |
| **developer** | `/execute-task <slug> <task>` (preferred) or direct `@developer` Agent call | Code changes, tests run, `Status: Done` marker per task |
| **reviewer** | Dispatched automatically by `/ship` (read-only, pre-merge gate) | Findings report — never fixes |

The chain is enforced mechanically: `/execute-task` refuses to run without an approved `tasks.md`. Skipping the spec to "just dispatch the developer with a prompt" sidesteps the discipline this exists to enforce.

The architect owns both design and decomposition — they draw on the same context, so splitting them across two dispatches only re-derived it. The reviewer stays a separate role on purpose: independent review works because the reviewer didn't write the code.

### Size gate — when the chain is required

You **must** route through the architect → developer chain when **any** of these are true:

- **>3 files** likely to change (envelope estimate, not exact)
- **Data shape change** — Prisma schema, Zod wire shapes in `@storybook/shared`, seed data shape
- **New dependency** — any new entry in any `package.json`
- **Touches a guardrail** (see Guardrails section below)

You **may bypass** the chain for:

- **1–2 file edits** in a single zone → edit inline in main session
- **Trivial cross-zone change** (rename, move, single import update) → edit inline
- **Single-task feature, single zone, no schema/deps** → dispatch `@developer` directly with a freehand prompt; skip the spec

When in doubt, lean toward the chain. The overhead is one architect dispatch, and the audit trail is preserved.

### Reviewer agent and mechanical-check skills

The reviewer runs six checks on every `/ship`. Two of them invoke project-local skills:

- **Check 3 — dark-mode parity** → `dark-mode-parity-check` skill (greps added classNames for missing `dark:` partners)
- **Check 4 — wire-shape assertion** → `wire-shape-check` skill (verifies every server route response field is pinned by `toMatchObject` in its test)
- **Check 6 — surfaced-gaps follow-through (ADR-item slice)** → `adr-tracking-check` skill (verifies every ADR-worthy item in `spec.md`/`tasks.md` has one tracking action — ADR, linked issue, or `Deferred:` line)

The reviewer is read-only. Findings come back as a report; the user (or a follow-up developer dispatch) addresses them. Surfaced-gaps follow-through (Check 6) ensures developer-hand-back "Surprises" don't get orphaned.

### Retired agents

The **storefront** and **booksmith** zone-specialists were retired in #55 — the full-stack `@developer` replaces both, reading `docs/conventions/{server,client}.md` on demand.

**planner** and **qa** were retired in the 2026-08 harness simplification. The architect absorbed task decomposition; the developer absorbed Playwright e2e specs and test infrastructure (conventions in `docs/conventions/testing.md`).

**ALWAYS record plan/spec link + agent ownership in the PR body** — `/ship` drafts this from the work you actually did, so the audit trail stays visible.

## Done criteria

NEVER claim a feature complete until ALL of:
1. Relevant tests MUST pass (server + client + e2e if a user-facing flow changed)
2. UI changes MUST be manually verified in browser in **both** light and dark mode
3. NO TypeScript errors
4. If `data.json` shape changed, seed MUST load cleanly

**Criterion #2, mechanical discharge (ADR-009).** A Playwright spec that runs the flow in **both themes** at a mobile viewport, asserting no horizontal overflow and minimum tap-target sizes (`forEachTheme` / `expectNoHorizontalOverflow` / `expectTapTargets` in `e2e/tests/mobile/_helpers.ts`), satisfies the **correctness** half of #2. The **aesthetic** half — "does it look right" — still needs a human, and a spec should say which half it is claiming.

## Guardrails (cross-cutting)

**ALWAYS confirm with user before:**
- Deleting or replacing `data.json` (NEVER `rm` — use `resetStore()` for tests)
- Changing seed data shape (breaks existing carts/orders)
- Swapping the Claude model or upgrading SDK major versions
- Adding new paid external APIs (image generation, payments)
- Adding auth or session changes (UUID session model is load-bearing)
- Deleting tests rather than fixing them

**Safe without asking:**
- UI tweaks, new components, additive routes, new tests
- Refactoring within a single file
- Dependencies that fit existing stack

## Pointers

- **Backlog (active):** https://github.com/slickG0ose/storybook/issues — grouped by milestone
- **Backlog (archive):** `docs/backlog.md` — pre-migration, preserved for OPS conventions
- **Research:** `docs/marketing-research.md`, `docs/print-publishing-research.md`
- **Conventions:** `docs/conventions/{server,client,testing,data}.md` — stack details, patterns, when-adding-a-new-X recipes; **`docs/conventions/call-graph.md`** — cross-zone call graph (client→route, route→service, shared-schema fan-out) and the greps that regenerate it; **`docs/conventions/harness-resolution.md`** — auto-generated snapshot of how every `.claude/` item resolves
- **Active agents:** `.claude/agents/{architect,developer,reviewer}.md`
- **Commands:** `.claude/commands/{start-task,execute-task,ship,create-adr}.md`
- **Mechanical-check skills:** `.claude/skills/{wire-shape-check,dark-mode-parity-check,adr-tracking-check}/SKILL.md`
- **Codebase map:** `AGENTS.md` (entry point), `.code-captain/docs/{toc,architecture,tech-stack,code-style,objective}.md` (deep reference)
