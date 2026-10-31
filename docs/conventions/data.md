# Data conventions

Database layer: Prisma over SQLite. Migrations, seeds, snapshots, restore. The developer agent (HR5) reads this when touching the data layer.

## The big picture

- **Schema:** `server/prisma/schema.prisma` is the source of truth.
- **Database file:** `server/prisma/dev.db` (SQLite, gitignored under `*.db`).
- **Migrations:** `server/prisma/migrations/<timestamp>_<name>/` — auto-generated, committed.
- **Seeds:**
  - `server/prisma/seed.ts` — canonical Prisma-based seed (6 books with pages).
  - `server/prisma/demo-seed.ts` — extra demo content layered on top.
- **Tests:** `server/test.db` (gitignored, recreated per test run via vitest globalSetup).
- **Snapshots:** `server/.backups/dev-<timestamp>.db` — auto-created on dev-server boot, 7-day retention.

## Preserving your locally-generated books

The seed files are **upsert-only**. `npm run db:seed` and `npm run db:seed-demo` never delete anything — they reach for known IDs and update-or-create. Your locally-generated books survive both.

`npm run db:reset` is the only destructive op: it drops the DB and re-runs migrations. It does **not** auto-run a seed; you need to chain it yourself.

```bash
cd server && npm run db:hydrate   # chains: db:seed && db:seed-demo
cd server && npm run db:reset     # drops + re-migrates (no seed)
cd server && npm run db:reset && npm run db:hydrate   # nuke + reseed
```

Use `db:hydrate` after pulling a branch that ships new fixtures.

## Auto-snapshot on dev startup

`server/src/db/snapshot.ts` runs at the start of every `npm run dev` (called from `server/src/index.ts`). It:

1. Skips silently if `dev.db` doesn't exist (first run).
2. Copies `dev.db` to `server/.backups/dev-<YYYYMMDD-HHMMSS>.db`.
3. Prunes any backup older than **7 days**.

So you almost always already have a recent backup without doing anything.

## Manual backup before risky ops

Before a planned `db:reset`, a migration test, or any one-off destructive operation:

```bash
cp server/prisma/dev.db server/prisma/dev.db.bak.db
```

**The suffix has to keep ending in `.db`.** The root `.gitignore` has `*.db`, which matches on the
*end* of the filename — so `dev.db.bak.db` is ignored but `dev.db.local-backup` and `dev.db.bak`
are **not**. Name a backup either of those ways and it lands as an untracked ~256 KB binary that
the next `git add -A` will happily commit. Verify with `git check-ignore -v <path>` if unsure.

## Restore from backup

Stop the dev server first (the running process holds an open handle to `dev.db`), then reverse the copy:

```bash
cp server/prisma/dev.db.bak.db server/prisma/dev.db
```

### Schema-drift safety rule

A `cp` restore is **safe iff no new folder appeared in `server/prisma/migrations/` since the backup was taken.** If the migrations directory changed between snapshot and now, the backup's schema doesn't match the codebase — your routes may crash on rows missing new columns, or worse, silently misread them.

When the migrations dir has changed:

```bash
cd server && npm run db:reset && npm run db:hydrate
```

Your old custom rows are gone, but the schema is consistent.

## Creating a new migration

```bash
cd server && npm run db:migrate -- --name add_<thing>
```

This:

1. Reads `schema.prisma`.
2. Diffs against the current `dev.db` state.
3. Generates a timestamped folder under `migrations/`.
4. Applies the migration to `dev.db`.
5. Regenerates the Prisma client (`@prisma/client` types update).

**Never edit a committed migration**, in either history: `server/prisma/migrations/` (SQLite) or `server/prisma/postgres/migrations/` (Postgres). Once a migration has run on someone else's machine, in CI, or in prod, changing its SQL breaks them. Prisma records each applied migration's checksum, so an edited Postgres migration also fails prod's `migrate deploy`. To fix forward, add a new migration.

**Naming:** kebab-case, descriptive. Examples: `add-book-status-and-versions`, `add-illustration-url`, `add-admin-role-and-soft-delete`.

### Postgres-only schema edits

Prod runs `server/prisma/postgres/schema.prisma`, generated from `schema.prisma` by `cd server && npm run db:gen-postgres-schema`. Some edits are valid only in Postgres (SQLite would reject them).

