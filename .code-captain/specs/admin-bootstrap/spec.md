# ADMIN_BOOTSTRAP_EMAILS — env-driven admin promotion (+ auth email normalization)

> Status: Accepted
> Last updated: 2026-09-02
> Backlog: no issue yet — file one alongside the ADRs (see Pre-merge follow-ups)

## Problem

On the deploy running right now (`https://storybook-server-t84f.onrender.com`, client at
`https://slickg0ose.github.io/storybook/`) **no user has `role: 'admin'`, and there is no
supported way to create one.** `render.yaml:45` runs `prisma/seed.ts` at build time, which
inserts 6 demo books and zero users. The only code in the repo that ever writes
`role: 'admin'` is `server/prisma/demo-seed.ts:206-219`, which is *not* in the Render build
command. `ALLOWLIST_BOOTSTRAP_EMAILS` (`server/src/services/allowlist.ts:37`) only decides who
may *register*; it does not grant a role. `requireAdmin` (`server/src/routes/auth.ts:29-34`)
gates on `user.role !== 'admin'`, so `/admin` and every `/api/admin/*` route return 403 to
everyone — including the repo owner. Today the only way in is a manual `psql UPDATE` against
the Render Postgres instance.

The fix must also work in the other direction. The stated end state is that **no real live
admin access exists once there is real tester data**, so revoking admin has to be as cheap as
granting it: an env-var edit plus a restart, never a code deploy.

## Constraints

- **Auth/authorization change — a CLAUDE.md guardrail.** The user has already given explicit
  go-ahead on this mechanism (env-var promotion at server start). No further design latitude:
  the developer implements what is pinned below and surfaces the guardrail in the PR body.
- No Prisma schema change. `role String @default("user")` already exists in **both**
  `server/prisma/schema.prisma:16` and `server/prisma/schema.postgresql.prisma:21`.
- No new dependency.
- Server zone only for code, plus `render.yaml` and the "Registration allowlist" section of
  `CLAUDE.md`. No shared or e2e changes. **Amended 2026-09-02:** Scope 2 below adds two
  client input-attribute edits (`Register.tsx`, `Login.tsx`); still no shared or e2e change.
- Emails normalise through the existing `normalizeEmail` (trim + lowercase) so casing cannot
  create a bypass or a near-miss.
- Tests live under `server/src/`, and must opt addresses onto the registration allowlist via
  `allowEmail()` in `server/src/__tests__/setup.ts`.
- **Ruled out, do not revisit:** adding `npx tsx prisma/demo-seed.ts` to the Render build. It
  would publish a live admin account with the hardcoded password `demo!2026`
  (`server/prisma/demo-seed.ts:28`).

## Proposed shape

A new service, `server/src/services/adminBootstrap.ts`, exporting `reconcileAdmins()`. It is
called at server start from `server/src/index.ts`, in a `void ... .then().catch()` block
immediately after the existing `void bootstrapAllowlist()` block at `index.ts:122` — same
best-effort shape, same "log, never fatal" rule. The two calls are independent; neither
depends on the other's result.

The operator flow is: put the address in `ADMIN_BOOTSTRAP_EMAILS` in the Render dashboard, the
person registers normally through `POST /api/auth/register` with their own password (they must
also be on `ALLOWLIST_BOOTSTRAP_EMAILS` or the allowlist table to get that far), and the next
boot promotes them. No password ever appears in config, and no user row is ever created by this
path.

**The env var is the source of truth, reconciled on every boot** — not a one-shot seed. This is
the one place the design deliberately diverges from `bootstrapAllowlist()`, which only runs
against an empty table. That guard is unavailable here: the `User` table is never empty once
anyone registers, so "only when empty" would mean "only on the very first boot of a fresh
database," which is exactly the state we are already stuck in. The four decisions below pin
what reconcile means.

### Decision 1 — Reconcile on every boot (env var is the source of truth)

Every boot, the set of admins is made to equal the set of parseable addresses in
`ADMIN_BOOTSTRAP_EMAILS`. Chosen over promote-once because:

- **Revocation is the harder half of the requirement.** With promote-once, removing admin
  needs either a manual `psql UPDATE` (the exact problem being solved) or a *new* role-editing
  admin endpoint — more code and more attack surface than an env edit.
