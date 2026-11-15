# Auth tokens expire: 30-day absolute expiry, hashed at rest — task plan

> Spec: [spec.md](spec.md)
> Status: Accepted
> Accepted: 2026-11-15 by the owner (Nick), in chat — all five Owner decisions ruled as recommended: (1) Option 1, 30-day absolute expiry; (2) end existing sessions at deploy; (3) hash tokens at rest now; (4) `TOKEN_TTL_DAYS` default 30, range 1–90; (5) keep the Create-a-Book draft in `sessionStorage`. This is the guardrail confirmation for Tasks 2, 3 and 4.
> Last updated: 2026-11-15

## Overview

Nine tasks. Server first, strictly one at a time (1 → 2 → 3): a pure token helper, the schema change with both migrations, then the wiring in `auth.ts`. Client next (4 → 5, 6): the `authFetch` seam and `AuthContext`, then the page call sites and the wizard draft. Then one e2e spec (7), docs (8), and the pre-merge ADR task (9). The client chain (4, 5, 6) can run alongside the server chain; two server tasks can never run at once.

Written for the recommended rulings on the spec's five Owner decisions. If the owner rules differently on decision 1, 2 or 3, stop and re-dispatch the architect.

## Cross-cutting constraints

- **Guardrails touched: auth/session model.** USER CONFIRMATION REQUIRED before Tasks 2, 3 and 4. The spec must read `Status: Accepted`, set by the owner. Surface the guardrail in the PR body, along with the fact that every signed-in user is signed out once at deploy, by design.
- **Wire-shape:** no response gains a field. `/register` and `/login` stay `{ id, email, name, role, token }`, `/me` stays `{ id, email, name, role }`, `/logout` stays `{ ok: true }`. Do not add `expiresAt`. Do not edit the existing `toMatchObject` pins in `auth-normalization.test.ts` or `auth-session.test.ts`.
- **Auth middleware order:** unchanged everywhere. No route gains, loses or reorders middleware.
- **Migrations:** name `add_token_expiry` in both histories. Each `migration.sql` starts with `UPDATE "User" SET "token" = NULL;`, added by hand before the first commit of that file. Never edit either file after it is committed. Never run `prisma generate --schema=prisma/postgres/schema.prisma`.
- **Additive only:** `User.token` keeps its name and type. Nothing is dropped or renamed.
- **The wire token stays a UUIDv4.** Only what is stored changes.
- **One 401:** every dead token gets the existing `401 { error: 'Not authenticated' }`. No error code, no "expired" wording from the server.
- **Stored `storybook-auth` blob shape is unchanged:** `{ id, email, name, token, role }`, and a blob without `role` must still hydrate.
- **Dark-mode parity:** the Login notice (Task 4) needs `dark:` variants.
- **Spend:** no test may reach `/api/generate` with a live token. Task 7 route-mocks it.
- **One server-zone agent at a time.** Server suites share `test.db`.
- **Cart session (`storybook-session`) is not touched.**

## Tasks

### Task 1 — Token helper: hash, TTL config, issue

**Status:** Done (2026-11-15)

**Zone:** server
**Depends on:** none
**Parallel-safe with:** 4, 5, 6

**Files to add or change:**
- `server/src/lib/authToken.ts` — new, pure, no Prisma and no Express import
- `server/src/lib/__tests__/authToken.test.ts` — new

**Signatures / shapes:**
```ts
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

export const DEFAULT_TOKEN_TTL_DAYS = 30;
export const MAX_TOKEN_TTL_DAYS = 90;

/** sha256 hex (64 lowercase chars) of the bearer token. Unsalted on purpose: the input is a 122-bit random UUID. */
export function hashToken(token: string): string;

/**
 * Days a new token lives. Reads env at CALL time, never module scope.
 * Accepts /^\d+$/ integers from 1 to MAX_TOKEN_TTL_DAYS. Unset or blank -> default, silently.
 * Anything else -> default plus ONE console.warn per process naming the variable (not the value).
 */
export function resolveTokenTtlDays(env?: NodeJS.ProcessEnv): number;

export interface IssuedToken {
  token: string;      // UUIDv4, returned to the client, never stored
  tokenHash: string;  // hashToken(token), stored in User.token
  expiresAt: Date;    // now + resolveTokenTtlDays() days
}
export function issueToken(now?: Date, env?: NodeJS.ProcessEnv): IssuedToken;

/** Test hook for the warn-once latch. */
export function resetTokenTtlWarning(): void;
```

