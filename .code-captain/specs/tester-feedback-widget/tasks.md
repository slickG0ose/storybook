# Tester feedback widget — task plan

> Spec: [spec.md](spec.md)
> Status: Draft
> Last updated: 2026-11-08

## Overview

There are 9 tasks. Shared schemas come first (1). Then the server runs serially: data (2), tester route (3), admin routes (4). The client can start after Task 1 and runs in parallel with 2–4: submit path and dialog (5), Navbar trigger (6), admin tab (7). Then come e2e (8) and the ADR follow-ups (9). Branch from **`master`** as `agent/feat/tester-feedback-widget`, not from `feat/blob-storage-r2`.

## Cross-cutting constraints

- **Wire-shape:** `POST /api/feedback` → `FeedbackCreateResponseSchema` (201). `GET /api/admin/feedback` → `AdminFeedbackListResponseSchema`. `PATCH /api/admin/feedback/:id` → `AdminFeedbackStatusResponseSchema`. Every field is pinned with `toMatchObject`, and so is every `{ error }` envelope.
- **Auth middleware order:** `requireAuth → rateLimit → validate → handler` for the tester route, and `adminGate → validate → handler` for admin routes. `user_id` comes only from `res.locals.user`.
- **Session:** read `useCart().sessionId` and nothing else. Do not touch `getSessionId()` or the `storybook-session` key.
- **Dark-mode parity:** every class on the dialog, the Navbar control, and the admin cards needs a `dark:` partner.
- **Fixed surfaces:** the Feedback trigger must **not** be `position: fixed`. The dialog overlay mirrors the existing modal at `client/src/pages/BookDetail.tsx` (~line 1345, `fixed inset-0 z-50 … bg-black/60`).
- **Migrations:** SQLite `npm run db:migrate -- --name add-feedback`, then Postgres `npm run db:migrate:postgres -- add_feedback`. Commit both folders and the regenerated `server/prisma/postgres/schema.prisma`. Never run `prisma generate --schema=prisma/postgres/schema.prisma` locally.
- **Server suites share `test.db`:** Tasks 1–4 run one at a time, in one worktree.
- **Guardrails touched:** none need confirmation as designed. The session is read-only and there is no new dependency or paid API. If you find yourself adding a dependency (for example, for screenshots) or changing session issuance, stop and surface it.

## Tasks

### Task 1 — Shared feedback schemas

**Zone:** shared
**Depends on:** none
**Parallel-safe with:** none (everything depends on it)

**Status:** Done (2026-11-08)

**Files to add or change:**
- `shared/src/feedback.ts` (new) — every schema in spec §"Schema / contract changes", verbatim, plus inferred `type` exports
- `shared/src/index.ts` — `export * from './feedback';`
- `client/src/types.ts` — re-export `FeedbackCategory`, `FeedbackStatus`, `FeedbackCreateRequest`, `FeedbackCreateResponse`, `AdminFeedbackItem`
- `server/src/types.ts` — the same re-exports

**Signatures / shapes:** as in the spec. `FEEDBACK_CATEGORIES`, `FEEDBACK_STATUSES`, and `FEEDBACK_MESSAGE_MAX` are **values**, so the client imports them through a small value re-export (the `client/src/lib/ageRanges.ts` precedent). That re-export lands in Task 5, not in the types-only barrel.

**Tests to write:**
- `server/src/__tests__/feedbackSchema.test.ts`:
  - `InAppRouteSchema` (via `FeedbackCreateRequestSchema`) accepts `/`, `/book/abc?theater=1`, and rejects `//evil.example`, `https://x`, `javascript:alert(1)`, and `''`
  - message trims, rejects whitespace-only, accepts exactly 2000 characters, rejects 2001
  - category and theme reject values outside their enums
  - unknown keys such as `user_id` are stripped from the parse result
- Wire-shape assertion required: no (no route yet)

**Done when:** the tests pass, `cd server && npm test` and `cd client && npm test` are green, and `npx tsc --noEmit` is clean in both.

---

### Task 2 — `Feedback` Prisma model and both migrations

**Zone:** server (data)
**Depends on:** 1
**Parallel-safe with:** 5, 6, 7 (client-only)

**Status:** Done (2026-11-08)

