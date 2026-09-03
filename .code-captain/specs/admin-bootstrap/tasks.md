# ADMIN_BOOTSTRAP_EMAILS — env-driven admin promotion (+ auth email normalization) — task plan

> Spec: [spec.md](spec.md)
> Status: Accepted
> Last updated: 2026-09-02

## Overview

Six tasks across two scopes in one PR.

**Scope 1 — admin bootstrap (Tasks 1-3).** Task 1 is the whole behaviour (service + tests);
Task 2 is a ten-line wiring into `index.ts`; Task 3 is the operator surface (`render.yaml` +
`CLAUDE.md`). Strictly sequential — Task 2 imports what Task 1 exports, and Task 3 documents
what Task 2 makes real.

**Scope 2 — auth email normalization (Tasks 4-5), folded in 2026-09-02 with the user's
explicit go-ahead.** Task 4 is the server fix (normalise on write and read, plus the boot
backfill and its collision rule); Task 5 is two client input attributes and a test that pins
them. Task 6 files the ADRs and follow-up issues for both scopes.

Parallel cut: **Task 5 (client) is safe to run alongside Task 4 (server)** — different
workspaces, no shared file, no import edge. Everything else is sequential. Do **not** run
Task 4 concurrently with any other server-zone task: one `test.db`, single worker.

## Cross-cutting constraints

- **Wire-shape:** N/A **for scope 1** (no route added or changed, no `@storybook/shared` schema
  touched). **Required for scope 2:** `/register` and `/login` are touched, and nothing in
  `server/src/routes/__tests__/` currently pins either response with `toMatchObject` — verified
  2026-09-02; the only matches are `allowlist.test.ts:176` (a DB row) and `:225` (the allowlist
  delete envelope), and there is no `auth.test.ts` at all. Task 4 must add
  `toMatchObject({ id, email, name, role, token })` for both. Do **not** add a shared Zod schema
  or `validate()` middleware — the response shape is unchanged and that exceeds approved scope.
  Say all of this in the PR body so Check 4 reads as deliberate on both halves.
- **Auth middleware order:** N/A — no new route in either scope. Do **not** touch `requireAdmin`
  (`server/src/routes/auth.ts:29-34`), `adminGate` (`server/src/routes/admin.ts:84-99`),
  `getAuthUser`, token issuance, or the UUID session model. Scope 2 changes only the email
  *value* used in a `where` clause and a `create`.
- **Dark-mode parity:** N/A for both scopes, and for scope 2 that is a **ruling, not a skip**:
  the client edits add `autoCapitalize` / `autoCorrect` / `spellCheck` attributes and change
  **no `className`**, so there is no surface that could need a `dark:` partner. State it in the
  PR body so reviewer Check 3 reads as deliberate.
- **Migrations:** none. `role String @default("user")` already exists in both
  `server/prisma/schema.prisma:16` and `server/prisma/schema.postgresql.prisma:21`.
- **Guardrails touched:** **two** auth guardrails under CLAUDE.md, both pre-approved by the
  user. Scope 1 is an authorization change (env-var promotion at boot). Scope 2 is an
  authentication change (how `/register` and `/login` resolve an identity, and a one-time
  rewrite of stored `User.email` values). Implement both as specified and name both in the PR
  body. Any deviation from the pinned semantics needs a fresh check-in with the user, not a
  judgement call.
- **No schema change in either scope.** `User.email` is **already** `String @unique` in both
  `server/prisma/schema.prisma:12` and `server/prisma/schema.postgresql.prisma:16` — do not add
  it, do not change it, do not write a migration. A case-insensitive index is a follow-up issue
  (Task 6), not work here.
- **Test DB is shared.** `server/vitest.config.ts` runs single-worker against
  `server/prisma/test.db`. Never run two server-zone suites at once.

## Tasks

### Task 1 — `reconcileAdmins()` service and its behaviour tests

**Zone:** server
**Depends on:** none
**Parallel-safe with:** none

**Files to add or change:**
- `server/src/services/adminBootstrap.ts` — new; `reconcileAdmins()` + result type.
- `server/src/services/allowlist.ts` — extract and export `parseEmailList`; `bootstrapAllowlist()` calls it. Behaviour must not change.
- `server/src/services/__tests__/adminBootstrap.test.ts` — new.

