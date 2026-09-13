# Durable persistence for the beta — Neon Postgres + Cloudflare R2

> Status: Draft
> Last updated: 2026-09-12
> Backlog: [#78](https://github.com/slickG0ose/storybook/issues/78) (Postgres expiry — Scope A),
> [#157](https://github.com/slickG0ose/storybook/issues/157) (MVP beta — the product reason),
> [#77](https://github.com/slickG0ose/storybook/issues/77) (restore the deploy — unblocked by Scope A).
> Supersedes the open checklist item at `docs/deploy-spike-render.md:226`
> ("Decide on illustration persistence strategy") and the `render.yaml:11` note
> ("Long-term fix: blob storage (R2/S3/Cloudinary)").

## Problem

Nick is inviting family and friends to create books (#157), and wants the books they
create to survive. Two independent persistence holes stand in the way, and **only one of
them is the database** — which is the hole everyone has been looking at.

1. **The database is deleted on 2026-09-14.** Render's free Postgres has a hard 90-day
   lifetime. Not downgraded — deleted. Two days out as of this spec.
2. **Every runtime-generated PNG is already being lost, today, on every restart.**
   Render's free web service has an ephemeral filesystem and spins down after 15 minutes
   idle. `server/src/services/illustrations.ts` writes generated art to
   `server/public/illustrations/<bookId>/` (lines 443, 613, 673). Those bytes do not
   survive a spin-down. The `Page.illustration_url` row **does** survive, so the failure
   mode is not "the book is gone" — it is a book whose pages point at dead paths.
   `illustrations.ts:80-88` already documents exactly this class of failure for a
   `dev.db` copied without its PNGs; production makes it the default.

Fixing only #78 buys rows that describe books whose pictures are missing.

### The sizes that decide the plan

Measured 2026-09-12 against this checkout (`server/public/illustrations`, `dev.db`):

| Thing | Measured | Consequence |
|---|---|---|
| Relational rows | `dev.db` is **651 KB** total | Neon's free 0.5 GB is ~4 orders of magnitude of headroom. Storage tier is a non-question. |
| Illustration PNGs | **20 files, 36.2 MB, 1.81 MB average** | Images are ~99.9% of the bytes and **none of them are in the database.** |
| One real book's art | 27 MB in `b2fa23cf…`, 6.6 MB and 2.2 MB in the others | Regenerations accumulate as versions and never get pruned. Budget ~11-27 MB per active book. |

So: **Postgres holds paths, R2 holds bytes.** R2's free tier is 10 GB-month recurring,
$0.015/GB-month beyond it — roughly 5,500 images, call it 400-900 beta books.

## Scope A — Neon (ops, human-only, deadline 2026-09-14)

**This scope cannot be automated and must not be attempted by an agent.** It needs the
Render dashboard, the Neon console, and credentials that exist in neither the repo nor any
agent environment. The runbook is `docs/neon-migration-runbook.md` (Task 1).

Code touched by Scope A is limited to `render.yaml`:

- `DATABASE_URL` is `fromDatabase` (`render.yaml:104-108`) pointing at the
  `storybook-postgres` free instance declared at `render.yaml:108-110`. Overriding the
  value in the dashboard alone is **not durable** — the next Blueprint sync re-asserts
  `fromDatabase` and points production back at a database that no longer exists. The
  `databases:` block must go and the var must become `sync: false`.
- `render.yaml:45` runs `prisma db push --accept-data-loss` on **every** deploy. Against
  the empty spike database that was harmless; against tester rows it is a live
  data-loss risk. **Decision: leave `db push` in place for the migration itself**
  (identical schema in, identical schema out — it is a no-op against the restored
  database) and switch to `migrate deploy` as a **separate, later PR**, because
  generating the first Postgres migration set (`docs/deploy-spike-render.md:155`) is not
  a thing to attempt inside a two-day deadline. Tracked as a follow-up issue in Task 7.

## Scope B — R2 (code, autonomous-safe)

### Design decision 1 — a storage seam, not a find-and-replace

New module `server/src/services/storage.ts` exporting a narrow interface and a memoized
env-selected implementation:

```ts
export interface StoredObject { key: string; lastModified: Date }
export interface StorageBackend {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;                                  // throws when absent
  head(key: string): Promise<{ size: number; lastModified: Date } | null>;  // null when absent
  list(prefix: string): Promise<StoredObject[]>;
  remove(prefix: string): Promise<void>;
}
export function getStorage(): StorageBackend;
```

**Keys are the existing relative path with `/illustrations/` stripped** —
`<bookId>/page-4-v2.png`. That is already the exact string every read site computes
(`illustrations.ts:98`, `:205`, `providers/fal.ts:164`), so the seam lands on a boundary
the code already has rather than inventing one.

### Design decision 2 — `illustration_url` does not change, so there is no data migration

Stored URLs stay `/illustrations/<bookId>/<file>.png`. The client, the PDF exporter, the
history viewer, and every existing row keep working untouched, and a book written under
the local backend is readable under R2 and vice versa. The alternative — writing absolute
`https://<bucket>/…` URLs into the DB — would mean a backfill, would bake the bucket host
into rows forever, and would make local dev rows unusable in production. Rejected.

The mapping from web path to bytes moves into the serving layer (decision 4).

### Design decision 3 — local disk stays the default; R2 is opt-in by env

`STORAGE_BACKEND=local|r2`, defaulting to `local`. Reasons this is load-bearing rather
than tidy:

- **Every existing test writes real PNGs to the real directory.**
  `server/src/services/__tests__/illustrations.test.ts` (≈8 `BASE_DIR` blocks),
  `pdf.test.ts:8`, `imagePin.test.ts` (uses `utimes` to control mtimes),
  `admin.test.ts:15`. Under `local` they must stay **byte-for-byte unmodified**. A
  spec that rewrites 1,000 lines of passing tests to accommodate a storage swap has
  mis-designed the swap.
- No R2 credential is needed to run the suite, work offline, or open a PR from a
  worktree.

Under `r2`, **reads fall back to local disk on a miss.** This is not belt-and-braces: the
fixture book `b2fa23cf-3156-4b89-83e7-82d98c32c8b7` ships **13 committed PNGs** inside
the deploy bundle (`.gitignore:27` whitelists exactly that directory), and
`prisma/seed.ts` re-upserts its rows on every deploy. Without the fallback, the demo
book's art 404s the moment the switch flips, with no upload step having happened.

### Design decision 4 — serve from disk, redirect to R2

`server/src/index.ts:61` is `express.static('/illustrations', …)`. It becomes: the same
`express.static` first, then a fallback handler that, under the `r2` backend, issues a
**302 to `${R2_PUBLIC_BASE_URL}/<key>`**.

Redirecting rather than streaming keeps generated-image bytes off the Render free
instance entirely — no bandwidth, no CPU, no cold-start penalty on a 1.8 MB PNG. It
requires public read on the bucket: use R2's `r2.dev` development subdomain for the beta
and note its rate limiting; a custom domain is the upgrade path when the beta outgrows it.

Streaming through the server (proxy) and presigned GETs are both strictly more work and
more load; they become interesting only if the bucket must stay private, which for
already-public storefront art it does not.

### Design decision 5 — `@aws-sdk/client-s3`, with the tradeoff stated

R2 is S3-compatible. This is a **new runtime dependency**, which is a size-gate trigger
(CLAUDE.md §Size gate) and needs Nick's sign-off, which this spec is requesting.

- **Chosen:** `@aws-sdk/client-s3`. Handles SigV4, retries, and — the one that matters —
  `ListObjectsV2` XML parsing. `list()` backs version numbering (`getNextVersion`), and a
  hand-rolled XML parse that silently returns `[]` would make a regenerate overwrite v2
  instead of creating v3. Silent wrong-answer failure, not a loud one.
- **Rejected:** `aws4fetch` (~6 KB, zero deps) plus hand-rolled XML. Materially smaller
  install and faster Render builds; pay for it in exactly the fragile place above.
- Only `@aws-sdk/client-s3` is added. No `@aws-sdk/lib-storage` (no multipart — these are
  ~2 MB objects), no `@aws-sdk/s3-request-presigner` (decision 4 chose redirects).

### Call sites — the complete verified list

Every filesystem touch against `public/illustrations`, as of 31bd6bf:

| File | Site | Change |
|---|---|---|
| `services/illustrations.ts` | `:436-445` page write, `:605-615` portrait write, `:671-675` cover write | `put()` |
| `services/illustrations.ts` | `:91-117` `resolveStyleAnchor` (`stat`) | `head()` — keeps returning `null` on every failure mode; the never-throws contract in its comment block is load-bearing |
| `services/illustrations.ts` | `:204-212` `resolveReferenceBytes` (`readFile`) | `get()` — keeps throwing with the same message shape |
| `services/illustrations.ts` | `:460-476` `getNextVersion`, `:478-492` `getNextPortraitVersion` (`readdir`) | `list()` — the `catch → return 1` guard stays |
| `services/illustrations.ts` | `:521-548` `listIllustrationVersions` legacy synthesis (`readdir` + `stat().mtime`) | `list()` + `lastModified` |
| `services/illustrations.ts` | `:634+` `listCharacterPortraitVersions` | same |
| `services/providers/fal.ts` | `:161-170` `toDataUri` (`readFile`) | `get()` |
| `services/imagePin.ts` | `:44` dir const, `earliestArtAt` `readdir` + mtime fallback | `list()` + `lastModified`. Note `:42-44` deliberately duplicates the dir constant to avoid an import cycle — importing `storage.ts` is cycle-free, so the duplicate goes. |
| `services/pdf.tsx` | `:124-140` `loadImage` — relative-path branch | `get()`. The `https?://` branch at `:127` stays exactly as-is. |
| `routes/admin.ts` | `:273-318` `GET /orphan-illustrations`, `:320-345` `DELETE` | `list()` / `remove()`. The path-traversal fence at `:337-341` must survive as a key-shape guard — a key may not contain `..` or a leading `/`. |
| `index.ts` | `:61` static mount | static-then-redirect (decision 4) |

### What does NOT change

- `Page.illustration_url` / `Book.cover_url` values, and no Prisma migration.
- Any `@storybook/shared` Zod schema, any route response shape → **wire-shape check is
  N/A**, and the PR body should say so and why.
- Any client file. **Zero** client changes; dark-mode parity is N/A for the same reason.
- `public/uploads` (`index.ts:62`) and `public/hero` (`index.ts:66`). Hero frames are
  committed, byte-budgeted, and deliberately bundled (ADR-014); they never go to R2.
- The `IllustrationVersion` table, `PORTRAIT_SLOT_BASE`, the pin model, spend gates.

## Verification

1. `cd server && npm test` — unmodified under the default `local` backend. This is the
   primary regression fence for the whole spec.
2. New `storage.test.ts`: the local backend against a temp prefix, and the R2 backend
   against a mocked `S3Client` (`vi.mock('@aws-sdk/client-s3')`) asserting the key shape,
   the `..`/leading-slash rejection, `head()` returning `null` on a 404 rather than
   throwing, and the R2-miss → local-hit fallback.
3. A `/illustrations/*` redirect test: under `r2`, a key absent from disk answers 302 with
   the `R2_PUBLIC_BASE_URL` location; present-on-disk still answers 200 with bytes.
4. e2e is unaffected (local backend, `dev.db`, committed fixture PNGs) and must stay green.
5. **Real-R2 verification is out of agent reach** and is Nick's, post-merge: set the env
   vars, create a book, restart the service, confirm the pages still render.

## ADR candidates

- **The storage seam** — key shape, the URL-stability decision, and why local stays the
  default (decisions 1-3).
- **Redirect-not-proxy, and `r2.dev` for the beta** (decision 4), including the rate limit.
- **`@aws-sdk/client-s3` over `aws4fetch`** (decision 5) — the XML-parse argument is the
  whole reason, so it needs to be written down where the next person will find it.

## Deferred, with the tracking action

- `prisma db push --accept-data-loss` → `migrate deploy`. **Deferred:** new issue (Task 7).
- Pruning superseded illustration versions (27 MB in one book is mostly dead versions).
  **Deferred:** new issue (Task 7).
- A custom domain in front of R2, replacing `r2.dev`. **Deferred:** same issue as above.
- Case-insensitive `User.email` index — untouched here, already tracked as
  [#174](https://github.com/slickG0ose/storybook/issues/174).