**Tests to write:**
- `server/src/lib/__tests__/authToken.test.ts`:
  - `hashToken` is deterministic, 64 hex chars, differs from its input, differs for different inputs.
  - `resolveTokenTtlDays`: unset → 30; `''` and `'  '` → 30 with no warn; `'7'` → 7; `'1'` → 1; `'90'` → 90; each of `'0'`, `'-1'`, `'1.5'`, `'abc'`, `'91'`, `'3000'`, `'30d'` → 30.
  - A malformed value warns once across repeated calls; the message does not contain the bad value.
  - `issueToken(fixedNow, { TOKEN_TTL_DAYS: '2' })`: `expiresAt - fixedNow` is exactly 2 days in ms; `tokenHash === hashToken(token)`; `token` matches a UUIDv4 pattern.
- Wire-shape assertion required: no

**Done when:** listed tests pass, `cd server && npm test` green, no new TS errors. Nothing imports the module yet.

---

### Task 2 — Schema and both migrations: `token_expires_at`, unique `token`, purge old tokens
**Status:** Done (2026-11-15). SQLite DDL generated with `prisma migrate diff` (non-interactive shell); purge prepended by hand; no drift.

> USER CONFIRMATION REQUIRED — auth/session guardrail. Requires the owner's approval of the spec.

**Zone:** server
**Depends on:** Task 1
**Parallel-safe with:** 4, 5, 6

**Files to add or change:**
- `server/prisma/schema.prisma` — `User.token` gains `@unique` and a comment; add `token_expires_at DateTime?`
- `server/prisma/migrations/<timestamp>_add_token_expiry/migration.sql` — generated, then one statement added at the top
- `server/prisma/postgres/schema.prisma` — regenerated, never hand-edited
- `server/prisma/postgres/migrations/<timestamp>_add_token_expiry/{migration.sql,schema.prisma}` — generated, then one statement added at the top of `migration.sql`
- `server/src/__tests__/tokenExpiryMigration.test.ts` — new

**Signatures / shapes:**
```prisma
model User {
  // ...
  // sha256 hex of the bearer token, never the token itself (#210). A row whose
  // token_expires_at is null or past does not authenticate. See lib/authToken.ts.
  token            String?   @unique
  token_expires_at DateTime?
  // ...
}
```

First statement of BOTH `migration.sql` files, above the generated DDL:
```sql
-- #210: every token issued before this migration was stored in plaintext with no
-- expiry. Purge them; each user signs in once. Runs before the unique index is built.
UPDATE "User" SET "token" = NULL;
```

Steps, in order:
1. Edit `schema.prisma`.
2. `cd server && npm run db:migrate -- --name add_token_expiry --create-only` — writes the SQLite migration without applying it.
3. Add the `UPDATE` at the top of the SQLite `migration.sql`.
4. `cd server && npm run db:migrate` — applies it to `dev.db` and regenerates the client. This signs out local dev sessions; that is expected.
5. `cd server && npm run db:migrate:postgres -- add_token_expiry`.
6. Add the same `UPDATE` at the top of the Postgres `migration.sql`. Leave its `schema.prisma` snapshot alone.
7. Validate without generating: `cd server && DATABASE_URL="postgresql://u:p@localhost:5432/x" npx prisma validate --schema=prisma/postgres/schema.prisma`.

Expected generated DDL, for review. SQLite: `ALTER TABLE "User" ADD COLUMN "token_expires_at" DATETIME;` and `CREATE UNIQUE INDEX "User_token_key" ON "User"("token");`. Postgres: `ALTER TABLE "User" ADD COLUMN "token_expires_at" TIMESTAMP(3);` and the same index. No `DROP`, no `ALTER COLUMN … TYPE`. If either file contains one, stop and report.

Not verified by the architect (read-only): whether `prisma migrate dev --create-only` runs non-interactively when the diff adds a unique constraint. If it demands a prompt, stop and report rather than hand-writing the folder.

