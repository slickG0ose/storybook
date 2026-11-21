# WebMCP tools: let a browser agent find and open books

> Status: Draft (owner settled all four open questions on 2026-11-19: recommended default on each)
> Last updated: 2026-11-21
> Backlog: none yet (open an issue under the Foundation milestone when this is accepted)

## Open questions for the owner: resolved 2026-11-19

The owner chose the recommended default on all four. The task plan runs on these.

1. **Decided: no `start_new_book` in v1; it moves to v2.** It would only prefill the Create form, but it is the first tool that changes state and leads into a paid flow. v1 proves the read path first.
2. **Decided: dev-only.** `VITE_WEBMCP_ENABLED` defaults off and the Pages build keeps it off. No origin-trial token for now; testers don't need this to test books.
3. **Decided: `open_book` returns metadata only** (title, author, age range, page count, private or published), never story text. Story text is the most personal part of a private book, and every tool result goes to the agent's model.
4. **Decided: 30 tool calls per minute per tab**, client-side.

## Problem

WebMCP lets a web page hand a browser agent a short list of typed tools ("search the store", "list my books") instead of making it click through the UI by screenshots. The "AI for small business and WebMCP" brief (2026-11-17) picks Storybook as the first $0 experiment: a few tools, with Playwright tests that call them.

Storybook has two properties that make this more than a demo. Books are **private by default** since #235, so a careless tool could hand one user's draft to an agent acting for someone else, or leak a child's name into a third-party model. And **generation costs money** (`COST_CENTS` in `server/src/services/spend.ts`), so a tool that an agent can loop on must never reach a paid route.

## What WebMCP is today (checked 2026-11-19)

