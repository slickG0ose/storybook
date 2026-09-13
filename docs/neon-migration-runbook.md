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

**The rule is client >= server.** `pg_dump` refuses outright when the server is newer
(`aborting because of server version mismatch`), but a newer client dumps an older server
fine. So install the **highest** major Homebrew offers rather than guessing at a match:

```bash
brew search /^postgresql@/          # see what majors exist
brew install postgresql@18          # measured 2026-09-13: Render runs 18.4, Neon 18.6
export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"
pg_dump --version
```

Add that `export` line to `~/.zshrc` to make it stick. Once `psql` works, confirm both ends:

```bash
psql "$RENDER_URL" -tAc 'select version();'
psql "$NEON_URL"   -tAc 'select version();'
```

A **major**-version gap between source and target is the one that needs a decision: Neon
pins the Postgres version at project creation, so a PG 18 source wants a PG 18 Neon project.
Same major on both ends is a clean `pg_dump`/`pg_restore`.

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
pg_dump -Fc -d "$RENDER_URL" -f ~/storybook-render-$(date +%Y%m%d).dump
ls -lh ~/storybook-render-*.dump
pg_restore -l ~/storybook-render-*.dump | grep -c 'TABLE DATA'   # expect 10
```

`-Fc` is the custom format `pg_restore` wants. Do **not** use `pg_dumpall` or `-C`; Neon
supports neither.

**Check the file, not the exit code.** `pg_dump -f` creates the output file *before* it
connects, so a failed dump leaves a **0-byte file** that looks like success — and the
restore then reports `could not read from input file: read 0, expected 5` against an empty
database. The `grep -c 'TABLE DATA'` above is the real gate: 10 tables, 34 KB at this data
size. Anything less, fix the connection and dump again.

Two ways that string goes wrong when pasted: a **trailing newline** (the closing quote lands
on the next line, and the dbname becomes `storybook_yuwr\n`), and **unquoted `&`**, which
the shell reads as "background this." Single quotes, one line.

Keep this file until the new database has served real traffic for a week. It is the only
rollback that survives the 14th.

## Step 3 — Create the Neon project (5 minutes)

[console.neon.tech](https://console.neon.tech) → New project. **Set the region in that
dialog:** `aws-us-west-2` (US West, Oregon), to sit next to the Render service in `oregon`.
Neon may otherwise default you into `us-east-2` (Ohio).

**A project's region cannot be changed after creation.** Neon's documented remedy is a new
project plus a second migration, which makes this the one field in this runbook that is
expensive to get wrong. Ohio→Oregon costs roughly 60 ms per query round trip, and a page
making three sequential queries pays it three times. If you notice after the fact, recreate
the project while it is still empty — three minutes.

**Neon shows one connection string, not two.** Click **Connect**, pick Branch / Compute /
Database / Role, then toggle **Connection pooling** off to reveal the direct string. The two
shapes differ only by `-pooler` in the hostname, so deleting that substring gets you there
just as reliably:

| Shape | Hostname | Used for |
|---|---|---|
| Pooled (what the console shows first) | `ep-xxx-pooler.c-3.us-west-2.aws.neon.tech` | not used yet — see Step 6's note |
| Direct / unpooled | `ep-xxx.c-3.us-west-2.aws.neon.tech` | the restore, and `DATABASE_URL` (see Step 6) |

Newer Neon hostnames carry a `.c-N.` segment before the region. **Only `-pooler` comes
off** — deleting `.c-3.` as well gives you a host that still resolves (Neon's DNS is a
wildcard) and still accepts TCP on 5432, then fails at authentication.

Keep `?sslmode=require`; Neon rejects unencrypted connections. **Drop
`channel_binding=require`** if the console appended it — `psql` and `pg_dump` accept it, but
it is not a parameter Prisma needs in `DATABASE_URL`.

## Step 4 — Restore (5 minutes)

```bash
pg_restore -v -O -d "<neon-DIRECT-connection-string>" ~/storybook-render-<date>.dump
```

`-O` (`--no-owner`) is required, not optional: `neon_superuser` is not a Postgres
superuser and cannot execute the `ALTER OWNER` statements in the dump. Without it you get a
wall of non-fatal ownership errors.

Never run `pg_dump` or `pg_restore` against the **pooled** string.

## Step 5 — Verify the restore before you cut over (5 minutes)

Put both strings in shell variables first. Two reasons, and the first one bites immediately:
a bare `psql "<connection-string>"` runs the placeholder as a *database name*, so libpq falls
back to the local Unix socket and reports `connection to server on socket
"/tmp/.s.PGSQL.5432" failed` — which reads like a broken server and is really an unsubstituted
placeholder. Second, **single quotes are required**: these URLs contain `&`, which the shell
would otherwise read as "run this in the background."

```bash
export RENDER_URL='<render-external-connection-string>'
export NEON_URL='<neon-direct-connection-string>'
```

Then run the same query against each and expect identical numbers:

```bash
for url in "$RENDER_URL" "$NEON_URL"; do
  echo "== ${url#*@}"
  psql "$url" -tAc 'SELECT
    (SELECT count(*) FROM "User")  AS users,
    (SELECT count(*) FROM "Book")  AS books,
    (SELECT count(*) FROM "Page")  AS pages,
    (SELECT count(*) FROM "Order") AS orders;'
done
```

`psql "$NEON_URL" -c '\dt'` should list the 10 application tables. A count mismatch means stop and re-dump;
do not proceed on a partial restore.

Clear the variables when you are done: `unset RENDER_URL NEON_URL`.

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
| `pg_dump: aborting because of server version mismatch` | Client older than the server — Render is on 18.4 | Install the higher major (Step 0); a newer client is always safe |
| `pg_restore: could not read from input file: read 0, expected 5` | The dump is 0 bytes — `pg_dump -f` created the file, then failed to connect | Re-dump, then gate on `pg_restore -l \| grep -c 'TABLE DATA'` |
| `role "storybook_admin" does not exist`, 4 errors ignored | `ALTER DEFAULT PRIVILEGES` / `GRANT` for a role that exists only on Render | Benign — `-O` already skipped ownership; the data restored |
| `database "storybook_yuwr\n" does not exist` | Trailing newline in the pasted connection string | Re-export on one line |
| Only one connection string in the console | The Connect dialog shows the pooled shape first | Toggle `Connection pooling` off, or delete `-pooler` from the hostname |
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
