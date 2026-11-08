# Tester feedback widget

> Status: Draft
> Last updated: 2026-11-08
> Backlog: [#157 — MVP beta: restore deploy for family/friends feedback, with temp logins](https://github.com/slickG0ose/storybook/issues/157)

## Problem

The friends-and-family alpha exists to collect findings: UX bugs, feature ideas, and what people liked ([#157](https://github.com/slickG0ose/storybook/issues/157)). `docs/mvp-alpha-plan.md` §"Decisions Nick owes" recommended a Google Form linked from the footer. Nick has chosen an in-app widget instead. An out-of-band report has two costs. The tester has to leave the app at the moment they notice something. Nick then has to ask "who was this, which page, which book, phone or laptop, dark mode?" before he can act on it. In-app, the app already knows all of that: the bearer token says who, the router says where, and the browser says how. Nothing captures it today.

## Constraints

- **Auth-only.** Testers are allowlisted, registered users (`docs/mvp-alpha-plan.md`: "the existing allowlist, no new auth"). The submit route uses `requireAuth` (`server/src/middleware/requireAuth.ts`). `user_id` comes from `res.locals.user` and never from the body.
- **No new session concept.** The UUID in `localStorage['storybook-session']`, issued by `getSessionId()` in `client/src/context/CartContext.tsx` and exposed as `useCart().sessionId`, is the session that `CartItem.session_id` and `Order.session_id` already use. Feedback reuses it, unchanged. The session model is a CLAUDE.md guardrail, and this spec only reads it.
- **Wire shapes live in `@storybook/shared`** (OPS.3 / ADR-003). Every response is pinned with `toMatchObject` (`docs/conventions/testing.md`).
- **Middleware order:** `requireAuth | adminGate → (rateLimit) → validate → handler` (`docs/conventions/server.md`).
- **Two migrations per schema change (ADR-028).** The SQLite migration goes through `db:migrate`. The Postgres migration goes through `db:migrate:postgres`. Render's build runs `prisma migrate deploy --schema=prisma/postgres/schema.prisma` (`render.yaml`). Missing the Postgres half fails `server/src/__tests__/postgresMigrations.test.ts`.
- **`UpdateToast` is the app's only bottom-fixed surface** (ADR-011 decision 5, amended by ADR-017 decision 2). `ErrorToastHost` owns the top (`fixed top-20 z-40`). `NarrationPlayer`, `BookSpread`, and `PublishStateBar` each carry comments and e2e computed-style assertions saying so. This constraint decides the trigger's placement. See "Placement" below.
- **Dark-mode parity, 44px primary tap targets, and no horizontal overflow at 360/393px** (ADR-009 helpers in `e2e/tests/mobile/_helpers.ts`). Navbar icons use `NAV_TAP_MIN` (24px). The dialog's controls use `PRIMARY_TAP_MIN` (44px).
- **Components never call `api()` directly** (`docs/conventions/call-graph.md`). Network access goes through `client/src/lib/`. Admin network calls stay in `pages/Admin.tsx`, which owns `/api/admin/*`.
- **No paid API.** This feature makes no AI or other paid calls, so it needs no spend gate. A per-user rate limit is still required: the route writes a DB row on every call.
- **Branch base.** Implementation branches from `master`, not from `feat/blob-storage-r2`, which is checked out locally and is behind `master`. ADR-028's `server/prisma/postgres/` layout, `authRateLimit.ts`, and the storage seam exist only on `master`.

## Proposed shape

A **"Send feedback" button in the Navbar**, shown only to signed-in users, opens a **modal dialog**. The dialog has four category choices (Bug, Idea, Praise, Other; Bug is preselected), a textarea capped at 2000 characters, and Send. On send, the client attaches context the tester never sees or types: the router path and query, the book id when the path is `/book/:id`, the viewport size, the light/dark theme, the cart session UUID, and the client build id. The server adds the authenticated user, the `User-Agent` header, and its own build id (`RENDER_GIT_COMMIT`). It then writes one `Feedback` row with `status: 'new'`. The tester needs two taps (open, Send) plus their typing.

On success the dialog swaps its form for a polite `role="status"` confirmation ("Thanks — that's been sent.") with **Close** and **Send another** buttons. On failure an inline `role="alert"` inside the dialog explains the error, and **the typed message stays in the textarea**, so losing a tester's words is impossible by construction. There is no new toast type. `ToastContext` is failure-only and forbids timers (ADR-017), and the dialog itself is the surface the tester is looking at.

Nick triages in a new **Feedback tab on `/admin`**. It lists cards, newest first, with an editable status (`new → triaged → done`) on each card. A status filter defaults to **New**. Clicking an email narrows the list to that user. Each card shows the user's email and name, the category, the message, the route as an in-app `<Link>`, the book title, the context line (theme · viewport · client build · server build), the user agent, and a short session id. The list is cards rather than a table because the existing admin tables are not built for 393px, and Nick will triage from a phone.

### Placement — Navbar, not a floating button (deviation from the request)

The request asked for a floating button. A floating button is a `position: fixed` surface, and the app has a deliberate two-surface fixed-position budget:

- **Bottom-right is taken.** On desktop `UpdateToast` sits at `sm:right-6 sm:bottom-6 sm:w-96`, exactly where a FAB would sit. On mobile it is `inset-x-3 bottom-3`, the full width of the bottom edge.
- **Mid-right is taken.** `BookSpread`'s "Next spread" chevrons sit at the sides of the reader, and a side tab would cover them on a phone.
- **ADR-017 says why the budget exists.** Two independently-authored fixed surfaces negotiating z-index is "a bug generator". The existing assertions pin each surface's own element, so a new FAB would pass every test while breaking the invariant they protect. No test would catch it.

The Navbar is `sticky top-0` on every route, including reader and theater mode. It is already visible everywhere, which satisfies "from any page in two clicks", and it adds no fixed surface. The cost is width. The densest current row (signed-in admin, 8 controls) fits 336px at 360px wide, and estimated arithmetic puts a 9th 34px control at about 334px. Testers see 8 controls, the same density as today's admin. Only Nick, as the admin, sees 9. Task 6 measures this. Its fallback is listed in order, so the developer doesn't improvise. **Open question 1 asks Nick to confirm this placement.**

### Schema / contract changes

**Prisma** (`server/prisma/schema.prisma`, plus the generated `postgres/schema.prisma`):

```prisma
// Tester feedback (#157). One row per submission. user_id is the authenticated
// submitter (never taken from the body); session_id is the cart-session UUID the
// client already holds — an unverified correlation hint, not an identity.
model Feedback {
  id              String   @id @default(uuid())
  user_id         String
  session_id      String
  category        String   // 'bug' | 'idea' | 'praise' | 'other' — enforced in Zod
  message         String
  route           String   // router pathname + search, basename-stripped, starts with '/'
  book_id         String?
  user_agent      String?  // from the request header, server-side, truncated to 512
  viewport_width  Int
  viewport_height Int
  theme           String   // 'light' | 'dark'
  client_build    String?  // VITE_APP_COMMIT at build time; null in local dev
  server_build    String?  // RENDER_GIT_COMMIT at request time; null off Render
  status          String   @default("new") // 'new' | 'triaged' | 'done'
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt

  user User  @relation(fields: [user_id], references: [id], onDelete: Cascade)
  book Book? @relation(fields: [book_id], references: [id], onDelete: SetNull)

  @@index([status, created_at])
  @@index([user_id, created_at])
}
```

`User` and `Book` each gain a `feedback Feedback[]` back-relation. Notes on the choices:

- **`onDelete: Cascade` on the user.** Users are soft-deleted in the app, so a hard delete only happens in the test-only `DELETE /api/_test/user-by-email` (`server/src/routes/test.ts`). Cascade keeps that cleanup working unchanged. With the default `Restrict`, every e2e `deleteUsers()` would fail once that user had submitted feedback.
- **`onDelete: SetNull` on the book.** Feedback outlives a deleted book.
- **The server verifies `book_id`.** If no `Book` row has that id, it stores `null` instead of returning 400. Context must never be the reason a report fails.

**Zod** (new `shared/src/feedback.ts`, re-exported from `shared/src/index.ts`):

```ts
export const FEEDBACK_CATEGORIES = ['bug', 'idea', 'praise', 'other'] as const;
export const FeedbackCategorySchema = z.enum(FEEDBACK_CATEGORIES);
export const FEEDBACK_STATUSES = ['new', 'triaged', 'done'] as const;
export const FeedbackStatusSchema = z.enum(FEEDBACK_STATUSES);
export const FEEDBACK_MESSAGE_MAX = 2000;

// In-app path only: must start with a single '/'. Rejects '//evil.example' and
// 'javascript:' so the admin <Link to={route}> cannot become an off-site jump.
const InAppRouteSchema = z.string().max(500).regex(/^\/(?!\/)/);

export const FeedbackCreateRequestSchema = z.object({
  category: FeedbackCategorySchema,
  message: z.string().trim().min(1).max(FEEDBACK_MESSAGE_MAX),
  route: InAppRouteSchema,
  book_id: z.string().max(64).nullable(),
  session_id: z.string().min(1).max(64), // lenient on purpose: a hint, never a reason to reject
  viewport_width: z.number().int().min(0).max(10000),
  viewport_height: z.number().int().min(0).max(10000),
  theme: z.enum(['light', 'dark']),
  client_build: z.string().max(64).nullable(),
});
export const FeedbackCreateResponseSchema = z.object({
  id: z.string(),
  status: FeedbackStatusSchema,
  created_at: z.string(),
});

export const AdminFeedbackItemSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  user_email: z.string(),
  user_name: z.string(),
  session_id: z.string(),
  category: FeedbackCategorySchema,
  message: z.string(),
  route: z.string(),
  book_id: z.string().nullable(),
  book_title: z.string().nullable(),
  user_agent: z.string().nullable(),
  viewport_width: z.number(),
  viewport_height: z.number(),
  theme: z.enum(['light', 'dark']),
  client_build: z.string().nullable(),
  server_build: z.string().nullable(),
  status: FeedbackStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
export const AdminFeedbackListResponseSchema = z.array(AdminFeedbackItemSchema);
export const AdminFeedbackListQuerySchema = z.object({
  status: FeedbackStatusSchema.optional(),
  user_id: z.string().max(64).optional(),
});
export const AdminFeedbackStatusRequestSchema = z.object({ status: FeedbackStatusSchema });
export const AdminFeedbackStatusResponseSchema = AdminFeedbackItemSchema;
```

**Routes:**

| Method | Path | Gate | Body / query | 2xx |
|---|---|---|---|---|
| POST | `/api/feedback` | `requireAuth → rateLimit({ max: 10, windowMs: 10 min, bucket: 'feedback' }) → validate` | `FeedbackCreateRequest` | **201** `FeedbackCreateResponse` |
| GET | `/api/admin/feedback` | `adminGate → validate({ response })` | query `?status=&user_id=`, parsed in the handler with `AdminFeedbackListQuerySchema` (`validate()` covers bodies only) | 200 `AdminFeedbackListResponse`, newest first, `take: 200` |
| PATCH | `/api/admin/feedback/:id` | `adminGate → validate` | `AdminFeedbackStatusRequest` | 200 `AdminFeedbackStatusResponse`; 404 for an unknown id |

**Admin routes sit under `/api/admin/feedback`, not `GET /api/feedback`.** The request named the latter. Two reasons for the change. First, `adminGate` is module-local to `server/src/routes/admin.ts`, and reusing it beats exporting or duplicating a gate. Second, call-graph's one-owner-per-prefix rule already assigns `/api/admin/*` to `Admin.tsx`. The tester route `/api/feedback` stays a separate router (`server/src/routes/feedback.ts`), because its gate is `requireAuth` and not `adminGate`.

**Rate-limit message.** `rateLimit()` currently hardcodes `'Too many uploads in a short time…'` in its 429 body. It gains an optional `message` option, and the default stays byte-identical, so the uploads tests don't change. Feedback passes: `"You've sent a lot of feedback in a few minutes. Try again shortly."` The rate limiter runs before `validate`, so malformed bodies count toward the limit. That is deliberate: it stops a caller from using validation errors to probe at unlimited speed.

**Client build id.** `.github/workflows/deploy-pages.yml` sets `VITE_APP_COMMIT: ${{ github.sha }}` in its build `env`. `client/src/vite-env.d.ts` types `ImportMetaEnv.VITE_APP_COMMIT?: string`. The client sends `import.meta.env.VITE_APP_COMMIT ?? null`. No `define` is needed, because Vite exposes `VITE_*` natively.

### Data flow

1. A signed-in tester taps **Send feedback** (Navbar). `FeedbackDialog` opens with focus on the textarea.
2. The tester types and taps **Send**. `submitFeedback()` in `client/src/lib/feedback.ts` builds the body. `buildFeedbackContext()` is a pure function that reads `useLocation()` (pathname + search), `matchPath('/book/:id', pathname)`, `window.innerWidth/innerHeight`, `useTheme().dark`, `useCart().sessionId`, and `import.meta.env.VITE_APP_COMMIT`. The client then sends `POST api('/api/feedback')` with `Authorization: Bearer <useAuth().user.token>`.
3. On the server, `requireAuth` resolves the user, `rateLimit` checks the bucket, and `validate` parses the body. The handler looks up `book_id`, reads `req.get('user-agent')` and `process.env.RENDER_GIT_COMMIT`, runs `prisma.feedback.create`, and returns 201.
4. The client shows the success state. On any non-2xx it shows the inline error and keeps the text: 401 means the session has expired, so sign in again; 429 shows the server's message; anything else gets a generic retry message.
5. Nick opens `/admin` → **Feedback**. `Admin.tsx` fetches `GET /api/admin/feedback?status=new`, and `AdminFeedbackTab` renders the cards. A status change sends `PATCH /api/admin/feedback/:id`. A failed PATCH goes through `useToast().showError`, matching every other admin failure.

All state lives in the `Feedback` table. The client keeps only dialog-local React state.

### Files likely touched

- `shared/src/feedback.ts` (new), `shared/src/index.ts` — schemas and barrel
- `client/src/types.ts`, `server/src/types.ts` — re-exports
- `server/prisma/schema.prisma`, `server/prisma/postgres/schema.prisma` (generated), `server/prisma/migrations/<ts>_add-feedback/`, `server/prisma/postgres/migrations/<ts>_add_feedback/` — data
- `server/src/__tests__/setup.ts` — `resetDatabase()` clears `feedback`; `createTestApp()` mounts the new router
- `server/src/middleware/rateLimit.ts` — optional `message`
- `server/src/routes/feedback.ts` (new), `server/src/index.ts` — tester route and mount
- `server/src/routes/admin.ts` — admin list and status routes
- `client/src/lib/feedback.ts` (new), `client/src/vite-env.d.ts`, `.github/workflows/deploy-pages.yml` — submit path and build id
- `client/src/components/FeedbackDialog.tsx` (new), `client/src/components/Navbar.tsx` — tester UI
- `client/src/components/AdminFeedbackTab.tsx` (new), `client/src/pages/Admin.tsx` — admin UI
- `e2e/tests/feedback.spec.ts` (new), `e2e/tests/mobile/feedback.spec.ts` (new)
- `docs/conventions/call-graph.md`, `docs/conventions/server.md` — new edges and routes

## Alternatives considered

### Floating action button, bottom-right (as requested)

**Pros:** It's the conventional feedback-widget pattern, it stays in view without scrolling, and it costs no Navbar width.
**Cons:** It lands exactly on `UpdateToast` on desktop (`sm:right-6 sm:bottom-6`) and inside its full-width mobile strip. It breaks the ADR-011/ADR-017 two-fixed-surface invariant in a way no existing test detects. On phones it covers whatever scrolls under it, including the reader's per-page control row and the narration player.
**Why rejected:** The cost is an invariant that three components and two e2e specs were built around. Nick can still overrule it via open question 1, and that path needs its own ADR amending ADR-017.

### Fixed side tab (vertical "Feedback" on the right edge)

**Pros:** It stays out of the bottom strip.
**Cons:** It adds a third fixed surface, and it overlaps `BookSpread`'s side chevrons in mobile reader view.
**Why rejected:** Same invariant, and it collides with a primary reader control.

### Footer link to the dialog

**Pros:** It costs no Navbar width.
**Cons:** The footer is below the fold on every content page, which fails "from any page in two clicks".
**Why rejected:** It doesn't meet the goal. A footer link to the same dialog is a fine addition later.

### Google Form linked from the footer (the alpha plan's original recommendation)

**Pros:** About an hour of work and no schema.
**Cons:** Nothing is attached automatically, which is exactly the "who was this / what were you doing" problem.
**Why rejected:** Nick chose in-app.

### Context as one `context_json` column

**Pros:** New fields such as console errors need no migration.
**Cons:** It can't be indexed or filtered, and its shape drifts silently.
**Why rejected:** Six well-known fields justify real columns. If open question 3 comes back yes before Task 2, add a `recent_errors_json String?` column in the **same** migration rather than a second one.

### Admin-view e2e against a real admin account

**Pros:** True end-to-end coverage.
**Cons:** It needs a test-only "promote to admin" endpoint. Even behind `NODE_ENV !== 'production'`, that endpoint is a privilege-escalation surface touching the auth guardrail.
**Why rejected:** The admin e2e mocks `/api/auth/me` and `/api/admin/feedback*`, following `e2e/tests/admin.spec.ts`. The real admin route is covered by Supertest.

## Success criteria

- A signed-in tester on any route, including `/book/:id` in reader and theater mode, at 360/393px and on desktop, in both themes, can open the dialog from the Navbar and submit. A `Feedback` row then exists with the correct `user_id`, `session_id` (equal to `localStorage['storybook-session']`), `route`, `book_id`, viewport, and theme.
- A `user_id` sent in the body is ignored, because the schema strips it. A Supertest test proves the stored `user_id` is the token's user.
- Signed out, the Navbar shows no Feedback button, and `POST /api/feedback` returns 401.
- An 11th submission inside 10 minutes returns 429 with `Retry-After`. A message over 2000 characters, or one that is only whitespace, returns 400. A route of `//evil.example` returns 400.
- `GET /api/admin/feedback` returns 401 signed out, 403 for a non-admin, and the full item shape for an admin, newest first, with `status` and `user_id` filters working. `PATCH` updates the status and returns 404 for an unknown id.
- Every response is pinned with `toMatchObject` on every field.
- In mobile e2e: no horizontal overflow with the dialog closed or open, as a user and as an admin, at both widths. Dialog controls are at least 44px. The trigger's computed `position` is not `fixed`.
- Both migrations are committed, `postgresMigrations.test.ts` and `postgresSchema.test.ts` pass, and the generated Postgres SQL contains only `CREATE TABLE` / `CREATE INDEX` / `ADD CONSTRAINT`, with no `DROP` or `ALTER COLUMN … TYPE`.

## Out of scope

- **Screenshot capture.** Deferred: it needs a new client dependency (CLAUDE.md guardrail) and a private storage path that does not exist yet. Recommendation and reasoning below.
- Email, push, or GitHub-issue notification on new feedback. This is open question 2. The default is none.
- Console-error capture. This is open question 3. The default is none.
- Replies to testers, threads, or in-app "your feedback was triaged" messages.
- Feedback from signed-out visitors. Every alpha tester has an account.
- Viewing a tester's **draft** book from the route link. As admin, Nick gets the normal non-owner 404 on someone else's draft. The card shows `book_title` from the join, so he still knows which book it was. Admin access to drafts is a separate decision.
- Pagination beyond the newest 200 rows. That is alpha scale. Add a cursor when the table passes it.

### Screenshot capture — recommendation: Deferred

Deferred: the four costs below outweigh the benefit for a friends-and-family alpha. `route`, `book_id`, viewport, and theme let Nick open the same screen himself in most cases. Revisit if triage shows reports that can't be reproduced from the context fields.

1. **New dependency (guardrail).** `html2canvas` is the usual pick, but it rasterises from computed styles. Tailwind 4 emits `oklch()` colours, which `html2canvas` is widely reported not to parse; verify this before choosing it. A fork (`html2canvas-pro`) or an SVG-`foreignObject` library (`html-to-image`, `modern-screenshot`) would be needed. Each adds roughly 40–200 KB to the client bundle for a feature only testers use.
2. **Cross-origin images taint the canvas.** Illustrations will 302 to `r2.dev` (ADR-026). Without CORS headers on the bucket, the illustrated part of the page, which is the part that matters, fails to capture.
3. **Privacy and storage.** The R2 bucket is **public-read** (ADR-026). A screenshot can contain a tester's private draft, so it can't go under the illustration prefix. It needs a private prefix served by proxy or presigned URL, which ADR-026 explicitly did not build. On Render's ephemeral disk under `STORAGE_BACKEND=local`, screenshots would vanish on restart.
4. **Payload.** At 0.3–1.5 MB per PNG, base64 inside JSON is inside the 10 MB body limit but heavy on the free instance. Multipart needs multer wiring and its own rate limit.

If it is ever built, it should be a separate spec. Use an opt-in "Attach screenshot" checkbox (never automatic), `html-to-image` lazy-loaded with `import()` only when the box is ticked, and a nullable `Feedback.screenshot_key` written through `getStorage()` under a `feedback/` prefix that is served only by an admin-gated proxy route.

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| **Wire-shape drift (OPS.3)** | Five new schemas in `shared/src/feedback.ts`. Every 2xx and error envelope is pinned with `toMatchObject` in `feedback.test.ts` and `adminFeedback.test.ts`. |
| **Auth / middleware order** | `requireAuth → rateLimit → validate` and `adminGate → validate`. Tests assert that 401 beats 400 (unauthenticated with a bad body returns 401) and that 403 beats 400 for a non-admin. |
| **Spoofed identity** | `user_id` comes only from `res.locals.user`, and the Zod object strips unknown keys. `session_id` is documented as an unverified hint. A tester can only lie about their own session, which harms nothing. |
| **Session model (guardrail)** | Read-only reuse of `useCart().sessionId`. No change to issuance, storage key, or lifetime. Nothing new to confirm with Nick. |
| **Open redirect / XSS via stored route** | `InAppRouteSchema` requires a single leading `/`. The admin card renders `route` only through `<Link to>` and the message as React text with `whitespace-pre-wrap`, never as HTML. |
| **Navbar overflow at 360px for the admin (9 controls)** | Task 6 measures it with `expectNoHorizontalOverflow` as a mocked admin at `mobile-small`. If it overflows, the fallbacks are, in order: (a) the Feedback icon at `p-1.5` (30px, still ≥ `NAV_TAP_MIN`); (b) the row's `gap-0.5` reduced to `gap-0` below `sm`. If both fail, stop and report; do not hide or reorder other controls. |
| **Prisma / migrations** | Additive only: a new table and two back-relations. Use `db:migrate -- --name add-feedback`, then `db:migrate:postgres -- add_feedback`, and commit both plus the regenerated `postgres/schema.prisma`. Read the Postgres SQL for `DROP`/`ALTER … TYPE` warnings. Never run `prisma generate --schema=prisma/postgres/schema.prisma` locally (`docs/conventions/data.md`). Prod applies it automatically on merge via `migrate deploy`. |
| **Test-cleanup FK breakage** | `onDelete: Cascade` on `user` keeps `DELETE /api/_test/user-by-email` working. `resetDatabase()` gains an explicit `prisma.feedback.deleteMany()` before `user`. |
| **Shared `test.db` across server suites** | Tasks 1–4 all run the server suite, so they run one after another in one worktree, never two server agents at once. |
| **Dark-mode parity** | Two new surfaces (dialog, admin cards) plus a Navbar control. Every background, text, border, focus, and hover class gets a `dark:` partner, checked by `dark-mode-parity-check` at `/ship`. |
| **Spend exposure** | No paid call, so no `spendGate`. The DB-write abuse vector is bounded by `requireAuth` (allowlisted users only) plus the 10-per-10-minute per-user limit plus the 2000-character cap. The limiter is per-instance (ADR-018), which is fine on Render's single instance. |
| **ADR-017 toast rules** | No success toast is added to `ToastContext`. Success is an in-dialog `role="status"`, and failure is an in-dialog `role="alert"` bound to the control the tester is using, which ADR-017 decision 4 permits. |
| **`RENDER_GIT_COMMIT` availability** | `server_build` is nullable, and a missing env var stores `null`. The developer confirms the variable name against Render's docs and does not add it to `render.yaml`, because Render injects it. |

## ADR-worthy decisions

- [x] → [ADR-031](../../product/decisions.md) **Feedback trigger lives in the sticky Navbar, not a floating fixed button.** This upholds ADR-011 decision 5 and ADR-017 decision 2 (two fixed surfaces, top and bottom). It also covers the alternative: if Nick overrules via open question 1, the ADR is instead an amendment of ADR-017. Write via /create-adr after spec approval.
- [x] → [ADR-032](../../product/decisions.md) decisions 1–4 **Feedback data model.** It is a new `Feedback` table with discrete context columns rather than JSON. `session_id` is an unverified correlation hint reusing the cart UUID. User cascade and book `SetNull`. An unknown `book_id` is dropped, not rejected. Write via /create-adr after spec approval.
- [x] → [ADR-032](../../product/decisions.md) decision 5 **Admin feedback routes live under `/api/admin/feedback` (in `admin.ts`), not `GET/PATCH /api/feedback`.** This reuses `adminGate` and keeps one owner per prefix. It could be bundled into the data-model ADR.
- [x] **Screenshot capture deferred.** (also recorded under ADR-032 §Deferred) Deferred: see "Screenshot capture — recommendation: Deferred" above (new dependency, `oklch`/CORS capture failures, public-bucket privacy, payload). Revisit if triage shows reports that can't be reproduced.