- **Listed-before-registered resolves itself.** The normal sequence is that an address is in
  the var days before that person registers. Reconciling every boot retries automatically;
  promote-once would need its own retry rule anyway.
- **One rule to reason about.** "Admins are whoever is in the var" is auditable by reading the
  Render dashboard. Promote-once makes the live admin set a function of deploy history.

The cost, stated plainly: a manually promoted admin (psql, or a local `demo-seed.ts` run) is
demoted on the next boot whenever the var is set. That is intended — see Risks.

### Decision 2 — Yes, demotion, with three guards

An admin whose email is not in the var is set back to `role: 'user'`. Guards against the
"empty var demotes everyone" footgun:

1. **Unset or blank ⇒ total no-op.** No promotions, no demotions, no writes. An absent var
   means "this deployment does not manage admins here," which is the correct reading for local
   dev and for the current production box before the var is set.
2. **Present but no parseable address ⇒ total no-op, with a `console.warn`.** A var of `,,`
   or `not-an-email` is a typo, not an instruction to clear the admin set. Refusing to act on
   an unparseable value is what stops a fat-fingered dashboard edit from locking everyone out.
3. **Demotion never deletes.** It writes `role: 'user'` and nothing else — account, books,
   orders, and token are untouched. Re-add the email, restart, and admin is back.

Because guards 1 and 2 make "clear the var" a no-op, going to **zero admins** needs an explicit
instruction: the sentinel value **`ADMIN_BOOTSTRAP_EMAILS=none`** demotes every admin and
promotes nobody. `none` is not a valid address, so it cannot collide with a real one, and it
survives `normalizeEmail` unchanged. This is the lever for the stated end state — going live
with real tester data and no standing admin access — and it is an env edit plus a restart, no
deploy.

There is deliberately **no** "never demote the last admin" rule. Such a rule would make the
end state unreachable, which is the requirement that matters most here.

### Decision 3 — Listed addresses with no user row are skipped, never created

Promotion is an `updateMany` over existing rows filtered by `deleted_at: null`. An address with
no matching row is collected into `missing` and logged once per boot at `console.log` level:
this is the *expected* steady state in the window between setting the var and the person
registering, so it is information, not an error. It is retried on every subsequent boot for
free, which is Decision 1 doing its job. A soft-deleted user is never promoted — tombstoned
accounts already fail `getAuthUser` (`auth.ts:21`), and promoting one would leave a dormant
admin row waiting on a restore.

### Decision 4 — New file, not an extension of `allowlist.ts`

`server/src/services/adminBootstrap.ts`. `allowlist.ts` answers "may this address create an
account" against `AllowedEmail`; this answers "what role does this account have" against
`User`. Different table, different lifecycle (reconcile-always vs. seed-once-when-empty), and
co-locating them invites the reader to assume both share the "only when empty" rule — the one
assumption that is most dangerous to carry across. The shared piece is the parser: extract
`parseEmailList(raw: string | undefined): string[]` into `allowlist.ts` (exported), have
`bootstrapAllowlist()` use it, and import it plus `normalizeEmail` from the new file. That
keeps one definition of "what counts as a listed address."

### Schema / contract changes

**None.** No Prisma migration, no route added or changed, no `@storybook/shared` Zod schema
touched. No wire-shape assertion applies to this work (reviewer Check 4 is N/A — say so in the
PR body rather than leaving it ambiguous). No client change **in scope 1**, so dark-mode
parity is N/A for it. Scope 2 changes two client inputs and two server routes — see
"Schema / contract changes (scope 2)" below, which has its own Check 3 and Check 4 rulings.

### Data flow

```
Render dashboard: ADMIN_BOOTSTRAP_EMAILS="owner@example.com"
        ↓ (deploy or manual restart)
server/src/index.ts  app.listen callback
        ↓ void reconcileAdmins()
services/adminBootstrap.ts
    parseEmailList(process.env.ADMIN_BOOTSTRAP_EMAILS)
    ├─ undefined / blank / no valid entry → { skipped: true }, no writes
    ├─ ["none"]  → demote all, promote none
    └─ [emails]  → prisma.user.updateMany promote (email in list, deleted_at null, role≠admin)
                   prisma.user.updateMany demote  (role = admin, email notIn list)
                   missing = listed emails with no user row
        ↓
console.log summary (only when something changed or something is missing)
```