**Tests to write:**
- `server/src/__tests__/tokenExpiryMigration.test.ts` — finds the `*_add_token_expiry/migration.sql` in each history and asserts each contains `UPDATE "User" SET "token" = NULL;` positioned before `CREATE UNIQUE INDEX`.
- Existing gates that must stay green: `postgresMigrations.test.ts`, `postgresSchema.test.ts`. The server suite's global setup runs the SQLite migration against a fresh `test.db`, which proves the SQL applies.
- Wire-shape assertion required: no

**Done when:** listed tests pass, `cd server && npm test` green, no new TS errors, both migration folders and the regenerated `postgres/schema.prisma` are in the diff.

---

### Task 3 — Issue, store and check tokens through the helper; 401 on expiry

> USER CONFIRMATION REQUIRED — auth/session guardrail. Requires the owner's approval of the spec.

**Zone:** server
**Depends on:** Tasks 1 and 2
**Parallel-safe with:** 4, 5, 6

**Files to add or change:**
- `server/src/routes/auth.ts` — `getAuthUser`, `/register`, `/login`, `/logout`
- `server/src/routes/admin.ts` — `PUT /users/:id/restore` also clears the token
- `server/src/routes/__tests__/auth-expiry.test.ts` — new

**Signatures / shapes:**
```ts
// getAuthUser — signature unchanged: (req: Request) => Promise<User | null>
const presented = header.slice(7);
if (!presented) return null;
return prisma.user.findFirst({
  where: {
    token: hashToken(presented),
    deleted_at: null,
    token_expires_at: { gt: new Date() },   // null never matches
  },
});

// /register and /login
const { token, tokenHash, expiresAt } = issueToken();
// store: { token: tokenHash, token_expires_at: expiresAt }
// respond with `token` exactly as today — response bodies are unchanged

// /logout
data: { token: null, token_expires_at: null }

// admin restore
data: { deleted_at: null, token: null, token_expires_at: null }
```

Rules:
- Remove the `uuid` import from `auth.ts` if nothing else there uses it.
- `requireAdmin`, `requireAuth`, `adminGate` are not edited; they inherit the check.
- Status codes and error strings do not change. No new response field.
- Re-grep before finishing: `grep -rn "token" server/src --include="*.ts" | grep -v __tests__` must show no reader or writer of `User.token` outside `auth.ts`, `admin.ts` restore, and `lib/authToken.ts`.
- In the server tests, find any that write `token:` straight into a `User` row and then present it as a bearer. The architect found none (`auth-hashing.test.ts:79,95` and `adminBootstrap.test.ts:96` write literals that are never presented). If one exists, store `hashToken(value)` with a future `token_expires_at`; do not delete the test.

**Tests to write:**
- `server/src/routes/__tests__/auth-expiry.test.ts`, using `createTestApp`, `resetDatabase`, `allowEmail`:
  - **Fresh token works:** register, then `GET /api/auth/me` → 200.
  - **Stored value is the hash:** after register and after login, the row's `token` equals `hashToken(body.token)` and is not `body.token`.
  - **Expiry is set:** after register and after login, `token_expires_at` is within 10 seconds of now + 30 days.
  - **401 on expiry, `/me`:** set `token_expires_at` to one second ago with `prisma.user.update` → `GET /api/auth/me` → 401, body `toMatchObject({ error: expect.any(String) })`.
  - **401 on expiry, `requireAuth` route:** same setup → `GET /api/books/mine` → 401.
  - **401 on expiry, `adminGate` route:** promote the user to admin, expire the token → `GET /api/admin/users` → 401 (not 403).
  - **Null expiry never authenticates:** set `token_expires_at: null`, keep the hash → 401.
  - **A plaintext row never authenticates:** `prisma.user.create` with `token: 'legacy-plaintext'` and a future `token_expires_at`; present `legacy-plaintext` → 401.
  - **Login rotates and renews:** expire the token, log in → new token works, old token 401, new `token_expires_at` in the future.
  - **Logout clears both columns;** logout with an expired token still returns 200 `{ ok: true }`.
  - **Optional-auth read is not a 401:** an expired token on `GET /api/books/luna-star-garden` → 200. Comment that this is deliberate.
  - **Restore does not resurrect a session:** tombstone a user by `prisma.user.update`, restore through `PUT /api/admin/users/:id/restore` as an admin → the user's old token gets 401; the row's `token` is null.
  - **TTL is read per call:** `vi.stubEnv('TOKEN_TTL_DAYS', '1')`, register → expiry about one day out; `vi.unstubAllEnvs()` in `afterEach`.
  - **The column stays off the wire:** `/register`, `/login`, `/me` and `PUT /api/admin/users/:id/restore` bodies each `not.toHaveProperty('token_expires_at')`.
