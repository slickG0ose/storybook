# CLAUDE.md

Guidance for Claude Code sessions working in StoryBook Storefront.

## Project

AI-powered children's book store. React + Express + Claude API. Working storefront with creation workflow being built out. Demo-grade product concept.

**Current focus:** see [GitHub Issues](https://github.com/slickG0ose/storybook/issues), grouped by milestone (Foundation, Harness Rebuild, Tier 2 Storefront, Illustration v2, Mobile + Series, Print/Subscription). The pre-migration backlog at [docs/backlog.md](docs/backlog.md) is preserved as a read-only archive of completed-work conventions (OPS.1–3) — do not add new items there.

## Layout

| Directory | Stack | Owner agent | Zone rules |
|-----------|-------|-------------|------------|
| `client/` | React 19, Vite 8, Tailwind 4, TS | @storefront | `.claude/agents/storefront.md` |
| `server/` | Express 4, TS, Anthropic SDK | @booksmith | `.claude/agents/booksmith.md` |
| `e2e/` | Playwright 1.52, TS | @qa | `.claude/agents/qa.md` |
| `docs/` | Backlog, research notes | — | — |

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

## Local dev.db — preserving your books across iteration

The seed files are upsert-only — `npm run db:seed` and `npm run db:seed-demo` never delete anything you created. Your locally-generated books survive both. `db:reset` is the only destructive op (drops the DB, re-runs migrations), and it does **not** auto-run any seed.

`npm run db:hydrate` chains `db:seed && db:seed-demo` — use it after pulling a branch that ships new fixtures, or as `db:reset && npm run db:hydrate` for the full nuke-and-pave flow.

**Auto-snapshot on startup.** `server/src/db/snapshot.ts` copies `dev.db` to `server/.backups/dev-{timestamp}.db` every time `npm run dev` boots. Old backups self-prune after 7 days. So you usually already have a recent backup without doing anything.

**Manual backup before risky ops** (planned `db:reset`, migration testing, etc.):

```bash
cp server/prisma/dev.db server/prisma/dev.db.local-backup
```

`*.db` is gitignored at the root, so any naming works (`.bak`, `.local-backup`, etc.).

**Restore.** Stop the dev server first, then reverse the cp:

```bash
cp server/prisma/dev.db.local-backup server/prisma/dev.db
```

**Schema-drift rule of thumb.** A `cp` restore is safe iff no new folder appeared in `server/prisma/migrations/` since the backup was taken. If the migrations directory changed, `db:reset && npm run db:hydrate` from a clean state — your old book rows won't have the new columns.

## Testing

```bash
cd server && npm test                # Vitest + Supertest (33 tests)
cd client && npm test                # Vitest + RTL (19 tests)
cd e2e && npm test                   # Playwright (20 tests)
cd e2e && npm run test:headed
cd e2e && npm run test:ui
```

## Delegation rules (opinionated)

For any non-trivial change in a zone, you MUST delegate to the owning agent via the Agent tool rather than editing directly:

- `client/**` → **@storefront**
- `server/**` → **@booksmith**
- Tests in any zone → **@qa**

When work spans multiple zones, you MUST issue parallel Agent calls in a single message — do NOT do zone work serially in the main session. The main session's job is to orchestrate: read for context, plan, dispatch in parallel, then verify.

**Exceptions** (safe to do inline in main):
- 1-line fixes
- Pure orchestration (Reads, Glob, Grep, git inspection)
- Renames or moves that mechanically span zones

**ALWAYS record delegations in the PR body** so the audit trail is visible. `/ship` drafts this from the work you actually did.

**Zone-specific conventions, stack details, and patterns live in each agent's `.md` file** — not duplicated here.

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
- **Agent definitions:** `.claude/agents/{storefront,booksmith,qa}.md`
- **Codebase map:** `AGENTS.md` (entry point), `.code-captain/docs/{toc,architecture,tech-stack,code-style,objective}.md` (deep reference)