State lives entirely in `User.role`. Nothing is cached; the next boot recomputes from the env
var. Single-instance is load-bearing already (ADR-018, `render.yaml:22-28`), so two processes
cannot race this reconcile.

### Files likely touched

- `server/src/services/adminBootstrap.ts` — new; `reconcileAdmins()` and its result type.
- `server/src/services/allowlist.ts` — extract and export `parseEmailList`; `bootstrapAllowlist` uses it.
- `server/src/index.ts` — import and the startup `void reconcileAdmins()` block after line 129.
- `server/src/services/__tests__/adminBootstrap.test.ts` — new; the behaviour table.
- `render.yaml` — declare `ADMIN_BOOTSTRAP_EMAILS` with `sync: false` and a comment.
- `CLAUDE.md` — "Registration allowlist" section gains an admin-promotion subsection.

## Scope 2 — email normalization in the auth path

> Folded into this spec and this PR on **2026-09-02** with the user's explicit go-ahead. It is
> a separate bug from admin bootstrap, but it lands in the same file (`server/src/routes/auth.ts`),
> ships under the same auth guardrail, and blocks the same beta invite. Splitting it out would
> serialise two auth-path branches over one file for no gain.

### Problem (verified by grep, 2026-09-02)

`server/src/routes/auth.ts` **never imports `normalizeEmail`.** The only importers in the repo
are `server/src/routes/admin.ts:29` and `server/src/routes/test.ts:13`.

- `POST /register` (`auth.ts:36-74`) calls `isEmailAllowed(email)` at line 52, which normalises
  **internally, for the `AllowedEmail` lookup only**. The duplicate check at line 58 is
  `findFirst({ where: { email, deleted_at: null } })` — raw. `prisma.user.create({ data: { email, ... } })`
  at line 64 stores the **raw request value**.
- `POST /login` (`auth.ts:85`) is `findFirst({ where: { email, deleted_at: null } })` — raw.
- `client/src/pages/Register.tsx:57` and `client/src/pages/Login.tsx:46` are bare `type="email"`
  with no `autoCapitalize` / `autoCorrect`. iOS autocapitalises the first letter by default.

Three consequences: (a) register as `Nick@Gmail.com`, log in as `nick@gmail.com` → permanent
401; (b) mobile testers hit this by default, not by accident; (c) `Nick@Gmail.com` and
`nick@gmail.com` can both register as separate accounts against a single `AllowedEmail` row.

Live beta blocker: the deploy is up at `https://storybook-server-t84f.onrender.com` and
family/friend testers are about to be invited.

### Correction to the brief — `User.email` is **already** `@unique`

The brief says not to add `@unique` on `User.email` because a collision would make the
migration unrunnable. Read the schema: the index **already exists**, in both
`server/prisma/schema.prisma:12` and `server/prisma/schema.postgresql.prisma:16`
(`email String @unique`). Two things follow, and they redirect the design:

1. **No migration is needed or wanted**, so the brief's conclusion holds — just for a different
   reason. Nothing to add.
2. **The existing index does not close the duplicate-account hole.** String equality is
   case-sensitive in both Postgres and SQLite, so `Nick@Gmail.com` and `nick@gmail.com` are
   two distinct values and both rows can exist under the unique index today. Consequence (c)
   above is real, not hypothetical.
3. **The collision risk moves from a migration to the backfill's `UPDATE`.** Lowercasing a row
   whose normalised form already belongs to another row raises Prisma `P2002`. Unhandled, that
   is an unhandled rejection in a startup path — the crash the brief rules out. Decision 6
   handles it explicitly.

The thing that *would* close the hole at the database level is a case-insensitive unique index
(Postgres `citext`, or a functional index on `lower(email)`). That is Postgres-only, has no
SQLite equivalent for the dev/test path, and is exactly the migration that becomes unrunnable
if a collision exists — so it stays a follow-up issue, filed in the final task, not work here.

### Decision 5 — Both: one-time backfill **and** normalise-on-write