- Wire-shape assertion required: no new shape. The existing pins must pass unedited.

**Done when:** listed tests pass, `cd server && npm test` green with no existing test edited except as the rule above allows, no new TS errors.

---

### Task 4 — `authFetch`, session-end handling in `AuthContext`, Login notice and return path
**Status:** Done (2026-11-15). Manual browser verify (light + dark) pending, to be done with the full flow.

> USER CONFIRMATION REQUIRED — auth/session guardrail. Requires the owner's approval of the spec.

**Zone:** client
**Depends on:** none
**Parallel-safe with:** 1, 2, 3

**Files to add or change:**
- `client/src/lib/authFetch.ts` — new
- `client/src/context/AuthContext.tsx` — listener; mount check; nothing else about login/register changes
- `client/src/pages/Login.tsx` — notice, return path
- `client/src/lib/__tests__/authFetch.test.ts`, `client/src/context/__tests__/AuthContext.test.tsx`, `client/src/pages/__tests__/Login.test.tsx` — new or extended

**Signatures / shapes:**
```ts
// client/src/lib/authFetch.ts
export const AUTH_EXPIRED_EVENT = 'storybook:auth-expired';
export interface AuthExpiredDetail { token: string }

/**
 * fetch with `Authorization: Bearer <token>` merged into init.headers.
 * No token -> plain fetch, no header, never dispatches.
 * 401 on a request that carried a token -> dispatches AUTH_EXPIRED_EVENT on window with
 * { token }, then returns the Response UNCHANGED so the caller's own error handling runs.
 * Never throws on its own; a rejected fetch rejects as usual. `input` is passed through as
 * given — callers keep using api('/api/...').
 */
export function authFetch(
  token: string | null | undefined,
  input: string,
  init?: RequestInit,
): Promise<Response>;

// Router state Login reads. Set only by AuthProvider.
export interface LoginLocationState { from?: string; reason?: 'expired' }
```

`AuthContext.tsx`:
- `AuthProvider` uses `useNavigate` and `useLocation` (it sits inside `BrowserRouter` in `main.tsx`).
- Subscribe to `AUTH_EXPIRED_EVENT` in an effect with cleanup. On an event whose `detail.token` equals the current user's token: `setUser(null)`, remove `storybook-auth`, then `navigate('/login', { state: { from: pathname + search, reason: 'expired' } })`. Ignore the event if the token differs or nobody is signed in. If already on `/login`, clear but do not navigate. Read the current user and location through refs so the listener is registered once.
- This path does **not** call `/api/auth/logout` and does **not** clear the Create-a-Book draft.
- Mount check: only a **401** from `/api/auth/me` clears the stored session. A rejected fetch or any other non-OK status keeps it: hydrate `user` from the stored blob (`role` defaults to `'user'`). No redirect and no notice from the mount check in any case.
- The context value (`user`, `loading`, `login`, `register`, `logout`) keeps its shape.

`Login.tsx`:
- When `location.state?.reason === 'expired'`, render above the form: "Your session ended. Sign in to pick up where you left off." Informational, not an error: `role="status"`, amber surface. Mirror the notice at `CreateBook.tsx:552` (`bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200`).
- On success, `navigate(from)` when `from` is a string that starts with `/` and not with `//`; otherwise `/my-books` as today.

**Tests to write:**
- `client/src/lib/__tests__/authFetch.test.ts` — sets the header and keeps caller headers; no token → no header; 401 with a token dispatches once with that token and resolves to the same Response; 401 with no token does not dispatch; 200, 403, 404, 500 do not dispatch; a rejected fetch rejects and does not dispatch.
- `client/src/context/__tests__/AuthContext.test.tsx` (under `MemoryRouter`) — mount: 200 hydrates; 401 clears storage, stays on the same route; rejected fetch keeps the stored user; 500 keeps the stored user. Event with the current token: user cleared, storage cleared, location is `/login` with `state.from` equal to the previous path plus search and `state.reason === 'expired'`, and no call to `/api/auth/logout`. Event with a different token: nothing changes. A blob with no `role` hydrates as `'user'`.
- `client/src/pages/__tests__/Login.test.tsx` — notice shown only with `reason: 'expired'`; success navigates to `state.from`; `from: '//evil.example'` and a missing `from` both fall back to `/my-books`.
- Wire-shape assertion required: no

