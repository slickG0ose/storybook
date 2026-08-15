# PDF digital export (PS1)

> Status: Implemented (2026-08-15) — see ADR-008
> Last updated: 2026-08-15
> Architect: Claude Opus 4.7 via /start-task on 2026-05-29
> Backlog: https://github.com/slickG0ose/storybook/issues/26

## Problem

Buyers who own a finished book today have only the in-app web reader. There is no way to take the book offline — no email-to-grandma, no print-at-home, no archival copy on a tablet for bedtime. PS1 is the first deliverable in the Print/Subscription milestone: ship a downloadable PDF of any published book so the storefront has something tangible to hand the buyer post-checkout. It also lays the layout pipeline that PS2 (POD print) will extend to 300 DPI + bleed; getting the layout right at screen resolution now means PS2 only needs to swap the renderer's page metrics, not redesign the document.

The research in `docs/print-publishing-research.md` §2 and §4 frames this as the screen-quality (~150 DPI, RGB) sibling of the print-ready pipeline. This spec only covers the screen variant — the print-ready variant is PS2.

## Constraints

- **Wire-shape (OPS.3 / ADR-003).** Any new server response shape requires a Zod schema in `shared/src/<domain>.ts` and a `toMatchObject` wire-shape assertion in the route's Supertest file. No exception for binary responses — even a `{ pdf_url, expires_at }` envelope must be pinned.
- **Auth middleware order (server conventions).** The download route is owner-or-buyer gated; the `requireAuth → validate() → handler` order is load-bearing.
- **Soft-delete default (server conventions).** Any Book lookup must continue to filter `deleted_at: null`; PDFs for a soft-deleted book must 404.
- **No new paid external API** (CLAUDE.md guardrail). MVP must run with libraries the project can self-host on the existing Express server. Adding a hosted PDF service would require user confirmation.
- **Dark-mode parity (client conventions).** The new "Download PDF" button on `BookDetail` needs `dark:` variants for every state.
- **TypeScript strict + no `any`.** Library choice has to ship with usable types or be wrappable behind a small typed adapter.
- **Tier-gated features don't exist yet.** Subscription tiers / "free vs. paid" gating is PS3 work. This spec ships with a single behavior (always-watermark) so we don't bake tier logic into the renderer prematurely.
- **Demo-grade product.** Local dev runs against SQLite; there is no S3, no Azure Blob, no Redis queue today. The MVP must work without introducing new infrastructure.

## Proposed shape

A new server route, `POST /api/books/:id/pdf`, generates a screen-quality (150 DPI, RGB, A4-equivalent square) PDF on demand from the book's current page rows. The route is authed via the existing Bearer-token middleware and gated to the book's owner (for drafts) or any authed buyer (for published books, mirroring the existing `GET /api/books/:id` authorization). The renderer is **`@react-pdf/renderer`** running in Node — the PDF is streamed back as the HTTP response body with `Content-Type: application/pdf` and a `Content-Disposition: attachment; filename="<slug>.pdf"` header.

The renderer **reuses the visual structure of `client/src/components/BookSpread.tsx`** but in a parallel implementation: a new `server/src/services/pdf.tsx` declares `<Document>` / `<Page>` / `<View>` / `<Text>` / `<Image>` JSX that mirrors the cover spread, story spreads (illustration left / text right), and end spread, including the amber-cream paper tone and the page-number footer. It does not import the React component itself — `BookSpread.tsx` is a DOM/Tailwind component, and `@react-pdf/renderer` uses a different reconciler with its own `StyleSheet` API. Mirroring is intentional duplication: the layout intent is shared, the implementation is not.

PDFs are **always generated on demand and streamed back** — not persisted to disk and not exposed as a long-lived URL on the Book row. This keeps the schema unchanged and avoids the "stale PDF after a revise" problem (regenerate cheaply on each click; the cost is text layout + remote image fetch, not AI). When PS2 needs a persistent print-ready file for a POD vendor upload, that's a separate flow with its own `print_jobs` model — we don't conflate the two.

A **watermark band** ("Created with StoryBook Storefront · storybook.example.com") renders at the bottom of every interior page. This is unconditional in MVP. PS3 will introduce the tier flag and the watermark will become tier-aware then; for now, the toggle does not exist in the code. See "Out of scope" and the ADR list for the open decision on whether a hidden feature flag (`PDF_WATERMARK=true|false`) is warranted now or deferred.

