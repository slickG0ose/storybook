# Close the duplicate-account hole: case-insensitive unique `User.email` (citext)

> Status: Approved (orchestrator ruling, 2026-10-31 — Nick away; see brief)
> Last updated: 2026-10-31
> Backlog: [#174 — Close the duplicate-account hole: case-insensitive unique index on User.email](https://github.com/slickG0ose/storybook/issues/174)

## Problem

`User.email` is `String @unique`, but string equality is case-sensitive in both Postgres and SQLite, so `Nick@G.com` and `nick@g.com` can coexist as two accounts. Today the only thing preventing that is application code: `/register` runs `normalizeEmail` before its duplicate check and its `create` (`server/src/routes/auth.ts:56`), and `backfillUserEmails()` converges legacy rows at boot ([[ADR-022]]). That is a convention enforced in one code path. A future write path that forgets `normalizeEmail` reopens the hole silently in production. ADR-022 deferred the database-level fix to this issue because it is Postgres-only and unrunnable while a collision exists.

## Constraints

- **Production deploys with `prisma db push --accept-data-loss`** (`render.yaml:48`), not `migrate deploy` ([[ADR-024]]). Whatever closes the hole must be created by that command, or it does not exist in prod. [[ADR-028]] proposes moving to `migrate deploy` with a Postgres `0_init` generated from `schema.postgresql.prisma`; it is not implemented yet, and this work must not wait on it.
- **`schema.postgresql.prisma` is generated, never hand-edited.** `server/prisma/gen-postgres-schema.mjs` derives it from `schema.prisma`; the header says so.
- **SQLite is the dev and test path** (`schema.prisma`, `test.db`). It has no citext and no portable functional unique index that Prisma models.
- **Prerequisite: zero case collisions in prod.** Verified 2026-10-31 on a throwaway Neon branch off `production`: 2 users, no collisions, and the live schema equals the current `schema.postgresql.prisma` (`migrate diff` empty).
- **Prisma stays on 6.x** (6.19.3 in `server/package.json`). Everything below was verified against 6.19.3.

## Proposed shape

Make `User.email` a Postgres `citext` column, declared in the Prisma schema, so `db push` creates it today and ADR-028's `0_init` contains it automatically later. The Postgres-only edits are injected by the generator, so `schema.prisma` (SQLite) does not change and needs no migration.

The generator gains three injections, each of which must match **exactly once** or the generator throws, mirroring the existing provider swap:

1. Generator block: `previewFeatures = ["postgresqlExtensions"]`.
2. Datasource block: `provider = "postgresql"` (existing swap) plus `extensions = [citext]`.
3. `model User`: `email String @unique` becomes `email String @unique @db.Citext`.

Dev and test keep `normalizeEmail` as the guarantee. Existing tests already cover the app-level behavior (see Success criteria). New tests pin the Postgres side mechanically: the generator output contains the three citext pieces, the committed `schema.postgresql.prisma` equals fresh generator output (no such drift check exists today; `grep -rn gen-postgres-schema` finds only the npm script, `render.yaml`, and docs), and each needle throws when missing.

### Decisions (orchestrator rulings, with rationale)

1. **citext, not a functional `lower(email)` index.** Both close the hole. Verified on Neon with Prisma 6.19.3: a raw `CREATE UNIQUE INDEX ... (lower(email))` survives `db push` (a no-op push, and pushes that add then drop a `User` column, all left it intact). Its flaw is that nothing in the repo creates it. A fresh database, a Neon branch from scratch, or ADR-028's `0_init` (generated from the datamodel) would all silently lack it, and prod would need a manual SQL step. citext is declarative: it lives in the schema, `db push` applies it, and `migrate diff --from-empty` emits it.
2. **Do not wait on ADR-028.** citext works under `db push` now, and it carries into `0_init` with no extra work. That removes one of ADR-028's stated reasons ("#174 needs it ... under `migrate deploy` it is the first real migration"). ADR-028's other reasons stand.
3. **The generator injects the Postgres-only edits and fails loudly.** One source of truth stays one source of truth. A needle that matches zero times or more than once throws, so a reformat of `schema.prisma` cannot quietly drop citext from prod.
4. **Accept a dev/prod divergence, in the safe direction.** On Postgres, `email` comparisons become case-insensitive. On SQLite they stay case-sensitive. A future path that forgets `normalizeEmail` works by accident in prod but fails in dev and test, so the bug shows up where tests run. The reverse (passing in tests, failing in prod) cannot happen through this column. `normalizeEmail` stays on every write and lookup. It is still what keeps the stored form canonical, and citext preserves the stored case.
5. **No Prisma Client runtime change.** `postgresqlExtensions` is a schema/migrate-engine preview feature. It changes what `db push` / `migrate diff` emit, not the generated query API. A `@db.Citext` column maps to `String` in the client, as before. The local client (generated from the SQLite schema) and the prod client (generated from the Postgres schema on Render) expose the same `User` type. One observable difference: in prod, a `where: { email }` filter matches regardless of case. That is the intended guarantee, and decision 4 explains why it is safe.

### Schema / contract changes

- **Prisma (Postgres only, via generator):** `generator client { previewFeatures = ["postgresqlExtensions"] }`, `datasource db { extensions = [citext] }`, `User.email String @unique @db.Citext`.
- **Prisma (SQLite):** none. No migration under `server/prisma/migrations/`.
- **Zod / wire shapes / routes:** none.

**DDL the next Render deploy runs** (from `db push`, verified via `migrate diff` and a real push on the Neon branch). The PR body must quote this verbatim:

```sql
CREATE EXTENSION IF NOT EXISTS "citext";
ALTER TABLE "User" ALTER COLUMN "email" SET DATA TYPE CITEXT;
```

No data-loss warning. Idempotent (re-diff after push is empty). The existing `User_email_key` unique index is kept under the same name, so the P2002 target is unchanged.

### Data flow

Unchanged at the app layer: request → `normalizeEmail` → `findFirst` / `create` on `User`. What changes is the backstop. In prod, a `create` or `update` with a differently-cased duplicate now raises a unique violation on `User_email_key` (P2002) instead of inserting a second account.

### Files likely touched

- `server/prisma/gen-postgres-schema.mjs`: three injections with exactly-once checks; exports a pure transform; writes only when run as a script
- `server/prisma/gen-postgres-schema.d.mts`: type declaration so the TS test can import the `.mjs` under `strict`
- `server/prisma/schema.postgresql.prisma`: regenerated, not hand-edited
- `server/src/__tests__/postgresSchema.test.ts`: drift check, citext-pieces check, loud-failure checks
- `CLAUDE.md` §"`User.email` normalisation": replace the "tracked as a follow-up" sentence
- `docs/conventions/data.md`: add a short "Postgres-only schema edits" note; fix the stale "Switch the database provider ... placeholder" line

## Alternatives considered

### Functional unique index on `lower(email)` (raw SQL)

**Pros:** no preview feature; column stays `text`; `WHERE email = ?` semantics unchanged.
**Cons:** invisible to Prisma, so nothing in the repo creates it. Needs a manual prod step today and a hand-added migration under ADR-028. Silently absent from any fresh database or `0_init`.
**Why rejected:** "exists only because someone ran SQL once" is the same failure class as the convention it replaces.

### Wait for ADR-028, then add a Postgres migration

**Pros:** reviewable SQL in a migration history.
**Cons:** blocks a small fix on an unimplemented deploy change. citext reaches `0_init` anyway.
**Why rejected:** no benefit over citext-now. Held as the natural home for any *future* raw-SQL Postgres change.

### Hand-edit `schema.postgresql.prisma`

**Why rejected:** violates the generated-file contract. The next `npm run db:gen-postgres-schema` would silently strip citext from prod.

### Move dev/test to Postgres so behavior matches

**Why rejected:** ADR-028 already rejected this for now (Neon branch and credential per worktree and CI run, `test.db` rework). Decision 4 makes the divergence safe enough.

## Success criteria

- `cd server && npm run db:gen-postgres-schema` produces a `schema.postgresql.prisma` containing all three citext pieces, and the committed file equals the generator's output byte for byte.
- `server/src/__tests__/postgresSchema.test.ts` passes: drift check, citext pieces present, `schema.prisma` itself contains no `citext` / `postgresqlExtensions`, and each of the three injections throws when its needle is missing (and when it matches more than once, for the `email` needle).
- Existing app-level coverage stays green (no duplicates added). `server/src/routes/__tests__/auth-normalization.test.ts` already pins: mixed-case register stored lowercase plus lowercase login (`:29`), lowercase register then `NICK@gmail.com` register returns 409 with one row (`:65`), and mixed-case padded login works (`:80`).
- `DATABASE_URL=postgresql://u:p@localhost:5432/x npx prisma validate --schema=prisma/schema.postgresql.prisma` reports the schema valid.
- `cd server && npm test` and `cd server && npx tsc --noEmit` are green.
- After the Render deploy: the build log shows the two DDL statements above, and the service boots. Nick checks this; agents do not touch prod.

## Out of scope

- Moving the deploy to `migrate deploy` ([[ADR-028]]).
- Any change to `normalizeEmail`, `/register`, `/login`, or `backfillUserEmails()`. The backfill stays: it is cheap, it still converges legacy casing on any Postgres DB that predates this change, and removing it is a separate call.
- Mapping P2002 on `User.email` to a 409 in the global error handler. `/register` already pre-checks. A future path that trips the constraint gets a 500, which is loud and correct for "a write path forgot to normalise".
- Case-insensitivity for `AllowedEmail.email` or `Order.customer_email`.

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| **Prisma/dev.db:** a schema change with no SQLite migration looks incomplete to a reviewer applying ADR-028 point 4 | `schema.prisma` is unchanged; only the generated Postgres file differs. The PR body says so explicitly. |
| Generator needle silently stops matching after a `schema.prisma` reformat, dropping citext from prod | Exactly-once checks throw; the drift test fails CI if the committed file and the generator disagree. |
| A collision appears in prod between now and the deploy, so `ALTER ... CITEXT` fails on the unique index | Build fails before go-live, and Render keeps serving the previous deploy. Fix: resolve via `/api/admin/users`, then redeploy. With 2 users and closed registration, the window is near zero. |
| Prod DB role lacks `CREATE EXTENSION` privilege | Verified working on a Neon branch off `production` with the same owner role. If it fails, the build fails loudly (same fail-safe as above). |
| Developer runs `prisma generate --schema=prisma/schema.postgresql.prisma` locally, overwriting the SQLite client in `node_modules` and breaking tests | Tasks forbid it. Use `prisma validate` only. Recovery: `cd server && npx prisma generate`. |
| Dev/prod divergence hides a missing `normalizeEmail` | Divergence fails in dev/test, not prod (Decision 4). |
| Rollback | Reverting the PR makes the next `db push` run `ALTER ... SET DATA TYPE TEXT` (lossless). The extension stays installed, which is harmless. |
| **Wire-shape / auth middleware / dark-mode / paid APIs / spend** | Not touched. No route, response, UI, or paid call changes. |
| **Guardrail: auth/session.** The uniqueness of the login identity changes at the DB layer; the UUID session model does not | Called out for user confirmation in the PR. No session or token code changes. |
| **`CLAUDE.md` edit** | Doc-only change to one paragraph, ruled by the orchestrator. Surface the diff to Nick in the PR. |

## ADR-worthy decisions

- [x] **ADR-029 — `User.email` is `citext` in Postgres via generator-injected schema edits; SQLite relies on `normalizeEmail`** — citext over `lower(email)` (declarative, survives `db push`, lands in ADR-028's `0_init`), plus the accepted dev/prod divergence and why it fails safe. Also note that it voids ADR-028's "#174 needs it" rationale bullet. Write via /create-adr after spec approval.