**Manual verify:**
- Sign in, delete the row's token (or sign in again in a private window), click an action on `/my-books`. You should land on `/login` with the amber notice. Check the notice in light and dark mode. Sign in and confirm you return to `/my-books`. Nothing calls `authFetch` until Task 5, so before then trigger it from the console: `window.dispatchEvent(new CustomEvent('storybook:auth-expired', { detail: { token: JSON.parse(localStorage['storybook-auth']).token } }))`.
- Stop the API server, reload the app: you should still appear signed in.

**Done when:** listed tests pass, `cd client && npm test` green, typecheck and lint clean.

---

### Task 5 — Move the authed page call sites to `authFetch`
**Status:** Done (2026-11-15). 11 existing header assertions changed to read a `Headers` object (values unchanged, none deleted); only the excluded optional-auth `fetchBook` still builds a Bearer header by hand.

**Zone:** client
**Depends on:** Task 4
**Parallel-safe with:** 1, 2, 3, 6 (6 also edits `CreateBook.tsx`; run 5 and 6 one after the other unless in separate worktrees)

**Files to add or change:**
- `client/src/pages/Admin.tsx` — about 14 call sites
- `client/src/pages/BookDetail.tsx` — about 17 call sites
- `client/src/pages/MyBooks.tsx` — 4 call sites
- `client/src/pages/CreateBook.tsx` — 2 call sites (`/api/uploads/style-reference`, `/api/generate`)
- the matching `client/src/pages/__tests__/*.test.tsx` — one added test each

**Signatures / shapes:**
```ts
// before
fetch(api('/api/books/mine'), { headers: { Authorization: `Bearer ${user.token}` } })
// after
authFetch(user.token, api('/api/books/mine'))
```

Rules:
- Mechanical. Same URL, method, body and non-auth headers. Each call site's existing success and error handling stays.
- Convert every `fetch` in these four files that sends a bearer header, **except** the optional-auth read `fetchBook` in `BookDetail.tsx` (`GET /api/books/:id`), which may use `authFetch` or stay as it is: the server never answers it with a 401.
- `MyBooks.tsx` `fetchBooks` parses the body without checking `res.ok`, so a 401 body would be stored as the book list. Add the `res.ok` guard while converting.
- Do **not** convert `client/src/lib/feedback.ts`, `client/src/lib/narration/api.ts`, or anything under `client/src/components/`. Their 401 handling is deliberate (spec, Out of scope).
- Finish with `grep -n "Bearer" client/src/pages/*.tsx`: no hand-built bearer header should remain in the four pages.

**Tests to write:**
- One added test per page in its existing test file: a 401 from that page's first authed call dispatches `AUTH_EXPIRED_EVENT` (listen on `window` in the test) and the page does not throw.
- `MyBooks.test.tsx`: a 401 list response leaves the list empty rather than crashing.
- Existing tests must pass unedited apart from additions; they mock global `fetch`, which `authFetch` still calls.
- Wire-shape assertion required: no

**Done when:** listed tests pass, `cd client && npm test` green, typecheck and lint clean, the grep above is empty.

---

### Task 6 — Keep the Create-a-Book draft across the sign-in bounce

**Zone:** client
**Depends on:** Task 4
**Parallel-safe with:** 1, 2, 3 (see the note on Task 5 about `CreateBook.tsx`)

**Files to add or change:**
- `client/src/lib/createDraft.ts` — new
- `client/src/pages/CreateBook.tsx` — restore on mount, save on change, clear on success
- `client/src/context/AuthContext.tsx` — `logout()` clears the draft
- `client/src/lib/__tests__/createDraft.test.ts` — new; `client/src/pages/__tests__/CreateBook.test.tsx` — extended

