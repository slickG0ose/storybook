# Architecture: storybook-storefront

## System Context
A self-contained full-stack demo app. The React SPA communicates with the Express API via Vite's dev proxy. The only external dependency is the Anthropic Claude API for AI story/illustration generation.

## Layer Diagram
```
[Browser — React SPA :5173]
  → Vite proxy (/api → :3001)
    → Express middleware (CORS, JSON parsing, static files)
      → Route handlers (books, cart, orders, generate, auth, admin)
        → Zod validation middleware (request/response schemas)
          → Prisma ORM (SQLite)
          → Anthropic SDK (Claude API — story + illustration generation)
          → File system (public/illustrations/, public/uploads/)
```

## Directory Structure
```
storybook-storefront/
├── client/                    # React 19 SPA — 10 pages, 3 components, 3 contexts
│   └── src/
│       ├── components/        # Shared UI: BookCard, BookSpread, Navbar
│       ├── context/           # AuthContext, CartContext, ThemeContext
│       └── pages/             # Route pages: Home, BookDetail, CreateBook, Cart, ...
├── server/                    # Express REST API
│   ├── prisma/                # Schema, migrations, seed files, SQLite DB
│   └── src/
│       ├── db/                # Prisma client, DB init, snapshot utility
│       ├── middleware/        # Zod validation middleware
│       ├── routes/            # Express routers: books, cart, orders, generate, auth, admin
│       ├── services/          # Business logic: illustrations, parseAiJson
│       └── __tests__/         # Vitest + Supertest integration tests
├── shared/                    # @storybook/shared — Zod schemas + inferred TS types
│   └── src/                   # books.ts, cart.ts, orders.ts, admin.ts, test.ts
├── e2e/                       # Playwright E2E specs
│   └── tests/                 # 7 spec files covering major flows
└── docs/                      # Backlog, research notes
```

## Data Flow
1. **Browse books**: GET /api/books → Prisma query (filter by theme/age/featured) → JSON response
2. **Create story**: POST /api/generate → Claude API (structured JSON output) → Prisma insert (Book + Pages) → return book
3. **Revise story**: POST /api/books/:id/revise → Claude API with existing pages + feedback → new BookVersion + updated Pages
4. **Illustrations**: POST /api/books/:id/illustrate → Claude API generates description → illustration service → IllustrationVersion record
5. **Cart flow**: Session-based (UUID in localStorage) → CartItem table → Order + OrderItems on checkout
6. **Auth**: Register/Login → password_hash stored in User table → token-based session (Bearer header)

## External Integrations
| System | Protocol | Purpose | Config Location |
|--------|----------|---------|-----------------|
| Anthropic Claude API | HTTPS | Story generation, revision, illustration descriptions | .env (ANTHROPIC_API_KEY) |

## Key Design Decisions
- **SQLite + Prisma** for zero-config persistence (demo project, no external DB needed)
- **Zod schemas in shared package** for contract-first development between client ↔ server
- **Session-based cart** (UUID) allows anonymous shopping, user association optional
- **Version tracking** for both story text (BookVersion) and illustrations (IllustrationVersion) — enables iteration workflows
- **No build step for server** — tsx executes TypeScript directly in dev and "production"
- **Vite proxy** eliminates CORS issues in development, simplifies client fetch calls