`normalizeEmail` is applied on write in `/register`, on lookup in `/register` and `/login`, and
a boot-time reconcile (`backfillUserEmails()`) lowercases any `User.email` that is not already
normalised. Read paths do a plain normalised lookup — **no** case-insensitive fallback.

Why both rather than either alone:

- **Normalise-on-write alone locks out existing rows.** If a stored row is `Nick@Gmail.com` and
  `/login` looks up `nick@gmail.com`, that account is permanently 401 — the reported bug,
  inverted, which is the exact failure mode the brief warns about. Nobody can currently
  enumerate whether such rows exist (the production Postgres dates to ~2026-06-16; `AllowedEmail`
  only landed 2026-08-15 in `8ca0eda`, so the June window had no allowlist gate at all, and
  `/api/admin/users` needs the admin that scope 1 is still building). The design has to be
  correct without that knowledge, which rules out "assume the table is already clean".
- **Backfill alone leaves the hole open going forward.** The next mixed-case registration
  re-creates the problem the moment it lands.
- **Together they are self-limiting.** Once writes are normalised, the backfill's steady state
  is one `findMany` returning zero rows and zero writes, on every boot, forever.

Rejected alternative — **normalise on write, tolerant (case-insensitive) lookup on read**:

**Pros:** no data migration; no collision handling; existing mixed-case rows keep working.
**Cons:** Prisma's `mode: 'insensitive'` is **Postgres-only** and would break the SQLite dev
and CI path — the same constraint already recorded in Task 1 for `reconcileAdmins`. The
portable fallbacks are worse: scanning the whole `User` table on every login attempt is a
non-starter, and leaning on SQLite's ASCII-case-insensitive `LIKE` is an accident waiting to
happen. It also keeps the duplicate-account ambiguity permanently, and puts branching logic on
the hottest, most security-sensitive path in the app.
**Why rejected:** it is more complexity in a worse place, and it never converges. The backfill
converges the data once and the read path stays a single, boring lookup.

### Decision 6 — On collision: skip, log loudly, never merge or delete. Tombstones participate.

A collision is two or more rows whose emails normalise to the same address. The backfill
resolves it in application code **before** writing, so `P2002` is never reached:

1. `findMany` **every** `User` row (`id`, `email`, `deleted_at`, `created_at`) — no
   `deleted_at` filter, see below.
2. Group by `normalizeEmail(email)`. A group of one whose stored email already equals its
   normalised form needs no write — this is the steady state.
3. In a group of more than one, exactly one row is elected to hold the normalised address.
   **Election order: a live row (`deleted_at: null`) beats a tombstoned row; between two live
   rows, the older `created_at` wins.** Deterministic, and the older account is the one with
   more history behind it.
4. Every non-elected row in the group is **left exactly as it is** — email untouched, row not
   deleted, books/orders/token intact — and reported in `collisions`, logged at `console.warn`
   with both ids and both stored emails.
5. The elected row is lowercased with a single `update`. Because the group's other members keep
   their distinct mixed-case values, the unique index cannot be violated.

The honest cost, stated rather than hidden: **a non-elected live row becomes unreachable via
`/login`**, since login now looks up the normalised address and the elected row owns it. That
is accepted, because the alternatives are worse. Merging two accounts means moving books and
orders between users — a data decision nobody has authorized and one that cannot be undone.
Deleting is strictly worse. Leaving it addressable would require the case-insensitive read path
Decision 5 just rejected. The row survives intact and a human can resolve it through
`/api/admin/users` — which is precisely what scope 1 of this spec unblocks. The `console.warn`
is the trigger for that human; if it never fires, there was nothing to resolve.

**Tombstoned (`deleted_at != null`) rows participate in both the backfill and collision
detection.** In collision detection this is **mandatory, not a preference**: the unique index
spans tombstoned rows, so ignoring them means a tombstoned `Nick@G.com` blocks the lowercasing
of a live `nick@g.com` with a `P2002` — the backfill would crash on exactly the case it exists
to handle. In the backfill they participate because `PUT /api/admin/users/:id/restore`
(`admin.ts:145`) can bring one back, and a restored row with a mixed-case email would just be
this bug on a delay. Tombstones lose every election to a live row, so a restore never silently
takes an address away from an active account.