- **Status:** Chrome origin trial from Chrome 149; locally behind `chrome://flags/#enable-webmcp-testing`. The spec is a W3C Community Group draft, not a standard. No Firefox or Safari implementation. Chrome's docs say the API may still change. ([Chrome docs, updated 2026-10-07](https://developer.chrome.com/docs/ai/webmcp), [spec draft](https://webmachinelearning.github.io/webmcp/))
- **API shape:** `await document.modelContext.registerTool({ name, description, inputSchema, annotations, execute }, { signal })`. `execute(args, { signal })` returns a string or JSON value. Unregister by aborting the signal (there is no `unregisterTool`). Agents use `getTools()` and `executeTool()`. ([Imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api))
- **It moved.** Early builds and most blog posts use `navigator.modelContext`; the draft moved it to `document.modelContext` in July 2026 and Chrome 150 deprecated the old one. The origin trial still ships both. **We feature-detect both.** `provideContext()` / `clearContext()` were removed; do not use them.
- **Annotations:** `readOnlyHint`, `untrustedContentHint`, `consequentialHint`. Tools are same-origin only unless `exposedTo` lists other origins. ([Secure tools](https://developer.chrome.com/docs/ai/webmcp/secure-tools))
- **Budgets Chrome recommends:** name ≤ 30 chars, tool description ≤ 500, parameter description ≤ 150, tool output ≤ 1,500 chars.
- **UNVERIFIED:** whether Playwright's bundled Chromium exposes `document.modelContext` with any launch flag. Chrome documents only the `chrome://flags` switch, and says headless use "may be possible". This spec does not depend on it (Decision 4).

## Constraints

- **No server change, no new route, no wire-shape change.** Tools call the same `/api` routes the UI calls, through `authFetch` with the signed-in user's token. The server's existing ownership checks are the privacy boundary.
- **No new dependency.** Hand-write a small `ModelContext` type (about 20 lines) rather than adding `webmcp-types`. A new `package.json` entry is a size-gate trigger.
- **No auth or session change.** Tools read the token the `AuthProvider` already holds; they never store, refresh or expose it.
- **No paid route, ever.** None of the three tools may issue a request to `/api/generate`, `/illustrate`, `/cover`, `/portrait`, `/revise`, `POST /narration` or `/api/uploads`.
- **Build-time flag, off by default.** `VITE_WEBMCP_ENABLED`, parsed the way `VITE_COMMERCE_ENABLED` is (`client/src/lib/commerce.ts`), so it is statically removed from builds that leave it off.
- **Book ids are not always UUIDs.** Seeded books use slugs (`luna-star-garden`). Input validation is `^[A-Za-z0-9-]{1,64}$`, not a UUID regex.

## Proposed shape

### Decision 1: three read-only tools, all in the browser

| Tool | Calls | Returns (≤ 10 items, ≤ 1,500 chars) | Annotations |
|---|---|---|---|
| `search_store` | `GET /api/books?search=&age_range=` | id, title, author, age range, theme | `readOnlyHint`, `untrustedContentHint` |
| `list_my_books` | `GET /api/books/mine` (signed in only) | id, title, private or published, page count, created date | `readOnlyHint`, `untrustedContentHint` |
| `open_book` | `GET /api/books/:id`, then client navigation to `/book/:id` | title, author, age range, page count, private or published | `readOnlyHint`, `untrustedContentHint` |

**Inputs.**
- `search_store`: `query` (string, 1 to 100 chars, required), `age_range` (optional, one of `AGE_RANGES` from `@storybook/shared`).
- `list_my_books`: none.
- `open_book`: `book_id` (string, `^[A-Za-z0-9-]{1,64}$`, required).

**Why these three.** They are the agent version of the three things a tester does first: browse, find their own book, open it. All three are reads the user can already do by hand, so the tools add speed, not reach. `readOnlyHint` lets an agent run them without a confirmation prompt; `untrustedContentHint` tells it that titles and authors were written by other people (and by an AI), so it should not follow instructions inside them.

**Why no write tools.** Create, revise, illustrate, narrate, publish, cart and checkout all spend money or change what other people can see. v1 has none. `start_new_book` is deferred to v2 (owner decision 1).

### Decision 2: privacy rules

1. **The server decides who sees what.** Tools never filter ownership themselves. `GET /api/books` returns published books only; `GET /api/books/mine` scopes to the token's user; `GET /api/books/:id` 404s a draft to anyone but its author (`server/src/routes/books.ts`, `/:id` handler). A tool can only ever show what the signed-in user could open in the UI.
2. **Return less than the API does.** Each tool maps the response through an explicit allow-list summariser. It never passes `characters`, `characters_json`, `description`, page text, `style_reference_url`, `cover_url`, `illustration_url` or any `/illustrations/` or `/uploads/` link. Signed media links are bearer tokens for up to 2 hours (signed-media-urls spec), and character names are often a real child's name.
3. **Not found looks the same either way.** `open_book` returns the identical message, "No book with that id.", for a nonexistent id and for someone else's private book, and does not navigate. No existence oracle.
4. **Signed out means no private data.** `list_my_books` reads the token at call time. With no token it returns "Sign in to see your books." and makes no request. Signing out mid-session takes effect on the next call.
5. **Same origin only.** No `exposedTo`. Cross-origin frames and other sites cannot see the tools.
6. **Belt and braces on the store.** `search_store` also drops any row whose `status` is not `published`, in case the list route ever regresses (the server already filters; `books.test.ts` 'excludes draft books from storefront listing').
7. **Private stays labelled.** `list_my_books` and `open_book` say "private" for a draft, so the agent can tell the user it is not shared.

### Decision 3: rate limits and spend

- **Spend: zero by construction.** The three tools call only GET routes, and none of them is paid. The e2e suite fences this with a request collector (test W11).
- **Throttle in the tool layer.** 30 calls per rolling minute per tab, shared across the three tools. Over the limit, a tool returns "Too many requests. Try again in a minute." without touching the network. Why: an agent can loop, and `GET /api/books` and `/api/books/mine` carry no server rate limit today (`rateLimit` is mounted on paid routes only). This protects the free Render instance from one tab; it is not a security boundary.
- **No server rate-limit change.** Adding limits to public GET routes is a separate decision (they would need an IP key, `authRateLimit.ts` territory, ADR-018/030). Listed in Out of scope.

### Decision 4: how tools register, and how we test them without real WebMCP

- `client/src/lib/webmcp/` holds pure handlers that take their dependencies (`fetchJson`, `getToken`, `navigate`, `now`) so they unit-test without a browser.
- `WebMcpTools.tsx` (renders nothing) mounts inside `AuthProvider` and the router in `App.tsx`. If the flag is on and `document.modelContext ?? navigator.modelContext` exists, it registers the three tools once with one `AbortController` and aborts on unmount. If neither exists it does nothing, with no console error.
- **Playwright uses a fake `modelContext`,** installed with `page.addInitScript` before the app loads, the same way `_media.ts` and `_speech.ts` fake browser APIs. The fake records `registerTool` calls and exposes `executeTool`. This proves our tool code end to end against the real app and the real server. It does **not** prove Chrome's agent picks the tools up; that is a manual check (Test strategy, M1), because Chrome's WebMCP is still a flagged trial.

### Files likely touched

- `client/src/lib/webmcp/flag.ts` (new): reads `VITE_WEBMCP_ENABLED`.
- `client/src/lib/webmcp/types.ts` (new): minimal `ModelContext` / tool descriptor types.
- `client/src/lib/webmcp/tools.ts` (new): the three descriptors, handlers and summarisers.
- `client/src/lib/webmcp/throttle.ts` (new): 30-per-minute window.
- `client/src/components/WebMcpTools.tsx` (new), `client/src/App.tsx` (mount).
- `client/src/lib/webmcp/__tests__/*.test.ts`, `client/src/components/__tests__/WebMcpTools.test.tsx` (new).
- `e2e/tests/_webmcp.ts` (new fake), `e2e/tests/webmcp.spec.ts` (new), `e2e/playwright.config.ts` (pin the flag per webServer).
- `server/src/routes/__tests__/books.test.ts`: two tests only, no code (Task 1).
- `docs/conventions/client.md` (§WebMCP), `docs/conventions/call-graph.md`, `.code-captain/product/decisions.md` (ADR).

## Alternatives considered

| Option | Why not |
|---|---|
| **Declarative API** (`toolname` attributes on forms) | Chrome's spec text for it is still a TODO and attribute names may change. Also it would expose the Create form, which is the paid path. |
| **A server-side MCP server** for Storybook | A new process, auth for agents, and a real security surface. WebMCP rides the user's own session in their own tab, which is the point of the experiment. |
| **One `find_books` tool with `scope: mine | store`** | Mixes a public and a private scope in one call, so one wrong argument leaks. Two tools keep the private one obviously private. |
| **Return story text from `open_book`** | Owner decision 3: no. Held as a later option, maybe as a separate `read_book_page` tool with its own consent story. |
| **Add `webmcp-types`** | A dependency (size-gate trigger) for twenty lines of types on an API that is still moving. |

## Success criteria

- With the flag on and a `modelContext` present, exactly three tools register, each with `readOnlyHint: true`, within Chrome's name, description and output budgets.
- With the flag off, or with no `modelContext`, nothing registers and the app is unchanged.
- No tool output contains a media link, a character name, a description or page text (sentinel-string tests).
- `open_book` gives the same answer for someone else's private book as for a nonexistent id.
- No tool call issues a request to any paid route (request-collector test).
- All existing suites stay green; no TypeScript errors.

## Out of scope

- Any tool that writes, spends or publishes, including `start_new_book` (owner decision 1).
- Origin-trial token and turning the flag on in the Pages build (owner decision 2).
- `exposedTo` cross-origin sharing.
- Server rate limits on public GET routes.
- Making Chrome's real agent part of CI.

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| WebMCP API changes again (it already moved once) | Feature-detect both locations; all registration in one component; flag off by default; the fake in `_webmcp.ts` is the only test coupling. |
| Prompt injection via book titles from other authors | `untrustedContentHint` on all tools; summaries are data fields, never prose that reads like instructions. |
| Private data reaching a third-party model | Allow-list summarisers; no story text, names or media links (Decision 2). The manual check M1 uses a test account, because the Chrome inspector extension sends prompts to Gemini. |
| Agent loops hammer the free server | Client throttle (Decision 3). |
| Wire-shape | No new or changed route. Summariser tests copy response shapes locally, per `testing.md`. |
| Auth/session guardrail | Not touched: tools read the existing token via `useAuth()` at call time. |
| Dark-mode parity | No UI. Not applicable. |
| Paid APIs / spend | None called; fenced by W11. |

## Test strategy

### Server (Vitest + Supertest): pin the two guarantees the tools rely on

Tests only, no code change. The existing suite covers anonymous readers and owners, but not a **signed-in non-owner**.

- **S1** `GET /api/books/:id` returns 404 `Book not found` to a signed-in user who does not own the draft, and the body equals the nonexistent-id body.
- **S2** `GET /api/books/mine` returns only the caller's books: seed one draft for user A and one for user B, call as A, assert B's id is absent.

### Client unit (Vitest)

- **U1** Each summariser drops every non-allow-listed field. Fixture rows carry sentinels (`SENTINEL_CHILD_NAME`, `SENTINEL_DESC`, `/illustrations/sentinel.png`, `style_reference_url: '/uploads/sentinel.jpg'`); `JSON.stringify(result)` contains none.
- **U2** Lists cap at 10 items and the serialised result stays ≤ 1,500 chars with 50 long titles.
- **U3** `open_book` rejects ids outside `^[A-Za-z0-9-]{1,64}$` without calling `fetchJson`; accepts `luna-star-garden` and a UUID.
- **U4** `list_my_books` with `getToken() === null` returns the sign-in message and never calls `fetchJson`.
- **U5** Throttle: call 31 inside 60 s is refused without `fetchJson`; after `now` advances past the window, calls work again.
- **U6** `WebMcpTools` with a fake `document.modelContext` registers 3 tools; unmount aborts the signal; with only `navigator.modelContext` it registers there; with neither it renders nothing and logs nothing.
- **U7** Descriptor budgets: every name ≤ 30, description ≤ 500, parameter description ≤ 150; every tool has `readOnlyHint: true` and `untrustedContentHint: true`.

### E2E (Playwright, `e2e/tests/webmcp.spec.ts`, chromium project)

Helper, `e2e/tests/_webmcp.ts`:

```ts
export async function installFakeModelContext(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tools = new Map<string, any>();
    const mc = {
      async registerTool(tool: any, opts?: { signal?: AbortSignal }) {
        tools.set(tool.name, tool);
        opts?.signal?.addEventListener('abort', () => tools.delete(tool.name));
      },
      async getTools() {
        return [...tools.values()].map(({ name, description, inputSchema, annotations }) =>
          ({ name, description, inputSchema, annotations }));
      },
      async executeTool(name: string, args: unknown) {
        const t = tools.get(name);
        if (!t) throw new Error(`no tool ${name}`);
        return t.execute(args, { signal: new AbortController().signal });
      },
    };
    Object.defineProperty(document, 'modelContext', { value: mc, configurable: true });
  });
}

export const callTool = (page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => (document as any).modelContext.executeTool(n, a), [name, args] as const);

export const listTools = (page: Page) =>
  page.evaluate(() => (document as any).modelContext.getTools());
```

Every test installs the fake before `page.goto`, and attaches a request collector:

```ts
const paid = /\/api\/(generate|uploads)|\/(illustrate|cover|portrait|revise)\b|\/narration$/;
const hits: string[] = [];
page.on('request', r => { if (r.method() !== 'GET' && paid.test(r.url())) hits.push(r.url()); });
// afterEach: expect(hits).toEqual([]);
```

| # | Case | Setup | Assert |
|---|---|---|---|
| W1 | Registers three read-only tools | goto `/` | `listTools` names are exactly `list_my_books`, `open_book`, `search_store`; each `annotations.readOnlyHint === true` |
| W2 | No double registration across SPA navigation | goto `/`, click to a book, back, open My Books | still exactly 3 tools |
| W3 | Store search hits the real catalog | goto `/`; `callTool('search_store', { query: <word from a seeded title> })` | result lists that seeded book's id; ids are a subset of `GET /api/books?search=` (request fixture); no `/illustrations/` substring; length ≤ 1,500 |
| W4 | Store search drops a draft even if the server sent one | `page.route('**/api/books?*')` returns one published and one draft row matching the query | only the published id appears |
| W5 | My books, signed out | fresh context, no auth | result is the sign-in message; zero requests to `/api/books/mine` |
| W6 | My books, signed in, labels and redaction | `registerOwner` + `seedAuth`; `page.route('**/api/books/mine')` returns one draft and one published row whose `characters`, `description` and URLs hold sentinels | both titles present; draft says "private"; no sentinel in the result |
| W7 | Open own private book | owner + `installBookMocks({ status: 'draft', createdBy: owner.id })` | result names the title and "private"; URL is `/book/<id>`; `h1` shows the title |
| W8 | Someone else's private book looks like a missing one | `installBookMocks({ status: 'draft', createdBy: 'someone-else' })` mocked to 404 as the server does; plus a random id against the real server | both results are exactly "No book with that id."; URL unchanged |
| W9 | Bad id never reaches the network | `callTool('open_book', { book_id: '../admin' })` | validation message; zero `/api/books/` requests |
| W10 | Sign-out mid-session | signed in, `list_my_books` ok; sign out through the UI; call again | sign-in message; no `/mine` request after sign-out |
| W11 | Spend fence | runs as `afterEach` on every test above | `hits` is empty |
| W12 | Throttle | fire 31 `search_store` calls in one `page.evaluate` | the 31st returns the rate message; network saw 30 search requests |
| W13 | Flag off | `pwa` project (prod build, flag pinned `false`), fake installed | `listTools` returns `[]`; home page renders |
| W14 | No WebMCP at all | flag on, no fake | home page renders; no console errors mentioning `modelContext` |

**Config.** `e2e/playwright.config.ts` pins `VITE_WEBMCP_ENABLED: 'true'` on the dev-client `webServer` and `'false'` on the `pwa` and `commerce-off` builds, as it does for `VITE_COMMERCE_ENABLED`. Per `testing.md`, specs own their data (fresh owner per test, mocked rows for drafts) and never mutate a seeded row.

**Done criterion #2.** No UI changes, so no light/dark check is claimed.

### Manual (owner, optional, not CI)

- **M1** Chrome 149+ with `chrome://flags/#enable-webmcp-testing`, local dev with the flag on, a **test account** (not a real child's book), and Chrome's Model Context Tool Inspector extension. Ask: "find a bedtime book", "list my books", "open the first one". Confirm the agent calls our tools and does not fall back to clicking. Note the inspector sends prompts to Gemini with your own API key.

## ADR-worthy decisions

- [ ] WebMCP tools are client-only, read-only and same-origin in v1, behind a default-off build flag (new agent-facing surface).
- [ ] Tool outputs use allow-list summarisers that exclude media links, character names and story text.
- [ ] Not-found and not-yours are indistinguishable in agent-facing tools.

*WebMCP facts are from Chrome's docs and the Community Group draft as of 2026-11-19. The API is a trial and may change.*
