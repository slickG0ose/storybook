# Call graph — what calls what across zones

Cross-boundary edges only: `client/` → `server/`, route → service, and everything
touching `@storybook/shared`. Read this to answer "if I change X, what breaks?"
without grepping four workspaces.

Within-zone conventions live in [client.md](client.md), [server.md](server.md),
[data.md](data.md), and [testing.md](testing.md) — this file does not repeat them.

> Hand-maintained. Regeneration commands are at the bottom; run them after adding a
> route or an API call and fix any drift.

## The four boundaries

```
client/src/pages/*        client/src/context/*        client/src/lib/*
        └──────────────── api('/api/...') fetch ────────────────┘
                                   │
                          server/src/index.ts          ← mounts routers by prefix
                                   │
                          server/src/routes/*          ← validate() + handler
                                   │
              ┌────────────────────┼────────────────────┐
       services/*               lib/*              middleware/*
              └────────────────────┼────────────────────┘
                            db/prisma.ts             ← the only persistence path

  @storybook/shared/src/*  ─── Zod schemas ───►  both sides, via each zone's types.ts
```

## Client → server

Every network edge in the app. The left column is the **only** place that URL is
called from; change a route's shape and this tells you the single file to update.

| Client caller | API prefix it owns |
|---|---|
| `context/AuthContext.tsx` | `/api/auth/{register,login,logout,me}` |
| `context/CartContext.tsx` | `/api/cart/:sessionId` (+ `/items`, `/items/:bookId`) |
| `lib/useHeroPool.ts` | `/api/hero/pool` |
| `pages/Home.tsx` | `/api/books`, `/api/books/:id`, `/api/books/{themes,age-ranges}` |
| `pages/MyBooks.tsx` | `/api/books/mine`, `/api/books/:id`, `:id/{publish,unpublish}` |
| `pages/BookDetail.tsx` | `/api/books/:id/{illustrate,revise,publish,unpublish,pdf}`, `:id/pages/:n`, `:id/illustrations/:n[/revert]`, `:id/versions[/:v/restore]`, `:id/characters/:i/portrait` |
| `pages/CreateBook.tsx` | `/api/generate`, `/api/uploads/style-reference` |
| `pages/Checkout.tsx` | `POST /api/orders` |
| `pages/OrderConfirmation.tsx` | `GET /api/orders/:id` |
| `pages/Admin.tsx` | all of `/api/admin/*` |

Rules this table encodes:

- **`components/` never calls `api()` directly.** It reaches the network through a
  context (`useAuth`, `useCart`) or a hook in `lib/` (`HeroArt.tsx` → `useHeroPool`).
  A `fetch` appearing under `components/` is the thing to push down.
- **One owner per prefix.** `/api/books/:id` is the only path called from two pages
  (`Home`, `MyBooks`, `BookDetail`) — everything else has exactly one caller.
- All URLs go through `api()` in `lib/apiBase.ts`, never a bare string — that is what
  makes this table greppable and what makes the prod cross-origin build work.

## Server: route → dependency

Fan-out per router. `db/prisma` is elided where a route only reads through a service.

| Router (`/api/…`) | services | lib | middleware |
|---|---|---|---|
| `auth` | `allowlist` | `password` | — |
| `books` | `illustrations`, `imagePin`, `parseAiJson`, `pdf`, `spend` | `apiKeys`, `availability`, `models` | `requireAuth`, `spendGate`, `validate` |
| `generate` | `illustrations`, `imagePin`, `parseAiJson`, `spend` | `apiKeys`, `models` | `requireAuth`, `spendGate` |
| `cart` | — | `availability` | `validate` |
| `orders` | — | `availability` | `validate` |
| `uploads` | `spend` | `apiKeys` | `requireAuth`, `spendGate`, `rateLimit` |
| `admin` | `allowlist`, `spend` | `heroPool` | `validate` |
| `hero` | — | `heroPool` | `validate` |
| `test` | `allowlist` | — | `validate` |

### Fan-in — change here, check there