### Schema / contract changes (scope 2)

**No Prisma change, no migration, no new dependency, no `@storybook/shared` schema.**

- **Reviewer Check 4 (wire-shape) — action required, and this is not the usual N/A.**
  `/register` and `/login` response bodies are **unchanged** (`{ id, email, name, role, token }`),
  so OPS.3 does not demand a new Zod schema. But there is **no `auth.test.ts` in the repo** and
  no `toMatchObject` anywhere pins either response — verified across
  `server/src/routes/__tests__/`; the only matches are `allowlist.test.ts:176` (a DB row) and
  `:225` (the allowlist delete envelope). Check 4 will flag both routes as touched-and-unpinned.
  The developer must add `expect(res.body).toMatchObject({ ... })` for both, naming all five
  fields, in the new scope-2 test file.
- **Deliberately not doing:** adding `AuthUserResponseSchema` to `@storybook/shared` and wiring
  `validate()` onto the auth routes. That changes auth-route middleware for a response shape
  that is not changing, which is beyond the scope the user approved. Filed as a follow-up
  instead.
- **Reviewer Check 3 (dark-mode parity) — N/A, deliberately.** The client edits add
  `autoCapitalize` / `autoCorrect` / `spellCheck` attributes only. **No `className` is added or
  changed**, so there is no surface that could need a `dark:` partner. State this in the PR body
  so the skip reads as a ruling rather than an oversight.

### Data flow (scope 2)

```
iOS keyboard → "Nick@Gmail.com"        (autoCapitalize="none" now suppresses this at the source)
        ↓
POST /api/auth/register  { email }
        ↓  const normalized = normalizeEmail(email)
   isEmailAllowed(normalized) → 403 if not allowlisted   (unchanged behaviour)
   findFirst({ email: normalized })    → 409 if taken    (was: raw email + deleted_at filter)
   user.create({ email: normalized })  → row is lowercase, always
        ↓
POST /api/auth/login  { email }
        ↓  findFirst({ email: normalizeEmail(email), deleted_at: null })
   matches regardless of how the address was typed

server start (index.ts):
   backfillUserEmails()  → lowercase every non-normalised row, skip + warn on collisions
        ↓ (awaited, same rows)
   reconcileAdmins()
```

Canonical state is `User.email`, lowercased. Nothing is cached; the backfill is idempotent and
converges to zero writes.

### Files likely touched (scope 2)

- `server/src/routes/auth.ts` — normalise on lookup and write in `/register` and `/login`.
- `server/src/services/emailBackfill.ts` — new; `backfillUserEmails()` and its result type.
- `server/src/services/__tests__/emailBackfill.test.ts` — new; collision and tombstone table.
- `server/src/routes/__tests__/auth-normalization.test.ts` — new; the round-trip plus the two
  wire-shape assertions Check 4 needs.
- `server/src/index.ts` — the backfill runs before `reconcileAdmins()` (both write `User`).
- `client/src/pages/Register.tsx`, `client/src/pages/Login.tsx` — input attributes only.
- `client/src/pages/__tests__/authEmailInput.test.tsx` — new; pins the attributes.

## Alternatives considered

### Promote-once (mirror `bootstrapAllowlist()` semantics literally)

**Pros:** identical mental model to the existing bootstrap; no chance of demoting an admin
someone promoted by hand.
**Cons:** no revocation path without new code; needs its own retry rule for the
listed-before-registered case; the live admin set becomes a function of deploy history rather
than of current config.
**Why rejected:** the stated requirement is that revocation must be cheap and deploy-free.
Promote-once fails the requirement that motivated the feature's end state.

### A `PATCH /api/admin/users/:id/role` endpoint

**Pros:** self-service after the first admin exists; auditable per action.
**Cons:** does not solve the bootstrap at all — it needs an admin to already exist. Adds a
privilege-escalation surface to the live API for a demo-grade product.
**Held as upgrade path:** worth revisiting if the admin set ever needs to change without a
restart. Not now.

### Adding `demo-seed.ts` to the Render build command

**Why rejected (pre-decided with the user):** publishes a live admin with the hardcoded
password `demo!2026` from `server/prisma/demo-seed.ts:28`.

## Success criteria

