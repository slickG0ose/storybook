# Testing conventions

Patterns and infrastructure for tests in `server/`, `client/`, `e2e/`, and root harness tests.

## Test pyramid

| Layer | Framework | Where it lives | Run with |
|---|---|---|---|
| Harness | Vitest | `.claude/__tests__/` | `npm test` (root) |
| Server unit/integration | Vitest + Supertest | `server/src/**/__tests__/` | `cd server && npm test` |
| Client unit | Vitest + React Testing Library + jsdom | `client/src/**/__tests__/` | `cd client && npm test` |
| E2E | Playwright (Chromium) | `e2e/tests/` | `cd e2e && npm test` |

Live counts (as of writing): harness 101, server 114, client 44. Don't trust this table once it's a few months old — `npm test` is the source of truth.

## Wire-shape assertions (MANDATORY for new routes)

Every new or changed server route response **MUST** be tested with a `toMatchObject` (or equivalent) that names every field the client depends on. This is the load-bearing convention from OPS.3 (ADR-003) — it catches client/server type drift at the unit-test layer, before it reaches e2e or production.

Pattern (canonical example: `server/src/routes/__tests__/orders.test.ts`):

```ts
expect(res.body.items[0]).toMatchObject({
  book_id: expect.any(String),
  title: expect.any(String),       // ← if client renames to book_title, this test fails
  quantity: expect.any(Number),
  price: expect.any(Number),
});
```

Rules:

1. **Name every field by name.** Never settle for `expect(res.body.items.length).toBeGreaterThan(0)` — that won't catch a field rename.
2. **Use `expect.any(Type)`** for variable values; only hard-code values when they're truly fixed.
3. **One wire-shape assertion per response shape**, not per test — repeat shape assertions are noise.
4. The `validate()` middleware (server) ALSO validates response shape against the Zod schema in dev, but that's a second line of defense — the test's job is to catch drift before code ships.

### Carve-out: binary responses (ADR-008)

A route whose 2xx body is a binary stream has no JSON success shape to pin. The rule's intent still holds — nothing about the response goes unasserted — so the pinnable surface becomes the headers plus the format signature:

```ts
expect(res.headers['content-type']).toMatch(/^application\/pdf/);
expect(res.headers['content-disposition']).toMatch(/attachment; filename=".+\.pdf"/);
expect((res.body as Buffer).subarray(0, 5).toString('utf8')).toBe('%PDF-');
```

Rules for these routes:

1. **Every 4xx/5xx envelope is still pinned the normal way** — `toMatchObject({ error: expect.any(String) })` against the route's error schema. The carve-out covers the success path only.
2. **Mount `validate({ request })` with no `response` key.** Response validation is opt-in; there is no schema to give it.
3. **Collect the body yourself.** Supertest's default parser corrupts binary bodies — use `.buffer(true).parse(...)` on every test that asserts a 200. Canonical example: the `POST /api/books/:id/pdf` block in `server/src/routes/__tests__/books.test.ts`.

## Server tests — Vitest + Supertest + Prisma

### Test DB lifecycle

`server/src/__tests__/globalSetup.ts` runs **once** per test process: wipes any existing `test.db` and applies migrations via `npx prisma migrate deploy`. Test code points at `DATABASE_URL=file:./test.db` (set in `server/vitest.config.ts`).

`server/src/__tests__/setup.ts` exports:

- **`resetDatabase()`** — deletes all rows from every table, then upserts the canonical seed (books + pages). Idempotent.
- **`createTestApp()`** — returns a fresh Express app with all routers mounted. No file watchers, no port binding.

### `beforeEach` pattern

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, resetDatabase } from '../../__tests__/setup';

describe('Orders API', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
  });

  it('creates an order', async () => {
    const res = await request(app).post('/api/orders').send({ /* ... */ });
    expect(res.status).toBe(200);
    // wire-shape assertion here
  });
});
```

### Legacy: `resetStore()`

`server/src/db/init.ts` exports a `resetStore()` for the old JSON-store path. **Do not use it in new tests.** New tests use `resetDatabase()` (Prisma). The CLAUDE.md guardrail "use `resetStore()` for tests instead of `rm data.json`" is historical — both `data.json` and `resetStore()` belong to the deprecated path. The guardrail will be revised in HR9.

## Client tests — Vitest + RTL + jsdom

### Setup

`client/vitest.config.ts` sets `environment: 'jsdom'`. `client/src/test/setup.ts` is loaded automatically and:

- Imports `@testing-library/jest-dom/vitest` so matchers like `toBeInTheDocument()` are available.
- Polyfills `window.matchMedia` (jsdom doesn't implement it; `ThemeContext` and any responsive logic need it).

### Provider wrapping

Components that consume context throw when rendered without their provider. Wrap manually in the test:

```ts
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

