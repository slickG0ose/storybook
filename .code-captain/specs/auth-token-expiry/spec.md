# Auth tokens expire: 30-day absolute expiry, hashed at rest

> Status: Accepted
> Accepted: 2026-11-15 by the owner (Nick), in chat — all five Owner decisions ruled as recommended: (1) Option 1, 30-day absolute expiry; (2) end existing sessions at deploy; (3) hash tokens at rest now; (4) `TOKEN_TTL_DAYS` default 30, range 1–90; (5) keep the Create-a-Book draft in `sessionStorage`. This is the guardrail confirmation for Tasks 2, 3 and 4.
> Last updated: 2026-11-15
> Backlog: [#210 — Auth tokens never expire — a leaked token is a permanent credential](https://github.com/slickG0ose/storybook/issues/210)

## GUARDRAIL — USER CONFIRMATION REQUIRED

This spec changes the auth/session model. `CLAUDE.md` §Guardrails lists "Adding auth or session changes (UUID session model is load-bearing)" under **always confirm with user before**. Nothing in `tasks.md` may run until the owner sets this spec to `Status: Accepted` and rules on the five Owner decisions below. An agent's message is not that approval.

What changes about the session model, and what does not:

| | Today | After |
|---|---|---|
| Token on the wire | UUIDv4, `Authorization: Bearer <uuid>` | Unchanged |
| Tokens per user | One; login rotates it | Unchanged |
| Lifetime | Until logout or next login | 30 days from the login that issued it |
| Stored in `User.token` | The token itself | `sha256(token)`, hex |
| Client storage | `localStorage['storybook-auth']` | Unchanged, same JSON shape |
| Cart session (`storybook-session`) | UUID in localStorage | **Not touched** |

## Owner decisions

Each has a recommended ruling. The task plan is written for the recommendations; a different ruling on 1, 2 or 3 means a re-dispatch of the architect, not an edit by the developer.

1. **Which option.** Recommended: **Option 1, absolute expiry**, 30 days from login. Options 2 and 3 are in Alternatives with migration costs.
2. **Existing sessions end at deploy.** Recommended: **yes, every signed-in user signs in once after the deploy.** Grandfathering leaves today's tokens permanent, which is the bug. See "Existing rows".
3. **Hash the token at rest, in this change.** Recommended: **yes.** It costs about 15 lines now. Deferred, it costs a second forced sign-in for every tester later.
4. **TTL value.** Recommended: **`TOKEN_TTL_DAYS` default 30, accepted range 1 to 90**, anything else falls back to 30.
5. **Keep the Create-a-Book draft in `sessionStorage` across the sign-in bounce.** Recommended: **yes.** It holds the child's name and story details in the tab's storage until the tab closes, the user signs out, or the book generates. That is the price of not losing the wizard on a shared tablet; say no and an expired session costs the user the whole wizard.

## Problem

`POST /api/auth/login` writes `token = uuidv4()` to `User.token` and `getAuthUser()` (`server/src/routes/auth.ts:16`) accepts it for as long as the row holds it. The schema has no expiry column. The client keeps the token in `localStorage['storybook-auth']`. A token copied off a shared family tablet, lifted by an extension, or read out of a database backup is a credential that works until that user happens to log in again. Testers are about to sign in on family tablets.

Two neighbouring facts found while reading the code, both inside this change's blast radius:

- **A database leak yields live tokens.** `User.token` is stored in the clear, and copies of the database exist outside Neon: `server/.backups/dev-*.db` snapshots, `dev.db.bak.db`, Neon branches.
- **The client has no dead-token path.** There is no shared fetch wrapper. About 40 call sites send `Authorization: Bearer ${user.token}` by hand and each handles a 401 as a generic failure string. Today a dead token is rare (it takes a login on a second device); with expiry it becomes routine.

## Constraints

- **Guardrail:** auth/session change, owner approval required (above).
- **Additive schema only** (architect checklist; `docs/conventions/data.md`). No column is dropped or renamed.
- **Two migrations, ADR-028.** SQLite via `db:migrate`, Postgres via `db:migrate:postgres`. Never run `prisma generate` against the Postgres schema locally.
- **`getAuthUser` stays the single choke point.** Every authenticated path already goes through it: `requireAuth`, `adminGate` and `requireAdmin`, `/logout`, `/me`, and the two optional-auth reads (`routes/books.ts:182`, `routes/narration.ts:95`). Verified by grep; nothing else reads `User.token`.
- **Middleware order is unchanged:** `requireAuth | adminGate → validate → handler`. No route gains or loses middleware.
- **Wire shapes (OPS.3 / ADR-003):** no response gains a field (see "Schema / contract changes"). The existing `toMatchObject` pins stay as they are.
- **Config fails safe**, matching the spend gate: a malformed limit falls back to the default, never to "no limit".
- **The stored `storybook-auth` blob must stay backward compatible.** Every e2e helper seeds `{ id, email, name, token }` (`e2e/tests/_editPublished.ts:203`, `admin.spec.ts`, `version-history.spec.ts`, `illustration-history.spec.ts`, `mobile/narration-generated.spec.ts`), and so does every real browser signed in before the deploy.
- **Dark-mode parity** for the one new UI surface (the sign-in notice).
- **No paid API is touched.** The e2e spec must not be able to reach `/api/generate` with a live token (Task 7).

## Proposed shape

**Server.** Login and register mint a UUIDv4 as today, return it to the client, and store `sha256(token)` in `User.token` with `token_expires_at = now + TTL`. `getAuthUser` hashes the presented token and looks up a row where the hash matches, `deleted_at` is null, and `token_expires_at` is in the future. A null `token_expires_at` never authenticates. Expiry is absolute: nothing extends it except logging in again, which mints a new token.

**One 401 for every dead token.** Expired, revoked by logout, rotated by a login elsewhere, and never-valid all return the existing `401 { error: 'Not authenticated' }`. The server does not say which. That keeps a token-validity oracle out of the API, and it means the client needs exactly one rule.

**Client.** A plain function `authFetch(token, input, init)` attaches the bearer header and, on a 401, announces "this token is dead" through a window event. `AuthProvider` listens: it clears state and `localStorage`, then routes to `/login` carrying the path the user was on. `Login` shows a "your session ended" notice and returns the user to that path after sign-in. The Create-a-Book wizard keeps its draft in `sessionStorage`, so the round trip restores it.

**The rule for the client:** a 401 on a request that carried a bearer token means the session is over. Only a 401 means that. A network failure or a 5xx does not.

### Why Option 1

The issue's threat is a leaked token that works forever. An absolute cap is the only one of the three properties that bounds it: a thief who uses a token weekly keeps a sliding token alive indefinitely, so Option 2 is only honest as "sliding plus an absolute cap", which is Option 1 with a second column, a write on the read path, and a throttle to test. Option 3 solves a different problem (several devices at once) and removes a property the current model has for free: today a fresh login revokes a leaked token, and with a session table it does not, so Option 3 needs a "sign out everywhere" control before it is not a regression.

What Option 1 costs: every user signs in again every 30 days, at a moment they do not choose. That is why the client work is in scope rather than a follow-up.

### Schema / contract changes

`server/prisma/schema.prisma`, model `User`:

```prisma
// sha256 hex of the bearer token, never the token itself (#210). A row whose
// token_expires_at is null or past does not authenticate.
token            String?   @unique
token_expires_at DateTime?
```

- `token` keeps its name and type and gains `@unique`. It is the lookup key on every authenticated request and has no index today. Multiple nulls are legal under a unique index in both SQLite and Postgres.
- `token_expires_at` is new and nullable.
- Migration name `add_token_expiry` in both histories. Each migration's **first statement** is hand-appended data SQL, identical in both dialects: `UPDATE "User" SET "token" = NULL;` (see "Existing rows").

**Wire shapes: no change.** `/register` and `/login` keep returning `{ id, email, name, role, token }`; `/me` keeps `{ id, email, name, role }`; `/logout` keeps `{ ok: true }`. An `expiresAt` field was considered and left out: the server is the only authority on expiry, the client would have nothing to do with the value except compare it to a clock that may be wrong, and the client's actual trigger is the 401. So no new schema goes into `@storybook/shared`. Tests add `not.toHaveProperty('token_expires_at')` on all four responses so the column cannot leak later.

Note for the record, not for this change: the four auth routes have no Zod schemas in `@storybook/shared` at all; they are pinned by `toMatchObject` in `auth-normalization.test.ts` and `auth-session.test.ts` only. Out of scope.

**New env var.** `TOKEN_TTL_DAYS`, read at call time (not module scope, so tests can stub it).

| Value | Result |
|---|---|
| unset, blank | 30 |
| integer 1 to 90 | that many days |
| `0`, negative, `1.5`, `abc`, `91`, `3000` | 30, plus one `console.warn` per process |

The upper bound is what makes this fail safe: without it `TOKEN_TTL_DAYS=3000`, a typo for 30, would quietly restore near-permanent tokens. No `render.yaml` entry; the default is the production value.

### Existing rows

Three choices were on the table for the tokens that exist at deploy:

| Choice | Result | Verdict |
|---|---|---|
| Grandfather (no expiry on old rows) | Every token that may already have leaked stays permanent | Rejected: it is the bug |
| Expiry = deploy + N days | Old tokens live N more days, in plaintext | Rejected: cannot coexist with hashing without a backfill, and needs dialect-specific date SQL (Prisma stores SQLite `DateTime` as epoch milliseconds; hand-written SQL that writes a text date produces a column with mixed formats) |
| **Expire now** | Everyone signs in once after the deploy | **Chosen** |

Expire-now falls out of the design with no extra mechanism. After the deploy `getAuthUser` hashes what it is given, so a stored plaintext token can never match; and old rows have a null `token_expires_at`, which never authenticates. The `UPDATE "User" SET "token" = NULL;` in the migration is there to purge the plaintext values from the database, not to revoke them. It is one statement, portable, and runs exactly once.

Cost: one sign-in per tester. The auth limiter (`authRateLimit`) refunds successful logins, so a household behind one address signing back in is not counted against the 10-per-15-minutes budget.

Rollback: if the new server build is rolled back after the migration ran, the old code compares presented tokens against null or hashed values, matches nothing, and everyone signs in again. Nothing crashes, because no column was removed.

### Data flow

Sign-in:

```
Login.tsx → AuthContext.login() → POST /api/auth/login
  server: verifyPassword → issueToken() → UPDATE User SET token = sha256(t), token_expires_at = now + TTL
  ← { id, email, name, role, token: t }
AuthContext: setUser, localStorage['storybook-auth'] = { id, email, name, token, role }
Login.tsx: navigate(location.state.from ?? '/my-books')
```

Authenticated request with a dead token:

```
page → authFetch(user.token, url, init) → server getAuthUser():
  WHERE token = sha256(presented) AND deleted_at IS NULL AND token_expires_at > now  → no row
  ← 401 { error: 'Not authenticated' }
authFetch: dispatch window event 'storybook:auth-expired' { token }; return the Response unchanged
AuthProvider listener: if event.token === current user.token →
  clear user, remove localStorage['storybook-auth'],
  navigate('/login', { state: { from: <current path + search>, reason: 'expired' } })
Login.tsx: shows "Your session ended. Sign in to pick up where you left off."
```

The `event.token === current user.token` check stops a slow request from a previous session from signing out a session that was just created.

App load with a dead token (the existing mount-time `/me` check):

```
AuthProvider mount → GET /api/auth/me
  401            → clear state and storage, no redirect, no notice (the user was not mid-task;
                   the storefront is browsable signed out; pages gate themselves as today)
  network / 5xx  → keep the stored session (NEW: today any failure, including being offline,
                   wipes the session; see Risks)
  200            → hydrate as today
```

Work in progress:

- **Create-a-Book wizard:** `CreateBook.tsx` holds all wizard state in `useState`, which is lost on any navigation. It writes the draft to `sessionStorage['storybook-create-draft']` on change and restores it on mount. Cleared on successful generation and on explicit logout. This also makes the page's existing signed-out copy true: `CreateBook.tsx:558` already promises "Your choices here are kept — sign in and come right back", and today they are not kept, and `Login.tsx:23` sends the user to `/my-books` rather than back.
- **Everything else:** the user returns to the page they were on. Unsaved inline text on `BookDetail` (one page's edit) is lost. Accepted; see Alternatives → in-place re-auth dialog.

### Interactions checked

| Area | Finding | Change |
|---|---|---|
| `getAuthUser` soft-delete filter (`auth.ts:22`) | Filter and expiry are both conditions of one query | Add the expiry condition; keep `deleted_at: null` |
| `/logout` | Calls `getAuthUser`, so an expired token resolves to no user and it answers `{ ok: true }` without writing. Correct: the token is already dead, and the existing test pins the idempotent path | Also null `token_expires_at` when it does clear |
| Admin restore (`admin.ts:161`) | Sets `deleted_at: null` only. A tombstoned user's token starts authenticating again on restore. No route sets `User.deleted_at`; tombstoning is done by hand | Restore also nulls `token` and `token_expires_at` |
| Admin bootstrap (`adminBootstrap.ts`) | Writes `role` only, never `token`. Role is read from the row on every request, so demotion takes effect immediately and is independent of expiry | None |
| Auth limiter (`authRateLimit.ts`) | Mounted on `/login` and `/register` only. 401s from expired tokens on other routes never reach it. Successful logins are refunded | None |
| Per-user limiter and spend gate | Both key on `res.locals.user`, set after `getAuthUser` succeeds | None |
| Demo seed admin (`prisma/demo-seed.ts:216`) | Writes `password_hash`, never `token`. `demo@storybook.local` gets a token by logging in | None |
| Optional-auth reads (`GET /api/books/:id`, `GET /api/books/:id/narration`) | A dead token is treated as signed out: published books still load, an owned draft 404s. No 401 is sent | None; pinned by a test as deliberate |
| `GET /api/hero/pool` | Never reads the user; byte-identical for all callers | None |
| e2e helpers | Register through the real API, seed `{ id, email, name, token }`. Fresh tokens last 30 days; the blob shape is unchanged | None |
| Server tests that write `token:` directly | `auth-hashing.test.ts:79,95` and `adminBootstrap.test.ts:96` write literal tokens as inert column filler; none is presented as a bearer. They keep passing, including under `@unique` (distinct values) | None; Task 3 re-greps |
| `/api/_test/*` router | Does not touch tokens | None |
| `server/src/types.ts` `User` | Legacy JSON-store interface with `token: string \| null`; unused by routes | None |

### Files likely touched

- `server/src/lib/authToken.ts` — new: `hashToken`, `resolveTokenTtlDays`, `issueToken`
- `server/prisma/schema.prisma` — `token @unique`, `token_expires_at`
- `server/prisma/migrations/<ts>_add_token_expiry/migration.sql` — SQLite migration
- `server/prisma/postgres/schema.prisma`, `server/prisma/postgres/migrations/<ts>_add_token_expiry/` — generated Postgres side
- `server/src/routes/auth.ts` — register, login, logout, `getAuthUser`
- `server/src/routes/admin.ts` — user restore clears the token
- `client/src/lib/authFetch.ts` — new: bearer fetch plus the dead-token event
- `client/src/context/AuthContext.tsx` — listener, only-401-clears on mount, logout clears the draft
- `client/src/pages/Login.tsx` — notice, return-to
- `client/src/pages/{Admin,BookDetail,MyBooks,CreateBook}.tsx` — call sites move to `authFetch`
- `client/src/lib/createDraft.ts` — new: sessionStorage draft read/write/clear
- `e2e/tests/mobile/session-expiry.spec.ts` — new
- `docs/conventions/{server,client,call-graph}.md`, `server/.env.example` — docs

## Alternatives considered

### Option 2 — sliding expiry (bump on use, throttled)

**Pros:** an active user is never signed out mid-task; an idle tablet signs itself out sooner than 30 days if the idle window is short.
**Cons:** on its own it does not bound a stolen token, because use keeps it alive. Made honest with an absolute cap, it needs a second timestamp (`token_issued_at`), a write inside `getAuthUser` on the read path of every authed request, and a throttle whose concurrency has to be tested. It still needs all the client work here.
**Migration cost from Option 1:** small and contained. One additive column, one branch in `getAuthUser`, no client change, no forced sign-in. About half a day.
**Held as upgrade path.** Worth it only if testers complain about the 30-day sign-in.

### Option 3 — a `Session` table (multi-device, per-device revoke)

**Pros:** fixes "signing in on the tablet signs the phone out", which this spec does not. Per-device revoke. The natural home for `last_used_at` and a device label.
**Cons:** new model and relation, session-row pruning, a per-user session cap, and a behaviour change with a security edge: a new login no longer revokes a leaked token, so it needs a "sign out everywhere" endpoint and a place in the UI to press it. Roughly twice the server work of this spec, plus that UI.
**Migration cost from Option 1:** cheap, and not a rewrite, for one reason: `getAuthUser` is the only reader of the token. The hash helper, the TTL config, the uniform 401, `authFetch`, the Login return path, the wizard draft and every test of 401-on-expiry carry over unchanged. The new work is the `Session` model, a rewrite of four handlers in `auth.ts`, and a migration that copies each live `(token, token_expires_at)` into a session row, so nobody is signed out. `User.token` and `User.token_expires_at` are then dropped in a later PR. Nothing built here is thrown away except those two columns.
**Why rejected for now:** it answers a different question from #210, and its security regression needs UI this issue does not ask for. Track it as its own issue.

### Hashing: defer, or use a separate `token_hash` column

**Defer:** rejected. Switching to hashes invalidates every stored token whenever it happens. Doing it with expiry means one forced sign-in; doing it later means two.
**New `token_hash` column, drop `token` later:** more honest naming, but it needs a purge step for the old column and a second deploy to drop it. Reusing `token` gets the same security with a schema comment. Rejected on cost; revisit the name if Option 3 happens, where the column moves anyway.
**Salted or slow hash (scrypt, as for passwords):** not needed. The token is 122 bits from a CSPRNG, so there is nothing to brute-force, and a fast hash keeps the per-request cost negligible. Passwords are low-entropy; that is why they get scrypt and this does not.

### Add `expiresAt` to the login and register responses

**Pros:** the client could warn before expiry, or sign out a stale tab without a round trip.
**Cons:** a new wire field in two routes and in the stored blob, with no consumer that the 401 does not already serve, and a client clock in the decision.
**Why rejected:** no consumer. If stale tabs become a problem, re-running `/me` when the tab regains focus covers expiry and "signed out by a login elsewhere" together, with no wire change. Listed in Out of scope.

### In-place re-auth dialog instead of a redirect

**Pros:** the page stays mounted, so no in-progress state is lost anywhere, including an unsaved inline edit on `BookDetail`.
**Cons:** the user must stay "signed in" in React state while the token is dead (clearing `user` makes `BookDetail` refetch anonymously and drop an owned draft, and makes `Admin` navigate away), so the app carries a third auth state. Plus a modal with a focus trap, both themes, and its own tests.
**Why rejected:** the redirect plus the wizard draft covers the one long-lived piece of unsaved work. The remaining loss is one page's text, at most once per 30 days.

### A global `window.fetch` patch instead of `authFetch`

**Why rejected:** client tests replace `fetch` wholesale, so the patch would silently vanish under test, and it would intercept third-party requests.

### e2e: a test-only "expire this token" endpoint

**Why rejected:** the server answers the same 401 for an expired token and a revoked one, so revoking through the real `POST /api/auth/logout` from Playwright's request context gives the browser a real dead-token 401 with no new auth-mutating test endpoint. Expiry-by-clock itself is pinned in the server suite, where a test can write `token_expires_at` directly.

## Success criteria

- A token whose `token_expires_at` is in the past gets 401 from `/api/auth/me`, from a `requireAuth` route, and from an `adminGate` route. Pinned in `server/src/routes/__tests__/auth-expiry.test.ts`.
- A row with a null `token_expires_at`, and a row holding a plaintext token, both get 401.
- After register and after login, `User.token` equals `sha256(returned token)` and is not the returned token; `token_expires_at` is 30 days out, within a few seconds.
- `TOKEN_TTL_DAYS` handling matches the table above, pinned in `server/src/lib/__tests__/authToken.test.ts`.
- `postgresMigrations.test.ts` and `postgresSchema.test.ts` pass; both migration files contain the `UPDATE`.
- In the browser, a dead token on an authed action lands the user on `/login` with the notice, and signing in returns them to the page they were on. On `/create`, the wizard fields are restored. Pinned in `e2e/tests/mobile/session-expiry.spec.ts` in both themes.
- Being offline at app load no longer signs the user out.
- Server, client, e2e and harness suites green; no new TypeScript errors.

## Out of scope

- A `Session` table, multi-device sign-in, per-device revoke, "sign out everywhere".
- Sliding expiry.
- Re-validating the session when a tab regains focus. A tablet PWA tab left open past expiry keeps showing a signed-in UI until the next authed action, which then redirects.
- A shorter TTL for admin accounts.
- Moving the token out of `localStorage` (httpOnly cookie). It is the larger fix for the XSS half of the threat and a much larger session change.
- Zod schemas in `@storybook/shared` for the four auth routes.
- Migrating `client/src/lib/feedback.ts` and `client/src/lib/narration/api.ts` to `authFetch`. Both already handle a 401 on purpose: the feedback dialog keeps the tester's typed report and says "Your session has ended — sign in again, then send", and narration falls back to the device voice. A redirect would destroy the report text.
- The cart session. Not touched.

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| **Auth/session guardrail** | Owner approval gate at the top of this spec; `USER CONFIRMATION REQUIRED` on Tasks 2, 3 and 4 |
| Every signed-in tester is signed out at deploy | Intended (Owner decision 2). Say so in the PR body so it is not read as an outage. Old client builds clear the dead token silently on next load |
| A cached old PWA build meets the new server mid-session | It shows its existing generic error strings until reload. No crash: no wire shape changed |
| Hand-appended SQL in a generated migration | It is appended before the migration is committed, which is not "editing a committed migration". Task 2 names the exact statement and its position, and a test asserts both files contain it |
| SQLite `migrate dev` applies before the SQL can be appended | Task 2 uses `--create-only`, appends, then applies |
| `@unique` on `token` fails if two rows share a value | The `UPDATE` runs first and nulls every row |
| Mount check behaviour change: network failure no longer clears the session | Deliberate. With a redirect and a "session ended" notice now attached to dead tokens, treating a cold Render start or an offline PWA as "expired" would tell the user something false. The server still rejects a dead token on the next call |
| A stale in-flight 401 signs out a fresh session | The listener ignores events whose token is not the current one |
| A dead token on an optional-auth read shows "not found" for an owned draft instead of a sign-in prompt | Rare (needs a tab open past expiry and no authed call first). Accepted; the focus re-validation in Out of scope closes it |
| Draft in `sessionStorage` holds a child's name on a shared tablet | Per-tab, gone when the tab closes; cleared on logout and on successful generation. Owner decision 5 |
| `location.state.from` as a redirect target | It is router state set only by in-app code, not a query parameter, so there is no open-redirect surface. Login still accepts it only if it starts with a single `/` |
| e2e reaching the paid `/api/generate` | The wizard test route-mocks `/api/generate` to 401. The real-server 401 test uses the free `GET /api/books/mine` |
| CodeQL flags `sha256` as a weak hash | It would be a false positive (the input is a 122-bit random secret, not a password). If it fires, dismiss with that reason; do not swap in a slow hash |
| Wire-shape (OPS.3) | No response field added. Existing pins unchanged; new `not.toHaveProperty` assertions keep the column off the wire |
| Dark-mode parity | One new surface, the Login notice. `dark:` variants required; e2e runs it in both themes |
| Spend exposure | No new route, no paid call. `requireAuth` still precedes `spendGate` everywhere |
| Two server-zone agents share `test.db` | Tasks 1 to 3 run one at a time |
| AI calls are never tested | Not relevant here; nothing in the AI path changes |

## ADR-worthy decisions

- [ ] **Absolute 30-day expiry on the single per-user token; Session table and sliding expiry deferred** — the session model changes under a guardrail, and the deferral of multi-device needs a recorded reason and a tracking issue. Write via /create-adr after spec approval.
- [ ] **Bearer tokens are stored as unsalted sha256 in the existing `User.token` column** — hard to reverse (every change of scheme forces a global sign-in) and the column name no longer describes its contents.
- [ ] **Existing sessions are invalidated at deploy by the migration, not grandfathered** — a one-way data change run against production by `migrate deploy`.
- [ ] **One 401 for every dead token, and the client treats any 401 on a bearer request as session end** — a cross-zone contract; `authFetch` is the new seam every authed page call goes through, and `expiresAt` is deliberately kept off the wire.
- [ ] **`TOKEN_TTL_DAYS` is range-checked (1 to 90) and falls back to 30** — the upper bound is a security control, not validation tidiness.