- `cd server && npm test` green, including a new `adminBootstrap.test.ts` that pins: promotion
  of a registered listed user; case/whitespace normalisation; `missing` for an unregistered
  address with no user row created; demotion of an unlisted admin; total no-op on unset, blank,
  and unparseable values; `none` demoting every admin; idempotence across two runs.
- No new TypeScript errors (`cd client && npm run typecheck` unaffected; server builds clean).
- Manually verified locally: register a user, set `ADMIN_BOOTSTRAP_EMAILS` to that address,
  restart `npm run dev:server`, and `/api/auth/me` reports `role: 'admin'`; then remove it,
  restart, and the role is back to `user`.
- After merge and deploy, the repo owner can register on the live site and reach `/admin`
  following a restart, with no `psql` involved.

**Scope 2:**

- Registering as `Nick@Gmail.com` and logging in as `nick@gmail.com` succeeds, and the stored
  `User.email` is `nick@gmail.com`. Pinned by a test, not by inspection.
- A second registration differing only in case returns **409**, not a second account.
- `backfillUserEmails()` lowercases a pre-existing mixed-case row, is a zero-write no-op on the
  second run, and on a collision leaves both rows intact while reporting the pair — no throw,
  no merge, no delete.
- `/register` and `/login` responses are pinned by `toMatchObject` on all five fields
  (`id`, `email`, `name`, `role`, `token`) — the Check 4 gap this work is obliged to close.
- `cd client && npm test` green with the email inputs asserting `autoCapitalize="none"`.
- The four existing `bootstrapAllowlist` tests
  (`server/src/routes/__tests__/allowlist.test.ts:83-125`) stay green, unedited.

## Out of scope

