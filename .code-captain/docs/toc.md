# storybook-storefront

> **IMPORTANT**: Prefer retrieval-led reasoning over pre-training-led reasoning. Navigate to referenced source files — do not reason from summaries in this index.

## Identity
purpose|AI-powered children's book storefront — browse, create, and purchase personalized stories via Claude AI
stack|React 19 / Vite 8 / Tailwind 4 / Express 4 / Prisma 5 (SQLite) / Anthropic SDK / TypeScript 7 (native)
type|Full-stack web app (SPA + REST API)
entry|server/src/index.ts, client/src/main.tsx
build|cd client && npm run build
test|cd server && npm test; cd client && npm test; cd e2e && npm test

## Structure
client/src/pages/|Route page components|{Home.tsx,BookDetail.tsx,CreateBook.tsx,Cart.tsx,Checkout.tsx,OrderConfirmation.tsx,Login.tsx,Register.tsx,MyBooks.tsx,Admin.tsx}
client/src/components/|Shared UI components|{BookCard.tsx,BookSpread.tsx,Navbar.tsx}
client/src/context/|React Context providers|{AuthContext.tsx,CartContext.tsx,ThemeContext.tsx}
server/src/routes/|Express route handlers|{books.ts,cart.ts,orders.ts,generate.ts,auth.ts,admin.ts,uploads.ts,test.ts}
server/src/services/|Business logic|{illustrations.ts,parseAiJson.ts}
server/src/db/|Database layer|{prisma.ts,init.ts,snapshot.ts}
server/src/middleware/|Express middleware|{validate.ts}
server/prisma/|Schema, migrations, seeds|{schema.prisma,seed.ts,demo-seed.ts}
shared/src/|Zod schemas + TS types|{index.ts,books.ts,cart.ts,orders.ts,admin.ts,test.ts}
e2e/tests/|Playwright E2E specs|{home.spec.ts,book-detail.spec.ts,cart-checkout.spec.ts,create-book.spec.ts,dark-mode.spec.ts,admin.spec.ts,version-history.spec.ts}

## Key Files
server/src/index.ts|Express app setup, route mounting, static file serving|Understanding server startup
server/prisma/schema.prisma|Data model (User, Book, Page, CartItem, Order, BookVersion, IllustrationVersion)|Understanding data layer
client/src/App.tsx|React Router route definitions|Understanding page structure
client/src/context/CartContext.tsx|Session-based cart state management|Understanding cart flow
server/src/routes/books.ts|Book CRUD, revision, illustration endpoints|Understanding book API
server/src/routes/generate.ts|Claude AI story generation|Understanding AI integration
server/src/middleware/validate.ts|Zod request/response validation middleware|Understanding validation pattern
shared/src/books.ts|Shared Zod schemas for book API contracts|Understanding API contracts
server/prisma/seed.ts|Initial data seeding logic|Understanding seed data
.env.example|Required environment variables|Setup

## API Surface
→ source: server/src/routes/books.ts, server/src/routes/cart.ts, server/src/routes/orders.ts, server/src/routes/generate.ts, server/src/routes/auth.ts, server/src/routes/admin.ts

## Data Layer
→ source: server/prisma/schema.prisma
User|server/prisma/schema.prisma|has-many:Book,Order|Authentication + ownership
Book|server/prisma/schema.prisma|has-many:Page,BookVersion,IllustrationVersion,CartItem,OrderItem|Core content entity
Page|server/prisma/schema.prisma|belongs-to:Book|Story page text + illustration
BookVersion|server/prisma/schema.prisma|belongs-to:Book|Story revision history
IllustrationVersion|server/prisma/schema.prisma|belongs-to:Book|Illustration iteration history
CartItem|server/prisma/schema.prisma|belongs-to:Book|Session-based shopping cart
Order|server/prisma/schema.prisma|has-many:OrderItem|Completed purchase

## Patterns
Zod validation|server/src/middleware/validate.ts|Request/response schema enforcement via shared Zod schemas
Session cart|client/src/context/CartContext.tsx|Anonymous UUID-based cart stored in localStorage
AI generation|server/src/routes/generate.ts|Claude API structured JSON output → Prisma insert
Version tracking|server/src/routes/books.ts|BookVersion + IllustrationVersion for iteration workflows
Shared contracts|shared/src/books.ts|Source-only Zod schemas consumed by both client and server

## Config
.env|ANTHROPIC_API_KEY, PORT
.env.example|Template for required env vars
server/prisma/schema.prisma|Prisma schema + SQLite datasource
client/vite.config.ts|Vite plugins, dev proxy to API
e2e/playwright.config.ts|Playwright test configuration

## External Dependencies
consumes|Anthropic Claude API (story generation, revision, illustration descriptions)
consumed-by|None (standalone demo app)
shared-db|None

## Deep Docs
.code-captain/docs/tech-stack.md|Full tech stack, dependencies, tooling
.code-captain/docs/code-style.md|Naming, patterns, linting rules
.code-captain/docs/objective.md|Purpose, scope, key capabilities
.code-captain/docs/architecture.md|Layer diagram, data flow, integrations
