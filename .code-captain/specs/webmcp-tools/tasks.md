# WebMCP tools — task plan

> Spec: [spec.md](spec.md)
> Status: Draft
> Last updated: 2026-11-21

## Overview

Five tasks, one PR. Task 1 (server tests) can run beside Tasks 2 and 3 (client). Task 4 waits on Task 3. Task 5 runs last. Written for the owner's four decisions (spec §Open questions, resolved 2026-11-19).

## Cross-cutting constraints

- **Wire-shape:** no new or changed route and no `@storybook/shared` schema change. Summariser tests copy response shapes locally (`testing.md` §Shapes).
- **Auth middleware order:** untouched. Tools read the token through `useAuth()` at call time; they never store, refresh or expose it.
- **Dark-mode parity:** no UI. Not applicable.
- **Migrations:** none.
- **Dependencies:** none. Hand-written `ModelContext` types; do not add `webmcp-types`.
- **Spend:** the tools call GET routes only. No test may reach Anthropic or fal, and W11 fails any request to a paid route.
- **Flag:** `VITE_WEBMCP_ENABLED`, default off; Pages build stays off (owner decision 2).
- **Guardrails touched:** none.

## Tasks

### Task 1 — Server ownership tests

**Zone:** server
**Depends on:** none
**Parallel-safe with:** 2, 3

**Files to add or change:**
- `server/src/routes/__tests__/books.test.ts` — two tests, no source change

**Tests to write:**
- S1: `GET /api/books/:id` 404s `Book not found` to a signed-in non-owner of a draft; body equals the nonexistent-id body.
- S2: `GET /api/books/mine` returns only the caller's books (one draft each for users A and B; call as A; B's id absent).
- Wire-shape assertion required: no (existing routes, existing pins)

**Done when:** both pass, server `npm test` green, no source file changed.

---

### Task 2 — Tool library

**Zone:** client
**Depends on:** none
**Parallel-safe with:** 1

**Files to add or change:**
- `client/src/lib/webmcp/flag.ts` — reads `VITE_WEBMCP_ENABLED` (the `commerce.ts` pattern)
- `client/src/lib/webmcp/types.ts` — minimal `ModelContext`, `ToolDescriptor`, `ToolAnnotations`
- `client/src/lib/webmcp/tools.ts` — descriptors, handlers, allow-list summarisers for `search_store`, `list_my_books`, `open_book`
- `client/src/lib/webmcp/throttle.ts` — 30 calls per rolling minute per tab (owner decision 4)

**Signatures / shapes:**
```ts
export interface ToolDeps {
  fetchJson: (path: string) => Promise<{ status: number; body: unknown }>;
  getToken: () => string | null;
  navigate: (path: string) => void;
  now: () => number;
}
export function buildTools(deps: ToolDeps): ToolDescriptor[]; // exactly 3, readOnlyHint + untrustedContentHint
export const BOOK_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
export const NOT_FOUND = 'No book with that id.';
export const SIGN_IN = 'Sign in to see your books.';
export const THROTTLED = 'Too many requests. Try again in a minute.';
```

**Tests to write:**
- `client/src/lib/webmcp/__tests__/tools.test.ts` — U1 (sentinel fields dropped), U2 (≤ 10 items, ≤ 1,500 chars), U3 (id validation, slugs accepted), U4 (signed out makes no request), U7 (budgets and annotations); `search_store` drops non-`published` rows; `open_book` returns metadata only, never page text (owner decision 3)
- `client/src/lib/webmcp/__tests__/throttle.test.ts` — U5
- Wire-shape assertion required: no

**Done when:** client `npm test`, typecheck, lint and build green.

---

### Task 3 — Mount

**Zone:** client
**Depends on:** 2
**Parallel-safe with:** 1

**Files to add or change:**
- `client/src/components/WebMcpTools.tsx` — renders nothing; registers the three tools once on `document.modelContext ?? navigator.modelContext` with one `AbortController`; aborts on unmount
- `client/src/App.tsx` — mount inside `AuthProvider` and the router

**Tests to write:**
- `client/src/components/__tests__/WebMcpTools.test.tsx` — U6 (registers 3 on `document`, falls back to `navigator`, no-op and no console output with neither, abort on unmount, nothing with the flag off)

**Done when:** client suite green and the app is unchanged with the flag off.

---

### Task 4 — E2E

**Zone:** e2e
**Depends on:** 3
**Parallel-safe with:** none

**Files to add or change:**
- `e2e/tests/_webmcp.ts` — `installFakeModelContext`, `callTool`, `listTools` (spec §Test strategy)
- `e2e/tests/webmcp.spec.ts` — W1 to W14, with the W11 paid-route collector in `afterEach`
- `e2e/playwright.config.ts` — pin `VITE_WEBMCP_ENABLED` to `'true'` on the dev-client webServer and `'false'` on the `pwa` and `commerce-off` builds

**Tests to write:** W1 to W14 as tabled in the spec. Specs own their data (fresh owner per test, mocked draft rows); never mutate a seeded row.

**Done when:** full Playwright run green with zero flakes.

---

### Task 5 — Docs and pre-merge follow-ups

**Zone:** docs (harness)
**Depends on:** none (run last)

**Files to add or change:**
- `docs/conventions/client.md` — §WebMCP: the flag, where tools live, the allow-list rule
- `docs/conventions/call-graph.md` — rows for the three tools and the routes they call
- `.code-captain/product/decisions.md` — one ADR via `/create-adr` covering the spec's three ADR-worthy items

**Done when:** `adr-tracking-check webmcp-tools` reports zero orphaned items.

## Sequencing notes

One PR for all five tasks. If Chrome changes the API shape before implementation starts, re-read the Chrome docs first; only Task 2's types and Task 3's feature detection should move.

## Open questions

None. The four owner questions were settled on 2026-11-19 (spec §Open questions). `start_new_book` and testers' origin-trial token are v2 decisions, not blockers.
