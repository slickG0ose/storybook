# Neon + R2 durable persistence — task plan

> Spec: [spec.md](spec.md)
> Status: Draft — awaiting Nick's approval (new dependency, new external service)
> Last updated: 2026-09-12

## Overview

Seven tasks in two scopes that share no files except `render.yaml`.

**Scope A — Neon (Task 1 only).** Docs plus a `render.yaml` env change. The *execution*
is Nick's, by hand, by 2026-09-14. An agent writes the runbook; an agent must not run it.

**Scope B — R2 (Tasks 2-7).** Strictly sequential. Task 2 builds the seam every later
task imports. Tasks 3-5 re-point call sites and all live in the server zone against one
`test.db` with a single worker — **do not run them concurrently.** Task 6 is the operator
surface, Task 7 the audit trail.

Task 1 is independent of 2-7 and can run at any point, including first.

## Cross-cutting constraints

- **The default backend is `local` and the existing server suite is the fence.**
  `cd server && npm test` must pass with **zero edits** to
  `services/__tests__/illustrations.test.ts`, `services/__tests__/pdf.test.ts`,
  `services/__tests__/imagePin.test.ts`, or `routes/__tests__/admin.test.ts`. If a task
  finds itself editing those files, the seam is wrong — stop and hand back.
- **Wire-shape check: N/A, deliberately.** No route response field changes, no
  `@storybook/shared` schema is touched. The 302 added in Task 5 is a static-asset
  response, not an API envelope. Say this in the PR body so Check 4 reads as a ruling.
- **Dark-mode parity: N/A.** Zero client files change in this spec.
- **No Prisma migration.** `illustration_url` values are unchanged (spec decision 2). A
  task that reaches for `prisma migrate` has misread the spec.
- **Never log a credential.** `R2_SECRET_ACCESS_KEY` must not reach a log line, an error
  message, or a test fixture. Config errors name the *variable*, never the value.
- **Branch:** `feat/blob-storage-r2` (this spec already lives there). Squash-merge, one PR
  for Scope B. Task 1 may ship as its own `docs/` PR if the deadline needs it to.

---

## Task 1 — Neon migration runbook + durable `DATABASE_URL`

**Status:** Not started

Write `docs/neon-migration-runbook.md`: numbered, copy-pasteable, `pg_dump` first, with the
verify-before-delete ordering and an explicit rollback (the Render instance stays alive
until Neon answers). Cover the Prisma-on-Neon detail — the build runs `prisma db push`, so
the **direct/unpooled** connection string is what belongs in `DATABASE_URL` for a
single-instance beta; note the pooled endpoint plus `DIRECT_URL` as the scale-up shape.

Then make the Render side durable in `render.yaml`: delete the `databases:` block
(`:108-110`), change `DATABASE_URL` from `fromDatabase` (`:104-108`) to `sync: false`, and
update the free-Postgres caveat comment at `:13-14`. Leave `buildCommand` (`:45`) alone —
spec Scope A explains why.

**Done when:** the runbook exists and a reader could execute it without opening this spec;
`render.yaml` no longer declares a Render database; `docs/deploy-spike-render.md`'s
"Free Postgres expires" section (`:141-146`) points at the runbook instead of describing
options. No code outside `render.yaml` and `docs/`.

## Task 2 — `services/storage.ts`: the seam and both backends

**Status:** Not started

Add `@aws-sdk/client-s3` to `server/package.json`. Implement the interface from spec
decision 1: `LocalStorage` (wrapping today's exact `fs/promises` calls against
`server/public/illustrations`) and `R2Storage` (S3 API, `R2_*` env), plus `getStorage()`
memoizing the `STORAGE_BACKEND` choice. Under `r2`, `get`/`head`/`list` fall back to local
on a miss and `list` merges both sources, deduping by key with R2 winning.

Key validation lives here and nowhere else: reject a key containing `..`, a leading `/`, or
a backslash. This is the replacement fence for `admin.ts:337-341` and Task 5 depends on it.

Write `services/__tests__/storage.test.ts` per spec §Verification item 2. Mock
`@aws-sdk/client-s3`; no test may require a real credential or network.

**Done when:** `storage.test.ts` passes, the full server suite still passes untouched, and
no other source file imports `fs/promises` for an illustration path yet.

## Task 3 — Re-point `services/illustrations.ts`