**Files to add or change:**
- `server/prisma/schema.prisma` — the `Feedback` model from the spec, plus `feedback Feedback[]` on `User` and `Book`
- `server/prisma/migrations/<ts>_add-feedback/migration.sql` — from `cd server && npm run db:migrate -- --name add-feedback`
- `server/prisma/postgres/migrations/<ts>_add_feedback/{migration.sql,schema.prisma}` and `server/prisma/postgres/schema.prisma` — from `cd server && npm run db:migrate:postgres -- add_feedback`
- `server/src/__tests__/setup.ts` — `resetDatabase()` gets `await prisma.feedback.deleteMany();` as its first delete, ahead of `usageLog`

**Signatures / shapes:** the spec's Prisma block, verbatim.

**Tests to write:**
- `server/src/__tests__/feedbackModel.test.ts`:
  - hard-deleting a `User` cascades its `Feedback` rows
  - hard-deleting a `Book` leaves the feedback row with `book_id === null`
  - `status` defaults to `'new'`
- The existing `postgresMigrations.test.ts` and `postgresSchema.test.ts` must pass unmodified.
- Wire-shape assertion required: no

**Manual verify:**
- Read the generated Postgres `migration.sql`. It should contain only `CREATE TABLE "Feedback"`, two `CREATE INDEX`, and two `ADD CONSTRAINT … FOREIGN KEY`. Paste the line count and the absence of `DROP`/`ALTER COLUMN` into the hand-back.
- Optionally run `cd server && DATABASE_URL="postgresql://u:p@localhost:5432/x" npx prisma validate --schema=prisma/postgres/schema.prisma`.

**Done when:** the tests pass, `cd server && npm test` is green, and both migration folders plus the regenerated Postgres schema are committed together.

---

### Task 3 — `POST /api/feedback` with per-user rate limit

**Zone:** server
**Depends on:** 2
**Parallel-safe with:** 5, 6, 7

**Files to add or change:**
- `server/src/middleware/rateLimit.ts` — add `message?: string` to `RateLimitOptions`. The 429 body uses `message ?? 'Too many uploads in a short time. Try again in a moment.'`, so the default stays byte-identical.
- `server/src/routes/feedback.ts` (new) — the router
- `server/src/index.ts` — `import feedbackRouter from './routes/feedback'`; `app.use('/api/feedback', feedbackRouter)`
- `server/src/__tests__/setup.ts` — mount the same router in `createTestApp()`
- `docs/conventions/server.md` — add a row to the §Routes table
- `docs/conventions/call-graph.md` — add the router row `feedback | — | — | requireAuth, rateLimit, validate`

**Signatures / shapes:**
```ts
export const FEEDBACK_RATE_LIMIT = { max: 10, windowMs: 10 * 60 * 1000, bucket: 'feedback' } as const;

router.post(
  '/',
  requireAuth,
  rateLimit({ ...FEEDBACK_RATE_LIMIT, message: "You've sent a lot of feedback in a few minutes. Try again shortly." }),
  validate({ request: FeedbackCreateRequestSchema, response: FeedbackCreateResponseSchema }),
  async (req, res) => {
    // user = res.locals.user; book_id → null unless prisma.book.findUnique finds it
    // user_agent = req.get('user-agent')?.slice(0, 512) ?? null
    // server_build = process.env.RENDER_GIT_COMMIT ?? null
    // 201 { id, status, created_at: created_at.toISOString() }
  },
);
```

**Tests to write:**
- `server/src/routes/__tests__/feedback.test.ts` (`resetDatabase()` and `resetRateLimits()` in `beforeEach`, `allowEmail()` for the registered user):
  - 201, with `toMatchObject({ id: expect.any(String), status: 'new', created_at: expect.any(String) })`, and the DB row carries the body fields plus `user_id === <token user>`
  - a body containing `user_id: '<other id>'` still stores the token user's id
  - an unknown `book_id` is stored as `null`; a real seeded book id is stored as-is
  - `user_agent` is taken from the `User-Agent` header; `server_build` comes from a stubbed `RENDER_GIT_COMMIT`, and is `null` when unset
  - no token → 401 `{ error }`; no token **and** a bad body → still 401 (order)
  - whitespace message, a 2001-character message, and `route: '//evil.example'` → 400 `{ error }`
  - the 11th call within the window → 429, `toMatchObject({ error: expect.stringMatching(/feedback/i), retryAfterSeconds: expect.any(Number) })`, and a `Retry-After` header
- The existing `uploads.test.ts` passes unmodified, which proves the default message is unchanged.
- Wire-shape assertion required: **yes**, `FeedbackCreateResponse` plus the 401/400/429 envelopes

