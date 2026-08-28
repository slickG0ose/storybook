# Server conventions

Stack and patterns under `server/`. The developer agent (HR5) reads this when editing the server zone.

**Stack:** Express 4, TypeScript, Prisma 5 (SQLite), Anthropic SDK, Zod via `@storybook/shared`.

## Layout

```
server/
  prisma/
    schema.prisma          # source of truth for the DB schema
    migrations/            # generated migrations (deploy with db:migrate)
    seed.ts                # Prisma-based canonical seed
    demo-seed.ts           # extra demo content
  src/
    db/
      prisma.ts            # singleton PrismaClient export
      snapshot.ts          # auto-backup dev.db on dev-server boot
      init.ts              # ⚠ legacy JSON-store shim — see "Legacy shim" below
    middleware/
      validate.ts          # Zod request/response validation middleware
    routes/
      admin.ts             # admin CRUD + soft-delete restore + orphan cleanup
      auth.ts              # /register, /login, /logout, /me + getAuthUser helper
      books.ts             # catalog + per-user creation/revision flow
      cart.ts              # session-scoped cart
      generate.ts          # Claude story generation
      hero.ts              # GET /api/hero/pool — public hero-rotation frames (no auth, on purpose)
      orders.ts            # checkout flow
      uploads.ts           # file uploads (illustrations)
      test.ts              # E2E helpers, mounted only when NODE_ENV !== 'production'
    services/
      illustrations.ts     # illustration generation + versioning
    types.ts               # thin re-exports from @storybook/shared + server-only DB shapes
    index.ts               # Express bootstrap
    loadEnv.ts             # MUST be imported first — populates DATABASE_URL
```

## Database — Prisma over SQLite

- **All persistence goes through Prisma.** Import the singleton from `server/src/db/prisma.ts`:
  ```ts
  import prisma from '../db/prisma';
  const books = await prisma.book.findMany({ where: { deleted_at: null } });
  ```
- The schema lives in `server/prisma/schema.prisma`. SQLite file is `server/prisma/dev.db` (gitignored).
- **Soft-delete pattern.** `User` and `Book` have a `deleted_at: DateTime?` column. Default queries always filter `deleted_at: null`. Admin restore flows set it back to `null`.
- **Migrations.** Add a column / model in `schema.prisma`, then `cd server && npm run db:migrate -- --name <kebab-case-description>`. Prisma generates a timestamped folder under `migrations/`.
- **Never edit a committed migration.** Add a new one to fix forward — committed migrations have already run on other machines.

### Legacy shim — `server/src/db/init.ts`

The file exports `getStore` / `resetStore` / `save` / `initDb`. These were the original JSON-store API and **are no longer used by routes** (every handler in `routes/*.ts` uses Prisma). The functions remain for any in-tree consumers that haven't migrated yet. Treat them as deprecated:

- **Do not** add new code that calls them.
- The canonical seed is `server/prisma/seed.ts` (Prisma), not the seed inside `init.ts`.
- A future cleanup will remove `init.ts` entirely.

## Wire shapes — Zod schemas in `@storybook/shared` (OPS.3, ADR-003)

Per-route request and response shapes are Zod schemas in the source-only workspace package `shared/src/{books,cart,orders,admin,hero,test}.ts`. Both client and server import inferred TypeScript types from the same schemas via `@storybook/shared`. **Never declare a wire shape in `server/src/types.ts`** — re-export from shared and add only server-internal DB-row / auth shapes there.

A literal field in a response schema can be a **deliberate discriminator, not decoration**: `HeroFrameSchema` in `shared/src/hero.ts` carries `source: z.literal('pool')` so that a future personalised frame (`source: 'personal'`, a different schema) cannot be emitted from the pool route without `validate()` failing loudly in dev. Do not "simplify" a single-valued literal away — check what it is guarding first.

### `validate()` middleware (`server/src/middleware/validate.ts`)

Wraps a route with Zod-backed request + response validation:

```ts
import { validate } from '../middleware/validate';
import { OrderCreateRequestSchema, OrderCreateResponseSchema } from '@storybook/shared';

router.post(
  '/',
  validate({ request: OrderCreateRequestSchema, response: OrderCreateResponseSchema }),
  async (req, res) => { /* req.body is now typed + validated */ },
);
```

- Request fails validation → **400** with `{ error: 'Invalid request body: ...' }`.
- Response fails validation:
  - **dev** (`NODE_ENV !== 'production'`): loud — `console.error` + return a 500 envelope so the test fails.
  - **prod**: soft — `console.warn` + serve the body anyway, so a wire-shape drift on deploy doesn't 500 every user.
- Response validation runs only on 2xx; error envelopes (4xx/5xx) have their own shape and pass through.

### Middleware order rule (load-bearing)

For any protected route:

```
requireAuth | adminGate  →  validate()  →  handler
```