- Any UI for managing admins. Promotion is config, not a screen.
- Role changes without a restart.
- Auditing or logging *who* changed the env var (that is Render's dashboard history).
- Roles beyond `user` / `admin`.
- Changing `ALLOWLIST_BOOTSTRAP_EMAILS` semantics. The two vars stay independent; being
  promotable does not imply being allowed to register, and a person listed in
  `ADMIN_BOOTSTRAP_EMAILS` still needs an allowlist entry to create their account.

**Scope 2:**

- Merging duplicate accounts. Colliding rows are reported, never combined (Decision 6).
- A case-insensitive unique index (`citext` / functional index on `lower(email)`). Postgres-only,
  no SQLite equivalent, and unrunnable if a collision exists — follow-up issue.
- An `AuthUserResponseSchema` in `@storybook/shared` plus `validate()` on the auth routes. The
  response shape is not changing; adding middleware to auth routes is not in the approved scope.
- Normalising anything other than case and surrounding whitespace. No Gmail dot-stripping, no
  `+tag` removal — those are different addresses to some providers, and guessing loses mail.
- Any other client auth UX (password rules, `autoComplete` policy, error copy).

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| **Auth/authorization guardrail (CLAUDE.md).** This changes who holds `role: 'admin'` in production. | User has given explicit go-ahead on the env-var mechanism. Developer names the guardrail in the PR body; no change to `requireAdmin`, `adminGate`, `getAuthUser`, or the UUID session model. |
| A manually promoted admin (psql, or a local `demo-seed.ts`) is silently demoted on the next boot. | Intended consequence of Decision 1, documented in `CLAUDE.md` and in the `render.yaml` comment. Local mitigation: leave `ADMIN_BOOTSTRAP_EMAILS` **unset** in local `.env`, which is a total no-op and leaves the `demo@storybook.local` admin intact. |
| A typo in the dashboard var mass-demotes everyone. | Guards 1 and 2: unset, blank, or no-parseable-address are all total no-ops. Only a var containing at least one valid address (or the `none` sentinel) writes anything. |
| Owner locks themselves out by editing the var wrong. | Demotion is `role: 'user'` only — nothing is deleted. Fix the var, restart, admin returns. `psql` remains the break-glass path, now a fallback rather than the only door. |
| Promotion silently does nothing because the person has not registered yet. | `missing` is logged every boot with the address list, and retried every boot. |
| Reconcile runs concurrently on two instances. | Cannot happen: single instance is enforced (ADR-018, `server/src/__tests__/rateLimitScope.test.ts` fails CI on `numInstances > 1`). |
| Boot failure if the DB is unreachable at start. | Same `.catch()` best-effort shape as `bootstrapAllowlist()` — logged, never fatal. A server that will not boot is worse than one whose admin needs one more restart. |
| `parseEmailList` extraction changes `bootstrapAllowlist` behaviour. | Pure refactor with identical filter (`length > 0 && includes('@')`), covered by the four existing bootstrap tests in `server/src/routes/__tests__/allowlist.test.ts:83-125`, which must stay green untouched. |
| **Scope 2 — auth guardrail (CLAUDE.md).** Changing how `/register` and `/login` resolve an identity is an auth change. | User gave explicit go-ahead to fold it into this PR. Session model, token issuance, `getAuthUser`, and middleware order are all untouched — only the email value used in the `where` and the `create`. Name the guardrail in the PR body. |
| Backfill hits `P2002` on a pre-existing case collision and takes down the boot. | Collisions are resolved in application code before any write (Decision 6): one elected row is lowercased, the rest are left alone. The call is also wrapped in the same best-effort `.catch()` as `bootstrapAllowlist` — logged, never fatal. |
| A non-elected colliding row silently loses its login. | Accepted and documented (Decision 6). `console.warn` names both ids and both emails on every boot until resolved; the row and its data are intact; `/api/admin/users` — unblocked by scope 1 — is the resolution path. |
| Existing mixed-case rows might not exist at all, making the backfill dead code. | Cheap either way: one `findMany` and zero writes in the steady state. The design is deliberately correct without knowing, because nobody can enumerate production rows until scope 1 ships. |
| `/register` duplicate check filters `deleted_at: null` but the unique index does not — registering an address whose row is tombstoned throws `P2002` and returns a generic **500** (`index.ts:99`). | Pre-existing, and normalisation makes it easier to hit. Fixed in the same task: drop the `deleted_at` filter from the duplicate check so a tombstoned address returns **409**, and pin it with a test. |
| Client attribute change silently reverts in a future edit. | `client/src/pages/__tests__/authEmailInput.test.tsx` asserts the attributes; there is currently no test file for either page, so this is new coverage rather than an edit to existing coverage. |
| Server-side normalisation makes the client change look optional. | It is defence in depth, not a duplicate: `autoCapitalize="none"` stops the wrong value being typed and shown back to the user in the field. The server fix is what makes it *correct*; the client fix is what makes it *not look broken*. |

## ADR-worthy decisions

- [ ] **Admin set is reconciled from `ADMIN_BOOTSTRAP_EMAILS` on every boot, not seeded once** — diverges from `bootstrapAllowlist()`'s empty-table rule; hard to reverse once operators rely on it. Write via `/create-adr` after spec approval.
- [ ] **Demotion is in scope, with unset/blank/unparseable as total no-ops and `none` as the demote-all sentinel** — this is the lever for the "no live admin access once we have real tester data" end state, and the sentinel is a magic value future readers will otherwise question.
- [ ] **Deferred: no in-app role management UI or endpoint** — record as deferred scope so a later reader knows it was considered and why (see Alternatives).
- [ ] **Scope 2: email normalization is backfill + normalise-on-write, with a plain normalised read path** (Decision 5) — hard to reverse once the `User` table is converged, and it forecloses the case-insensitive-lookup design. Write via `/create-adr`.
- [ ] **Scope 2: collision rule — elect one row, skip the rest, never merge or delete; tombstones participate in election** (Decision 6) — a deliberate, permanent account-reachability trade-off that a future reader will otherwise read as a bug. May share one ADR with the item above if they read as a single decision; say so in the spec if merged.
- [ ] **Scope 2 follow-up issue: case-insensitive unique index on `User.email`** (`citext` or a functional index on `lower(email)`) — the only thing that closes the duplicate-account hole at the database layer. Postgres-only, unrunnable while a collision exists, so it depends on the backfill's `collisions` log being empty. File as an issue, not an ADR.
- [ ] **Deferred: no `AuthUserResponseSchema` in `@storybook/shared`** — `/register` and `/login` stay unvalidated by `validate()`; the response shape is unchanged and adding auth-route middleware exceeds the approved scope. Record as a `Deferred:` line or a filed issue.