**Signatures / shapes:**
```ts
// server/src/services/allowlist.ts — extracted, exported, behaviour identical
export function parseEmailList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return Array.from(new Set(
    raw.split(',').map(normalizeEmail).filter(e => e.length > 0 && e.includes('@')),
  ));
}

// server/src/services/adminBootstrap.ts
export interface AdminBootstrapResult {
  promoted: string[];  // emails whose role went user -> admin this boot
  demoted:  string[];  // emails whose role went admin -> user this boot
  missing:  string[];  // listed emails with no live (deleted_at: null) user row
  skipped:  boolean;   // true when the var was absent/blank/unparseable: zero writes
}

/** Sentinel: demote every admin, promote nobody. Not a valid address, so it
 *  cannot collide with a real one. */
export const DEMOTE_ALL_SENTINEL = 'none';

export async function reconcileAdmins(): Promise<AdminBootstrapResult>;
```

Behaviour, in order:
1. `raw = process.env.ADMIN_BOOTSTRAP_EMAILS`. If `!raw?.trim()` → `{ promoted: [], demoted: [], missing: [], skipped: true }`, no DB access.
2. If `normalizeEmail(raw) === DEMOTE_ALL_SENTINEL` → target set is empty; go to step 5 with `emails = []`.
3. `emails = parseEmailList(raw)`. If empty → `console.warn` that the var is set but contains no usable address, return `skipped: true`, no writes.
4. **Promote:** `prisma.user.updateMany({ where: { email: { in: emails }, deleted_at: null, role: { not: 'admin' } }, data: { role: 'admin' } })`. Read the affected emails first (a `findMany` on the same filter) so `promoted` can list them.
5. **Demote:** find then `updateMany({ where: { role: 'admin', email: { notIn: emails } }, data: { role: 'user' } })`. With `emails = []` this demotes every admin — the sentinel path.
6. **Missing:** listed emails with no `deleted_at: null` user row.

**Stored emails are NOT normalised — verified 2026-09-02, this assumption was wrong in an
earlier draft.** `server/src/routes/auth.ts` never imports `normalizeEmail`: `/register`
checks the allowlist with a normalised copy but writes `prisma.user.create({ data: { email } })`
with the raw request value, so `User.email` can hold `Nick@Gmail.com`. A plain
`where: { email: { in: lowercasedEmails } }` would therefore silently MISS exactly the admin
it was meant to promote.

Do not add `mode: 'insensitive'` — it is a Postgres-only Prisma option and would break the
SQLite dev/test path. Instead match in application code: `findMany` the candidate rows
(`deleted_at: null`), compare `normalizeEmail(row.email)` against the parsed set in JS, and
drive both `updateMany` calls by the resulting `id` lists rather than by email. Same for
`demoted` (`role: 'admin'` rows whose normalised email is not in the set) and for `missing`.

Add a test for this directly: create a user whose stored email has mixed case, list the
lowercase form in the var, and assert it is promoted.

**Tests to write:**
- `server/src/services/__tests__/adminBootstrap.test.ts` — `beforeEach(resetDatabase)`, `afterEach(vi.unstubAllEnvs)`, `vi.stubEnv('ADMIN_BOOTSTRAP_EMAILS', ...)`, and `allowEmail()` before every `/register`. Mirror the setup in `server/src/routes/__tests__/allowlist.test.ts:83-92`. Assert:
  - promotes a registered listed user; `promoted` names it; a second identical run returns empty `promoted`/`demoted` (idempotent).
  - `'  Owner@Example.COM '` promotes the row stored as `owner@example.com`.
  - an unregistered listed address lands in `missing`, creates **no** user row (`prisma.user.count()` unchanged), and is promoted on a later run once registered.
  - an admin whose email is not in the var is demoted to `user`; the row still exists with its books/token intact.
  - unset, `'   '`, and `',,not-an-email'` are each total no-ops: `skipped === true` and a pre-existing admin keeps `role: 'admin'`.
  - `'none'` (and `'NONE '`) demotes every admin and promotes nobody.
  - a soft-deleted listed user is not promoted.
