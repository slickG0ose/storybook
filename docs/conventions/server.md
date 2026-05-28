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

Per-route request and response shapes are Zod schemas in the source-only workspace package `shared/src/{books,cart,orders,admin,test}.ts`. Both client and server import inferred TypeScript types from the same schemas via `@storybook/shared`. **Never declare a wire shape in `server/src/types.ts`** — re-export from shared and add only server-internal DB-row / auth shapes there.

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

## Auth — Bearer tokens (not "no auth")

- **`Authorization: Bearer <uuid>`** header on every authed request.
- Token is regenerated on every login (server-side rotation). Logout clears it. No expiration — token is invalidated by rotation or admin tombstone.
- Passwords stored as `salt:sha256(salt+password)` in `User.password_hash`.
- `getAuthUser(req)` (exported from `routes/auth.ts`) returns the user row or `null`.
- `requireAdmin(req)` returns the user row only if `user.role === 'admin'`, else `null`.
- **Soft-deleted users** (`deleted_at` non-null) cannot log in and their tokens stop authenticating. Rows persist so admins can restore later.

### Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | none | Create account |
| POST | `/api/auth/login` | none | Returns token |
| POST | `/api/auth/logout` | bearer | Clears server-side token |
| GET | `/api/auth/me` | bearer | Echoes the authed user |

## Claude API integration

- Model: `claude-sonnet-4-6` (set per call in `routes/generate.ts` and `services/illustrations.ts`).
- Use the official SDK (`@anthropic-ai/sdk`). Initialize a client per route module — no global singleton.
- Structured output: request JSON via the schema-shaped system prompt, parse with `JSON.parse`, validate the parsed object before persisting.
- **Always confirm with the user** before swapping the Claude model or upgrading the SDK major version (CLAUDE.md guardrail).

## Cross-cutting server setup (`server/src/index.ts`)

- **`loadEnv.ts` MUST be imported before anything else.** It populates `process.env.DATABASE_URL` before the Prisma client instantiates. Re-ordering imports breaks this — keep `import './loadEnv'` as the first line.
- **`process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'`** is set unconditionally — required for the corporate proxy's self-signed cert. The test global setup mirrors this.
- **CORS:** open (`app.use(cors())`). No origin allowlist today.
- **Body limit:** 10 MB (`app.use(express.json({ limit: '10mb' }))`). AI-generated content + illustrations can be large.
- **Static assets:** `/illustrations/*` and `/uploads/*` are served from `server/public/`.
- **`/api/_test`** is mounted **only** when `NODE_ENV !== 'production'`. Handlers themselves also re-check the env to belt-and-suspender.
- **Auto-snapshot on boot:** `snapshotDb()` copies `dev.db` to `.backups/dev-{timestamp}.db` on every `npm run dev`. 7-day retention. No-op on first run before any DB exists.

## When adding a new route

1. **Define the Zod schemas** in `shared/src/<domain>.ts` (request + response).
2. **Add the route handler** in `server/src/routes/<domain>.ts`. Import the schemas; mount `validate({ request, response })` after any auth middleware.
3. **Use Prisma** for persistence — `prisma.<model>.findMany / create / update`. Add `deleted_at: null` to default queries for soft-deletable models.
4. **Mount the router** in `server/src/index.ts`: `app.use('/api/<domain>', <domain>Router)`.
5. **Write a Supertest integration test** in `server/src/routes/__tests__/<domain>.test.ts`. Use `createTestApp()` + `resetDatabase()` from `server/src/__tests__/setup.ts` (see `docs/conventions/testing.md`).
6. **Wire-shape-assert** every new response in the test — pin every field name the client depends on. See `testing.md` for the pattern.

## Things to NEVER do without user confirmation (CLAUDE.md guardrails)

- Drop or replace `dev.db` (use `db:reset` flow, never `rm dev.db` — the guard hook blocks it).
- Change seed shape in a way that invalidates existing carts/orders.
- Swap the Claude model or upgrade the Anthropic SDK major version.
- Add a new paid external API (image generation, payments).
- Modify the session/auth model (Bearer-token + UUID-session is load-bearing).
- Delete tests instead of fixing them.
