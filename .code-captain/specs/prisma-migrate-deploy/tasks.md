# Production schema changes via `prisma migrate deploy` (ADR-028): task plan

> Spec: [spec.md](spec.md)
> Status: Approved (orchestrator, 2026-10-31, under Nick's standing delegation to rule on defaults)
> Last updated: 2026-10-31

## Overview

There are eight tasks. Tasks 1–4 build the Postgres history and its DB-less guard, all in the server zone and strictly sequential. Task 5 switches `render.yaml`. Task 6 is the orchestrator's Neon-branch proof of a script-made second migration. Task 7 finalizes the docs and the reviewer rule once that proof is in. Task 8 closes the ADR items. Tasks 5 and 6 can run in parallel. Run only one server-zone agent at a time, because the server suites share `test.db`.

## Cross-cutting constraints

- **Never run `prisma generate --schema=prisma/postgres/schema.prisma` (or the old path) locally.** It overwrites the SQLite client in `node_modules` and breaks the server suite. `prisma migrate diff` and `prisma validate --schema=…` are safe. To recover, run `cd server && npx prisma generate`.
- **Never hand-edit `server/prisma/postgres/schema.prisma`.** Regenerate it with `npm run db:gen-postgres-schema`.
- **Never edit a committed migration in either history.** Once Nick baselines prod, the checksum of `0_init/migration.sql` is recorded there.
- **Never point any Prisma command at Neon `production`.** The baseline is Nick's step from the runbook.
- **Spawn Prisma with `DATABASE_URL` deleted from the child env** (in tests and in the script). Unset is the verified case. Vitest sets a `file:` URL, which is not verified under a `postgresql` provider.
- **render.yaml:** edit only `buildCommand` and its "Build notes" comment block. Do not edit envVars or the `DATABASE_URL` comment, because a parallel session owns that area.
- **Do not edit** `.code-captain/product/decisions.md` or historical `.code-captain/specs/*`.
- **Wire-shape / auth middleware / dark mode / spend gates:** not touched.
- **Guardrails touched:** this changes production deploy behavior. The PR body must say "Do not merge until Nick has run the runbook baseline", and must link the runbook section.
- **Out of scope:** e2e (do not run it), `.github/workflows/*`, seed, moving dev/test to Postgres.
- **Verification for every developer task:** `cd server && npm test`, then `cd server && npx tsc --noEmit`. The second matches the CI Server job.

## Tasks

### Task 1: Move the generated Postgres schema to `server/prisma/postgres/schema.prisma`

**Zone:** server
**Depends on:** none
**Parallel-safe with:** none

**Status:** Done (2026-10-31)

**Files to add or change:**
- `server/prisma/schema.postgresql.prisma` → `server/prisma/postgres/schema.prisma`: use `git mv` so history follows, then regenerate
- `server/prisma/gen-postgres-schema.mjs`: target `join(here, 'postgres', 'schema.prisma')`, and `mkdir -p` the target's parent. Line 1's comment names the new path. `HEADER` does not mention the target path, so the generated file's content is byte-identical after the move
- `server/prisma/gen-postgres-schema.d.mts`: declare the new export
- `server/src/__tests__/postgresSchema.test.ts`: read from `postgres/schema.prisma`; update the `it` title, the failure message, and the docblock ("what Render's `migrate deploy` applies")

**Signatures / shapes:**
```js
// gen-postgres-schema.mjs
export const POSTGRES_SCHEMA_PATH; // absolute path to server/prisma/postgres/schema.prisma
export function writePostgresSchema(): Promise<string>; // regenerate from schema.prisma, write, return path
```
The CLI entry point calls `writePostgresSchema()`. Task 3's script reuses it.

**Tests to write:**
- None new. The existing drift test must pass at the new path.
- Wire-shape assertion required: no

**Done when:**
- `npm run db:gen-postgres-schema` leaves `git status` clean after the move. That proves the output is byte-identical.
- `server/prisma/schema.postgresql.prisma` no longer exists.
- `npx prisma validate --schema=prisma/postgres/schema.prisma` passes.
- `npm test` and `npx tsc --noEmit` are green.

---

### Task 2: Create the Postgres migration history with `0_init`

**Zone:** server
**Depends on:** 1
**Parallel-safe with:** none

**Files to add or change:**
- `server/prisma/postgres/migrations/migration_lock.toml`: same three-line format as the SQLite lock, with `provider = "postgresql"`
- `server/prisma/postgres/migrations/0_init/migration.sql`: generated, never hand-edited:
  ```bash
  cd server && npx prisma migrate diff --from-empty \
    --to-schema-datamodel prisma/postgres/schema.prisma \
    --script --output prisma/postgres/migrations/0_init/migration.sql
  ```
- `server/prisma/postgres/migrations/0_init/schema.prisma`: byte copy of `prisma/postgres/schema.prisma` (`cp`). This is the snapshot.

**Tests to write:** none in this task. Task 4 pins these files.

**Done when:**
- `grep -F 'CREATE EXTENSION IF NOT EXISTS "citext"' server/prisma/postgres/migrations/0_init/migration.sql` matches.
- `grep -F '"email" CITEXT' server/prisma/postgres/migrations/0_init/migration.sql` matches.
- `cmp server/prisma/postgres/schema.prisma server/prisma/postgres/migrations/0_init/schema.prisma` reports no difference.
- `server/prisma/migrations/` (SQLite) is untouched, and its lock still says `sqlite`.
- `npm test` is green.

---

### Task 3: Add the `db:migrate:postgres` script

**Zone:** server
**Depends on:** 2
**Parallel-safe with:** none

**Files to add or change:**
- `server/prisma/postgres-migrations.mjs`: helpers plus the CLI (guarded the same way as the generator's `import.meta.url === pathToFileURL(argv[1])`)
- `server/prisma/postgres-migrations.d.mts`: declarations for the exports below
- `server/package.json`: add `"db:migrate:postgres": "node prisma/postgres-migrations.mjs"`

**Signatures / shapes:**
```ts
export const POSTGRES_MIGRATIONS_DIR: string;          // server/prisma/postgres/migrations
export function snapshotPathFor(migrationDir: string): string; // join(dir, 'schema.prisma'). The ONLY place that knows the snapshot location (fallback = change this line)
export function listMigrations(migrationsDir?: string): string[]; // subdirectory names, sorted with plain string compare (Prisma's order); files excluded
export function latestMigrationDir(migrationsDir?: string): string; // absolute path; throws if none
export function migrationFolderName(name: string, now?: Date): string; // `${YYYYMMDDHHMMSS UTC}_${name}`; throws unless /^[a-z0-9_]+$/
export function prismaEnv(): NodeJS.ProcessEnv;  // { ...process.env } with DATABASE_URL deleted
export function diffExitCode(fromSchema: string, toSchema: string): { status: number; stderr: string };
  // spawnSync('npx', ['prisma','migrate','diff','--from-schema-datamodel',from,'--to-schema-datamodel',to,'--exit-code'], { cwd: serverDir, env: prismaEnv() })
export function createMigration(opts: {
  name: string; migrationsDir?: string; schemaPath?: string; now?: Date;
}): { created: false; reason: string } | { created: true; dir: string; destructive: string[] };
```

**CLI behavior:**
1. Accept `<name>` or `--name <name>`. Print usage and exit 1 if it is missing or invalid.
2. Call `writePostgresSchema()` from Task 1.
3. Run `diffExitCode(snapshotPathFor(latestMigrationDir()), POSTGRES_SCHEMA_PATH)`.
4. On exit **0**, print "No Postgres schema change since `<latest>`; no migration created.", exit 1, and create nothing.
5. On anything other than **2**, print stderr and exit 1.
6. On exit **2**, create the folder and run `migrate diff --from-schema-datamodel <snapshot> --to-schema-datamodel <schema> --script --output <dir>/migration.sql`. Copy the schema to `<dir>/schema.prisma`.
7. Print the path. Print a warning listing any lines that match `/\bDROP\b|ALTER COLUMN .* TYPE/i` ("review for data loss").

If step 6 fails, remove the half-made folder. Use no new dependencies, only `node:` builtins.

**Tests to write:** in Task 4.

**Manual verify:**
- `cd server && npm run db:migrate:postgres -- nothing` exits non-zero with the "no change" message. `git status` stays clean.

**Done when:** the manual verify behaves as described, and `npm test` and `npx tsc --noEmit` are green.

---

### Task 4: Add a DB-less drift guard (`postgresMigrations.test.ts`)

**Zone:** server
**Depends on:** 3
**Parallel-safe with:** none

**Files to add or change:**
- `server/src/__tests__/postgresMigrations.test.ts`: new

**Tests to write:** set a per-test timeout of 30000 on the tests that spawn Prisma.
- **Guard:** `diffExitCode(snapshotPathFor(latestMigrationDir()), POSTGRES_SCHEMA_PATH).status` is `0`. Check it with a boolean `expect(…, msg)` first, as `postgresSchema.test.ts` does. On 2 the message is: "Postgres schema changed without a Postgres migration. Run `cd server && npm run db:migrate:postgres -- <name>` and commit the new folder." On any other status, the message includes stderr.
- **Layout:** every folder under `postgres/migrations/` has both `migration.sql` and `schema.prisma`. The lock file contains `provider = "postgresql"`. The first folder is `0_init`.
- **No sharing:** `server/prisma/migrations/migration_lock.toml` still says `provider = "sqlite"` and has no `0_init` folder. `server/prisma/schema.postgresql.prisma` does not exist.
- **citext in 0_init:** `migration.sql` contains `CREATE EXTENSION IF NOT EXISTS "citext"` and `"email" CITEXT`.
- **Pure helpers:** `migrationFolderName('add_x', new Date(Date.UTC(2026,9,31,1,2,3)))` returns `'20261031010203_add_x'`. Invalid names (`''`, `'Add-X'`, `'../x'`) throw. `listMigrations` sorts `0_init` first.
- **createMigration, in a temp dir** (`mkdtemp` under `os.tmpdir()`; copy `0_init` into it):
  - With the unchanged schema it returns `created: false` and adds no new folder.
  - With a temp copy of the schema that has one extra nullable field on `model Book`, it returns `created: true`. The folder contains a `migration.sql` with `ALTER TABLE "Book" ADD COLUMN`, and a `schema.prisma` equal to the temp schema.
  - Never write inside `server/prisma/postgres/`.
- Wire-shape assertion required: no

**Acceptance demonstration (do it, record it in the hand-back, then revert):**
1. Add `demoField String?` to `model Book` in `server/prisma/schema.prisma`, then run `npm run db:gen-postgres-schema`. Running `npx vitest run src/__tests__/postgresMigrations.test.ts` **fails** with the fix-command message.
2. Run `npm run db:migrate:postgres -- demo`. The same test passes.
3. Revert with `git checkout -- prisma/schema.prisma prisma/postgres/schema.prisma` and remove the `*_demo` folder. Confirm `git status` is clean apart from this task's file.

Do **not** run `db:migrate` (SQLite) for the demo. `postgresSchema.test.ts` ignores whether a SQLite migration exists.

**Done when:** the demonstration is recorded, and `npm test` and `npx tsc --noEmit` are green.

---

### Task 5: Switch `render.yaml` to `migrate deploy`

**Zone:** multi-zone (deploy config)
**Depends on:** 2
**Parallel-safe with:** 3, 4, 6

**Files to add or change:**
- `render.yaml`: replace line 48 with
  ```
      cd server && npx prisma generate --schema=prisma/postgres/schema.prisma && npx prisma migrate deploy --schema=prisma/postgres/schema.prisma && npx tsx prisma/seed.ts
  ```
  In the "Build notes" block above `buildCommand`, add one bullet. It should say that the schema step is `prisma migrate deploy` over `server/prisma/postgres/migrations/` (ADR-028). It never drops data on its own; destructive SQL only arrives as a reviewed migration. The bullet should also note that a non-baselined database fails the build with P3005 and Render keeps the previous deploy, with a pointer to `docs/neon-migration-runbook.md`. Keep the "&& on a single logical line" bullet.

**Done when:**
- `grep -n "db push\|accept-data-loss" render.yaml` matches only the `DATABASE_URL` envVar comment, which is a known follow-up.
- `git diff render.yaml` touches nothing at or below `envVars:`.

---

### Task 6: Neon-branch proof of a script-made second migration

**Owner:** orchestrator (Neon MCP), not the developer
**Zone:** ops (no committed files)
**Depends on:** 3, 4
**Parallel-safe with:** 5

These are already proven, so do not repeat them: `0_init` contents, extra-file tolerance, baseline steps (a)–(c), and P3005 before the baseline.

1. Create a throwaway branch off `production` in project `winter-hall-49187726`, and use its **direct** connection string. Then baseline it: run `migrate resolve --applied 0_init --schema=prisma/postgres/schema.prisma`.
2. In the worktree, add `demoField String?` to `model Book` and run `npm run db:migrate:postgres -- demo`.
3. Run `migrate deploy --schema=prisma/postgres/schema.prisma` against the branch. It should apply `<ts>_demo`.
4. Run `migrate status`. It should report "Database schema is up to date".
5. Run the old buildCommand's `db push --schema=prisma/postgres/schema.prisma --skip-generate --accept-data-loss` against the branch. Confirm `_prisma_migrations` still exists with its rows. This covers the window between baseline and merge, and the rollback-by-revert path.
6. Delete the branch. Revert the worktree with `git checkout -- server/prisma/schema.prisma server/prisma/postgres/schema.prisma` and remove the `*_demo` folder. `git status` is clean.

**Done when:** steps 3–5 behave as stated and the result is noted in the PR body. If step 5 drops `_prisma_migrations`, add a runbook warning in Task 7: "no deploys between baseline and merge; after a revert, re-baseline."

---

### Task 7: Docs and the reviewer rule

**Zone:** docs (+ harness)
**Depends on:** 4, 5, 6
**Parallel-safe with:** none

**Files to add or change:**
- `docs/neon-migration-runbook.md`:
  - **Add a new section before "Rollback":** "Baseline prod for migrate deploy (once, BEFORE merging the ADR-028 PR)". Run it from `server/` on the PR branch, with `DATABASE_URL` set to the Neon **direct** `production` string:
    - (a) `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/postgres/schema.prisma --script` must print only `-- This is an empty migration.`
    - (b) `npx prisma migrate resolve --applied 0_init --schema=prisma/postgres/schema.prisma`
    - (c) `npx prisma migrate deploy --schema=prisma/postgres/schema.prisma` prints "No pending migrations to apply."
    - Then merge promptly, and watch the Render build log for the same line.
  - **Merge-order trap.** If the PR merges first, the first `migrate deploy` fails with P3005 and Render keeps serving the old deploy. That is safe, but it is blocked. Fix: run (a)–(c), then use Manual Deploy in Render.
  - **If (a) is not empty: stop. Do not run (b).** A non-empty diff means prod has drifted from the schema. Resolving would record SQL that never ran. Save the output, open an issue, and decide whether prod or the schema is right before baselining.
  - Edit "Why direct": say `migrate deploy`. Say `DIRECT_URL` would be injected by `gen-postgres-schema.mjs`, not hand-declared.
  - Edit Troubleshooting: change "`prisma db push` hangs" to "`prisma migrate deploy` hangs". Add a row: P3005 → baseline not run.
  - Edit "What this leaves open": replace the first bullet with a pointer to the new section.
- `docs/conventions/data.md` §"Postgres-only schema edits" and line 118:
  - Use the new path.
  - Add the four-step workflow: edit `schema.prisma` → `npm run db:migrate -- --name x` → `npm run db:migrate:postgres -- x` → commit both.
  - Explain that `postgresMigrations.test.ts` fails without the second step.
  - Say the prod deploy runs `migrate deploy`.
  - Extend "never edit a committed migration" to `postgres/migrations/`.
- `docs/deploy-spike-render.md`:
  - Line 19: use the new path.
  - Lines 151–158: state that this is resolved by ADR-028 and point to the runbook section. Remove the stale `migrate dev --schema=…postgresql` instructions.
  - Line 226: tick the box.
- `AGENTS.md:23`: change `schema.postgresql.prisma` to `postgres/{schema.prisma,migrations/}`.
- `server/.env.example:9`: use the new path.
- `.claude/agents/reviewer.md`, Check 5 table: add a row. Pattern: "diff touches `server/prisma/schema.prisma` but adds no folder under `server/prisma/postgres/migrations/`". Guardrail: "Missing Postgres migration (ADR-028). Prod's `migrate deploy` will not apply the change, and `postgresMigrations.test.ts` should already be red." Mark it as **blocking regardless of approval markers**, and add one sentence under the table that says so. Do not touch the frontmatter.

**Done when:**
- `grep -rn "schema.postgresql" --exclude-dir=node_modules --exclude-dir=.git . | grep -v "^./.code-captain/"` returns nothing.
- `npm test` at the repo root (harness suite) is green. Its resolution snapshot must not change, because frontmatter is untouched.

---

### Task 8: Pre-merge follow-ups

**Zone:** docs (harness)
**Depends on:** none (run last)

For each ADR-worthy item in spec.md, make sure exactly one tracking action exists:
- **Layout + per-migration snapshot check:** add a `Deferred:` line to the spec item. Reasoning: this is the implementation choice ADR-028 §2 explicitly delegated to the architect. It is recorded in this spec, and a separate ADR would duplicate it.
- **ADR-028 "#174" rationale void:** tracked by ADR-029 (its Consequences bullet "Voids one of ADR-028's reasons"). No action needed beyond confirming the match.

**Done when:** `adr-tracking-check prisma-migrate-deploy` reports zero orphaned items.

## Sequencing notes

- Commit boundaries: Tasks 1–4 can go in one commit or one per task. Task 5 is its own commit, so `render.yaml` is easy to revert alone. Task 7 is one docs commit.
- **The PR must not merge until Nick runs the runbook baseline.** Put that line at the top of the PR body. Task 6 does not replace it; Task 6 runs on a throwaway branch.
- If CI wobbles because `npx prisma` downloads the schema engine, it would show up in Task 4. The engine is already installed by `npm ci` in the Server job, so this is not expected.

## Open questions

- None blocking. Task 6 step 5 is the only result that could change the docs; Task 7 already handles that branch.