- Existing `server/src/routes/__tests__/allowlist.test.ts` stays green **unedited** — that is the proof the `parseEmailList` extraction was behaviour-preserving.
- Wire-shape assertion required: **no** — no route response involved.

**Done when:** listed tests pass, `cd server && npm test` green, no new TS errors.

---

### Task 2 — Wire the reconcile into server start

**Zone:** server
**Depends on:** Task 1
**Parallel-safe with:** none

**Files to add or change:**
- `server/src/index.ts` — import at the `bootstrapAllowlist` import (line 35); new `void` block inside the `app.listen` callback, immediately after the allowlist block that ends at line 129.

**Signatures / shapes:**
```ts
import { reconcileAdmins } from './services/adminBootstrap';

// Reconcile admin roles from ADMIN_BOOTSTRAP_EMAILS. Unlike the allowlist
// bootstrap above this runs on EVERY boot: the env var is the source of truth,
// so removing an address demotes it. Unset/blank/unparseable is a total no-op.
// Failure is logged, never fatal.
void reconcileAdmins()
  .then(({ promoted, demoted, missing }) => {
    if (promoted.length) console.log(`[admin-bootstrap] promoted ${promoted.length}: ${promoted.join(', ')}`);
    if (demoted.length)  console.log(`[admin-bootstrap] demoted ${demoted.length}: ${demoted.join(', ')}`);
    if (missing.length)  console.log(`[admin-bootstrap] not registered yet, will retry next boot: ${missing.join(', ')}`);
  })
  .catch((err: unknown) => console.error('[admin-bootstrap] reconcile failed', err));
```

Quiet when nothing changed, matching the allowlist block's `if (seeded.length > 0)` habit.
The two calls stay independent — do not chain `reconcileAdmins` off the allowlist promise.

**Tests to write:** none. `index.ts` has no test harness in this repo, and the behaviour is
fully covered by Task 1. Verify by hand instead.

**Manual verify:**
1. `cd server && npm run dev:server` with `ADMIN_BOOTSTRAP_EMAILS` **unset** → no `[admin-bootstrap]` output, `demo@storybook.local` keeps `role: 'admin'`.
2. Register a throwaway address locally, add it to `server/.env` as `ADMIN_BOOTSTRAP_EMAILS`, restart → log line names it, and `GET /api/auth/me` with that token reports `role: "admin"`.
3. Set the var to `none`, restart → both admins demoted, `/api/admin/users` returns 403 for that token.
4. Restore the var to the demo admin's address, restart → admin back. Leave the local `.env` var **unset** when done.

**Done when:** the four manual steps behave as written, `cd server && npm test` green, no new TS errors.

---

### Task 3 — Declare the var and document the semantics

**Zone:** docs
**Depends on:** Task 2
**Parallel-safe with:** none

**Files to add or change:**
- `render.yaml` — new `envVars` entry after the `ALLOWLIST_BOOTSTRAP_EMAILS` block (lines 63-67), same comment style.
- `CLAUDE.md` — extend the "Registration allowlist" section (lines 108-116); retitle it **"Registration allowlist and admin bootstrap"** and update the pointer to it if any exists elsewhere in the file.

**Signatures / shapes:**
```yaml
      # Grants role:'admin' to already-registered users at server start
      # (server/src/services/adminBootstrap.ts). Comma-separated. UNLIKE the
      # allowlist bootstrap above, this reconciles on EVERY boot: the var is the
      # source of truth, so removing an address DEMOTES that admin on the next
      # restart, and a manually promoted admin is demoted too. Unset, blank, or
      # unparseable = total no-op (a typo cannot mass-demote). The literal value
      # `none` demotes every admin and promotes nobody — that is the lever for
      # going live with no standing admin access. Never creates a user: list the
      # address, have them register normally, then restart.
      - key: ADMIN_BOOTSTRAP_EMAILS
        sync: false
```

The `CLAUDE.md` addition covers, in the existing bullet voice: what the var does; that it
reconciles every boot rather than once; that demotion is real and `none` clears the admin set;
that it never creates a user, so registration (and therefore the allowlist) still comes first;
that unset is a total no-op and should stay unset locally so `demo-seed.ts`'s admin survives.

**Tests to write:** none. `server/src/__tests__/rateLimitScope.test.ts` parses `render.yaml` —
confirm it still passes after the edit (it asserts on `numInstances`, which this does not touch).