**Done when:** the tests pass, `cd server && npm test` is green, and there are no TS errors.

---

### Task 4 — Admin feedback list and status routes

**Zone:** server
**Depends on:** 3 (serial with it; shared `test.db`)
**Parallel-safe with:** 5, 6, 7

**Files to add or change:**
- `server/src/routes/admin.ts` — two routes behind the existing module-local `adminGate`
- `docs/conventions/call-graph.md` — mention `/api/admin/feedback` in the admin row if the table lists sub-paths

**Signatures / shapes:**
```ts
// GET /api/admin/feedback?status=new&user_id=<id>
router.get('/feedback', adminGate, validate({ response: AdminFeedbackListResponseSchema }), handler);
//   query parsed with AdminFeedbackListQuerySchema.safeParse(req.query) → 400 { error } on failure
//   prisma.feedback.findMany({ where, orderBy: { created_at: 'desc' }, take: 200,
//     include: { user: { select: { email: true, name: true } }, book: { select: { title: true } } } })
//   flatten to AdminFeedbackItem: user_email, user_name, book_title (null if no book), dates toISOString()

// PATCH /api/admin/feedback/:id   body { status }
router.patch('/feedback/:id', adminGate,
  validate({ request: AdminFeedbackStatusRequestSchema, response: AdminFeedbackStatusResponseSchema }), handler);
//   404 { error: 'Feedback not found.' } when the id is unknown
```
Put the row→wire mapping in one local `toAdminFeedbackItem(row)` helper, used by both routes.

**Tests to write:**
- `server/src/routes/__tests__/adminFeedback.test.ts` (new file; `admin.test.ts` is already large):
  - admin GET → 200, with a full `toMatchObject` on `[0]` naming **every** `AdminFeedbackItem` field, and newest first across 3 rows with distinct `created_at`
  - `?status=triaged` and `?user_id=` each narrow correctly; `?status=bogus` → 400
  - signed out → 401, non-admin → 403, non-admin with a bad PATCH body → 403 (order)
  - PATCH → 200, the status changes and `updated_at` advances; an unknown id → 404 `{ error }`; `{ status: 'archived' }` → 400
  - after a book is hard-deleted, `book_title` is `null`
- Wire-shape assertion required: **yes**, `AdminFeedbackItem` (list and PATCH) plus the error envelopes

**Done when:** the tests pass, `cd server && npm test` is green, and there are no TS errors.

---

### Task 5 — Client submit path and `FeedbackDialog`

**Zone:** client (+ one line in `.github/`)
**Depends on:** 1
**Parallel-safe with:** 2, 3, 4, 7

**Status:** Done (2026-11-08)

**Files to add or change:**
- `client/src/lib/feedback.ts` (new) — `buildFeedbackContext`, `submitFeedback`, and value re-exports of `FEEDBACK_CATEGORIES` / `FEEDBACK_MESSAGE_MAX`
- `client/src/vite-env.d.ts` — `interface ImportMetaEnv { readonly VITE_APP_COMMIT?: string }`
- `.github/workflows/deploy-pages.yml` — add `VITE_APP_COMMIT: ${{ github.sha }}` to the build step's `env`
- `client/src/components/FeedbackDialog.tsx` (new)

**Signatures / shapes:**
```ts
// lib/feedback.ts — pure + fetch, no React
export function buildFeedbackContext(input: {
  pathname: string; search: string; dark: boolean; sessionId: string;
  viewport: { width: number; height: number }; build: string | undefined;
}): Omit<FeedbackCreateRequest, 'category' | 'message'>;
// book_id via matchPath({ path: '/book/:id' }, pathname)?.params.id ?? null

export type SubmitResult =
  | { ok: true; data: FeedbackCreateResponse }
  | { ok: false; kind: 'auth' | 'rate' | 'invalid' | 'network'; message: string };
export function submitFeedback(token: string, body: FeedbackCreateRequest): Promise<SubmitResult>;

// components/FeedbackDialog.tsx
interface FeedbackDialogProps { open: boolean; onClose: () => void; }
```
Dialog behaviour:
- `role="dialog" aria-modal="true" aria-labelledby` with the heading "Send feedback". Escape and the overlay close it. Focus goes to the textarea on open and returns to the trigger on close.
- The category is a `role="radiogroup"` of 4 buttons (`role="radio"`, `aria-checked`), laid out 2×2 below `sm` and 1×4 at `sm`. Each is at least 44px tall. Default: `bug`.
- The textarea has `aria-label="Your feedback"` and `maxLength={FEEDBACK_MESSAGE_MAX}`, with a live character counter.
- Send is disabled while the text is empty after trimming or while submitting, and it reads "Sending…" during the request.
- Small helper copy: "Your account, the page you're on, and your screen size are attached so we can follow up."
- Success swaps the form for a `role="status"` "Thanks — that's been sent." with **Close** and **Send another** (which clears and returns to the form).
- Failure shows an inline `role="alert"` and the text is kept: `auth` → "Your session has ended — sign in again, then send."; `rate` → the server message; otherwise → "Couldn't send that. Your message is still here — try again."
- The panel is `w-full max-w-md max-h-[90dvh] overflow-y-auto` and every surface carries `dark:` partners.