- **They live in `server/prisma/gen-postgres-schema.mjs`**, as needle injections that must each match exactly once or the generator throws. Never put them in `schema.prisma`, and never hand-edit `postgres/schema.prisma`.
- **`server/src/__tests__/postgresSchema.test.ts` fails on drift.** If the committed Postgres schema differs from generator output, rerun `db:gen-postgres-schema` and commit the result.
- **Never run `prisma generate --schema=prisma/postgres/schema.prisma` locally.** It overwrites the SQLite client in `node_modules` and breaks the server suite. To recover, run `cd server && npx prisma generate`. To check the schema without generating, use `prisma validate` with a placeholder Postgres URL, because the `file:` URL in `server/.env` fails a `postgresql` provider:

  ```bash
  cd server && DATABASE_URL="postgresql://u:p@localhost:5432/x" npx prisma validate --schema=prisma/postgres/schema.prisma
  ```

- **Today there is one:** `User.email @db.Citext` (plus the `postgresqlExtensions` preview feature and `extensions = [citext]` it needs), which makes the unique index case-insensitive. See ADR-029 in `.code-captain/product/decisions.md`.

### Schema changes ship two migrations (ADR-028)

Prod's Render build runs `prisma migrate deploy --schema=prisma/postgres/schema.prisma`, which applies the Postgres history in `server/prisma/postgres/migrations/`. It never runs `db push`, so a schema change reaches prod **only** as a committed Postgres migration. Every change to `schema.prisma` takes four steps:

1. Edit `server/prisma/schema.prisma`.
2. `cd server && npm run db:migrate -- --name add_x` — the SQLite migration, applied to `dev.db`.
3. `cd server && npm run db:migrate:postgres -- add_x` — regenerates `postgres/schema.prisma`, then writes `postgres/migrations/<timestamp>_add_x/` with `migration.sql` and a `schema.prisma` snapshot. It needs no database. The name must match `^[a-z0-9_]+$`, so use underscores even where the SQLite name is kebab-case. It warns on `DROP` / `ALTER COLUMN … TYPE` lines; read those for data loss before committing.
4. Commit both migration folders and the regenerated `postgres/schema.prisma`.

**Skipping step 3 fails `server/src/__tests__/postgresMigrations.test.ts`.** It diffs the latest Postgres migration's snapshot against the current `postgres/schema.prisma` and fails with the fix command when they differ. The two histories never share a folder: the SQLite lock pins `provider = "sqlite"`, the Postgres lock pins `provider = "postgresql"`.

Prod was baselined once at `0_init`; the operator steps live in `docs/neon-migration-runbook.md` §"Baseline prod for migrate deploy".

## Test database lifecycle (`test.db`)

- Vitest's global setup (`server/src/__tests__/globalSetup.ts`) deletes any leftover `test.db` and runs `npx prisma migrate deploy` once per test process.
- Each test's `beforeEach` calls `resetDatabase()` from `server/src/__tests__/setup.ts` — deletes every row, then upserts the canonical seed books + pages.
- `DATABASE_URL=file:./test.db` is set by `server/vitest.config.ts`.
- `test.db` is never long-lived — wiped between runs. Don't write production code that assumes test data exists outside of `resetDatabase()`'s control.

See `docs/conventions/testing.md` for the per-test usage pattern.

## Legacy: `server/src/db/init.ts`

This file pre-dates the Prisma migration. It exports `getStore` / `resetStore` / `save` / `initDb` for the original JSON-file store. Routes no longer use it; new code should not call it. The legacy seed inside `init.ts` may also diverge from `prisma/seed.ts` — when in doubt, the Prisma seed is canonical.

## Things to NEVER do without user confirmation (CLAUDE.md guardrails)

- Drop or replace `dev.db` directly (`rm dev.db` — the guard hook blocks it; use `db:reset`).
- Change the seed shape in a way that breaks existing local books/carts/orders.
- Edit a committed migration after it has run elsewhere.
- Switch the dev/test database provider off SQLite. Prod already runs Postgres on Neon, from `server/prisma/postgres/schema.prisma` (generated by `db:gen-postgres-schema`) and the migration history in `server/prisma/postgres/migrations/` (applied by `migrate deploy`). Both are load-bearing, not placeholders. See "Postgres-only schema edits" and "Schema changes ship two migrations" above.