### Schema / contract changes

**`shared/src/pdf.ts`** (new file, exported from `shared/src/index.ts`):

```ts
import { z } from 'zod';

// POST /api/books/:id/pdf — request body (empty for MVP; future: format/quality)
export const BookPdfRequestSchema = z.object({}).strict();
export type BookPdfRequest = z.infer<typeof BookPdfRequestSchema>;

// Success response is a binary stream (Content-Type: application/pdf), NOT
// JSON — so there is no response schema to pin. The error envelope when the
// route fails (404 / 401 / 403 / 500) reuses the existing shape:
export const BookPdfErrorResponseSchema = z.object({
  error: z.string(),
});
export type BookPdfErrorResponse = z.infer<typeof BookPdfErrorResponseSchema>;
```

**Note on the wire-shape rule.** OPS.3 / ADR-003 pins JSON response shapes. The PDF route returns a binary stream on 2xx, so there is no JSON schema to validate on the happy path. The wire-shape test instead asserts: (1) the response `Content-Type` is `application/pdf`, (2) the response starts with the PDF magic bytes `%PDF-`, and (3) the error envelope matches `BookPdfErrorResponseSchema` on every failure code. This is a one-off carve-out for binary endpoints; future PDF routes follow the same pattern. The `validate()` middleware is **request-only** for this route (`validate({ request: BookPdfRequestSchema })` — no `response`), which `validate.ts` already supports (response validation is optional).

**Prisma schema:** **no changes.** No `pdf_url` column on `Book`, no `PdfDownload` model. PDFs are ephemeral.

**New HTTP routes:**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/books/:id/pdf` | bearer | Stream the book's PDF |

Why POST and not GET: the route does meaningful work (image fetches + layout + render — order-of-magnitude tens to hundreds of milliseconds, network-bound on remote illustration URLs). POST signals "this performs work" and lets us add a non-empty request body in PS2 (`{ format: 'print' | 'screen' }`) without breaking GET-cache semantics. It also makes it harder for a stray `<a href>` to accidentally fire the download from a bot crawl.

### Data flow

```
User clicks "Download PDF" on BookDetail
  ↓
client/src/pages/BookDetail.tsx fires POST /api/books/:id/pdf with Bearer token
  ↓
server/src/routes/books.ts validates auth + ownership, loads Book + Pages (Prisma)
  ↓
server/src/services/pdf.tsx assembles <Document> with cover/story/end <Page>s
  ↓