**Signatures / shapes:**
```ts
// client/src/lib/createDraft.ts
export const CREATE_DRAFT_KEY = 'storybook-create-draft';

export interface CreateDraft {
  v: 1;
  step: number;                                   // 1 | 2 | 3
  theme: string;
  customTheme: string;
  stylePreset: string;
  cast: Array<{ role: CharacterRole; name: string; descriptor?: string; relationship?: string }>;
  ageRange: string;
  additionalDetails: string;
  previewMode: 'quick' | 'cover' | 'full';
  pageCount: number;
  styleReferenceUrl: string;
  customStyleDescriptor: string;
}

/** sessionStorage read. Returns null on a missing key, bad JSON, wrong `v`, or any field of the wrong type. Never throws. */
export function loadCreateDraft(): CreateDraft | null;
/** sessionStorage write. Swallows quota and access errors. */
export function saveCreateDraft(draft: CreateDraft): void;
export function clearCreateDraft(): void;
```

Rules:
- `sessionStorage`, not `localStorage`: the draft holds a child's name and must not outlive the tab.
- `CreateBook` seeds each `useState` from the draft with lazy initialisers, and assigns fresh `_id`s to restored cast members from the module counter. A restored cast must still contain exactly one `primary`; otherwise ignore the draft.
- Save in one effect keyed on the persisted fields. Do not persist `generating`, `error`, or the upload flags.
- Clear after a successful `/api/generate`, just before navigating to the new book.
- `AuthContext.logout()` (the explicit sign-out) calls `clearCreateDraft()`. The session-end path from Task 4 must not.
- No visual change. The copy at `CreateBook.tsx:558` ("Your choices here are kept…") stays; this task is what makes it true.

**Tests to write:**
- `client/src/lib/__tests__/createDraft.test.ts` — round trip; null on missing key, malformed JSON, `v: 2`, a field of the wrong type; `saveCreateDraft` does not throw when `sessionStorage.setItem` throws.
- `client/src/pages/__tests__/CreateBook.test.tsx` — fields filled in are in `sessionStorage` afterwards; mounting with a stored draft shows the step, theme, character name and age range from it; a successful generate clears the key; a draft with no primary character is ignored. Clear `sessionStorage` in `beforeEach`.
- `client/src/context/__tests__/AuthContext.test.tsx` — `logout()` clears the key; the session-end event does not.
- Wire-shape assertion required: no

**Manual verify:**
- Fill steps 1 and 2 on `/create`, reload: the wizard comes back as you left it. Sign out from the navbar, open `/create`: it is empty.

**Done when:** listed tests pass, `cd client && npm test` green, typecheck and lint clean.

---

### Task 7 — e2e: a dead token routes to sign-in and back, in both themes

**Zone:** e2e
**Depends on:** Tasks 3, 5 and 6
**Parallel-safe with:** 8

**Files to add or change:**
- `e2e/tests/mobile/session-expiry.spec.ts` — new; runs under `mobile-pixel` and `mobile-small`

**Signatures / shapes:**
```ts
import { registerOwner, seedAuth, deleteUsers } from '../_editPublished';
import { forEachTheme, expectNoHorizontalOverflow, expectTapTargets } from './_helpers';
// registerOwner's password is 'pw-test-1234'.

/** Ends the session server-side through the real logout route, and proves it is dead. */
async function killToken(request: APIRequestContext, token: string): Promise<void>;
//   POST {API_BASE}/api/auth/logout with the bearer  -> expect ok
//   GET  {API_BASE}/api/auth/me     with the bearer  -> expect status 401
```

Why logout stands in for expiry: the server answers an expired token and a revoked one with the same 401, so the browser cannot tell them apart. Expiry by clock is pinned in the server suite (Task 3). Say this in the spec file's header comment.

Two tests, each inside `forEachTheme`:

1. **Real server 401, return to the page.** Register, `seedAuth`, open `/my-books` and wait for it to render. `killToken`. Navigate away and back to `/my-books` **through navbar links, not a reload** (a reload would take the mount-check path, which does not redirect). Expect: URL is `/login`; the "Your session ended" notice is visible; `expectNoHorizontalOverflow`; `expectTapTargets`. Fill the email and `pw-test-1234`, submit. Expect: URL is `/my-books` and the page renders signed in.
2. **Wizard survives.** `page.route('**/api/generate', r => r.fulfill({ status: 401, json: { error: 'Not authenticated' } }))` **before anything else**, so this test cannot reach the paid route. Register, `seedAuth`, open `/create`, pick a theme, enter a character name and age range, go to step 3, press the generate button. Expect: URL is `/login` with the notice. Sign in. Expect: URL is `/create` and the theme, character name and age range are still there.

