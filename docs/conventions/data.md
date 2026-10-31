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
- **Illustration bytes:** not in the database. Local disk or Cloudflare R2, chosen by `STORAGE_BACKEND` — see [Illustration storage](#illustration-storage).

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

**Never edit a committed migration.** Once a migration has run on someone else's machine (or in CI), changing its SQL breaks them. To fix forward, add a new migration.

**Naming:** kebab-case, descriptive. Examples: `add-book-status-and-versions`, `add-illustration-url`, `add-admin-role-and-soft-delete`.

### Postgres-only schema edits

Prod runs `server/prisma/schema.postgresql.prisma`, generated from `schema.prisma` by `cd server && npm run db:gen-postgres-schema`. Some edits are valid only in Postgres (SQLite would reject them).

- **They live in `server/prisma/gen-postgres-schema.mjs`**, as needle injections that must each match exactly once or the generator throws. Never put them in `schema.prisma`, and never hand-edit `schema.postgresql.prisma`.
- **`server/src/__tests__/postgresSchema.test.ts` fails on drift.** If the committed Postgres schema differs from generator output, rerun `db:gen-postgres-schema` and commit the result.
- **Never run `prisma generate --schema=prisma/schema.postgresql.prisma` locally.** It overwrites the SQLite client in `node_modules` and breaks the server suite. Use `prisma validate` instead. To recover, run `cd server && npx prisma generate`.
- **Today there is one:** `User.email @db.Citext` (plus the `postgresqlExtensions` preview feature and `extensions = [citext]` it needs), which makes the unique index case-insensitive. See ADR-029 in `.code-captain/product/decisions.md`.

## Test database lifecycle (`test.db`)

- Vitest's global setup (`server/src/__tests__/globalSetup.ts`) deletes any leftover `test.db` and runs `npx prisma migrate deploy` once per test process.
- Each test's `beforeEach` calls `resetDatabase()` from `server/src/__tests__/setup.ts` — deletes every row, then upserts the canonical seed books + pages.
- `DATABASE_URL=file:./test.db` is set by `server/vitest.config.ts`.
- `test.db` is never long-lived — wiped between runs. Don't write production code that assumes test data exists outside of `resetDatabase()`'s control.

See `docs/conventions/testing.md` for the per-test usage pattern.

## Legacy: `server/src/db/init.ts`

This file pre-dates the Prisma migration. It exports `getStore` / `resetStore` / `save` / `initDb` for the original JSON-file store. Routes no longer use it; new code should not call it. The legacy seed inside `init.ts` may also diverge from `prisma/seed.ts` — when in doubt, the Prisma seed is canonical.

## Illustration storage

The database holds illustration **URLs**, never image bytes. The bytes — page art, covers, character portraits, every version of each — live behind a storage seam, and where that is depends on one env var. Decisions: ADR-025 (seam), ADR-026 (redirect serving, `r2.dev`), ADR-027 (R2 + `@aws-sdk/client-s3`) in `.code-captain/product/decisions.md`.

### The seam

`server/src/services/storage.ts` is the only code that touches illustration bytes. Everything else calls `getStorage()` and gets a `StorageBackend` with `put` / `get` / `head` / `list` / `remove`. Nothing else should import `fs/promises` for an illustration path.

- **Keys** are the stored web path minus `/illustrations/`: `<bookId>/page-4-v2.png`, `<bookId>/portrait-<slot>.png`. Key validation lives in `storage.ts` and nowhere else — it rejects `..`, a leading `/`, a backslash, NUL, and a `.` segment. It is the path-traversal fence for both backends and for the admin orphan endpoints.
- **Stored URLs never change.** `Page.illustration_url` / `Book.cover_url` stay relative (`/illustrations/<bookId>/<file>.png`) under either backend, so switching backends needs no migration and a row written under one is readable under the other.
- `public/uploads` and `public/hero` are **not** behind the seam. Hero frames are committed and bundled on purpose (ADR-014).

### Backends: `STORAGE_BACKEND`

| Value | Bytes live in | Use |
|-------|---------------|-----|
| `local` (default; blank or unset also mean `local`) | `server/public/illustrations/` on local disk | Dev, tests, e2e, offline work. Needs no `R2_*` var. |
| `r2` | Cloudflare R2 bucket, over the S3 API | Production. Render's disk is ephemeral, so under `local` every generated PNG is lost on the next restart or deploy. |

Any other value **throws at boot** — a typo must not quietly select ephemeral disk in production. The backend is resolved once at startup (`getStorage()` in `server/src/index.ts`); under `r2` the boot log says `[storage] backend: r2 (local disk is the read fallback)`. Changing the var takes a restart.

Under `r2`, all five `R2_*` vars are required. If any is missing or blank the server **refuses to start** with `STORAGE_BACKEND=r2 requires <VAR, VAR> to be set (missing or blank).` — it names the variables, never a value, so the secret can't reach a log.

| Var | What it is |
|-----|-----------|
| `R2_ACCOUNT_ID` | Cloudflare account ID. The endpoint is derived: `https://<id>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | Bucket name |
| `R2_ACCESS_KEY_ID` | R2 API token access key (secret) |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret (secret) |
| `R2_PUBLIC_BASE_URL` | Public read URL of the bucket, e.g. `https://pub-<hash>.r2.dev`. Trailing slashes are stripped. |

### Local-disk fallback under `r2`

Under `r2`, `get` and `head` **fall back to local disk on an R2 miss**, and `list` merges both sources (deduped by key, R2 wins). The reason is the fixture book `b2fa23cf-3156-4b89-83e7-82d98c32c8b7`: its 13 PNGs are committed under `server/public/illustrations/`, ship inside the deploy bundle, and are never uploaded. Without the fallback the demo book's art would 404 the moment the switch flipped. `remove` deletes from both sources, so an admin-deleted orphan doesn't reappear from disk.

New writes under `r2` go **only** to R2.

### Serving

`/illustrations/*` is `express.static` against local disk **first**, then `server/src/middleware/illustrationRedirect.ts`:

- **`local`:** a disk miss falls through to Express's default 404 — the pre-seam behaviour.
- **`r2`:** a disk miss on a GET/HEAD answers **302 → `${R2_PUBLIC_BASE_URL}/<key>`**. Image bytes never cross the Render instance. The redirect host is always `R2_PUBLIC_BASE_URL`; an invalid key is a 404, never a redirect. The handler does not check that the key exists in R2 — a genuinely missing image 302s and the bucket answers the 404.

This needs the bucket to be **public-read**. For the alpha that is R2's `r2.dev` development subdomain, which **Cloudflare rate-limits and says not to use in production**. A custom domain in front of the bucket is the upgrade path, tracked in [#192](https://github.com/slickG0ose/storybook/issues/192) with version pruning. The art is storefront content and book IDs are UUIDs, so a public bucket exposes nothing that isn't already public.

### Operator setup: switching production to R2

About 20 minutes. Do every step before flipping `STORAGE_BACKEND` — the server won't boot under `r2` with a blank `R2_*` var.

1. **Create the bucket.** Cloudflare dashboard → R2 → Create bucket. Note the name (`R2_BUCKET`) and, from the R2 overview page, the Account ID (`R2_ACCOUNT_ID`).
2. **Enable public access.** Bucket → Settings → Public access → R2.dev subdomain → Allow. Copy the `https://pub-<hash>.r2.dev` URL (`R2_PUBLIC_BASE_URL`).
3. **Create an API token.** R2 → Manage R2 API Tokens → Create API token, permission **Object Read & Write**, scoped to **this bucket only**. Copy the Access Key ID and Secret Access Key (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) — the secret is shown once.
4. **Set the five `R2_*` vars in Render.** `storybook-server` → Environment. They are declared `sync: false` in `render.yaml`, so they appear listed but **blank** — a listed key is not a set key; check each value.
5. **Flip `STORAGE_BACKEND` to `r2`** in the same Environment tab and save (this restarts the service). It is also `sync: false`, so a later Blueprint sync will not reset it; blank means `local`, which is why merging the Blueprint changed nothing.
6. **Verify.** Check the deploy log for `[storage] backend: r2` and no `STORAGE_BACKEND=r2 requires …` error. Generate a book, confirm its pages render, then **restart the service** (Manual Deploy → Restart) and confirm they still render. `curl -sI https://<service>/illustrations/<bookId>/page-1-v1.png` should answer `302` with a `Location` on your `r2.dev` URL. The fixture book's art should still load (served from disk).

**Rollback:** set `STORAGE_BACKEND` back to `local` (or blank). Books generated while on `r2` will then 404 their art until it is switched back — the bytes stay in the bucket.

## Things to NEVER do without user confirmation (CLAUDE.md guardrails)

- Drop or replace `dev.db` directly (`rm dev.db` — the guard hook blocks it; use `db:reset`).
- Change the seed shape in a way that breaks existing local books/carts/orders.
- Edit a committed migration after it has run elsewhere.
- Switch the dev/test database provider off SQLite. Prod already runs Postgres on Neon, from a schema generated by `db:gen-postgres-schema` — that script is load-bearing, not a placeholder. See "Postgres-only schema edits" above.