**Done when:** `render.yaml` parses (`cd server && npm test` includes the rateLimitScope parse),
`CLAUDE.md` reads correctly, no TS changes.

---

### Task 4 — Normalise email on the auth path, and backfill existing rows

**Zone:** server
**Depends on:** Task 3 (ordering only — no code dependency on Tasks 1-3)
**Parallel-safe with:** Task 5

**Files to add or change:**
- `server/src/routes/auth.ts` — normalise in `/register` (allowlist check, duplicate check, and the `create`) and in `/login`.
- `server/src/services/emailBackfill.ts` — new; `backfillUserEmails()` + result type.
- `server/src/services/__tests__/emailBackfill.test.ts` — new; collision and tombstone table.
- `server/src/routes/__tests__/auth-normalization.test.ts` — new; the round-trip plus the two wire-shape assertions.
- `server/src/index.ts` — run the backfill **before** `reconcileAdmins()`.

**Signatures / shapes:**
```ts
// server/src/routes/auth.ts — /register, replacing lines 52, 58, 64-70
const normalized = normalizeEmail(email);           // import from '../services/allowlist'

if (!(await isEmailAllowed(normalized))) { /* 403, unchanged copy */ }

// NOTE the dropped `deleted_at: null` filter. The unique index spans tombstoned
// rows, so filtering them out here meant `create` threw P2002 and the global
// handler (index.ts:99) returned a generic 500. 409 is the honest answer.
const existing = await prisma.user.findFirst({ where: { email: normalized } });
if (existing) { /* 409, unchanged copy */ }

const user = await prisma.user.create({
  data: { email: normalized, name, password_hash: hashPassword(password), token },
});

// server/src/routes/auth.ts — /login, replacing line 85
const user = await prisma.user.findFirst({
  where: { email: normalizeEmail(email), deleted_at: null },
});
```

Response bodies stay byte-for-byte identical: `{ id, email, name, role, token }`. `getAuthUser`,
`requireAdmin`, token issuance, and the legacy-hash upgrade at `auth.ts:93-103` are untouched.

```ts
// server/src/services/emailBackfill.ts
export interface EmailBackfillResult {
  normalized: string[];   // emails rewritten this boot, as their NEW lowercase value
  collisions: Array<{     // groups that could not be fully normalised
    normalizedEmail: string;
    keptId: string;       // the elected row, now holding normalizedEmail
    skipped: Array<{ id: string; email: string; deleted: boolean }>;
  }>;
}

/** Lowercase every User.email that is not already normalised. Idempotent:
 *  the steady state is one findMany and zero writes. Never merges or deletes. */
export async function backfillUserEmails(): Promise<EmailBackfillResult>;
```

Algorithm, in order — resolve collisions in application code so `P2002` is never reached:

1. `prisma.user.findMany({ select: { id: true, email: true, deleted_at: true, created_at: true } })`.
   **No `deleted_at` filter.** The unique index spans tombstones, so a tombstoned
   `Nick@G.com` would otherwise block a live `nick@g.com` with a `P2002` — a crash in exactly
   the case this exists to handle.
2. Group rows by `normalizeEmail(row.email)`.
3. Groups of one whose `email` already equals the normalised form: skip, no write. This is the
   expected steady state and must produce zero queries beyond step 1.
4. Groups of more than one: elect one row. **A live row (`deleted_at === null`) beats a
   tombstoned row; between two live rows, the older `created_at` wins.** Update only the elected
   row. Push the group to `collisions` and `console.warn` it with both ids and both stored
   emails. **Never merge, never delete, never touch the non-elected rows' data.**
5. Groups of one needing a rewrite: single `update` by `id`.

Then in `server/src/index.ts`, sequence the backfill ahead of `reconcileAdmins()` — both write
`User` rows, so chaining is cheaper to reason about than two racing `void` blocks. This
supersedes the standalone block specified in Task 2:

```ts
void backfillUserEmails()
  .then(({ normalized, collisions }) => {
    if (normalized.length) console.log(`[email-backfill] normalised ${normalized.length}: ${normalized.join(', ')}`);
    for (const c of collisions) {
      console.warn(`[email-backfill] COLLISION on ${c.normalizedEmail}: kept ${c.keptId}, skipped ${c.skipped.map(r => `${r.id} (${r.email})`).join(', ')} — resolve via /api/admin/users`);
    }
  })
  .catch((err: unknown) => console.error('[email-backfill] failed', err))
  .finally(() => { /* reconcileAdmins() block from Task 2 moves here */ });
```

Best-effort and never fatal, matching `bootstrapAllowlist`. `reconcileAdmins` must still run
even if the backfill throws — hence `.finally`, not `.then`.

**Tests to write:**
- `server/src/routes/__tests__/auth-normalization.test.ts` — `beforeEach(resetDatabase)`, `allowEmail()` before every `/register`:
  - register `'  Nick@Gmail.com '` → 201, stored `User.email` is `nick@gmail.com`, and `POST /login` with `nick@gmail.com` returns 200. This is the reported bug.
  - register `nick@gmail.com`, then register `NICK@gmail.com` → **409**, and `prisma.user.count()` is 1. This is the duplicate-account hole.
  - login with `'  NICK@GMAIL.COM '` finds the row registered as `nick@gmail.com`.
  - an address that is allowlisted only in lowercase still registers when typed mixed-case (proves the allowlist gate did not regress).
  - registering an address whose only row is soft-deleted returns **409**, not 500.
  - **Wire-shape assertion required: yes.** `expect(res.body).toMatchObject({ id: expect.any(String), email: 'nick@gmail.com', name: 'Nick', role: 'user', token: expect.any(String) })` on the `/register` 201 **and** on the `/login` 200. All five fields on both. Nothing else in the repo pins these.
- `server/src/services/__tests__/emailBackfill.test.ts` — seed rows with `prisma.user.create` directly (bypassing `/register`, which now normalises):
  - a mixed-case row is lowercased and named in `normalized`; a second run returns empty `normalized` (idempotent).
  - an already-lowercase-only table is a total no-op: `normalized` and `collisions` both empty.
  - two live rows colliding: the **older** keeps/gets the normalised address, the newer keeps its stored email, both rows still exist, `collisions` has one entry, nothing throws.
  - a tombstoned mixed-case row colliding with a live lowercase row: the **live** row wins, the tombstone is untouched, no `P2002`.
  - a tombstoned mixed-case row with no collision **is** normalised (a later restore must not resurrect the bug).
  - after a backfill, the previously mixed-case user can `POST /login` with the lowercase form.
- Existing suites stay green **unedited** — in particular the four `bootstrapAllowlist` tests at `server/src/routes/__tests__/allowlist.test.ts:83-125`, and `auth-hashing.test.ts`, whose fixtures already use lowercase addresses.

**Manual verify:**
1. `npm run dev:server`, register a throwaway `Test@Example.com` via curl, confirm the row is stored lowercase, then log in as `test@example.com` → 200.
2. Insert a mixed-case row by hand, restart, confirm the `[email-backfill]` log line names it and the row is lowercase.

**Done when:** listed tests pass, `cd server && npm test` green, no new TS errors.

---

### Task 5 — Stop mobile keyboards from capitalising the email field

**Zone:** client
**Depends on:** none
**Parallel-safe with:** Task 4

**Files to add or change:**
- `client/src/pages/Register.tsx` — the email `<input>` at line 57.
- `client/src/pages/Login.tsx` — the email `<input>` at line 46.
- `client/src/pages/__tests__/authEmailInput.test.tsx` — new. Neither page has a test file today.

**Signatures / shapes:**
```tsx
<input
  type="email"
  autoCapitalize="none"   // iOS capitalises the first letter by default; this is the actual fix
  autoCorrect="off"
  spellCheck={false}
  value={email}
  onChange={e => setEmail(e.target.value)}
  required
  className="… unchanged …"   // do NOT touch className — see dark-mode ruling below
/>
```

Attributes only. **Do not change any `className`**, do not restyle, do not touch the password
inputs or the `autoComplete` policy — those are out of scope. This is defence in depth, not a
duplicate of Task 4: the server fix makes the value *correct*, this one stops the wrong value
being typed and echoed back in the field.