Rules:
- Unique users per test via `registerOwner`; `deleteUsers` in `afterAll`.
- Role-based selectors; wait on visible content, not on responses.
- State in the header comment which half of Done criterion #2 the spec claims: **correctness** (ADR-009). The aesthetic check of the notice is the manual step in Task 4.

**Tests to write:**
- The two above. Wire-shape assertion required: no

**Done when:** `cd e2e && npm test` green, the new spec passes in both mobile projects with no retry.

---

### Task 8 — Docs: conventions, call graph, env example

**Zone:** docs
**Depends on:** Tasks 3 and 4
**Parallel-safe with:** 7

**Files to add or change:**
- `docs/conventions/server.md` §Auth — replace "No expiration — token is invalidated by rotation or admin tombstone" with: 30-day absolute expiry, `TOKEN_TTL_DAYS` and its fallback table, sha256 at rest in `User.token`, one 401 for every dead token, restore clears the token. Point at `server/src/lib/authToken.ts`.
- `docs/conventions/client.md` §Auth — `authFetch` is how a page makes an authed call; a 401 on a bearer request ends the session; only a 401 clears it on mount; the two deliberate exceptions (`lib/feedback.ts`, `lib/narration/api.ts`); the `storybook-create-draft` sessionStorage key and when it is cleared.
- `docs/conventions/call-graph.md` — `auth` router now uses `lib/authToken`; pages reach routes through `lib/authFetch`. Regenerate with the greps in that file rather than editing rows by hand.
- `server/.env.example` — commented `TOKEN_TTL_DAYS=30` with one line on the 1 to 90 range.

Rules:
- `CLAUDE.md` is **not** edited by this task. If the owner wants `TOKEN_TTL_DAYS` or the expiry rule recorded there, that is his edit; mention it in the hand-back.
- Do not copy the spec's reasoning into the conventions. State the rules and link the spec.

**Tests to write:** none. `npm test` at the repo root (harness suite) must stay green.

**Done when:** the four files are updated, the harness suite is green, and no doc still says tokens never expire (`grep -rn "No expiration" docs/`).

---

### Task 9 — Pre-merge follow-ups

**Zone:** docs (harness) · **Depends on:** none (run last)

For each ADR-worthy item in the spec, ensure exactly one tracking action exists — a matching ADR, a linked issue, or an explicit `Deferred:` line with reasoning. The five items are one decision cluster and may be bundled into a single ADR (next free number is ADR-038) via `/create-adr`, with `**Scope:**` naming the `auth-token-expiry` spec.

Also open, and link from the ADR's Consequences, one follow-up issue for each deferral the spec names:
- Session table: multi-device sign-in, per-device revoke, "sign out everywhere" (spec, Alternatives → Option 3, including the migration path recorded there).
- Re-validate the session when a tab regains focus (spec, Out of scope).

**Done when:** `adr-tracking-check auth-token-expiry` reports zero orphaned items.

## Sequencing notes

- **Server chain is strictly serial:** 1 → 2 → 3. Never two server-zone agents at once; they share `test.db`.
- **Client chain** (4, then 5 and 6) is independent of the server chain and can run beside it. 5 and 6 both edit `CreateBook.tsx`: run them in sequence, or in separate worktrees and merge.
- **One PR.** Tasks 2 and 3 must not merge apart: Task 2 alone purges every token and adds a column nothing checks. Suggested commits: 1; 2+3; 4; 5; 6; 7; 8+9.
- **Deploy effect, for the PR body:** the next Render deploy runs `UPDATE "User" SET "token" = NULL;` on Neon, then adds the column and index. Every signed-in user signs in once. Quote the Postgres `migration.sql` in the PR body. Server (Render) and client (Pages) deploy from the same merge at different speeds; either order is safe because no wire shape changed.
- **Rollback:** reverting the server build after the migration ran signs everyone out again and breaks nothing. No column was removed.
- Rough size: Tasks 1 and 8, under an hour each; Tasks 2, 6, 7 and 9, one to two hours each; Tasks 3, 4 and 5, two to three hours each. About two working days end to end.

## Open questions

None for the developer. The decisions that need the owner are the five under "Owner decisions" in [spec.md](spec.md); they gate the whole plan and are resolved by the owner setting the spec to `Status: Accepted`.