Auth runs **first** so 401/403 wins over 400. If `validate()` ran first, an unauthenticated request with a bad body would return 400 (leaking validation details) instead of 401. Adding a new protected route? Mount the auth check before `validate()`.

### Published books are immutable (#20, "withdraw to edit")

A `Book` may be mutated only while `status === 'draft'`. Every content-mutating book route uses
the shared gate in `server/src/lib/availability.ts` instead of writing its own check:

```ts
if (book.created_by !== user.id) return res.status(404).json({ error: 'Book not found.' });
if (!isEditable(book)) return res.status(403).json({ error: PUBLISHED_IMMUTABLE_ERROR });
```

- **Ownership first, then status — always.** A non-owner gets **404**, never 403; a 403 would
  confirm to a stranger that someone else's book exists and is published. The order of those two
  lines is an information-leak decision, not a style choice.
- `isEditable` **fails closed** — anything that is not exactly `'draft'` is immutable, so a
  future status value cannot silently reopen editing.
- It is a **handler-body check, not middleware**, so the order rule above is unchanged. On a paid
  route it must be the first statement in the body, before any provider call and before
  `recordUsage`, so a 403 costs nothing.
- The shopper-facing sibling is `AVAILABLE_BOOK_WHERE` (`{ deleted_at: null, status: 'published' }`),
  a Prisma `where` fragment shared by cart display, the add-item lookup, and checkout so all
  three agree on what is purchasable. New availability conditions go there, not inline in one
  route.

Editing a published book means withdrawing it (`PUT /api/books/:id/unpublish`) and republishing.
Reasoning, rejected alternatives, and accepted costs:
`.code-captain/specs/edit-published-books/spec.md`.

## Auth — Bearer tokens (not "no auth")

- **`Authorization: Bearer <uuid>`** header on every authed request.
- Token is regenerated on every login (server-side rotation). Logout clears it. No expiration — token is invalidated by rotation or admin tombstone.
- Passwords stored as `salt:sha256(salt+password)` in `User.password_hash`.
- `getAuthUser(req)` (exported from `routes/auth.ts`) returns the user row or `null`.
- `requireAdmin(req)` returns the user row only if `user.role === 'admin'`, else `null`.
- **Soft-deleted users** (`deleted_at` non-null) cannot log in and their tokens stop authenticating. Rows persist so admins can restore later.

### Routes

The auth routes, plus any route elsewhere whose auth requirement is itself load-bearing:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | none | Create account |
| POST | `/api/auth/login` | none | Returns token |
| POST | `/api/auth/logout` | bearer | Clears server-side token |
| GET | `/api/auth/me` | bearer | Echoes the authed user |
| GET | `/api/hero/pool` | **none — and must stay none** | Hero-rotation pool frames. Public, read-only, `Cache-Control: public, max-age=300`. Never reads the authenticated user. |
| PUT | `/api/admin/books/:id/hero-eligible` | `adminGate` | Toggles the editorial `Book.is_hero_eligible` flag. Returns `hero_frames_available`. |

`GET /api/hero/pool` has **no auth middleware on purpose**, and adding an optional auth
read is the one change that must not be made casually: the pool is a published list, so
the response is byte-identical signed-out, as a normal user, and as an admin. That is
asserted directly in `server/src/routes/__tests__/hero.test.ts`, and it is the tripwire on
the moment "what the catalog promotes" and "what this person's account contains" become
one code path. `PUT /api/admin/books/:id/hero-eligible` is the matching seam on the write
side: it sets editorial eligibility only and deliberately never writes `hero_consent_at`,
because an admin flagging a book is not the book's owner consenting to promotional
display. No API writes that column at all. See
`.code-captain/specs/hero-rotation/spec.md` §"The consent seam".

## Claude API integration

- Model: `claude-sonnet-4-6` (set per call in `routes/generate.ts` and `services/illustrations.ts`).
- Use the official SDK (`@anthropic-ai/sdk`). Initialize a client per route module — no global singleton.
- Structured output: request JSON via the schema-shaped system prompt, parse with `JSON.parse`, validate the parsed object before persisting.
- **Always confirm with the user** before swapping the Claude model or upgrading the SDK major version (CLAUDE.md guardrail).

## Image generation — `IMAGE_PROVIDER` is only the default for books with no art

`IMAGE_PROVIDER` (`'openai' | 'fal'`, default `'fal'`) selects the image provider — but **only
for a book that has never been illustrated**. Once a book has art, the provider and base model
that produced it are pinned on the row (`Book.image_provider` / `Book.image_model`) and that pin
wins forever. This is a partial supersession of ADR-006 decision 2.

Why: re-rolling a page used to silently adopt today's default, so a book drawn on `gpt-image-1`
in May came back as glossy Flux Pro digital painting in August — same prompt, same
`style_descriptor`, different model. Flipping `IMAGE_PROVIDER` today will **not** change how an
existing book re-rolls, and that is the point.