Ranked by blast radius. These are the modules where a signature change is not local:

1. **`db/prisma.ts`** — imported by every service, `lib/heroPool`, and 7 routers. The
   only persistence path; nothing else opens the DB.
2. **`services/spend.ts`** — `books`, `generate`, `uploads`, `admin`, plus
   `middleware/spendGate`. Any spend-accounting change touches all four routers.
3. **`services/illustrations.ts`** — `books`, `generate`, and `providers/fal`. Owns the
   `ImageGenerator` interface that providers implement.
4. **`routes/auth.ts`** — exports `getAuthUser` / `requireAdmin` as values, consumed by
   `middleware/requireAuth`, `routes/books`, and `routes/admin` (see inversion below).
5. **`lib/availability.ts`** — `books`, `cart`, `orders`. Stock/publish-state logic that
   the checkout path depends on three times over.

### Two edges that look wrong and are not

- **`middleware/requireAuth.ts` → `routes/auth.ts`** is a real runtime import
  (`getAuthUser`), so middleware depends on a route module. Intentional: `auth.ts` owns
  token verification and the helper lives beside it. Do not "fix" it by duplicating the
  logic into middleware.
- **`services/illustrations.ts` ⇄ `services/providers/fal.ts`** is a cycle on paper.
  `fal.ts` imports `ImageGenerator`/`ImageGenOptions` with `import type`, which is erased
  at compile, so only the `illustrations → fal` value edge exists at runtime. Keep the
  provider side type-only when adding a provider.

## `@storybook/shared` — the schema seam

Source-only workspace package, no build step. Both zones import the same Zod schemas, so
a schema edit is a two-sided change by construction.

**Never import `@storybook/shared` directly from a page, component, route handler, or
service.** Each zone re-exports through its own barrel:

- `client/src/types.ts` re-exports `Book`, `BookWithPages`, `Page`, `Character`,
  `CartItem`, `Order`, `OrderItem`, `HeroFrame`, `AllowedEmail`, `AdminSpend*`,
  `OrphanIllustration`, `IllustrationVersion`, `BookVersion`.
- `server/src/types.ts` re-exports the same wire shapes and adds server-only DB shapes.

The narrow exceptions, all of which import a **schema** (not a type) because they
validate at runtime: `client/src/lib/cartCache.ts` (`CartGetResponseSchema`),
`client/src/lib/useHeroPool.ts` (`HeroPoolResponseSchema`), and the routers that pass
schemas to `validate()` (`books`, `cart`, `orders`, `admin`, `hero`, `test`).

Changing a schema in `shared/src/<domain>.ts` means checking, in order: the router that
validates it → the client barrel → the wire-shape test
([testing.md §wire-shape assertions](testing.md)).

## e2e → server

`e2e/` drives the UI, with three direct API edges for setup only:

- `global-setup.ts` → `GET /api/hero/pool` (preflight, asserts seeded hero frames)
- `playwright.config.ts` → `GET /api/health` (server readiness gate)
- `tests/_editPublished.ts` → `POST /api/_test/allow-email`, then real `POST /api/auth/register`

`/api/_test` is the only test-only router and is mounted solely when
`NODE_ENV !== 'production'` (`server/src/index.ts`).

## Regenerating this file

```bash
# Client → server edges
grep -rn "api('\|api(\`" client/src --include='*.ts' --include='*.tsx' | grep -v __tests__ \
  | sed -E "s|^client/src/([^:]*):[0-9]*:.*api\((['\`])([^'\`]*).*|\1  ->  \3|" | sort -u

# Route → dependency edges
for f in server/src/routes/*.ts; do echo "--- $(basename "$f" .ts)"; \
  grep -oE "from '\.\.?/[^']*'" "$f" | sed "s/from '//;s/'//" | sort -u; done

# Router mount prefixes
grep -n "app.use('/api" server/src/index.ts

# Shared-package importers (should only be barrels + runtime validators)
grep -rn "@storybook/shared" client/src server/src --include='*.ts' --include='*.tsx'
```