**Tests to write:**
- `client/src/lib/__tests__/feedback.test.ts`:
  - `buildFeedbackContext` extracts `book_id` from `/book/xyz` and returns `null` on `/cart`
  - `route` is pathname + search
  - `theme` maps from `dark`
  - `client_build` is `null` when undefined
  - `submitFeedback` maps 201/401/429/400/rejected fetch to the right `SubmitResult` and sends `Authorization: Bearer`
- `client/src/components/__tests__/FeedbackDialog.test.tsx` (mock `useAuth`/`useCart`/`useTheme` with **annotated** factory return types per `testing.md`; stub `fetch`):
  - Bug is preselected
  - Send is disabled on whitespace
  - a successful submit shows the status and the posted body includes `session_id` from `useCart`
  - a failed submit keeps the textarea value and shows the alert
  - Escape calls `onClose`
- Wire-shape assertion required: no (client)

**Done when:** the tests pass, `cd client && npm test` is green, and `npx tsc --noEmit`, lint, and build are clean.

---

### Task 6 — Navbar trigger

**Zone:** client
**Depends on:** 5
**Parallel-safe with:** 2, 3, 4, 7

**Files to add or change:**
- `client/src/components/Navbar.tsx` — the trigger and the mounted `<FeedbackDialog>`
- `client/src/components/__tests__/Navbar.test.tsx` — new cases

**Signatures / shapes:**
- Render only when `!authLoading && user`. Place it immediately **before** the theme toggle.
- `<button aria-label="Send feedback" className={`${NAV_LINK} cursor-pointer bg-transparent border-none`}>`, using lucide `MessageSquarePlus size={18}` and `<span className="hidden sm:inline">Feedback</span>`.
- Owns `const [feedbackOpen, setFeedbackOpen] = useState(false)` and renders `<FeedbackDialog open={feedbackOpen} onClose={…} />`.
- Never add `fixed`, `sticky`, or `absolute` to the trigger. It inherits the nav's `sticky top-0`.

**Tests to write:**
- `Navbar.test.tsx`:
  - signed out → no "Send feedback" button
  - signed in → the button is present and clicking it opens the dialog (`getByRole('dialog', { name: 'Send feedback' })`)
  - while auth is loading → absent
- Wire-shape assertion required: no

**Manual verify:**
- At 360px as an admin (the 9-control row), check for overflow. If it overflows, apply the spec's fallbacks in order: icon `p-1.5`, then `gap-0` below `sm`. Stop and report if both fail.
- Open the dialog on `/`, `/book/<id>` (reader and `?theater=1`), `/cart`, and `/admin`, in **light and dark**. Record the aesthetic half of done-criterion #2.

**Done when:** the tests pass, `cd client && npm test` is green, and the manual check is recorded in the hand-back.

---

### Task 7 — Admin Feedback tab

**Zone:** client
**Depends on:** 1 (Task 4 only for manual verify against a real server)
**Parallel-safe with:** 2, 3, 4, 5, 6

**Files to add or change:**
- `client/src/pages/Admin.tsx`:
  - `Tab` gains `'feedback'`, with the tab label "Feedback"
  - state: `feedback`, `feedbackLoading`, `feedbackError`, `feedbackStatusFilter` (default `'new'`), `feedbackUserFilter: { id: string; email: string } | null`
  - `fetchFeedback()` calls `GET api('/api/admin/feedback?…')`
  - `updateFeedbackStatus(id, status)` calls `PATCH`; on failure → `showError("Couldn't update that feedback's status.")`
  - The fetch stays here, because `Admin.tsx` owns `/api/admin/*`
