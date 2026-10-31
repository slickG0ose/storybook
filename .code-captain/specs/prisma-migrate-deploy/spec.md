# Production schema changes via `prisma migrate deploy` (ADR-028)

> Status: Approved (orchestrator, 2026-10-31, under Nick's standing delegation to rule on defaults)
> Last updated: 2026-10-31
> Backlog: [#157 — invite alpha testers](https://github.com/slickG0ose/storybook/issues/157) (ADR-028 blocks it); plan: `docs/mvp-alpha-plan.md` item 4
> Implements: ADR-028 in `.code-captain/product/decisions.md` — treated as **Accepted** (Nick, 2026-10-31; the status flip lives in a separate unmerged PR, so this branch does not edit `decisions.md`)

## Problem

Every push to `master` runs `prisma db push --accept-data-loss` against production (`render.yaml:48`). Neon now holds real rows (2 users, 7 books), and the alpha will add testers' books. A column rename or a narrowed type in `schema.prisma` would silently delete data on the next deploy, with no reviewable SQL and no history. ADR-028 replaces the push with `prisma migrate deploy` over a Postgres-only migration history, baselined once against Neon.

**One of ADR-028's three reasons no longer holds.** The "#174 needs it" bullet is void: ADR-029 delivered the case-insensitive email through the schema generator (`User.email @db.Citext`), which `db push` already applies. The data-loss reason and the reviewable-SQL reason stand on their own. The ADR is not edited here; ADR-029's Consequences already records the voided bullet.

## Constraints

- **Two histories, never one folder.** `server/prisma/migrations/` is SQLite SQL with `migration_lock.toml` pinned to `provider = "sqlite"`. In Prisma 6.19.3 (no `prisma.config.ts`), the migrations directory is `migrations/` next to the schema file passed via `--schema`. Both schemas currently sit in `server/prisma/`, so they resolve to the same folder. Sharing is forbidden (ADR-028 §2).
- **The Postgres schema is generated.** `server/prisma/gen-postgres-schema.mjs` derives it from `schema.prisma` via exactly-once needle replacements (ADR-029). `server/src/__tests__/postgresSchema.test.ts` pins the generator output against the committed file. Both must keep working at the new path.
- **CI has no Postgres.** The Server tests job runs SQLite only. Any mechanical check must be DB-less. `migrate diff --from-migrations` needs a shadow database, so it is out.
- **The baseline is Nick's.** `migrate resolve --applied 0_init` against `production` is an operator step from the runbook. Agents never run it against `production` (ADR-028 Consequences).
- **Never run `prisma generate --schema=<postgres schema>` locally.** It overwrites the SQLite client in `node_modules` and breaks the server suite. `migrate diff` and `validate` are safe.
- **render.yaml is shared with a parallel session** (R2 env vars). This branch touches only the `buildCommand` and its "Build notes" comment block.
- **Never edit a committed migration.** Once `0_init` is baselined, its checksum is recorded in prod's `_prisma_migrations`. Editing it makes every later `migrate deploy` fail.

## Rulings (orchestrator, 2026-10-31)

Recorded as settled. Each was reviewed against the code. No technical objection was found.

1. **Layout.** The generated Postgres schema moves to `server/prisma/postgres/schema.prisma`. Its history lives in `server/prisma/postgres/migrations/`, with `migration_lock.toml` set to `provider = "postgresql"`. The first migration is `0_init/migration.sql`. No `prisma.config.ts`, because its `migrations.path` would also apply to SQLite commands. The generator stays at `server/prisma/gen-postgres-schema.mjs`; only its target changes. Every live reference gets updated. Historical specs under `.code-captain/specs/*` and `decisions.md` are not rewritten.
2. **`0_init`** = `prisma migrate diff --from-empty --to-schema-datamodel prisma/postgres/schema.prisma --script`. It must contain `CREATE EXTENSION IF NOT EXISTS "citext"` and a `CITEXT` email column. *Verified on a Neon branch:* the output contains `CREATE EXTENSION IF NOT EXISTS "citext";` and `"email" CITEXT NOT NULL`.
3. **The mechanical check is DB-less and uses a per-migration snapshot.** Each Postgres migration folder carries `schema.prisma`, a byte copy of `postgres/schema.prisma` as of that migration. A vitest test runs `prisma migrate diff --from-schema-datamodel <latest snapshot> --to-schema-datamodel prisma/postgres/schema.prisma --exit-code` and fails, quoting the fix command, unless the exit code is 0. *Verified on a Neon branch:* both `migrate resolve` and `migrate deploy` tolerate the extra file, and `migrate diff` between two datamodels works with `DATABASE_URL` unset. Settled details are under "Mechanical check" below.
4. **Script.** `npm run db:migrate:postgres -- <name>` creates the next Postgres migration plus its snapshot, and refuses to create an empty one. No new dependencies.
5. **Reviewer rule.** `.claude/agents/reviewer.md` Check 5 gains a row: a `server/prisma/schema.prisma` diff without a new `server/prisma/postgres/migrations/*/` folder is a blocking finding.
6. **Runbook.** `docs/neon-migration-runbook.md` gets a section titled "Baseline prod for migrate deploy (once, BEFORE merging the ADR-028 PR)", including the merge-order trap and a stop rule for a non-empty diff.
7. **render.yaml scope:** only `buildCommand` and its Build-notes comment. The `DATABASE_URL` envVar comment also mentions `db push`. It is a follow-up, not touched here.
8. **Neon-branch proof belongs to the orchestrator** (Neon MCP), not the developer. Items (a)–(c) and extra-file tolerance are already proven. What remains is applying a sample second migration made by the new script.
9. **Out of scope:** e2e (do not run it), CI workflow edits, moving local dev/test to Postgres, seed changes.

## Proposed shape

The Postgres schema becomes a self-contained Prisma project under `server/prisma/postgres/`. Prisma's default "migrations next to the schema" rule then separates the two histories with no config file. `render.yaml` swaps `db push --accept-data-loss` for `migrate deploy`. A schema change now produces two committed artifacts: a SQLite migration from `migrate dev`, and a Postgres migration from the new script. A server test makes the second one impossible to forget.

```
server/prisma/
  schema.prisma                       # SQLite source of truth (unchanged)
  migrations/                         # SQLite history (unchanged), lock = sqlite
  gen-postgres-schema.mjs             # target path changes
  postgres-migrations.mjs   (+ .d.mts) # NEW: helpers + `db:migrate:postgres` CLI
  postgres/
    schema.prisma                     # MOVED from ../schema.postgresql.prisma (generated)
    migrations/
      migration_lock.toml             # provider = "postgresql"
      0_init/
        migration.sql                 # migrate diff --from-empty
        schema.prisma                 # snapshot = postgres/schema.prisma at 0_init
      <YYYYMMDDHHMMSS>_<name>/        # future, created by the script
        migration.sql
        schema.prisma
```

### Mechanical check (settled design)

- **Snapshot location: inside each migration folder, named `schema.prisma`.** This is the filename verified on the Neon branch. Keeping the snapshot there means it cannot be bumped without adding a migration folder. Hand-editing an old snapshot is possible but obvious in a diff, and only the *latest* snapshot is read. Prisma sorts migration folders lexicographically, and `0_init` sorts before any `2026…` timestamp. The helper sorts the same way.
- **Fallback is one line.** `snapshotPathFor(migrationDir)` in `postgres-migrations.mjs` is the only place that knows where the snapshot lives. Switching to a single file such as `postgres/schema.snapshot.prisma` means changing that function. The fallback loses the "cannot bump without a migration" property. Note it if it is ever used.
- **Environment for the child process.** The `DATABASE_URL`-unset case is the one that was verified. Vitest sets `DATABASE_URL=file:./test.db`, and a `file:` URL under a `postgresql` provider is unverified. So the test and the script spawn Prisma with `DATABASE_URL` **deleted** from the child env. They do not set a dummy value. All other env (e.g. `NODE_TLS_REJECT_UNAUTHORIZED`) passes through.
- **Exit codes** (`--exit-code`): 0 = no difference → pass; 2 = difference → fail with "Postgres schema changed without a Postgres migration. Run `cd server && npm run db:migrate:postgres -- <name>` and commit the new folder."; anything else → fail and print Prisma's stderr.

### Schema / contract changes

- No Zod or wire-shape change. No route change. No change to the SQLite `schema.prisma`.
- The generated Postgres schema changes path only. Its content is byte-identical, because `HEADER` names the source, not the target.
- Postgres gets a `_prisma_migrations` table, created by Nick's baseline `migrate resolve`.

### Data flow

**Developer making a schema change (after this lands):**
1. Edit `server/prisma/schema.prisma`.
2. Run `npm run db:migrate -- --name add_x` to get the SQLite migration (`dev.db` and the client update).
3. Run `npm run db:migrate:postgres -- add_x`. This regenerates `postgres/schema.prisma`, diffs the latest snapshot against it, and writes `postgres/migrations/<ts>_add_x/{migration.sql,schema.prisma}`.
4. Review both SQL files and commit them together.

**Deploy:** Render runs `npm ci --include=dev`, then `prisma generate` against the Postgres schema, then `migrate deploy`, which applies pending folders and records them in `_prisma_migrations`. Then `seed.ts` runs.

### `render.yaml` buildCommand (exact)

```yaml
    buildCommand: |
      npm ci --include=dev
      cd server && npx prisma generate --schema=prisma/postgres/schema.prisma && npx prisma migrate deploy --schema=prisma/postgres/schema.prisma && npx tsx prisma/seed.ts
```

### Files likely touched

- `server/prisma/schema.postgresql.prisma` → `server/prisma/postgres/schema.prisma`: `git mv`, then regenerate
- `server/prisma/gen-postgres-schema.mjs`: new target path; export `POSTGRES_SCHEMA_PATH` and `writePostgresSchema()`
- `server/prisma/gen-postgres-schema.d.mts`: declare the new export
- `server/src/__tests__/postgresSchema.test.ts`: new path in the read and in messages
- `server/prisma/postgres/migrations/migration_lock.toml`: new, `provider = "postgresql"`
- `server/prisma/postgres/migrations/0_init/{migration.sql,schema.prisma}`: new
- `server/prisma/postgres-migrations.mjs` + `.d.mts`: new helpers and CLI
- `server/package.json`: add the `db:migrate:postgres` script
- `server/src/__tests__/postgresMigrations.test.ts`: new; the DB-less drift check plus script tests
- `render.yaml`: `buildCommand` and the Build-notes block only
- `docs/neon-migration-runbook.md`: baseline section; update the lines about "Why direct", Troubleshooting, and "What this leaves open"
- `docs/conventions/data.md` §"Postgres-only schema edits" (lines 93–97, 118): new path, and the two-migration workflow
- `docs/deploy-spike-render.md` lines 19, 151–158, 226: new path; mark the `db push` item resolved
- `AGENTS.md:23`, `server/.env.example:9`: new path
- `.claude/agents/reviewer.md` Check 5 table: a new row (body only; frontmatter untouched, so `harness-resolution.md` does not change)

## Alternatives considered

### `prisma.config.ts` with `migrations.path`

**Pros:** keeps the Postgres schema where it is.
**Cons:** the config applies to every Prisma CLI call in `server/`, including the SQLite `migrate dev` and `migrate deploy` that `globalSetup.ts` and CI run. Splitting it would need per-command config switching.
**Why rejected:** Ruling 1.

### Snapshot as a single file beside the schema (`postgres/schema.snapshot.prisma`)

**Pros:** simplest lookup.
**Cons:** it can be bumped without adding a migration, which silences the check with nothing applied.
**Why held as fallback:** it is a one-line switch in `snapshotPathFor` if a future Prisma version rejects extra files in migration folders.

### Check with `migrate diff --from-migrations … --shadow-database-url`

**Pros:** compares the actual SQL history, not a proxy.
**Cons:** needs a live Postgres in CI. Ruling 9 forbids CI workflow edits.
**Why rejected:** CI is DB-less. The snapshot is exact as long as each migration is generated by the script, which the reviewer rule backs.

### Keep `db push`, drop `--accept-data-loss`

Rejected in ADR-028 as an end state. It remains the same-day stopgap if this slips past the first tester invite.

## Success criteria

- `cd server && npm test` passes. This includes the new test in `server/src/__tests__/postgresMigrations.test.ts` and the moved drift test.
- `cd server && npx tsc --noEmit` is clean.
- `0_init/migration.sql` contains `CREATE EXTENSION IF NOT EXISTS "citext"` and `"email" CITEXT`.
- Demonstrated and then reverted: add a nullable field to `schema.prisma` and run `npm run db:gen-postgres-schema`. The migrations test fails and names the fix command. Running `npm run db:migrate:postgres -- demo` makes it pass.
- `npm run db:migrate:postgres -- x` with no schema change exits non-zero and creates no folder.
- On a Neon throwaway branch, the orchestrator applies a script-generated second migration with `migrate deploy`, and `migrate status` reports up to date.
- `render.yaml` `buildCommand` contains no `db push` and no `--accept-data-loss`.

## Out of scope

- Running e2e. CI workflow edits. Moving dev/test to Postgres. Seed changes.
- Running the baseline against `production`. That is Nick's step, from the runbook.
- `render.yaml` envVars, including the `DATABASE_URL` comment that mentions `db push`.
- Rewriting `decisions.md` or historical specs.

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| PR merged before the baseline: first `migrate deploy` fails P3005 | Render keeps the previous deploy (safe, but blocked). The runbook says to baseline first. If the order slips, run the baseline and then redeploy. The PR body must carry a "do not merge until baseline done" line. |
| Baseline over drift: `resolve --applied` marks SQL as applied when prod differs | Runbook step (a) must print an empty migration. Otherwise stop and do not resolve. |
| A deploy between baseline and merge (old `db push` buildCommand) touches `_prisma_migrations` | Expected safe: Prisma's differ ignores its own migrations table. The orchestrator confirms this on the throwaway branch (Task 6). The runbook says to baseline immediately before merging. |
| Rollback (revert the PR) restores `db push --accept-data-loss` | Same `_prisma_migrations` check as above. Reverting is lossless for schema. |
| `0_init` edited after the baseline: checksum mismatch | "Never edit a committed migration" is extended to `postgres/migrations/` in data.md. |
| Developer runs `prisma generate` against the Postgres schema locally and clobbers the SQLite client | This warning is repeated in tasks.md and data.md. Recovery: `cd server && npx prisma generate`. |
| A future migration contains destructive SQL | The script prints any `DROP` / `ALTER … TYPE` lines as a warning. Both SQL files get reviewed in the PR. |
| `migrate diff` spawn slows the server suite | One spawn for the drift check plus about two in the script tests, roughly 1–2 s each. Use a per-test timeout of 30 s. |
| Wire-shape / auth / dark-mode / paid API / spend | Not touched. |
| Guardrails | Touches the production schema-change mechanism (deploy behavior). No auth, session, seed-shape, or model change. Surface in the PR body. |

## Follow-ups (not in this PR)

- `render.yaml` `DATABASE_URL` envVar comment says the buildCommand "runs `prisma db push`". It should say `migrate deploy`. Left for after the parallel R2 session merges.
- `server/src/services/ageRangeBackfill.ts:14` says that `render.yaml` "deploys with `prisma db push`, never `migrate deploy`". That stops being true. Amend it to past tense; new row fixes may now use a data migration (ADR-028 Consequences).
- `docs/mvp-alpha-plan.md` lines 14 and 32: mark item 4 done once Nick has baselined and the PR has merged.

Deferred: `render.yaml` `DATABASE_URL` comment — the parallel R2 session owns `envVars`; fix it after that PR merges, to avoid a conflict.
Deferred: `docs/mvp-alpha-plan.md` item 4 — can only be ticked after Nick's baseline + merge, which this PR cannot observe.
Resolved in this PR: the `ageRangeBackfill.ts` comment (reviewer finding) is now past tense.

## ADR-worthy decisions

- [x] Postgres history layout (`prisma/postgres/` subdirectory, no `prisma.config.ts`) and the per-migration snapshot drift check. This is the "architect's call" ADR-028 §2 delegated. Recorded here, not as a new ADR.
  Deferred: no separate ADR — ADR-028 §2 delegated this choice to the architect; this spec (Rulings + Proposed shape) is its record. Revisit as an ADR only if the layout changes (e.g. a Prisma 7 `prisma.config.ts` move).
- [x] ADR-028's "#174 needs it" rationale is void (superseded by ADR-029). Already recorded in ADR-029 Consequences. No edit to ADR-028.
  Tracked by: ADR-029 Consequences in `.code-captain/product/decisions.md`.
