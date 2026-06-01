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

Stack details, patterns, and zone-specific conventions live in `docs/conventions/{server,client,testing,data}.md`. Agents read these on demand — they're the source of truth, not duplicated into agent prompts.

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
cd server && npm test                # Vitest + Supertest (33 tests)
cd client && npm test                # Vitest + RTL (19 tests)
cd e2e && npm test                   # Playwright (20 tests)
cd e2e && npm run test:headed
cd e2e && npm run test:ui
```

## How work flows (hybrid harness)

Non-trivial work flows through a four-role chain. Each role has one job; together they enforce spec → plan → execute → review before anything merges.

| Role | Dispatched via | Produces |
|------|----------------|----------|
| **architect** | `@architect` Agent call, or `/edit-spec` for revisions | `.code-captain/specs/<slug>/spec.md` |
| **planner** | `@planner` Agent call | `.code-captain/specs/<slug>/tasks.md` (3–12 ordered tasks) |
| **developer** | `/execute-task <slug> <task>` (preferred) or direct `@developer` Agent call | Code changes for one task, run tests, `Status: Done` marker |
| **reviewer** | Dispatched automatically by `/ship` (read-only, pre-merge gate) | Findings report — never fixes |

The chain is enforced mechanically: `/execute-task` refuses to run without an approved `tasks.md`. Skipping the spec or plan to "just dispatch the developer with a prompt" sidesteps the discipline this exists to enforce.

### Size gate — when the chain is required

You **must** route through the architect → planner → developer chain when **any** of these are true:

- **>3 files** likely to change (envelope estimate, not exact)
- **Data shape change** — Prisma schema, Zod wire shapes in `@storybook/shared`, seed data shape
- **New dependency** — any new entry in any `package.json`
- **Touches a guardrail** (see Guardrails section below)

You **may bypass** the chain for:

- **1–2 file edits** in a single zone → edit inline in main session
- **Trivial cross-zone change** (rename, move, single import update) → edit inline
- **Single-task feature, single zone, no schema/deps** → dispatch `@developer` directly with a freehand prompt; skip spec/plan

When in doubt, lean toward the chain. The overhead is small (one architect dispatch, one planner dispatch) and the audit trail is preserved.

### Reviewer agent and mechanical-check skills

The reviewer runs six checks on every `/ship`. Two of them invoke project-local skills:

- **Check 3 — dark-mode parity** → `dark-mode-parity-check` skill (greps added classNames for missing `dark:` partners)
- **Check 4 — wire-shape assertion** → `wire-shape-check` skill (verifies every server route response field is pinned by `toMatchObject` in its test)

The reviewer is read-only. Findings come back as a report; the user (or a follow-up developer dispatch) addresses them. Surfaced-gaps follow-through (Check 6) ensures developer-hand-back "Surprises" don't get orphaned.

### Legacy zone-owner agents

The **storefront** and **booksmith** zone-specialist agents have been retired — their definitions now live in `.claude/agents/_archive/` for one stability window before deletion. The full-stack `@developer` agent replaces both, reading `docs/conventions/{server,client}.md` on demand for zone-specific patterns.

`@qa` remains active. It owns net-new Playwright e2e specs and cross-zone test-infrastructure changes — work that doesn't fit `@developer`'s one-task-per-dispatch shape.

**ALWAYS record plan/spec link + agent ownership in the PR body** — `/ship` drafts this from the work you actually did, so the audit trail stays visible.

## Done criteria

NEVER claim a feature complete until ALL of:
1. Relevant tests MUST pass (server + client + e2e if a user-facing flow changed)
2. UI changes MUST be manually verified in browser in **both** light and dark mode
3. NO TypeScript errors
4. If `data.json` shape changed, seed MUST load cleanly

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
- **Conventions:** `docs/conventions/{server,client,testing,data}.md` — stack details, patterns, when-adding-a-new-X recipes; **`docs/conventions/harness-resolution.md`** — auto-generated snapshot of how every `.claude/` item resolves
- **Active agents:** `.claude/agents/{architect,planner,developer,reviewer,qa}.md` — chain + e2e specialist
- **Archived agents:** `.claude/agents/_archive/{booksmith,storefront}.md` — retained one stability window; see `.claude/agents/_archive/README.md`
- **Mechanical-check skills:** `.claude/skills/{wire-shape-check,dark-mode-parity-check}/SKILL.md`
- **Codebase map:** `AGENTS.md` (entry point), `.code-captain/docs/{toc,architecture,tech-stack,code-style,objective}.md` (deep reference)
