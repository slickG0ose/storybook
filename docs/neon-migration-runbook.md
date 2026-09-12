# Neon migration runbook

> **Deadline: 2026-09-14.** Render deletes the free `storybook-postgres` instance on that
> date — deleted, not downgraded. Tracked as
> [#78](https://github.com/slickG0ose/storybook/issues/78).
> Spec: [`.code-captain/specs/blob-storage-r2/spec.md`](../.code-captain/specs/blob-storage-r2/spec.md) §Scope A.
> Last updated: 2026-09-12.

Execute this by hand. It needs the Render dashboard, the Neon console, and credentials
that live in neither the repo nor any agent environment — an agent cannot run it.

**Budget 45 minutes**, most of it waiting on a Render deploy. Step 2 is the only step that
becomes impossible to redo after the 14th.

Total downtime if nothing goes wrong: one Render deploy, ~3 minutes.

---

## Step 0 — Install a Postgres client (10 minutes, do this first)

**This machine has no `pg_dump`, no `psql`, and no Docker** (checked 2026-09-12). Nothing
below works until that is fixed.

First read the source server's major version — Render dashboard → `storybook-postgres` →
the version is on the instance's info panel. Then install the **matching** client; Neon's
migration docs ask for a client at the same version as the source server:

```bash
brew install postgresql@17          # substitute the major version Render reports
echo 'export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"' >> ~/.zshrc
exec zsh
pg_dump --version                   # must print that same major version
```

**Fallback if this fights you:** Neon's console has an **Import Data Assistant** that pulls
directly from a source connection string, no local client required. Slower and less
inspectable, but it is a real path — use it and skip to Step 5.

## Step 1 — Answer the question that sizes everything else (2 minutes)

**Does the data matter?** The database holds the 6 upserted demo books plus any accounts
registered during the June 2026 window and since the deploy came back up on 2026-09-10.

- **Demo books are disposable.** `server/prisma/seed.ts` is upsert-only and idempotent; a
  fresh database reseeds itself on the next deploy.
- **Accounts are not.** There is no other copy of a registered user.

If the answer is "nothing here matters," the cheapest path is to skip to Step 3, create an
empty Neon project, and let Render's instance expire. **Dump anyway** — it costs four
minutes and it is the only decision on this page you cannot reverse after the 14th.

## Step 2 — Dump, before touching anything (5 minutes)

Copy the **external** connection string from Render → `storybook-postgres` → Connect →
External. The internal `.oregon-postgres.render.com` hostname is not reachable from your
laptop.

```bash
cd ~/src/storybook
pg_dump -Fc -v -d "<render-external-connection-string>" -f ~/storybook-render-$(date +%Y%m%d).dump
ls -lh ~/storybook-render-*.dump          # sanity: a non-trivial file exists
```

`-Fc` is the custom format `pg_restore` wants. Do **not** use `pg_dumpall` or `-C`; Neon
supports neither.

Keep this file until the new database has served real traffic for a week. It is the only
rollback that survives the 14th.

## Step 3 — Create the Neon project (5 minutes)

[console.neon.tech](https://console.neon.tech) → new project. Region: **US West (Oregon)**
if offered, to sit next to the Render service in `oregon`.

Copy **two** connection strings from the dashboard — Neon shows both and they differ by one
`-pooler` in the hostname:

| String | Hostname contains | Used for |
|---|---|---|
| Direct / unpooled | `ep-xxx.us-west-2.aws.neon.tech` | the restore, and `DATABASE_URL` (see Step 6) |
| Pooled | `ep-xxx-pooler.us-west-2.aws.neon.tech` | not used yet — see Step 6's note |

Both carry `?sslmode=require`. Keep it; Neon rejects unencrypted connections.

## Step 4 — Restore (5 minutes)

```bash
pg_restore -v -O -d "<neon-DIRECT-connection-string>" ~/storybook-render-<date>.dump
```

`-O` (`--no-owner`) is required, not optional: `neon_superuser` is not a Postgres
superuser and cannot execute the `ALTER OWNER` statements in the dump. Without it you get a
wall of non-fatal ownership errors.

Never run `pg_dump` or `pg_restore` against the **pooled** string.

## Step 5 — Verify the restore before you cut over (5 minutes)

Compare row counts on both databases. Run this against Render first, then Neon, and expect
identical numbers:

```bash
psql "<connection-string>" -c '\dt'
psql "<connection-string>" -c 'SELECT
  (SELECT count(*) FROM "User")   AS users,
  (SELECT count(*) FROM "Book")   AS books,
  (SELECT count(*) FROM "Page")   AS pages,
  (SELECT count(*) FROM "Order")  AS orders;'
```

A mismatch means stop and re-dump. Do not proceed to Step 6 on a partial restore.

## Step 6 — Point Render at Neon (10 minutes, including the deploy)

**Dashboard first, `render.yaml` second.** The order matters: `render.yaml:104-108` still
declares `DATABASE_URL` as `fromDatabase`, and a dashboard value wins over the Blueprint
until someone clicks Sync Blueprint (see `deploy-spike-render.md`). Setting the value first
means production is never without one.

1. Render → `storybook-server` → Environment → set `DATABASE_URL` to the Neon
   **direct/unpooled** string. Save. Render redeploys automatically.
2. Merge the branch carrying the `render.yaml` change (`feat/blob-storage-r2`), which
   deletes the `databases:` block and switches `DATABASE_URL` to `sync: false`. That is what
   makes the dashboard value permanent — until it lands, the next Blueprint sync re-points
   production at a database that no longer exists.

**Why direct rather than pooled:** the build command runs `prisma db push`
(`render.yaml:45`), and Prisma's schema operations want a direct connection. One Render
instance at beta traffic does not need PgBouncer. When it does, the shape is pooled in
`DATABASE_URL` plus direct in `DIRECT_URL`, declared in `schema.postgresql.prisma`.

## Step 7 — Verify the app (5 minutes)

```bash
curl -si https://storybook-server-t84f.onrender.com/api/health | head -1
curl -s  https://storybook-server-t84f.onrender.com/api/books | head -c 300
```

Expect `200` and the 6 demo books. First request after an idle period takes ~16 seconds —
free-tier cold start, not a failure. Then open
[the storefront](https://slickg0ose.github.io/storybook/), sign in, and load one book.

## Step 8 — Let the old instance expire (0 minutes)

**Do not delete `storybook-postgres` by hand.** Two reasons: it is your rollback until Neon
has proven itself, and while `render.yaml` still declares it, a Blueprint sync would simply
recreate it. Render deletes it on the 14th at no cost to you.

---

## Rollback

Any failure before Step 6 costs nothing — Render is still live and serving.

After Step 6: set `DATABASE_URL` in the Render dashboard back to the original Render
connection string and redeploy. This works **only until the 14th**, after which the dump
from Step 2 plus a fresh Neon project is the only path back.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `pg_dump: server version mismatch` | Client older than the source server | Install the matching major version (Step 0) |
| Wall of `must be owner of table` on restore | `-O` omitted | Re-run `pg_restore` with `-O`; the errors are non-fatal but noisy |
| `prisma db push` hangs or times out in the Render build | Pooled connection string in `DATABASE_URL` | Swap to the direct string |
| App boots, every query fails | `?sslmode=require` dropped from the string | Re-add it |
| `DATABASE_URL` reverts after a deploy | Blueprint sync re-asserted `fromDatabase` | Merge the `render.yaml` change (Step 6.2) |

## What this leaves open

- `render.yaml:45` still runs `prisma db push --accept-data-loss` on every deploy. Against
  an identical schema it is a no-op, which is why this runbook does not touch it — but
  against a future destructive schema change it silently drops tester data. Switching to
  `prisma migrate deploy` needs a generated Postgres migration set
  (`deploy-spike-render.md`) and is deliberately deferred out of a two-day window.
- Neon's free tier autosuspends after 5 minutes idle (~1-2s wake), stacking with Render's
  own 15-minute spin-down. A cold first request gets both.
- Illustration PNGs are **not** covered here. They are on Render's ephemeral filesystem and
  are still lost on every restart — that is Scope B of the spec (Cloudflare R2).