**Tests to write:**
- `client/src/pages/__tests__/authEmailInput.test.tsx` — render each page inside `<MemoryRouter>` (follow the wrapper in `client/src/pages/__tests__/NotFound.test.tsx:19-27`; both pages consume `useAuth` from `../context/AuthContext`, so wrap in the real provider or mock the hook, whichever the existing page tests do). Assert on each email input: `toHaveAttribute('autocapitalize', 'none')`, `toHaveAttribute('autocorrect', 'off')`, and `type="email"` still present.
- Wire-shape assertion required: **no** — client only, no route response.

**Manual verify:**
- Both `/login` and `/register` render unchanged in **light and dark mode**. This is the
  *correctness* half of done-criterion #2 only — nothing visual changed, because no `className`
  changed. Say that explicitly rather than claiming a full visual pass.

**Done when:** listed tests pass, `cd client && npm test` green, `npm run typecheck` and `npm run lint` clean, no visual diff in either theme.

---

### Task 6 — Pre-merge follow-ups

**Zone:** docs (harness) · **Depends on:** none (run last)

For each ADR-worthy item in `spec.md`, ensure exactly one tracking action exists — a matching
ADR via `/create-adr`, a linked issue, or an explicit `Deferred:` line with reasoning:
1. Reconcile-every-boot vs. seed-once → ADR (next free number after ADR-020).
2. Demotion in scope, with the no-op guards and the `none` sentinel → ADR (may share one ADR with item 1 if they read as a single decision; if merged, say so in the spec).
3. No in-app role management UI/endpoint → `Deferred:` line in `spec.md` pointing at the Alternatives section, or a filed issue.
4. Scope 2: backfill + normalise-on-write, with a plain normalised read path (Decision 5) → ADR. May share one ADR with item 5 if they read as a single decision; say so in the spec if merged.
5. Scope 2: the collision rule — elect one row, skip the rest, never merge or delete, tombstones participate (Decision 6) → ADR. This one matters most: it is a permanent account-reachability trade-off a future reader will otherwise file as a bug.
6. Scope 2: case-insensitive unique index on `User.email` (`citext` or a functional index on `lower(email)`) → **filed issue, not an ADR**. Note in the issue that it can only run once the `[email-backfill] COLLISION` log is empty.
7. Scope 2: no `AuthUserResponseSchema` in `@storybook/shared` and no `validate()` on the auth routes → `Deferred:` line or a filed issue.

Also file the backlog issue this spec was written without, and link it in the spec's `Backlog:`
line and the PR body.

**Done when:** `adr-tracking-check admin-bootstrap` reports zero orphaned items.

## Sequencing notes

- Sequential except for the Task 4 / Task 5 pair (server vs. client, no shared file). One PR on
  `agent/feat/admin-bootstrap`. Commit per task so a bad wiring step can be reverted without
  losing the service.
- **Task 4 edits `server/src/index.ts` again**, replacing the standalone `reconcileAdmins()`
  block Task 2 added with a chained `backfillUserEmails() → reconcileAdmins()` sequence. Expect
  that diff; it is intended, not a merge artefact.
- **Scope 2 is the beta blocker, scope 1 is not.** If the PR has to be split under time
  pressure, Tasks 4-5 ship first — testers cannot log in without them, whereas the admin
  bootstrap only blocks the owner, who still has `psql` as break-glass.
- Never run a second server-zone suite concurrently — one `test.db`, single worker.
- The live deploy needs a **manual restart** after `ADMIN_BOOTSTRAP_EMAILS` is set in the
  Render dashboard. Merging is not enough, and the var is `sync: false`, so it must be entered
  by hand. Call this out in the PR body as the post-merge step.
- Free-plan Postgres expires 2026-09-14. If the database is recreated, the admin returns on the
  next boot with no action, which is a small side benefit of Decision 1.

## Open questions

- Which address goes in the production var first? The owner's registration must exist before
  the promotion has anything to act on — order is: merge, set var, register, restart.
- Nobody can enumerate production `User` rows until scope 1 ships, so it is unknown whether any
  mixed-case row exists at all. This is **not** a blocker: the backfill is correct and cheap
  either way (Decision 5), and the first post-deploy boot log answers it. If
  `[email-backfill] COLLISION` fires, resolving those accounts is a separate conversation with
  the user — never an agent judgement call, since the only fixes are merge or delete.