**Status:** Not started

All nine sites in the spec's call-site table for this file: three writes, `resolveStyleAnchor`,
`resolveReferenceBytes`, both `getNext*Version` helpers, and both `list*Versions` legacy
synthesizers. `ILLUSTRATIONS_DIR` (`:15`) is deleted along with the `fs/promises` import.

Preserve three contracts verbatim, each of which has a comment block at its site explaining
why it exists — read them before editing: `resolveStyleAnchor` never throws and returns
`null` on every failure mode (`:80-90`); `resolveReferenceBytes` throws a clear
reference-not-found error (`:202-212`); `getNextVersion`'s unreadable-listing case returns
`1` rather than propagating (`:460-476`).

**Done when:** the server suite passes with those four test files unmodified, and
`grep -n "fs/promises" src/services/illustrations.ts` is empty.

## Task 4 — Re-point `providers/fal.ts`, `imagePin.ts`, `pdf.tsx`

**Status:** Not started

`fal.ts:161-170` `toDataUri` → `get()`; its duplicated dir constant (`:12`) goes.
`imagePin.ts` `earliestArtAt` filesystem fallback → `list()` + `lastModified`; the
duplicated constant at `:44` goes and the import-cycle note at `:42-43` is now obsolete —
delete it rather than leaving a comment that lies. `pdf.tsx:124-140` `loadImage`: the
relative branch goes through `get()`, the `https?://` branch (`:127-135`) is untouched.

`imagePin.test.ts` controls mtimes with `utimes` and must keep passing unmodified — under
the local backend `list().lastModified` **is** the file mtime, which is what makes that
possible. Verify it rather than assuming it.

**Done when:** all three files are free of illustration-path `fs/promises` use and the
server suite passes untouched.

## Task 5 — Serving layer and the admin orphan endpoints

**Status:** Not started

`index.ts:61`: keep `express.static` first, add the fallback handler that 302s to
`${R2_PUBLIC_BASE_URL}/<key>` under the `r2` backend and 404s under `local` (which is what
`express.static` already does, so `local` behaviour is unchanged). `/uploads` (`:62`) and
`/hero` (`:66`) are not touched.

`admin.ts:273-345`: both orphan endpoints move to `list()` / `remove()`. The traversal
fence moves to Task 2's key validation — the endpoint must still reject a malicious `:id`,
and `admin.test.ts`'s existing assertions on that rejection must pass unmodified.

Add the redirect test from spec §Verification item 3.

**Done when:** the new redirect test passes both branches, `admin.test.ts` passes
unmodified, and `npm test` at the repo root plus `cd e2e && npm test` are green.

## Task 6 — Operator surface

**Status:** Not started

Document the five new vars in `server/.env.example` (after the `IMAGE_PROVIDER` block, in
the same commented style): `STORAGE_BACKEND`, `R2_ACCOUNT_ID`, `R2_BUCKET`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL` — the three secrets left
blank, `STORAGE_BACKEND=local` as the documented default for local dev.

Declare them in `render.yaml` `envVars` with `sync: false` for the secrets, matching how
`FAL_KEY` is handled (`:57-60`). Add the operator section to
`docs/conventions/data.md` — it currently describes only the SQLite/Prisma layer and says
nothing about where image bytes live, which is the gap that let this bug sit unnoticed.
One line in `CLAUDE.md` §Layout or §Build pointing at it.

**Done when:** a fresh reader can set up R2 from `.env.example` plus `data.md` without
reading this spec, and `render.yaml` declares every var the server reads.

## Task 7 — ADRs and follow-ups

**Status:** Not started

Three ADRs in `.code-captain/product/decisions.md`, per spec §ADR candidates — next
numbers after ADR-024. Then file the deferred items as issues: `db push` → `migrate deploy`,
illustration-version pruning, and the `r2.dev` → custom-domain upgrade (the last two can be
one issue). Link each from the spec's Deferred section so `adr-tracking-check` sees one
tracking action per surfaced item.

Update `docs/deploy-spike-render.md`: the "no persistent-disk story" known issue (`:121-128`)
and the open checklist item (`:226`) are resolved by this spec — say so and link it.

**Done when:** `adr-tracking-check` passes, every Deferred line carries an issue number,
and the PR body records spec link + agent ownership per CLAUDE.md.