For each page with an illustration_url, server fetches the image bytes
  (local /illustrations/* served from server/public/, or remote URL),
  embeds them via @react-pdf/renderer's <Image src={Buffer}>
  ↓
Renderer writes the PDF to a streaming response
  ↓
Client receives blob, uses URL.createObjectURL() + anchor click to trigger download
```

Image embedding **must read bytes, not pass URLs** — `@react-pdf/renderer` accepts URLs, but during dev the renderer would have to call back to the same Express server, which can deadlock under load. Reading the file off disk for local `/illustrations/*` and using `fetch()` for remote URLs (with a 10s timeout) sidesteps it. Local paths under `server/public/illustrations/` are the common case; remote URLs only appear for legacy demo seed data.

### Files likely touched

- `server/src/services/pdf.tsx` — **new.** Exports `renderBookPdf(book: BookWithPages): Promise<NodeJS.ReadableStream>`. Owns the React-PDF JSX (cover/story/end spreads, watermark, page numbers). TSX extension because the file holds JSX.
- `server/src/routes/books.ts` — add `POST /:id/pdf` handler. Mounts `validate({ request: BookPdfRequestSchema })` after the existing `requireAuth` check. Streams the PDF body.
- `server/src/routes/__tests__/books.test.ts` — add a Supertest case that hits the new route, asserts 200 + `Content-Type` + magic-bytes prefix, plus the negative cases (401 / 404 / soft-deleted / wrong owner on draft).
- `server/package.json` — add `@react-pdf/renderer` dependency. (Architect does not run npm; this is a planner instruction.)
- `shared/src/pdf.ts` — **new.** Zod schemas above.
- `shared/src/index.ts` — re-export `pdf.ts`.
- `client/src/pages/BookDetail.tsx` — add the "Download PDF" button next to "Add to Cart" / "Publish" in the existing CTA cluster. Owner can download drafts; anyone authed can download a published book. Disabled when `pages.some(p => !p.illustration_url)` with a tooltip "Illustrate all pages first." Loading spinner during the fetch.
- `client/src/components/__tests__/BookDetail.test.tsx` (or `pages/__tests__/`, follow whichever pattern lives in the repo today) — RTL test that the button renders, calls fetch, and triggers a download. Mock the fetch.
- `e2e/tests/` — optional e2e covering the happy path. Out of scope for MVP if the integration test is solid; revisit if PS2 builds on this.

## Alternatives considered

### Library — `@react-pdf/renderer` (recommended)

**Pros:**
- React-component-based API maps directly onto the visual model already in `BookSpread.tsx`. The translation effort is "rewrite the same JSX with the PDF library's primitives," not "learn a declarative DSL."
- `StyleSheet.create({})` syntax mirrors React Native's, so dark/light theming logic from BookSpread can be carried over with minimal re-thinking.
- Mature image embedding (PNG / JPEG, accepts URL / Buffer / data URI) and font registration (`Font.register()`) — fonts matter for `font-display` parity with the cover.
- Node-compatible without a headless browser. No Chromium download in CI.
- TypeScript types ship with the package.

**Cons:**
- Bundle weight on the server side: ~1.5 MB installed. Acceptable — server-only, never shipped to the browser.
- PDF/X-1a or CMYK output is not native (research §2 table). Acceptable for PS1 (screen / RGB); PS2 will need a post-process step or library swap if POD providers reject RGB.
- React reconciler runs on the server thread. For a 5-12 page book this is sub-second; if we ever need to render 30+ books concurrently, this becomes a queue/worker discussion (out of scope).

**Why selected:** the shape of `BookSpread.tsx` is the single most reused asset in this feature. A library whose mental model matches it cuts the implementation time and the divergence risk in half. The cons are bounded and known.

### Library — `pdfmake`

**Pros:**
- Smaller install (~700 KB), pure JS, no reconciler.
- Declarative JSON document definition is easy to serialize and store (could open up "save layout, regenerate later" workflows we don't need today).
- Excellent built-in column layouts.

**Cons:**
- Declarative JSON does not map onto our existing JSX layout — every layout decision has to be re-described in a new schema. Higher translation cost.
- Image embedding is fine but font registration is awkward in Node (requires manually wiring `vfs_fonts.js`).
- TypeScript types are community-maintained (`@types/pdfmake`), occasional drift.
- No dark-mode story; not a real con (PDFs aren't dark-mode aware), but the team's mental model for "design a page" is JSX, not JSON.

**Why rejected:** the JSON definition style fights the team's existing React-centric design vocabulary. The bundle-size win is on the server, where it doesn't matter. If `@react-pdf/renderer` later proves too slow at scale, `pdfmake` is a viable rewrite — the route boundary and the wire shape don't change.

### Library — `puppeteer` (HTML-to-PDF)

**Pros:** Could literally render the existing `BookSpread.tsx` to PDF — maximum reuse, zero rewrite.

**Cons:** Bundles Chromium (~150 MB), CI startup cost, sandbox/permissions nightmare on Windows dev boxes, and the corporate proxy / `NODE_TLS_REJECT_UNAUTHORIZED=0` setup in `server/src/index.ts` already hints at headless-browser pain. Rejecting.

### Library — `pdf-lib` / `PDFKit`

**Pros:** Lower-level, more control, smaller install.

**Cons:** Hand-rolling layout primitives (text wrapping, image positioning, column logic) is unreasonable scope for PS1. Rejecting.

### Generation location — client-side `jsPDF`

**Pros:** Zero server load. No new dependency on the server.

**Cons:**
- Adds a heavyweight dep to the client bundle (`jsPDF` + `html2canvas` is ~500 KB).
- Cross-origin image loading for `/illustrations/*` paths is awkward — the dev proxy works, the production deployment may not.
- The image fidelity (DOM → canvas → PDF) is worse than direct image embedding, and breaks once we move to print-quality 300 DPI.
- Renders on the user's machine — variance across browsers / OSes is a support tail.

**Why rejected:** PS2 needs the print-quality variant of this exact pipeline, and PS2 will run server-side regardless (POD vendors expect us to upload a finished PDF, not "have the user generate one and upload it"). Building PS1 client-side would mean rewriting the renderer for PS2 — wasteful.

### Persistence shape — store PDF on disk, write `pdf_url` on Book

**Pros:** Subsequent downloads of the same book are instant. CDN-cacheable. Order confirmation emails could link to the file directly.

**Cons:**
- Adds a Book schema column + a cache-invalidation rule (every revise / re-illustrate / page-edit must `pdf_url = null` the row). Easy to miss a path.
- Disk-management policy needed (cleanup, retention) — out of scope for an MVP.
- The dev story (SQLite + local filesystem) doesn't translate to any production target — would need rework before deploy regardless.
- The watermark feature (and tier-aware watermarks under PS3) would mean either invalidate-on-tier-change or generate-per-tier, both more complex than always-regenerate.

**Why rejected:** generation cost is dominated by image fetches, not by the layout engine. For 5-12 pages with local images, the render is sub-second. The win from caching isn't worth the schema + invalidation complexity at this stage.

**Reconsider trigger:** if a single book gets downloaded > 50 times by the same buyer (analytics signal), or if we add print-ready PDFs (PS2) where re-rendering is expensive, switch to a `pdf_assets` table with `{ book_id, variant: 'screen' | 'print', version, url, expires_at }` keyed by book version so invalidation is automatic on revise.

## Success criteria

1. **A logged-in user can download a PDF of any published book** by clicking the "Download PDF" button on `BookDetail`. The downloaded file opens cleanly in Chrome's PDF viewer and Preview on macOS.
2. **The PDF visually mirrors the web `BookSpread` layout** — cover spread (title, author, emoji or cover image), one spread per story page (illustration on left, text on right), end spread ("The End" + description). Color tones (amber cream paper, dark text) match the web reader.
3. **Every interior page carries the watermark band** "Created with StoryBook Storefront" along the bottom. Cover and end pages are exempt.
4. **The Supertest integration test passes**, asserting:
   - 200 + `Content-Type: application/pdf` + body starts with `%PDF-` for a published book.
   - 401 for an unauthenticated request.
   - 404 for a missing book id.
   - 404 for a soft-deleted book.
   - 403 (or 404 — pick one and pin it in the schema) for a draft owned by a different user.
   - The error envelope conforms to `BookPdfErrorResponseSchema` on every failure code.
5. **The client RTL test passes**, asserting:
   - The button renders with `aria-label="Download PDF"` (icon-only buttons need aria-label per client conventions).
   - Clicking calls `fetch('/api/books/<id>/pdf', { method: 'POST', headers: { Authorization: 'Bearer ...' } })`.
   - Both light and dark `dark:` class variants are present on the button.
6. **Manual verification:** I downloaded a PDF in light mode and dark mode (the button is themed; the PDF itself is not). The 5-page demo book "The Brave Little Robot" renders with all 5 illustrations embedded.
7. **No TypeScript errors** in `server` or `client`. `npm run lint` clean in both zones.

## Out of scope

- **POD / physical printing.** Print-ready PDF (300 DPI, bleed, CMYK staging) is PS2 (issue tracker TBD).
- **Subscription tier gating.** "Free tier gets a watermark, paid tier doesn't" is PS3. MVP always watermarks; the toggle does not exist in code yet.
- **CMYK color conversion.** Issue body explicitly defers this to the POD provider's server-side conversion. Not relevant for screen PDFs anyway.
- **PDF/X-1a or other archival format compliance.** PS2 concern at the earliest.
- **EPUB / Kindle export.** Different format, different reader assumptions. Deferred indefinitely per research §4.
- **Order-confirmation email attaching the PDF.** Today the storefront doesn't send transactional email; when it does, the email handler can hit the same route.
- **PDF caching / persistence.** Always regenerate (rationale in Alternatives).
- **PDF versioning** — no need to associate a PDF with a `BookVersion`; the live book state is always the source of truth.
- **Watermark customization** (custom-text watermark, "Property of <child name>") — UI feature, not architectural.

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| `@react-pdf/renderer` server install adds ~1.5 MB + native deps. Could break the Windows-corporate-proxy CI flow. | Planner verifies install on a clean Windows node-modules tree before merge. Document the package version pin in the spec ADR. |
| Image embedding by URL deadlocks the Express thread when the renderer fetches back into the same server. | Always read bytes (fs.readFile for local `/illustrations/*`, `fetch` with timeout for remote URLs). Tested at the unit-test layer with a fixture book. |
| Wire-shape rule (OPS.3) doesn't cleanly apply to binary responses. | Documented carve-out: assert `Content-Type` + magic bytes + pinned error envelope. Add a docs/conventions note in the same PR so future binary routes follow the pattern. |
| The watermark hard-codes "always on" which becomes tech debt when PS3 lands. | Tracked as ADR-worthy decision. The watermark function takes a `(book) => string \| null` shape so PS3 can swap the policy without touching the renderer. |
| Soft-deleted books must 404 from the PDF route. Easy to forget. | Reuse the existing `getBookById` helper in `routes/books.ts` which already filters `deleted_at: null`. Test the soft-delete path explicitly. |
| `font-display` parity — `BookSpread.tsx` references a custom font family the web bundle ships. The PDF won't pick it up unless we `Font.register()` it. | Embed an open-licensed display font (Atkinson Hyperlegible or similar) and register it once in `pdf.tsx`. If we can't legally bundle the web font, document the visual delta. |
| The route is authed but **does not** rate-limit. A motivated user could spam the route and DoS the renderer. | Accept for MVP — gating is via the storefront's existing auth surface. Note rate-limiting as a follow-up if we observe abuse. |
| `pages.some(p => !p.illustration_url)` may be a noisy precondition — what about books legitimately published with no illustrations? | Confirm with product: today the publish flow doesn't enforce all-pages-illustrated. If a book can be published with missing illustrations, the PDF route should still succeed (render placeholder boxes per page) instead of 400'ing. Spec the renderer to draw a "Illustration coming soon" placeholder if `illustration_url` is null, so the route never fails on data shape. |
| Dark-mode parity on the new download button. | Mirror the existing "Add to Cart" / "Publish" button dark classes (same row in BookDetail). Add to the RTL test. |
| Streaming a PDF through Express requires careful error handling — once the response headers are flushed, you can't switch to a JSON error envelope. | Validate everything (auth, ownership, book lookup) **before** the renderer starts. Once rendering begins, errors are logged server-side and the stream is destroyed (client sees a truncated PDF — acceptable for MVP, log alerts pick up the failure). |

## ADR-worthy decisions

These are hard-to-reverse choices baked into the spec. Each should be captured via `/create-adr` after spec approval, so the next agent reading the codebase can see the rationale without re-reading this spec.

- [x] **`@react-pdf/renderer` as the PDF layout library** — ADR-008 decision 1. — choice of library affects every future PDF surface (PS2 print-ready, PS3 watermark variants). Swapping later means rewriting the renderer.
- [x] **PDFs are ephemeral, not persisted as `pdf_url` on Book** — ADR-008 decision 2. — schema decision. Reversing requires a migration + a cache-invalidation policy on every Book mutation path.
- [x] **Wire-shape carve-out for binary endpoints** — ADR-008 decision 3; convention paragraph added to docs/conventions/testing.md. — assert `Content-Type` + magic bytes + pinned error envelope instead of a JSON response schema. Sets a precedent for every future binary route (`POST /api/books/:id/epub`, `GET /api/orders/:id/receipt.pdf`, etc.). Worth a one-paragraph addition to `docs/conventions/testing.md` once the ADR is written.
- [x] **Always-watermark in MVP, no feature flag** — ADR-008 decision 4. — defers the tier-aware watermark to PS3. Alternative was a hidden `PDF_WATERMARK=false` env flag now, which felt like premature optimization. Capture the choice so PS3 doesn't relitigate.
- [x] **POST, not GET, for the download route** — ADR-008 decision 5. — non-obvious choice; documented above. Worth pinning so future agents don't "fix" it to GET.