- **The single choke point is `server/src/services/imagePin.ts`.** Routes call
  `resolveAndPinImagePin(book)` and thread the result: `{ pin }` into the generate functions,
  `pin.provider` into **both** `checkQuota` and `recordUsage`. Passing it to one and not the
  other lets the price difference escape the ceilings.
- **The pin is written lazily**, on the first successful image write (`generate.ts`), never at
  row-create time — it records art that exists, not an intention.
- **An unpinned legacy book is inferred, then backfilled**: earliest page-slot
  `IllustrationVersion.created_at` → oldest `page-*.png` mtime → current env default, against
  `PROVIDER_CUTOVER_AT = 2026-06-05` (the merge date of #60, which made Fal the default).
- **A pinned-but-unconfigured provider returns 409, never a silent fallback.** Keep the two
  failure modes distinct: **501** = no image provider is configured at all; **409** = this book
  needs a provider this server has no key for, while another one is configured. Falling back to
  the default re-creates the original bug, on exactly the books most vulnerable to it.
- **Cost is provider-aware.** `costCentsFor(kind, provider)` charges an openai-pinned image
  25¢ (`OPENAI_IMAGE_COST_CENTS`) against Fal's 4¢, because `gpt-image-1` genuinely costs
  4–11× more. `spendGate(kind)` still reserves at the default rate — it runs before the book is
  loaded — so the handler's per-call `checkQuota(..., pin.provider)` is the real gate.

## Cross-cutting server setup (`server/src/index.ts`)

- **`loadEnv.ts` MUST be imported before anything else.** It populates `process.env.DATABASE_URL` before the Prisma client instantiates. Re-ordering imports breaks this — keep `import './loadEnv'` as the first line.
- **`process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'`** is set unconditionally — required for the corporate proxy's self-signed cert. The test global setup mirrors this.
- **CORS:** allowlisted via `CORS_ORIGIN`, parsed by `server/src/lib/cors.ts` (`corsPolicy`). Comma-separated, lowercased, trailing slashes stripped. Unset in non-prod allows any origin (Vite on :5173, Playwright, curl); unset in production warns loudly but **stays permissive on purpose** — a drifted env var must not take a live service offline. Bearer-token auth means this was never the classic cross-site-request hole; what it closes is any page on the web scripting the API from a victim's browser and reading the response.
- **Body limit:** 10 MB (`app.use(express.json({ limit: '10mb' }))`). AI-generated content + illustrations can be large.
- **Static assets:** `/illustrations/*`, `/uploads/*` and `/hero/*` are served from `server/public/`. The first two hold runtime-generated content and are gitignored; `server/public/hero/` is the opposite — hand-derived, byte-budgeted hero-rotation frames, re-included in `.gitignore` and committed. See `server/public/hero/README.md`.
- **`/api/_test`** is mounted **only** when `NODE_ENV !== 'production'`. Handlers themselves also re-check the env to belt-and-suspender.
- **Auto-snapshot on boot:** `snapshotDb()` copies `dev.db` to `.backups/dev-{timestamp}.db` on every `npm run dev`. 7-day retention. No-op on first run before any DB exists.

## When adding a new route

1. **Define the Zod schemas** in `shared/src/<domain>.ts` (request + response).
2. **Add the route handler** in `server/src/routes/<domain>.ts`. Import the schemas; mount `validate({ request, response })` after any auth middleware.
3. **Use Prisma** for persistence — `prisma.<model>.findMany / create / update`. Add `deleted_at: null` to default queries for soft-deletable models.
4. **Mount the router** in `server/src/index.ts`: `app.use('/api/<domain>', <domain>Router)`.
5. **Write a Supertest integration test** in `server/src/routes/__tests__/<domain>.test.ts`. Use `createTestApp()` + `resetDatabase()` from `server/src/__tests__/setup.ts` (see `docs/conventions/testing.md`).
6. **Wire-shape-assert** every new response in the test — pin every field name the client depends on. See `testing.md` for the pattern.
7. **Mutating a book?** Call `isEditable(book)` from `server/src/lib/availability.ts` and return
   403 with `PUBLISHED_IMMUTABLE_ERROR` — **after** the owner check, never before (see
   "Published books are immutable" above).
8. **Paid route?** It needs **both** a `spendGate(kind)` mount and a `recordUsage(...)` call on
   success. Gating without recording defeats the global monthly ceiling, which sums the
   `UsageLog` rows only `recordUsage` writes — the character-portrait route ran paid and
   unmetered for exactly this reason.

## Things to NEVER do without user confirmation (CLAUDE.md guardrails)

- Drop or replace `dev.db` (use `db:reset` flow, never `rm dev.db` — the guard hook blocks it).
- Change seed shape in a way that invalidates existing carts/orders.
- Swap the Claude model or upgrade the Anthropic SDK major version.
- Add a new paid external API (image generation, payments).
- Modify the session/auth model (Bearer-token + UUID-session is load-bearing).
- Delete tests instead of fixing them.