- `client/src/components/AdminFeedbackTab.tsx` (new) — presentational only, with no `api()` calls

**Signatures / shapes:**
```ts
interface AdminFeedbackTabProps {
  items: AdminFeedbackItem[]; loading: boolean; error: string | null;
  statusFilter: FeedbackStatus | 'all'; onStatusFilter: (s: FeedbackStatus | 'all') => void;
  userFilter: { id: string; email: string } | null; onUserFilter: (u: { id: string; email: string } | null) => void;
  onStatusChange: (id: string, status: FeedbackStatus) => void; savingIds: Record<string, boolean>;
  onRetry: () => void;
}
```
Card layout (a `<ul>` of `<li>` cards at every width, with no table):
- local `created_at`
- a category badge
- `<select aria-label="Status for feedback from {email}">`, disabled while saving, min-height 44px
- a button with the email + name that sets the user filter
- the message (`whitespace-pre-wrap break-words`)
- the route as `<Link to={route} className="break-all">`
- the book title (if any)
- context: `{theme} · {w}×{h} · client {client_build?.slice(0,7) ?? 'dev'} · server {server_build?.slice(0,7) ?? '—'}`
- the user agent, truncated with a `title` attribute
- the session id's first 8 characters

There is an empty state per filter and an active-user-filter chip with a clear button. All of it has `dark:` partners.

**Tests to write:**
- `client/src/components/__tests__/AdminFeedbackTab.test.tsx`:
  - renders every listed field for one item
  - the route renders as a link with the right `href`
  - changing the select calls `onStatusChange`
  - clicking the email calls `onUserFilter`
  - the empty state shows
- `client/src/pages/__tests__/Admin.test.tsx`:
  - the Feedback tab fetches with `?status=new`
  - a failed PATCH raises the toast (scope with `within(screen.getByTestId('error-toast-host'))` per ADR-017)
- Wire-shape assertion required: no

**Manual verify:**
- With Tasks 3–4 merged into the worktree, submit two reports and triage one, in **light and dark** at 393px and on desktop.

**Done when:** the tests pass, `cd client && npm test` is green, and there are no TS or lint errors.

---

### Task 8 — E2E: submit as tester, view as admin, both themes, mobile

**Zone:** e2e
**Depends on:** 3, 4, 6, 7
**Parallel-safe with:** none

**Files to add or change:**
- `e2e/tests/feedback.spec.ts` (new, desktop `chromium`)
- `e2e/tests/mobile/feedback.spec.ts` (new, `mobile-pixel` and `mobile-small`)

**Signatures / shapes:**
- Tester flows are **real** against the live server. Use `registerOwner` / `seedAuth` / `deleteUsers` from `e2e/tests/_editPublished.ts`, with a unique email per test. Cleanup cascades the feedback rows.
- Admin flows mock `/api/auth/me` (role `admin`) and `/api/admin/feedback*` via `page.route`, following `e2e/tests/admin.spec.ts`. No real admin and no promote endpoint.
- Use `forEachTheme` from `e2e/tests/mobile/_helpers.ts` for both themes.

**Tests to write:**
- `feedback.spec.ts`:
  1. **Submit as tester (both themes).**
     - Open a seeded book `/book/<id>`, click "Send feedback", pick Idea, type, and Send.
     - Capture the request with `page.waitForRequest` and assert the body: `route` starts with `/book/`, `book_id` matches, `theme` matches the pass, `session_id === localStorage['storybook-session']`, the viewport numbers equal `page.viewportSize()`, and there is no `user_id` key.
     - Expect the `role="status"` confirmation.
  2. **Signed out:** no "Send feedback" button.
  3. **View as admin (both themes).**
     - With the mocked list of two items, the Feedback tab shows email, category, message, and route link.
     - Changing the status select sends a PATCH with `{ status: 'triaged' }`.
     - The route link navigates to that path.
- `mobile/feedback.spec.ts` (both themes, both viewports):
  - signed-in tester on `/` and `/book/<id>`: `expectNoHorizontalOverflow` with the dialog closed and open
  - `expectTapTargets(page, '[role="dialog"] button, [role="dialog"] textarea', PRIMARY_TAP_MIN)`
  - the trigger has `expectTapTargets(…, NAV_TAP_MIN)`, and its computed `position` is not `'fixed'` (pin the invariant, with a message naming ADR-017)
  - mocked admin: Navbar row has no overflow at `mobile-small` with 9 controls
  - Feedback tab cards: no overflow, and the status select is at least 44px