render(
  <MemoryRouter>
    <CartProvider>
      <Navbar />
    </CartProvider>
  </MemoryRouter>,
);
```

For components that don't need the real context (e.g. you're testing rendering logic and the context is incidental), **mock the hook** with `vi.mock`:

```ts
vi.mock('../../context/CartContext', () => ({
  useCart: () => ({ items: [], total: 0, /* ... */ }),
}));
```

This is faster than wiring a real provider and keeps tests focused.

**Annotate the factory's return type — `tsc` will not do it for you.** A `vi.mock` factory
returns an untyped object literal, so a mock that is *missing* fields the real context now
exposes still type-checks. Adding `offline` / `lastSyncedAt` to `CartContextValue` left
three of four mock sites silently stale under `npx tsc --noEmit`. Export the context's value
type and pin the factory to it, so the next field addition breaks the mock at compile time
instead of at runtime:

```ts
import type { CartContextValue } from '../../context/CartContext';

vi.mock('../../context/CartContext', () => ({
  useCart: (): CartContextValue => ({ items: [], total: 0, offline: false, /* ... */ }),
}));
```

Same rule for any context whose value type grows: export the interface, annotate the mock.

### Mocking fetch

Use `vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(...) }))`. Don't reach for MSW — overkill for the current test scope.

## E2E tests — Playwright

### Configuration

`e2e/playwright.config.ts`:

- **Auto-starts both servers** via `webServer[]`: spawns server (`:3001`) and client (`:5173`) before the test run.
- **`reuseExistingServer: !process.env.CI`** — if you're running `npm run dev` already, Playwright uses your running servers (faster). In CI it always spins up fresh.
- 1 Chromium project. No Firefox/Webkit today.
- `fullyParallel: true` locally; 1 worker in CI.
- HTML report; trace on first retry; screenshot only on failure.

### Selector strategy — role-based, not CSS

```ts
// Good — survives CSS changes and matches what screen readers see
await page.getByRole('button', { name: 'Add to Cart' }).click();
await page.getByText('Cart').click();

// Bad — breaks on class rename
await page.locator('.btn-primary').click();
```

For icon-only buttons, the role-based selector matches the **`aria-label`**. See `docs/conventions/client.md` — adding `aria-label` to icon-only buttons is required so e2e tests can target them.

### Wait pattern — visible content, not response timing

```ts
// Good — waits for the UI to settle
await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

// Bad — race condition: response can land before React re-renders
await page.waitForResponse(/api\/books/);
```

### Test isolation

- **Cart tests:** clear `localStorage` in `beforeEach` to drop the cart session UUID. Otherwise tests pollute each other.
- **Auth tests:** log out / clear `localStorage.storybook-auth` in `beforeEach`.

```ts
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});
```

### Running

```bash
cd e2e && npm test               # headless
cd e2e && npm run test:headed    # see the browser
cd e2e && npm run test:ui        # interactive UI mode (best for debugging)
```

## Harness tests (root)

`npm test` (from project root) runs `.claude/__tests__/**` — schema, reference integrity, and hook behavior tests for the agent/skill/command/hook config. These don't exercise the app; they validate the harness itself. See HR11 PR for context.

Add a harness test when:

- A new agent/skill/command file shape is introduced.
- A new cross-reference convention emerges (e.g. CLAUDE.md → conventions, conventions → agents).
- A new hook script is added — write at least the positive + negative case for each rule.

## Cross-cutting

- **Run the full suite before committing** (`cd server && npm test`, `cd client && npm test`, `cd e2e && npm test`, and root `npm test`). The CLAUDE.md done criteria require it.
- **Wire-shape assertions are non-negotiable** for new routes.
- **Don't delete tests** to make builds green — that requires user confirmation (CLAUDE.md guardrail).
