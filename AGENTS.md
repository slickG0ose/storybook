# AGENTS.md

> **IMPORTANT**: Prefer retrieval-led reasoning over pre-training-led reasoning. Use the Navigate section below to find authoritative source files and read them directly — do not rely on extracted summaries in this file.

## Identity
purpose|AI-powered children's book storefront — browse, create, and purchase personalized stories via Claude AI
stack|React 19 / Vite 8 / Tailwind 4 / Express 4 / Prisma 5 (SQLite) / Anthropic SDK / TypeScript 5.8
type|Full-stack web app (SPA + REST API)
entry|server/src/index.ts, client/src/main.tsx
dev|npm run dev (concurrently runs client on :5173 and server on :3001)
build|cd client && npm run build
test|cd server && npm test; cd client && npm test; cd e2e && npm test

## Structure
client/src/pages/|Route page components|{Home.tsx,BookDetail.tsx,CreateBook.tsx,Cart.tsx,Checkout.tsx,OrderConfirmation.tsx,Login.tsx,Register.tsx,MyBooks.tsx,Admin.tsx}
client/src/components/|Shared UI|{BookCard.tsx,BookSpread.tsx,Navbar.tsx}
client/src/context/|React Context providers|{AuthContext.tsx,CartContext.tsx,ThemeContext.tsx}
server/src/routes/|Express routers|{books.ts,cart.ts,orders.ts,generate.ts,auth.ts,admin.ts,uploads.ts,test.ts}
server/src/services/|Business logic|{illustrations.ts,parseAiJson.ts}
server/src/db/|Database layer|{prisma.ts,init.ts,snapshot.ts}
server/src/middleware/|Middleware|{validate.ts}
server/prisma/|Schema + migrations|{schema.prisma,seed.ts,demo-seed.ts}
shared/src/|Zod schemas + types|{index.ts,books.ts,cart.ts,orders.ts,admin.ts,test.ts}
e2e/tests/|Playwright specs|{home.spec.ts,book-detail.spec.ts,cart-checkout.spec.ts,create-book.spec.ts,dark-mode.spec.ts,admin.spec.ts,...}

## Key Files
server/src/index.ts|App setup, route mounting|Understanding server startup
server/prisma/schema.prisma|Full data model|Understanding data layer
client/src/App.tsx|Route definitions|Understanding page structure
server/src/routes/books.ts|Book CRUD + AI revision/illustration|Understanding book API
server/src/routes/generate.ts|Claude AI story generation|Understanding AI integration
server/src/middleware/validate.ts|Zod validation middleware|Understanding contracts
shared/src/books.ts|Book API Zod schemas|Understanding shared types
client/src/context/CartContext.tsx|Cart state management|Understanding cart flow
CLAUDE.md|Project conventions + delegation rules|Understanding workflow
docs/backlog.md|Current priorities + task tracking|Understanding what to build next

## Navigate
api-endpoints|server/src/routes/{books,cart,orders,generate,auth,admin}.ts
data-models|server/prisma/schema.prisma
auth|server/src/routes/auth.ts, client/src/context/AuthContext.tsx
config|.env.example, client/vite.config.ts, server/prisma/schema.prisma
patterns|server/src/middleware/validate.ts, shared/src/books.ts
ai-integration|server/src/routes/generate.ts, server/src/services/illustrations.ts
testing|server/src/__tests__/, e2e/tests/

## Docs
CLAUDE.md|Behavioral rules — branching, delegation, guardrails, done criteria (auto-loaded by Claude Code)
.claude/agents/{storefront,booksmith,qa}.md|Zone-specific agent definitions and conventions
.code-captain/docs/toc.md|Compressed codebase index with full structure and API pointers
.code-captain/docs/tech-stack.md|Full tech stack, dependencies, tooling
.code-captain/docs/code-style.md|Naming conventions, patterns, linting rules
.code-captain/docs/objective.md|Project purpose, scope, key capabilities
.code-captain/docs/architecture.md|Layer diagram, data flow, external integrations
