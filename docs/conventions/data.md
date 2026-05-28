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
cp server/prisma/dev.db server/prisma/dev.db.local-backup
```

`*.db` is gitignored at the root, so any naming works (`.bak`, `.local-backup`, etc.).

## Restore from backup

Stop the dev server first (the running process holds an open handle to `dev.db`), then reverse the copy:

```bash
cp server/prisma/dev.db.local-backup server/prisma/dev.db
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

**Never edit a committed migration.** Once a migration has run on someone else's machine (or in CI), changing its SQL breaks them. To fix forward, add a new migration.

**Naming:** kebab-case, descriptive. Examples: `add-book-status-and-versions`, `add-illustration-url`, `add-admin-role-and-soft-delete`.

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
- Switch the database provider (SQLite → Postgres etc.) — out of scope today; there is a `db:gen-postgres-schema` script left as a placeholder.
