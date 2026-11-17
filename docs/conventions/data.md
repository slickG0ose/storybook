# Data conventions

Database layer: Prisma over SQLite. Migrations, seeds, snapshots, restore. The developer agent (HR5) reads this when touching the data layer.

## The big picture

- **Schema:** `server/prisma/schema.prisma` is the source of truth.
- **Database file:** `server/prisma/dev.db` (SQLite, gitignored under `*.db`).
- **Migrations:** `server/prisma/migrations/<timestamp>_<name>/` — auto-generated, committed.
- **Seeds:**
  - `server/prisma/seed.ts` — canonical Prisma-based seed (6 illustrated books with pages, art committed under `server/public/illustrations/<id>/`).
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

## Illustration storage

The database holds illustration **URLs**, never image bytes. The bytes — page art, covers, character portraits, every version of each — live behind a storage seam, and where that is depends on one env var. Decisions: ADR-025 (seam), ADR-026 (redirect serving, `r2.dev`; superseded for serving by the signed-links design below), ADR-027 (R2 + `@aws-sdk/client-s3`) in `.code-captain/product/decisions.md`. Signed media links: [spec `signed-media-urls`](../../.code-captain/specs/signed-media-urls/spec.md) (#237); its ADRs are filed separately.

> **Rollout state (update this when it changes).** The mechanism below is in the code. As of the merge of Task 9, production runs `MEDIA_URL_MODE: enforce` in `render.yaml`, so unsigned links are refused there. The R2 bucket is still **public-read** (the `r2.dev` subdomain is still allowed), so already-leaked `r2.dev` URLs keep working. **The private bucket is pending** (spec stage 5, Task 11, owner only). Read every "private" sentence below as describing the target state until that step is done and recorded on #237.

### The seam

`server/src/services/storage.ts` is the only code that touches illustration bytes. Everything else calls `getStorage()` and gets a `StorageBackend` with `put` / `get` / `head` / `list` / `remove`. Nothing else should import `fs/promises` for an illustration path.

- **Keys** are the stored web path minus `/illustrations/`: `<bookId>/page-4-v2.png`, `<bookId>/portrait-<slot>.png`. Key validation lives in `storage.ts` and nowhere else — it rejects `..`, a leading `/`, a backslash, NUL, and a `.` segment. It is the path-traversal fence for both backends and for the admin orphan endpoints.
- **Stored URLs never change.** `Page.illustration_url` / `Book.cover_url` stay relative (`/illustrations/<bookId>/<file>.png`) under either backend, so switching backends needs no migration and a row written under one is readable under the other.
- **Style-reference uploads** (`/api/uploads/style-reference`) go through the same seam under the reserved `uploads/` key prefix: `getUploadStorage()` returns the same backend with that prefix, so under `r2` an upload lives in the same bucket at `uploads/style-refs/<uuid>.jpg`. Served at `/uploads/<key>`. `uploads` is a reserved first segment: `/illustrations/uploads/...` is never served or signed (`RESERVED_TOP_LEVEL_KEYS` in `storage.ts`), so a book id can never collide with it. `public/uploads` on disk is the local backend for that root.
- `public/hero` is **not** behind the seam. Hero frames are committed, bundled and public on purpose (ADR-014); they are never signed.
- **Immutable keys.** A media key is never overwritten in place. Signed links and browser caches can hold the old bytes for up to two TTL windows, so an in-place overwrite would serve stale art. Page art and portraits get a new versioned key per change (`page-4-v2.png`), narration keys include the text hash, and `cover.png` is written once per book (creation, or the add-only `POST /api/books/:id/cover`, which answers 409 if a cover already exists, so no issued link ever points at bytes that later change). A new write path that wants to replace bytes must mint a new key instead.

### Backends: `STORAGE_BACKEND`

| Value | Bytes live in | Use |
|-------|---------------|-----|
| `local` (default; blank or unset also mean `local`) | `server/public/illustrations/` on local disk | Dev, tests, e2e, offline work. Needs no `R2_*` var. |
| `r2` | Cloudflare R2 bucket, over the S3 API | Production. Render's disk is ephemeral, so under `local` every generated PNG is lost on the next restart or deploy. |

Any other value **throws at boot** — a typo must not quietly select ephemeral disk in production. The backend is resolved once at startup (`getStorage()` in `server/src/index.ts`); under `r2` the boot log says `[storage] backend: r2 (local disk is the read fallback)`. Changing the var takes a restart.

Under `r2`, the four `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` vars are required (`R2_PUBLIC_BASE_URL` is not). If any is missing or blank the server **refuses to start** with `STORAGE_BACKEND=r2 requires <VAR, VAR> to be set (missing or blank).` — it names the variables, never a value, so the secret can't reach a log.

| Var | What it is |
|-----|-----------|
| `R2_ACCOUNT_ID` | Cloudflare account ID. The endpoint is derived: `https://<id>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | Bucket name |
| `R2_ACCESS_KEY_ID` | R2 API token access key (secret) |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret (secret) |
| `R2_PUBLIC_BASE_URL` | **Optional and unused.** No code reads it any more (#237): serving is a signed link plus a presigned R2 GET. An existing dashboard value is harmless; delete it once the bucket is private. |

### Seed-book art

The six canonical books (`server/src/seed/canonicalBooks.ts`) ship with committed art: a cover plus five pages each, under `server/public/illustrations/<seed-book-id>/`.

- **Format:** 1024x1024 JPEG, quality 82 (about 9-10 MB total, versus about 95 MB as PNG). These are the only illustrations in the repo that are not `.png`. That is safe because seed books are unowned, so no re-roll, version-history or portrait code path can reach them.
- **Always-set on re-seed:** `seedCanonicalBooks()` writes the cover and page URLs on every run (`db:seed`, and the Render build). A fresh checkout has the bytes; nothing is uploaded to R2 and nothing is written to the prod DB by hand.
- **Regenerate** (paid, offline, owner's machine): `cd server && npx tsx scripts/generate-seed-art.ts`. It is a dry run unless you pass `--spend`. Useful flags: `--max-images N`, `--only <id>` (repeatable), `--redo <id>:<slot>` (regenerate one slot, e.g. `luna-star-garden:page-3`), and `--compress-only` (re-encode the cached PNGs to JPEG with no generation calls).
- **Raw cache:** the generated PNGs are kept in `server/.seed-art/` (gitignored) so a re-compress or a rerun never pays twice.
- **Hand-corrected: `luna-star-garden/cover.jpg`.** The model lettered the title onto the cover with the G missing ("STAR ARDEN"). On 2026-11-16 the G was added by hand (word shift plus a gold Inter ExtraBold G; no generation call), so the committed JPEG no longer matches the cached PNG. A `--compress-only` run, or `--redo luna-star-garden:cover`, would bring the typo back or replace the cover outright; check the lettering after either.
- **Never write into a seed-book directory from a test.** Those files are committed fixtures; a test that generates or deletes art there dirties the working tree. Tests use a temp directory or a non-seed book id.

### Local-disk fallback under `r2`

Under `r2`, `get` and `head` **fall back to local disk on an R2 miss**, and `list` merges both sources (deduped by key, R2 wins). The reason is the fixture books: the Sunny demo book `b2fa23cf-3156-4b89-83e7-82d98c32c8b7` (13 PNGs under `server/public/illustrations/b2fa23cf-…/`) and the six seed books (JPEGs under `server/public/illustrations/<seed-book-id>/`, see [Seed-book art](#seed-book-art)). All of it is committed, ships inside the deploy bundle, and is never uploaded. Without the fallback their art would 404 the moment the switch flipped. `remove` deletes from both sources, so an admin-deleted orphan doesn't reappear from disk.

New writes under `r2` go **only** to R2.

### Serving

`/illustrations/*` and `/uploads/*` are mounted by `mountMedia()` in `server/src/middleware/media.ts`. Per root, in this order: **per-IP rate limit -> `mediaGate` (verify the signed link) -> `express.static` against local disk -> `mediaPresignRedirect`**. The verifier runs for every backend, so `local` is gated exactly like `r2`.

- **Disk hit:** served by `express.static` with `Cache-Control: private, max-age=<seconds until the link expires>`, so no cache outlives the link.
- **Disk miss, `local`:** falls through to Express's default 404.
- **Disk miss, `r2`:** `302` to a short presigned R2 GET (`R2Storage.presignGet`). Image bytes never cross the Render instance. The `Location` host is always the R2 endpoint, and an invalid key is a 404, never a redirect. The handler does not check the key exists in R2: a genuinely missing object 302s and R2 answers the 404.
- **Signature format:** a link is `/<root>/<key>?e=<unix-seconds>&s=<sig>`, where `s` is base64url HMAC-SHA256 over `v1\n<root>\n<key>\n<e>`. Code: `server/src/lib/mediaUrl.ts` (pure: sign and verify); shared helpers `mediaPath` / `mediaExpiresAt` in `shared/src/media.ts`.
- **Windows:** `e = (floor(t/W)+2)*W`, so every link in a window shares one expiry and a link lives between W and 2W (default 60 to 120 minutes). A link whose `e` is more than 2W (+60 s slack) ahead is refused (`too-far`).
- **Outbound signing:** `signMediaResponses` is mounted at `app.use('/api', ...)` ahead of every router. It signs the keys `illustration_url`, `cover_url`, `portrait_url`, `style_reference_url` and `url` when the value is a `/illustrations/` or `/uploads/` path, on a copy of the body. Stored rows always hold the canonical unsigned path (`mediaPath()`).
- **Per-IP limit:** one `express-rate-limit` budget per client across **both** roots, checked **before** the gate so bad links cost the same as good ones. `MEDIA_RATE_LIMIT_PER_MINUTE`, default 600, valid 60 to 100000 (anything else falls back to 600 with a warning, never unlimited). Over budget: `429 { error: 'Too many requests. Try again in a minute.' }`, `no-store`. In-process store (ADR-018), keyed on `req.ip` (correct only with `TRUST_PROXY_HOPS`, ADR-030).

| Var | Default | Meaning |
|-----|---------|---------|
| `MEDIA_URL_SECRET` | dev: a committed constant; production unset or under 32 chars: random per process | HMAC key. In production, a missing key means links break on every restart, with a boot warning that names the var. `render.yaml` uses `generateValue: true`. |
| `MEDIA_URL_SECRET_PREVIOUS` | none | Verify-only old key, for rotation. Move the old value here before replacing `MEDIA_URL_SECRET`. Never used to sign. |
| `MEDIA_URL_TTL_MINUTES` | `60` | Window W, integer 5 to 1440; otherwise 60 with a warning. |
| `MEDIA_URL_MODE` | `enforce` | `enforce` or `lenient`. Unset or malformed means `enforce` (fails closed), so never delete the `render.yaml` line to "turn it off". |
| `MEDIA_RATE_LIMIT_PER_MINUTE` | `600` | See above. e2e raises it to `100000`. |

**`enforce`:** a missing, malformed, expired or wrong-signature link is `403 { error: 'Link expired' }` with `no-store`. That includes an invalid key: no valid link can exist for one, so under `enforce` it is always a 403. The 404-for-an-invalid-key behaviour only appears under `lenient`, where the gate lets the request through.

**`lenient`** (rollout stage): the gate lets unsigned or invalid links through and counts them. The log line `[media] lenient: served N request(s) without a valid link (last reason: <reason>)` fires on the **1st and every 100th** such request since boot (never the query string), and `getLenientMediaCount()` exposes the counter. A valid link is still verified and still gets the bounded `Cache-Control`. e2e runs `enforce` (it raises only the rate limit); production runs `enforce` (Task 9).

**Why private by default.** Illustrations of a book a user has not published, and the style photo they uploaded, belong to that user. The old design relied on unguessable UUID paths and a public bucket, so any leaked URL worked forever and could not be revoked. Short-lived signed links make a leak expire, and a private bucket removes the path around the signature. Book ids being UUIDs is a speed bump, not the control. Seed and published-book art goes through the same signer for simplicity (one rule, no per-book branch).

**Pending, stated plainly:** production runs `enforce` (Task 9), but the bucket is still public-read. Until the R2.dev subdomain is disallowed (Task 11, owner only), previously leaked `r2.dev` URLs keep working. A custom domain in front of the bucket is not part of this design and must **not** be connected, since it would be a second public path ([#192](https://github.com/slickG0ose/storybook/issues/192) tracks version pruning).

### Operator setup: switching production to R2

About 20 minutes. Do every step before flipping `STORAGE_BACKEND` — the server won't boot under `r2` with a blank required `R2_*` var.

1. **Create the bucket.** Cloudflare dashboard → R2 → Create bucket. Note the name (`R2_BUCKET`) and, from the R2 overview page, the Account ID (`R2_ACCOUNT_ID`).
2. **Leave public access OFF.** Do not enable the R2.dev subdomain and do not connect a custom domain: the server reaches the bucket with the S3 credentials and hands the browser short presigned links. (Production's bucket was created public-read under the older design and is still public until the owner disallows it; see [Rollback](#operator-setup-switching-production-to-r2) and spec stage 5.)
3. **Create an API token.** R2 → Manage R2 API Tokens → Create API token, permission **Object Read & Write**, scoped to **this bucket only**. Copy the Access Key ID and Secret Access Key (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) — the secret is shown once.
4. **Set the four `R2_*` vars in Render** (`R2_ACCOUNT_ID`, `R2_BUCKET`, the two credentials; `R2_PUBLIC_BASE_URL` is optional and unused). `storybook-server` → Environment. They are declared `sync: false` in `render.yaml`, so they appear listed but **blank** — a listed key is not a set key; check each value.
5. **Flip `STORAGE_BACKEND` to `r2`** in the same Environment tab and save (this restarts the service). It is also `sync: false`, so a later Blueprint sync will not reset it; blank means `local`, which is why merging the Blueprint changed nothing.
6. **Verify.** Check the deploy log for `[storage] backend: r2`, no `STORAGE_BACKEND=r2 requires …` error and no `MEDIA_URL_SECRET` warning. Then run the owner checklists in the spec, not an ad hoc check: **checklist A** (after signed URLs ship: private book renders, signed link 302s to a presigned R2 URL, `Range` gives `206`, seed art from disk, a style upload survives a restart) and **checklist B** (after enforce and the bucket flip: unsigned and tampered links are `403`, the old `r2.dev` URL stops returning the image). Both live in [spec.md](../../.code-captain/specs/signed-media-urls/spec.md) under Decision 6. **Neither has been run in production yet.**

**Making the bucket private (stage 5, owner only).** Cloudflare dashboard → R2 → the bucket → Settings → Public access → R2.dev subdomain → **Disallow**, and confirm no custom domain is connected. Run checklist B items 3, 4 and 6. **Rollback:** re-allow the R2.dev subdomain (instant, no code involved). Enforce (`MEDIA_URL_MODE`) and the bucket flip are independent, and the bucket goes private last on purpose.

**Backend rollback:** set `STORAGE_BACKEND` back to `local` (or blank). Books generated while on `r2` will then 404 their art until it is switched back — the bytes stay in the bucket.

## Things to NEVER do without user confirmation (CLAUDE.md guardrails)

- Drop or replace `dev.db` directly (`rm dev.db` — the guard hook blocks it; use `db:reset`).
- Change the seed shape in a way that breaks existing local books/carts/orders.
- Edit a committed migration after it has run elsewhere.
- Switch the dev/test database provider off SQLite. Prod already runs Postgres on Neon, from `server/prisma/postgres/schema.prisma` (generated by `db:gen-postgres-schema`) and the migration history in `server/prisma/postgres/migrations/` (applied by `migrate deploy`). Both are load-bearing, not placeholders. See "Postgres-only schema edits" and "Schema changes ship two migrations" above.