- State in a comment which half of done-criterion #2 the spec claims: **correctness only** (ADR-009).
- Wire-shape assertion required: no (Supertest covers it)

**Done when:**
- `cd e2e && npm test` is green locally, including both mobile projects.
- The full suite has been run: server, client, root harness, and e2e.

---

### Task 9 — Pre-merge follow-ups

**Zone:** docs (harness) · **Depends on:** none (run last)

For each ADR-worthy item in `spec.md` §"ADR-worthy decisions" and each item under §"Open questions" below, make sure exactly one tracking action exists: a matching ADR, a linked issue, or an explicit `Deferred:` line with reasoning.

- Navbar placement → `/create-adr`. If Nick overruled open question 1, this becomes the ADR-017 amendment instead.
- Data model plus `/api/admin/feedback` routing → one `/create-adr`, which may bundle both.
- Screenshot capture → already carries a `Deferred:` line in the spec, so no further action.
- Open questions 2 and 3 → record Nick's answer. If it was "not now", add a `Deferred:` line. If it was "yes, later", file an issue and link it here.

**Done when:** `adr-tracking-check tester-feedback-widget` reports zero orphaned items.

## Sequencing notes

- **Task 1 first.** After it there are two lanes. Lane A: server 2 → 3 → 4, strictly serial in **one** worktree, because server suites share `test.db`. Lane B: client 5 → 6, with 7 alongside. The lanes can run in separate worktrees at the same time.
- Task 8 needs both lanes merged into one branch.
- One PR is fine (about 9 commits, one per task). If split, the cut is after Task 4 (server + data) versus 5–8, and the server PR must merge first so the e2e can hit real routes.
- **The migration reaches prod on merge.** Render's build runs `migrate deploy`, and the change is purely additive, so no operator step is needed. Nick can confirm afterwards with Neon `SELECT count(*) FROM "Feedback"` (0 rows, no error).
- Task 6's manual 360px admin check is the one place the design might bend. Its fallbacks are pre-decided in the spec.

## Open questions

Resolve 1 before Task 6. Resolve 3 before Task 2, if the answer is yes. 2 can wait.

- **1. RESOLVED 2026-11-08 — Nick: "Yes, Navbar."** Original question: confirm Navbar placement over a floating button. The request said "floating". The spec moves the trigger into the sticky Navbar because a FAB would sit on `UpdateToast` and break the ADR-011/ADR-017 two-fixed-surface invariant (spec §Placement). **Default if unanswered:** Navbar. Overruling means writing an ADR-017 amendment and choosing a z-order and offset relative to `UpdateToast`. That adds about half a day.
- **2. Notify Nick on new feedback?** Options, cheapest first:
  - (a) none: Nick checks `/admin` → Feedback, which defaults to New
  - (b) a "N new" count on the Admin tab label, client-only, about 30 minutes
  - (c) email via a transactional provider (Resend or Postmark): a new external API and a new env secret, a CLAUDE.md guardrail, and its own spec
  - (d) auto-file a GitHub issue per report: a repo-scoped token in Render, and it puts testers' words in a public repo

  **Default if unanswered:** (a), with (b) as a cheap add-on.
- **3. RESOLVED 2026-11-08 — Nick: "Yes, include them."** Shared schema already amended in the commit after Task 1: `FeedbackCreateRequestSchema.recent_errors` (optional, defaults `[]`, server keeps last 5 × 300 chars) and `AdminFeedbackItemSchema.recent_errors: string[]`, constants `FEEDBACK_RECENT_ERRORS_MAX` / `FEEDBACK_RECENT_ERROR_CHARS`. Task 2 adds `recent_errors_json String?`; Task 3 stores it; Task 4 parses it back to `string[]` (null → `[]`); Task 5 adds the ring buffer in `main.tsx`; Task 7 shows the errors in the card. Original question: auto-include the last few client console errors? Shape if yes:
  - a ring buffer of the last 5 `window` `error` + `unhandledrejection` events, installed in `main.tsx`, each truncated to 300 characters
  - not a `console.error` monkey-patch, which also catches React dev warnings and third-party noise
  - sent as `recent_errors: string[]` and stored in a `recent_errors_json String?` column added in Task 2's migration

  Costs: about 2 hours. Messages can contain other users' data only if the app already leaks it, but they can contain URLs with book ids. **Default if unanswered:** no.
