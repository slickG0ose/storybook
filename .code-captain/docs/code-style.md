# Code Style: storybook-storefront

## Naming Conventions
- Classes/Components: PascalCase (e.g., `BookCard`, `CartProvider`)
- Functions/Hooks: camelCase (e.g., `getAuthUser`, `useCart`)
- Files (components): PascalCase.tsx (e.g., `BookDetail.tsx`, `CartContext.tsx`)
- Files (server): camelCase.ts (e.g., `books.ts`, `parseAiJson.ts`)
- Variables: camelCase
- Database columns: snake_case (Prisma schema convention)
- CSS classes: Tailwind utility classes (no custom CSS classes)

## Project Structure Pattern
Monorepo with npm workspaces. Feature-based file organization:
- Client: pages/ (route components), components/ (shared UI), context/ (React Context providers)
- Server: routes/ (Express routers), services/ (business logic), db/ (Prisma/init), middleware/
- Shared: Source-only Zod schemas + inferred types (no build step)

## Error Handling
- Server: try/catch in route handlers, return `{ error: string }` with appropriate HTTP status
- Zod validation middleware (`server/src/middleware/validate.ts`) for request/response shape enforcement
- Client: async/await with try/catch in context providers, error state in components

## Dependency Injection
- None (Express functional pattern — routers import services/prisma directly)
- React Context for shared state (CartContext, ThemeContext, AuthContext)

## Async Patterns
- async/await throughout (Express route handlers, React context methods)
- No streaming or WebSocket patterns
- Claude API calls use await (non-streaming)

## Formatting & Linting
| Tool | Config | Key Rules |
|------|--------|-----------|
| ESLint | client/eslint.config.js | react-hooks, react-refresh (client only) |
| TypeScript | strict mode in tsconfigs | noEmit, ESNext modules |
| Tailwind | @tailwindcss/vite plugin | v4 (no config file needed) |

## Testing Conventions
- Server tests: Co-located in `__tests__/` subdirectories — `server/src/routes/__tests__/*.test.ts` (5 route integration tests via Supertest), `server/src/services/__tests__/*.test.ts` (2 unit tests). `server/src/__tests__/` holds Vitest globalSetup/setup only.
- Client tests: Co-located in `__tests__/` subdirectories — `client/src/{components,context,pages}/__tests__/*.test.tsx` (8 files) via Vitest + React Testing Library.
- E2E tests: `e2e/tests/*.spec.ts` with Playwright Page Object-lite style.
- Test databases: Separate `test.db` for server integration tests.
