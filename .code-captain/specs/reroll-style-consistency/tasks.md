# Re-roll style consistency — task plan

> Spec: [spec.md](spec.md)
> Status: Draft
> Last updated: 2026-08-23

## Overview

Eleven tasks. **Task 0 is a satisfied decisions-of-record preamble, not a blocker** — the owner approved the paid-model swap and fixed the openai cost at 25¢ on 2026-08-23, so implementation starts at Task 1. One pre-merge item (current Fal Kontext pricing) remains open and is tracked in Tasks 0 and 10. Tasks 1–5 implement **mitigation A** (pin the image provider + model per book) and are independently shippable as their own PR: at the end of Task 5 the reported bug is fixed for every book, because a re-roll runs on the same model that made the original art. Tasks 6–9 add **mitigation B** (anchor the re-roll on the page's existing image), which improves style-lock further but is not required for A to be correct. Task 10 closes out the ADR trail.

## Cross-cutting constraints

- **Wire-shape:** `Book` gains two columns, and `hydrateBook` spreads the whole Prisma row while `validate()` sends the *original* body — so both fields ship whether or not they are declared. Add `image_provider: z.string().nullable()` and `image_model: z.string().nullable()` to `BookSchema` in `shared/src/books.ts`, and pin both with `toMatchObject` on a `POST /api/books/:id/illustrate` response. Affects every route returning a Book: `/api/books`, `/api/books/mine`, `/api/books/:id`, publish/unpublish, revise, restore, illustrate, portrait, and all of `admin.ts`.
- **Auth middleware order:** unchanged. `/illustrate` stays `requireAuth → spendGate('illustration') → validate → handler`. The new 409 gate is a **handler-body check**, placed after the ownership 404 and the `isEditable` 403 and before any provider call, so it costs nothing.
- **Dark-mode parity:** Task 9 adds one hint line in `BookSpread.tsx`; it needs `dark:` partners on every colour class.
- **Migrations:** one migration, `add-book-image-pin`. Edit `server/prisma/schema.prisma` only, then `cd server && npm run db:migrate -- --name add-book-image-pin`, then `npm run db:gen-postgres-schema` to regenerate `schema.postgresql.prisma`. Never hand-edit the postgres schema; never edit a committed migration.
- **Regression boundary (ADR-006 dec 3, ADR-007 dec 3):** with no reference images the generator request and the assembled prompt must stay **byte-identical** to today. Every new prompt clause is gated on the style anchor being present.
- **Spend:** every provider call stays covered by `spendGate('illustration')` + a per-iteration `checkQuota` + a `recordUsage` on success. Gating without recording is how the portrait route previously ran unmetered.
- **Guardrails touched — both discharged (see Task 0):** (a) the common single-page re-roll moves from Flux Pro 1.1 to Flux Kontext, a paid-model swap — **approved by Nick, 2026-08-23**; (b) `COST_CENTS` gains an openai-image rate — **ruled at 25¢, 2026-08-23**. No further confirmation is needed to begin. The one open pre-merge item is the current Fal Kontext / `kontext/multi` price.

## Tasks

### Task 0 — Decisions of record (satisfied — read, do not wait)

**Zone:** none (preamble) · **Depends on:** none · **Parallel-safe with:** all

No files change. This task exists so the guardrail confirmations are visible at the top of the plan rather than buried in the spec. **Both blocking gates are already answered — proceed straight to Task 1.**

1. **Paid-model swap — APPROVED.** Mitigation B routes the common single-page re-roll through `fal-ai/flux-pro/kontext` (or `/kontext/multi`) instead of `fal-ai/flux-pro/v1.1`. CLAUDE.md gates a paid-model swap on explicit owner confirmation. **Approved by Nick (repo owner) on 2026-08-23.** Carry the attribution and date into ADR-013 so the audit trail shows the guardrail was discharged rather than skipped.
2. **openai image cost — 25¢, decided.** `OPENAI_IMAGE_COST_CENTS = 25` (mid of ADR-006's $0.17–0.45 range), owner-ruled 2026-08-23. `COST_CENTS` stays the default table for `fal`. Implement 25 as the decided value; do not re-open it.
3. **STILL OPEN — Fal Kontext pricing re-check, blocking *merge*, not *start*.** ADR-007 dec 4 pinned Kontext at a flat $0.04/image from Fal docs dated 2026-06-05 (~2.5 months old) and never separately verified `kontext/multi`. The current price is not readable from this repo. Before merge, the owner re-checks both; if either differs from 4¢, `COST_CENTS.illustration` is updated **in this same PR**. Tracked again in Task 10.

**Done when:** the implementer has read (1) and (2) and carried (3) onto the PR body as a named open pre-merge item.

---

### Task 1 — `Book.image_provider` / `Book.image_model`: schema, migration, wire shape, fixtures

**Zone:** multi-zone (server · shared · client · e2e)
**Depends on:** none — Task 0 is a read-only preamble and its gates are already satisfied
**Parallel-safe with:** none (everything downstream needs the column and the type)

**Status:** Done (2026-08-23)

**Files to add or change:**
- `server/prisma/schema.prisma` — two nullable columns on `Book`
- `server/prisma/migrations/<ts>_add_book_image_pin/migration.sql` — generated, committed
- `server/prisma/schema.postgresql.prisma` — regenerated, not hand-edited
- `shared/src/books.ts` — `BookSchema` gains both fields
- `client/src/components/__tests__/BookCard.test.tsx`, `.../BookSpread.test.tsx`, `client/src/pages/__tests__/{Admin,BookDetail,Home}.test.tsx` — Book fixtures typed as `Book` need the new keys
- `e2e/tests/_editPublished.ts`, `e2e/tests/{admin,illustration-history,version-history}.spec.ts` — mock book bodies (untyped literals; add the keys so the mocks match the real wire shape)

**Signatures / shapes:**
```prisma
model Book {
  // ...existing fields...
  // Which image provider + base model produced this book's art. Written lazily
  // on the first successful image write (see services/imagePin.ts), NOT at
  // creation time — the pin describes art that exists, not an intention.
  // Null means "not yet pinned"; resolveImagePin() infers and back-fills.
  image_provider  String?   // 'openai' | 'fal'
  image_model     String?   // 'gpt-image-1' | 'fal-ai/flux-pro/v1.1'
}
```
```ts
// shared/src/books.ts — inside BookSchema, after style_reference_url
  image_provider: z.string().nullable(),
  image_model: z.string().nullable(),
```
Required-and-nullable, not `.optional()`: Prisma always returns the column, so an absent field is drift worth failing on.

**Tests to write:**
- No new tests in this task — it is a shape change. The existing server/client/e2e suites are the assertion: they must stay green, and `client` typecheck must pass.
- Wire-shape assertion required: **yes**, but it lands in Task 5 (`books.test.ts`, on the `/illustrate` response) once a route actually sets the fields.

**Manual verify:** `cd server && npm run db:hydrate` loads cleanly against the migrated DB (nullable additive column; seeds may omit the keys).

**Done when:** migration applied and committed alongside the regenerated postgres schema, all three suites green, no new TS errors.

---

### Task 2 — `services/imagePin.ts`: resolve, infer from legacy art, persist

**Zone:** server
**Depends on:** Task 1
**Parallel-safe with:** Task 4

**Status:** Done (2026-08-23)

**Files to add or change:**
- `server/src/services/imagePin.ts` — **new**; the single choke point for "which model serves this book"
- `server/src/services/__tests__/imagePin.test.ts` — **new**

**Signatures / shapes:**
```ts
export type ImageProvider = 'openai' | 'fal';
export interface ImagePin { provider: ImageProvider; model: string }

// PR #60 (1babb2d, merged 2026-06-05) made Fal Flux Pro 1.1 the default image
// provider. Art whose earliest timestamp precedes this was made on gpt-image-1.
export const PROVIDER_CUTOVER_AT = new Date('2026-06-05T00:00:00.000Z');

export const DEFAULT_MODEL: Record<ImageProvider, string> = {
  openai: 'gpt-image-1',
  fal: 'fal-ai/flux-pro/v1.1',
};

/** The pin a book with no art would get today: IMAGE_PROVIDER + that provider's model override. */
export function currentImagePin(): ImagePin;

/** Earliest evidence of this book's art: min page-slot IllustrationVersion.created_at,
 *  else oldest page-*.png mtime, else null (the book has no art). */
export async function earliestArtAt(bookId: string): Promise<Date | null>;

/** Pure resolution. Explicit pin wins; else infer from earliestArtAt vs the cutover;
 *  else currentImagePin(). Never writes. */
export async function resolveImagePin(
  book: { id: string; image_provider: string | null; image_model: string | null },
): Promise<ImagePin>;

/** Idempotent write-back. updateMany({ where: { id, image_provider: null } }) so a
 *  concurrent pin cannot be clobbered. */
export async function ensureBookPinned(bookId: string, pin: ImagePin): Promise<void>;

/** What routes call: resolve, then back-fill so inference runs at most once per book. */
export async function resolveAndPinImagePin(book: {...}): Promise<ImagePin>;

export function pinnedProviderUnavailableError(provider: string): string;
```
Notes for the implementer:
- **Do not import from `illustrations.ts`** — that module will import `ImagePin` from here in Task 3, and a cycle would result. Define a local `const PAGE_SLOT_MAX = 999;` with a comment cross-referencing `PORTRAIT_SLOT_BASE = 1000` in `illustrations.ts`, and filter `page_number: { lte: PAGE_SLOT_MAX }` so portrait rows never seed the inference.
- The mtime fallback mirrors the filesystem-synthesis path already in `listIllustrationVersions`; reuse its `page-<n>(-v<m>).png` pattern and swallow a missing directory as `null`.
- `currentImagePin()` reads `IMAGE_PROVIDER` (default `'fal'`), then `OPENAI_IMAGE_MODEL` / `FAL_IMAGE_MODEL`, falling back to `DEFAULT_MODEL`.
- An unrecognised `image_provider` value in the DB must fall through to inference, not throw.

**Tests to write:**
- `server/src/services/__tests__/imagePin.test.ts`:
  - explicit `image_provider = 'openai'` wins over `IMAGE_PROVIDER=fal`
  - explicit provider with a null `image_model` falls back to `DEFAULT_MODEL[provider]`
  - unpinned book with a page-slot `IllustrationVersion` dated `2026-05-19` → `openai` / `gpt-image-1`
  - unpinned book with a page-slot row dated `2026-07-01` → `fal` / `fal-ai/flux-pro/v1.1`
  - unpinned book whose **only** `IllustrationVersion` rows are portrait slots (≥ 1000) is treated as having no art → `currentImagePin()`
  - unpinned book with no rows but an on-disk `page-1.png` older than the cutover → `openai` (mtime fallback)
  - unpinned book with neither → `currentImagePin()`
  - `resolveAndPinImagePin` writes the pin to the Book row; calling it twice does not change an already-set pin
- Wire-shape assertion required: no.

**Done when:** listed tests pass, `cd server && npm test` green, no new TS errors.

---

### Task 3 — Pin-aware provider selection and service threading

**Zone:** server
**Depends on:** Task 2
**Parallel-safe with:** Task 4

**Status:** Done (2026-08-23)

**Files to add or change:**
- `server/src/services/illustrations.ts` — `getImageGenerator(pin?)`, `isImageGenConfigured(provider?)`, `GenerationPin` threaded into the three public generators
- `server/src/services/providers/fal.ts` — base model comes from the pin when supplied
- `server/src/services/__tests__/illustrations.test.ts` — **extend**, do not replace

**Signatures / shapes:**
```ts
import type { ImagePin, ImageProvider } from './imagePin';

/** Trailing options object rather than a 9th positional arg. Existing positional
 *  args are unchanged, so current tests' mock.calls[n][6] assertions still hold;
 *  the new options land at [7] (or [6] for generateCharacterPortrait). */
export interface GenerationPin {
  pin?: ImagePin;
  styleAnchor?: string | null;   // populated in Task 6; ignored here
}

export function getImageGenerator(pin?: ImagePin): ImageGenerator;
/** No argument = the env default (unchanged, back-compatible). With an argument,
 *  reports whether THAT provider's key is present. */
export function isImageGenConfigured(provider?: ImageProvider): boolean;

generateIllustration(bookId, pageNumber, description, feedback, styleDescriptor, characters, referenceImages, opts?: GenerationPin)
generateCover(bookId, title, description, styleDescriptor, characters, referenceImages, opts?: GenerationPin)
generateCharacterPortrait(bookId, characterIndex, name, descriptor, feedback, styleDescriptor, opts?: GenerationPin)

class OpenAIImageGenerator { constructor(private readonly model: string = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1') {} }
export class FalImageGenerator { constructor(private readonly baseModel?: string) {} }
```
Notes:
- `FalImageGenerator`'s **prompt-only** branch resolves `this.baseModel ?? process.env.FAL_IMAGE_MODEL ?? 'fal-ai/flux-pro/v1.1'`. The **reference-bearing** branch still hard-selects `kontext` / `kontext/multi` regardless of the pin — ADR-007 dec 4 is unchanged, because the pinned base model cannot take an input image. The pin selects the *provider family*; reference count still selects the model within it.
- Each generator's `isImageGenConfigured` guard inside `generateIllustration` / `generateCover` / `generateCharacterPortrait` must now check `opts?.pin?.provider` when a pin is supplied, so a pinned-but-unconfigured provider returns `null` rather than calling the wrong API.
- The module-level `const IMAGE_MODEL` at `illustrations.ts:8` becomes dead once the model moves into the generator constructor — remove it rather than leaving two sources of truth.

**Tests to write:**
- `illustrations.test.ts` (extend):
  - `getImageGenerator({ provider: 'openai', model: 'gpt-image-1' }).name === 'openai'` while `IMAGE_PROVIDER=fal`
  - a pinned openai book generates through the OpenAI endpoint (assert the mocked `fetch` URL) with `IMAGE_PROVIDER=fal` and both keys set
  - `FalImageGenerator` with a constructor base model posts to that model id on the prompt-only path
  - `FalImageGenerator` with a constructor base model **still** posts to `fal-ai/flux-pro/kontext` when given exactly 1 reference
  - `isImageGenConfigured('openai')` / `('fal')` gate on their own key; `isImageGenConfigured()` with no argument behaves exactly as today (the existing block must pass unmodified)
  - the existing no-reference prompt-only regression test passes **unchanged** (byte-identical request)
- Wire-shape assertion required: no.

**Done when:** listed tests pass, `cd server && npm test` green, no new TS errors.

---

### Task 4 — Provider-aware spend cost

**Zone:** server
**Depends on:** Task 2 (for the `ImageProvider` type)
**Parallel-safe with:** Task 3

**Status:** Done (2026-08-23)

**Files to add or change:**
- `server/src/services/spend.ts` — `costCentsFor`, optional provider on `checkQuota` / `recordUsage`
- `server/src/services/__tests__/spend.test.ts` — extend (or add, if absent)

**Signatures / shapes:**
```ts
import type { ImageProvider } from './imagePin';

/** gpt-image-1 runs ~$0.17–0.45/image (ADR-006) against Fal's flat $0.04.
 *  Pinning legacy books makes those calls reachable again; charging them 4c
 *  would undercount by 4-11x. 25c is the mid of that range, ruled by the repo
 *  owner on 2026-08-23 (ADR-013). Deliberately coarse, like COST_CENTS itself:
 *  this is a spend guard, not billing. */
export const OPENAI_IMAGE_COST_CENTS = 25;

export function costCentsFor(kind: UsageKind, provider?: ImageProvider): number;
//  'illustration' | 'cover' + provider === 'openai'  ->  OPENAI_IMAGE_COST_CENTS
//  everything else                                    ->  COST_CENTS[kind]

export async function checkQuota(userId, kind, isAdmin, now = new Date(), provider?: ImageProvider): Promise<QuotaDecision>;
export async function recordUsage(userId, kind, provider?: ImageProvider): Promise<void>;
```
`COST_CENTS` stays exported and unchanged as the default table. `spendGate(kind)` is **not** changed: it runs before the book is loaded, so it still reserves at the default rate — the handler's per-iteration `checkQuota` with the resolved provider is the real gate, and it runs before any call. Add a comment saying so rather than re-architecting the middleware.

**Tests to write:**
- `costCentsFor('illustration')` → 4; `costCentsFor('illustration', 'fal')` → 4; `costCentsFor('illustration', 'openai')` → `OPENAI_IMAGE_COST_CENTS`
- `costCentsFor('story', 'openai')` → 6 (provider is irrelevant to text)
- `recordUsage(user, 'illustration', 'openai')` writes a `UsageLog` row with `cost_cents = OPENAI_IMAGE_COST_CENTS`
- `checkQuota` with `provider: 'openai'` denies at a spend level where the fal rate would still be allowed
- every existing spend test passes unchanged (the new arg is optional)
- Wire-shape assertion required: no.

**Done when:** listed tests pass, `cd server && npm test` green, no new TS errors.

---

### Task 5 — Route wiring for the pin: `/illustrate` 409 gate, creation-time pinning, docs

**Zone:** server (+ docs)
**Depends on:** Tasks 3, 4
**Parallel-safe with:** none

This is the last task of **mitigation A**. At the end of it the reported bug is fixed and the branch is shippable on its own.

**Status:** Done (2026-08-23)

**Files to add or change:**
- `server/src/routes/books.ts` — `/illustrate` and the portrait route resolve and thread the pin
- `server/src/routes/generate.ts` — pin the book on the first successful cover/page image
- `docs/conventions/server.md` — record that `IMAGE_PROVIDER` no longer governs books that already have art
- `server/src/routes/__tests__/books.test.ts` — **extend**

**Signatures / shapes:**
```ts
// books.ts POST /:id/illustrate — after the 404 owner check and the 403 isEditable
// check, before any provider call:
const pin = await resolveAndPinImagePin(book);
if (!isImageGenConfigured(pin.provider)) {
  // Distinguish "nothing is configured" (unchanged 501) from "this book needs a
  // provider this server doesn't have" (new 409). Silently falling back to the
  // default provider is what caused the reported bug.
  return isImageGenConfigured()
    ? res.status(409).json({ error: pinnedProviderUnavailableError(pin.provider) })
    : res.status(501).json({ error: 'Image generation not configured' });
}
// ...per-iteration:
const decision = await checkQuota(requester.id, 'illustration', isAdmin, new Date(), pin.provider);
const url = await generateIllustration(..., referenceImages, { pin });
if (url) await recordUsage(requester.id, 'illustration', pin.provider);
```
The existing `if (!isImageGenConfigured())` 501 block moves **below** the pin resolution and is folded into the branch above; the portrait route gets the same treatment with `{ pin }` passed to `generateCharacterPortrait` and `recordUsage(user, 'cover', pin.provider)`.

In `generate.ts`, resolve `currentImagePin()` once, pass `{ pin }` to `generateCover` / `generateIllustration`, and call `ensureBookPinned(book.id, pin)` after the **first** successful image URL comes back. Re-read the book (or fold the pin into the existing `prisma.book.update`) so the returned body carries the non-null pin rather than a stale null.

`pinnedProviderUnavailableError` text:
```
This book's illustrations were made with <provider>, which isn't configured on this
server. Re-rolling on a different image model would not match the rest of the book.
```

**Tests to write:**
- `books.test.ts` (extend the existing `POST /api/books/:id/illustrate` describe):
  - **wire-shape pin:** `expect(res.body).toMatchObject({ image_provider: expect.any(String), image_model: expect.any(String), ... })` on a successful illustrate — this is the OPS.3 / Check 4 assertion for Task 1's two fields
  - book pinned to `openai` with `OPENAI_API_KEY` unset and `FAL_KEY` set and `IMAGE_PROVIDER=fal` → **409**, `mockGenerateIllustration` **not called**, `prisma.usageLog.count()` unchanged
  - the existing "returns 501 when image generation is not configured" test passes **unchanged** (unpinned seed book + `IMAGE_PROVIDER=openai` + no key → pin resolves to openai → default also unconfigured → 501)
  - a successful illustrate on an unpinned, unillustrated book writes `image_provider`/`image_model` to the Book row
  - a successful illustrate on an unpinned book with pre-cutover `IllustrationVersion` rows pins it to `openai` and passes `{ pin: { provider: 'openai' } }` as the 8th arg (`mock.calls[0][7]`)
  - the 409 lands **after** the 404 for a non-owner and after the 403 for a published book (ordering, per `docs/conventions/server.md`)
  - `generate.test.ts`: a full-preview generation pins the new book to `currentImagePin()`
- Wire-shape assertion required: **yes** — `image_provider`, `image_model` on `BookIllustrateResponseSchema`.

**Manual verify:**
- Re-roll page 4 of `b2fa23cf-3156-4b89-83e7-82d98c32c8b7` and confirm the result reads as the same art style as `page-4.png` v1. (Requires `OPENAI_API_KEY`; without it, confirm the 409 message renders in the illustrate error slot in both light and dark mode.)

**Done when:** listed tests pass, `cd server && npm test` and `cd e2e && npm test` green, no new TS errors. **Mitigation A is complete and shippable here.**

---

### Task 6 — Style anchor resolution and reference precedence

**Zone:** server
**Depends on:** Task 5
**Parallel-safe with:** none

**Status:** Done (2026-08-24)

**Files to add or change:**
- `server/src/services/illustrations.ts` — anchor resolution + reference composition
- `server/src/services/__tests__/illustrations.test.ts` — extend

**Signatures / shapes:**
```ts
/** Anchor at index 0, required portraits after. Required portraits are at most
 *  primary + antagonist (ADR-007 dec 7), so 3 is the natural ceiling; truncation
 *  only bites if a cast declares multiple primaries, and warns when it does. */
export const MAX_REFERENCE_IMAGES = 3;

/** Returns the web path iff it is non-empty AND the file exists on disk. A book
 *  restored from another machine can have a URL with no bytes behind it, and
 *  toDataUri() would throw and 500 the re-roll. Drops the anchor + console.warn. */
export async function resolveStyleAnchor(illustrationUrl: string | null | undefined): Promise<string | null>;

export function composeReferenceImages(styleAnchor: string | null, portraitRefs: string[]): string[];
```

**Tests to write:**
- `resolveStyleAnchor(null)` and `resolveStyleAnchor('')` → `null`
- `resolveStyleAnchor` for a path with no file on disk → `null` (and does not throw)
- `resolveStyleAnchor` for an existing file → the same web path back
- `composeReferenceImages(anchor, [])` → `[anchor]`
- `composeReferenceImages(anchor, [primary, antagonist])` → 3 entries, anchor first
- `composeReferenceImages(null, [primary])` → `[primary]` (unchanged from today)
- `composeReferenceImages(anchor, [a, b, c, d])` → 3 entries, anchor first, warns
- Wire-shape assertion required: no.

**Done when:** listed tests pass, `cd server && npm test` green, no new TS errors.

---

### Task 7 — Anchor-aware prompt shaping

**Zone:** server
**Depends on:** Task 6
**Parallel-safe with:** none

**Status:** Done (2026-08-24)

**Files to add or change:**
- `server/src/services/illustrations.ts` — `generateIllustration` prompt assembly
- `server/src/services/__tests__/illustrations.test.ts` — extend

**Signatures / shapes:**
```ts
// Inside generateIllustration, after the existing base prompt is built.
// EVERY clause below is gated on styleAnchor, so the no-anchor path stays
// byte-identical to today (ADR-006 dec 3 regression boundary).
let prompt = `${castPrefix}Children's book illustration, ${description}. ${style}. No text or words in the image.`;

if (styleAnchor) {
  prompt += ` Reference image 1 is an existing illustration from this same book:`
          + ` match its art style, colour palette, linework, shading, and character designs exactly.`;
  if (portraitCount > 0) {
    prompt += ` The remaining reference images are canonical character portraits.`;
  }
}
if (feedback) {
  prompt += ` Revision instructions: ${feedback}`;          // unchanged wording
}
if (styleAnchor && feedback) {
  prompt += ` Change only what the revision instructions ask for; keep the art style,`
          + ` palette and overall composition as in reference image 1.`;
} else if (styleAnchor) {
  prompt += ` Produce a fresh interpretation of this scene — a different composition,`
          + ` pose and camera angle from reference image 1 — while keeping its art style,`
          + ` palette and character designs identical.`;
}
```
The bare-redo variation directive is the mitigation for "an edit model handed its own output returns a near-copy". It is a prompt-level mitigation and cannot be asserted perceptually in a test — that is the manual step in Task 8.

**Tests to write:**
- with no anchor and no references, the prompt sent to the mocked `fetch` is **byte-identical** to the current expected string (extend the existing regression assertion)
- with an anchor and no feedback, the prompt contains the fresh-interpretation clause and **not** the change-only clause
- with an anchor and feedback, the prompt contains `Revision instructions: <feedback>` **and** the change-only clause, and **not** the fresh-interpretation clause
- with an anchor plus two portraits, the prompt mentions the remaining reference images
- Wire-shape assertion required: no.

**Done when:** listed tests pass, `cd server && npm test` green, no new TS errors.

---

### Task 8 — Route wiring for the anchor in `/illustrate`

**Zone:** server
**Depends on:** Task 7
**Parallel-safe with:** none

**Status:** Done (2026-08-24)

**Files to add or change:**
- `server/src/routes/books.ts` — build the anchor for targeted re-rolls only
- `server/src/routes/__tests__/books.test.ts` — extend

**Signatures / shapes:**
```ts
const portraitRefs = collectRequiredPortraitRefs(hydratedBook.characters);
// ...inside the per-page loop:
// Anchor ONLY on a targeted re-roll of an already-illustrated page. A bulk
// illustrate (no pageNumber) targets pages with no prior image by definition.
const styleAnchor = pageNumber ? await resolveStyleAnchor(page.illustration_url) : null;
const refs = composeReferenceImages(styleAnchor, portraitRefs);
const url = await generateIllustration(
  book.id, page.page_number, page.illustration_description,
  pageNumber ? feedback : undefined,
  book.style_descriptor, hydratedBook.characters,
  refs.length > 0 ? refs : undefined,        // undefined keeps the prompt-only path
  { pin, styleAnchor },
);
```

**Tests to write:**
- targeted re-roll of a page with an existing on-disk illustration → `mock.calls[0][6][0]` is that page's `illustration_url`
- targeted re-roll of a page with `illustration_url = null` → no anchor; references match today's behaviour exactly
- bulk illustrate (no `pageNumber`) → **no** anchor on any page, even for pages that happen to have a URL
- anchor + primary + antagonist portraits → exactly 3 references, anchor first (the existing `REF_IMAGES_ARG = 6` portrait test must be updated to expect the anchor at index 0, not deleted)
- the existing portrait-reference tests still pass for the bulk path
- Wire-shape assertion required: no (Task 5 owns the response pins).

**Manual verify:**
- Re-roll page 4 of `b2fa23cf-3156-4b89-83e7-82d98c32c8b7` with feedback ("more stars in the sky") — the result keeps the v1 art style and applies the change.
- Re-roll it again with the feedback box **empty** — the result is recognisably the same style but **not** a near-copy. If it is a near-copy, stop and switch `resolveStyleAnchor` to the cover-anchoring fallback documented in the spec's alternatives, rather than shipping a 4¢ button that returns the same picture.

**Done when:** listed tests pass, `cd server && npm test` and `cd e2e && npm test` green, no new TS errors, and both manual re-rolls above have been done by a human.

---

### Task 9 — Client: tell the user re-rolls match the book's original style

**Zone:** client
**Depends on:** Task 8
**Parallel-safe with:** none

**Status:** Done (2026-08-24)

**Files to add or change:**
- `client/src/components/BookSpread.tsx` — one hint line in `PageIllustration`, under the "What to change on re-roll" label (around line 703)
- `client/src/components/__tests__/BookSpread.test.tsx` — extend

**Signatures / shapes:**
```tsx
<p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
  Re-rolls match this book&rsquo;s original art style.
</p>
```
No fetch change: `handleIllustrate` in `BookDetail.tsx` already renders any `{ error }` body verbatim into `illustrateError`, so the new 409 message surfaces with no client work. Do not add a style picker — that is #91.

**Tests to write:**
- `BookSpread.test.tsx`: the hint renders for an owner on a draft book with an illustrated page, and does **not** render for a non-owner or a published book (same conditions as the existing re-roll controls)
- Wire-shape assertion required: no.

**Manual verify:**
- The hint reads correctly and has adequate contrast in **both** light and dark mode at a mobile viewport. This is the aesthetic half of done-criterion #2 (ADR-009); the correctness half is covered by the RTL test above, and no new Playwright spec is warranted for a static text line.

**Done when:** listed tests pass, `cd client && npm test` green, typecheck/lint/build clean.

---

### Task 10 — Pre-merge follow-ups

**Zone:** docs (harness) · **Depends on:** none (run last)

For each ADR-worthy item in the spec, ensure exactly one tracking action exists — a matching ADR, a linked issue, or an explicit `Deferred:` line with reasoning.

- ADR (expected **ADR-013**), covering as one coupled set: the per-book pin and its partial supersession of **ADR-006 decision 2**; inference-with-write-back as the backfill; 409-not-fallback; the style anchor and its feedback/no-feedback prompt split; reference precedence and the cap of 3 (extending **ADR-007** decisions 4 and 7); provider-aware spend cost at 25¢. It must also record the **CLAUDE.md paid-model-swap confirmation — Nick, 2026-08-23** — with attribution and date, so the guardrail reads as discharged rather than skipped. Write via `/create-adr`.
- `Deferred:` line for the full options-object refactor of the illustration service signatures — or file an issue.
- Link **#91** for the user-facing style override (already filed; no new issue needed).
- File an issue for the bug itself if the owner wants a permanent backlog record — it currently exists only as a PR #83 review comment.
- Record the Kontext / `kontext/multi` price re-check outcome from Task 0 item 3 on the PR, and update `COST_CENTS.illustration` if it moved.

**Done when:** `adr-tracking-check reroll-style-consistency` reports zero orphaned items.

## Sequencing notes

- **Task 0 changes no files and blocks nothing.** Both guardrail confirmations were given on 2026-08-23; it is there so the implementer carries the attribution into the ADR and the open Kontext-pricing item onto the PR body. Start at Task 1.
- **PR boundary.** Tasks 1–5 form a complete, shippable PR (**mitigation A**): after Task 5 a re-roll runs on the same model that made the book's original art, which is the fix for the reported bug. Tasks 6–9 form a second PR (**mitigation B**) that improves style-lock further. The split is a reviewability choice, not a contingency — the Kontext swap that mitigation B depends on is already approved.
- If the work does split into two PRs, write ADR-013 with the first PR covering the pin, the backfill, the 409 and the cost table, and amend it from the second PR with the anchor and precedence decisions. One ADR, two commits — not two ADRs for one feature.
- **Parallelism is limited.** Tasks 2 and 3/4 are the only real cut: Task 4 (spend) touches only `spend.ts` and can run alongside Task 3 (illustrations + fal provider). Everything else is a chain, because each task consumes the previous one's signature.
- Task 1 must land as one commit — schema, migration, regenerated postgres schema, `BookSchema`, and every fixture together. Splitting it leaves the client typecheck red.
- Commit per task; the migration commit should mention `add-book-image-pin` by name so a later `cp` restore can check the schema-drift rule in `docs/conventions/data.md`.

## Open questions

- Does `fal-ai/flux-pro/kontext/multi` have a documented maximum reference-image count? Not readable from this repo. The cap of 3 is set from our own ceiling (anchor + primary + antagonist), not from a published limit — if Fal's limit turns out to be lower, `MAX_REFERENCE_IMAGES` is the one constant to change.
- Is `OPENAI_API_KEY` set anywhere this will actually run? No `.env` in the tree sets it, and #62 says even `FAL_KEY` is unset in Render. If it is unset everywhere, the 409 path is the *common* outcome for legacy books in production rather than an edge case, which raises the priority of #91 — worth knowing before Task 5's manual verification is attempted.
