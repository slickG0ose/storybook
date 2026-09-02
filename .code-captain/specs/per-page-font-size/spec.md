# Font & text-size editing — curated defaults, print-safe

> Status: Accepted
> Last updated: 2026-09-02
> Backlog: [#113](https://github.com/slickG0ose/storybook/issues/113) — Per-page font & text-size editing
> Source: [#89](https://github.com/slickG0ose/storybook/issues/89) (direct per-page text editing) · Related: [#27](https://github.com/slickG0ose/storybook/issues/27) (Lulu xPress print umbrella)
> Architect: Claude Opus 5 via @architect on 2026-09-02

## Problem

Every book in the catalog renders its story text one way and only one way:
`client/src/components/BookSpread.tsx:573` hard-codes
`text-base md:text-lg text-gray-700 dark:text-gray-200 leading-relaxed font-display`.
That single line is the whole of the "fixed rendering" #113 wants to make variable. An
author writing for a 3-year-old and an author writing for a 9-year-old get identical
type at identical size, and a reader who needs larger text — the population that most
needs a picture book to be legible — has no recourse at all. #113 asks for author-side
control over family and size, with defaults derived from the book's age field, and for
an assessment of whether those choices survive the print path.

Three things make this more than a className swap, and the spec rules on each:

1. **The title says "per-page"; #113's own open questions doubt it.** Per-page control
   multiplies the print-overflow surface by page count before anyone has measured the
   overflow surface at all.
2. **`age_range` is not an enumerated field.** It is a free-text `String` on `Book`, and
   the codebase carries **two divergent vocabularies** for it (see §The `age_range`
   problem). "Tie defaults to the age-group field" is not implementable against that
   without first normalising the column.
3. **The print-fidelity gap already exists.** `server/src/services/pdf.tsx` renders in
   built-in Helvetica, not Fredoka, and says so in a module-scope
   `console.warn('[pdf] Display font not registered; falling back to Helvetica.')`.
   Letting an author *choose* Atkinson Hyperlegible does not create that gap; it makes
   it visible.

## Constraints

- **Existing books must render identically with no migration step.** Every new column is
  additive with a default, and the default must reproduce today's exact class string.
- **Prisma schema change** (`Book` gains two columns) — CLAUDE.md guardrail. Needs Nick's
  explicit confirmation before Task 1 runs. This spec does not assume approval.
- **No seed-data shape change is proposed.** `server/prisma/seed.ts`, `demo-seed.ts`, and
  the fixture JSON are untouched; the new columns take their DB defaults. If a task
  appears to need a seed edit, stop — that is a second guardrail.
- **OPS.3 / ADR-003.** `hydrateBook` (`server/src/routes/books.ts:60`) spreads the whole
  Prisma row, so the two new columns ship on the wire the instant the migration lands.
  `BookSchema` in `shared/src/books.ts` must gain them **in the same commit**, or
  `validate()` returns a 500 envelope on every book route in dev and the server suite
  goes red. Migration and schema are one task for exactly this reason.
- **Curated list, not a picker.** #113's "Not this" is binding: the vocabulary is a Zod
  enum in `@storybook/shared`, so a free-text family can't reach the DB.
- **Dark-mode parity** on every new control (`docs/conventions/client.md`).
- **Published books are immutable** (`isEditable`, ADR-012). See §Ruling 2.
- **No paid API is touched.** No `spendGate`, no `COST_CENTS` entry, no `recordUsage`.
  The new route is free to call; its only gate is auth + ownership.

## Proposed shape

Two token columns on `Book` — `font_family` and `text_size` — each a short string
validated against a Zod enum in `@storybook/shared`, each non-null with a default that
reproduces today's rendering byte-for-byte. A new free route,
`PUT /api/books/:id/typography`, writes them under the same ownership-then-`isEditable`
gate every other mutating book route uses. `BookSpread` resolves the pair into Tailwind
classes through one pure function; the owner sees a chip picker in the editor rail while
the book is a draft.

The age-derived default is applied **at creation time only**, not as a runtime fallback.
That distinction is the load-bearing part of the design and gets its own section below.

### Ruling 1 — Book-level, not per-page. Per-page is held as an upgrade path.

**Recommendation: put the columns on `Book`. Do not add per-page columns in this slice.**

Reasoning, in the order that decided it:

- **Print surface.** #113 item 3's overflow question is unanswered and unmeasurable today
  (§Print assessment). Book-level means one overflow check per book at trim size;
  per-page means one per page. Multiplying an *unmeasured* risk by page count is the
  wrong order of operations — measure the single-value case first.
- **Typography, not preference.** Mixing families page-to-page inside one picture book is
  a defect, not a feature. The legitimate per-page need is narrower: *this one page's
  text is long and overflows.* That is a **fit** problem, and the right answer to a fit
  problem is an automatic fit rule, not an author-facing knob that puts the burden of
  noticing on the author.
- **It drags Ruling 2 into its hard shape.** `BookVersion.pages_json` is a page-shaped
  snapshot (`{page_number, text, illustrationDescription}`). Per-page typography columns
  are page-shaped too, which makes "should they be in the snapshot?" a genuinely
  arguable question. Book-level columns are simply not page-shaped, and the answer falls
  out (§Ruling 2).

**The middle option — book default with per-page override — was considered and is
deferred, not rejected.** Nothing here forecloses it: adding nullable `Page.font_family`
/ `Page.text_size` later is additive, and the resolution helper is written *now* with the
signature that accommodates it:

```ts
resolveTypography(book: TypographySource, page?: Partial<TypographySource>): ResolvedTypography
```

The `page` parameter is unused in v1 and documented as the seam. Shipping the override UI
today would mean shipping a control for a fit problem nobody has measured, and every
override is another print-overflow case to check.

**Consequence for the issue:** #113's title becomes inaccurate. Retitle it, or add a
comment recording this ruling — a future reader should not have to diff the title against
the spec to find out which one won. The spec folder keeps its `per-page-font-size` slug
so links from the issue resolve.

### Ruling 2 — Presentation-only. Not version-bumping, excluded from `BookVersion`.

**Recommendation: a typography change does not bump `book.version` and does not write a
`BookVersion` snapshot.**

- **Shape.** `BookVersion` carries `pages_json`, `description`, and `characters_json`.
  The two book-level fields it already snapshots are *content* — the blurb and the cast —
  not presentation. A font token is neither page-shaped (so it has no home in
  `pages_json`) nor content.
- **The criterion is reversibility, not "presentation vs content" as a slogan.** A text
  edit destroys information: overwrite the words and the previous words are gone unless
  something snapshotted them. A typography change destroys nothing — the prior state is
  one of 4 × 4 tokens and is reconstructible by re-picking it. Version history exists to
  make destroyed information recoverable. This mutation destroys none.
- **The cost, stated plainly:** restoring version N restores that version's *text* with
  the book's *current* typography. Version history stops being a complete record of every
  change to the book. That is accepted, and the restore UI should not imply otherwise.

**Must #89's ruling agree? No — and that is coherent, not a contradiction.** #89 debates
snapshots for a mutation that destroys the previous words; this one doesn't. The two can
diverge on exactly the reversibility criterion above. **One coupling does bind, though,
and belongs in #89's spec:** if #89 lands text-edit snapshots, it must not sweep
typography into `pages_json` as a convenience. That would make font changes
version-bumping through the back door and quietly overturn this ruling. Cross-link this
section from #89 before that work starts.

**Editability still applies.** A typography write is a mutation on a `Book` row, so it
runs the standard gate — ownership check first (404 for a non-owner, never 403), then
`isEditable` (403 on a published book). The alternative — allowing typography edits on a
published book because presentation doesn't affect what was purchased — is rejected: the
catalog card and the reader would change under buyers with no trail at all, which is the
precise failure ADR-012 fenced off.

### Ruling 3 — Don't enumerate age bands. Bucket the string.

The recon for this spec turned up something worse than "there is no vocabulary": there
are **two, and they disagree.**

| Source | Values |
|---|---|
| `client/src/pages/CreateBook.tsx:26` — `AGE_RANGES` | `2-4`, `3-6`, `4-7`, `5-9`, `6-10` |
| `server/prisma/seed.ts` — the six catalog books | `2-5`, `3-6`, `4-7`, `4-8`, `5-9` |

`2-5` and `4-8` exist in the catalog but cannot be created. `2-4` and `6-10` can be
created but appear in no seeded book. The server enforces nothing — `generate.ts:121`
checks only that `ageRange` is truthy, and that route has no `validate()` at all.
`GET /api/books/age-ranges` derives its facet list from `SELECT DISTINCT`, so the Home
filter faithfully displays the drift.

**Recommendation: #113 does not enumerate age bands, and does not touch `age_range`.**
Normalising that column is a seed-data shape change plus a data migration — two
guardrails — for a problem that is #113's neighbour, not its content.

Instead, key defaults off a **pure function of the string's lower bound**:

```ts
// server/src/lib/typography.ts
export type AgeBucket = 'early' | 'developing' | 'independent';

/** Parses the leading integer out of an age_range string ("4-7" -> 4, "2-5" -> 2).
 *  Unparseable input buckets to 'developing' — the safe middle, never a guess at an
 *  extreme. Tolerant by design: it must survive both vocabularies above and any third. */
export function ageBucketFor(ageRange: string): AgeBucket;
```

Lower bound ≤ 4 → `early`; 5–7 → `developing`; ≥ 8 → `independent`. No migration, no seed
change, no new enum to keep in sync, and it keeps working unchanged if the column is
normalised later.

**Follow-up worth filing regardless of #113:** the `AGE_RANGES` / seed divergence is a
standalone bug — a shopper filtering `Ages 2-5` sees results nobody can create, and an
author picking `Ages 2-4` creates a book in a facet no other book occupies.

### Ruling 4 — NULL-equivalent means "the storefront default", not "derive from age"

This is where the age-defaults requirement and the no-visual-change constraint collide,
and the collision is real: a `4-7` book buckets to `early`, whose default size is `large`
— strictly bigger than what that book renders today. If age-derived defaults were a
*runtime fallback*, every existing `4-7` book would visibly change on deploy, violating
the constraint at the top of this spec.

So they are not a fallback. They are a **creation-time seed value**:

- The columns are **non-null with DB defaults** `'fredoka'` / `'standard'`. Every existing
  row takes those defaults on migration, and `fredoka` + `standard` is defined to emit
  today's exact class string. Existing books are byte-identical.
- `generate.ts` writes the **age-derived** values explicitly when creating a new book, so
  new books get age-appropriate typography and the author sees it immediately.
- Nothing ever re-derives typography for an existing book. An author's book does not
  change appearance because a default moved.

`fredoka` + `standard` is also the answer to **#113 item 2** ("the reader-facing default,
independent of age group"): it is what an untouched book renders as, and it is what the
DB default is.

### Curated set — four families

Both incumbents are already vendored, self-hosted, and OFL-licensed
(`client/public/fonts/README.md`), which settles the licensing half of #113 item 3 for
them outright: **SIL OFL 1.1 explicitly permits embedding in a document, including a
PDF.** The two additions are also OFL 1.1 via Google Fonts and follow the same vendoring
procedure the README already documents (binary + `<Family>-OFL.txt` alongside it).

| Token | Family | Licence | Cost | Why it is in the set |
|---|---|---|---|---|
| `fredoka` | Fredoka (vendored, v17) | OFL 1.1 ✓ | 0 KB | **The default.** Rounded terminals, large x-height, wide apertures. It is the current rendering; removing it would change every book in the catalog. |
| `nunito` | Nunito (vendored, v32) | OFL 1.1 ✓ | 0 KB | Narrower, more conventional letterforms; holds up better over a paragraph than a display face. The older-reader option. |
| `atkinson` | Atkinson Hyperlegible | OFL 1.1 ✓ | ~2 subsets | Braille Institute, designed for low vision. Deliberately disambiguated letterforms (`l`/`I`/`1`, `0`/`O`). Already named in `pdf.tsx`'s docblock as the intended print face. |
| `lexend` | Lexend | OFL 1.1 ✓ | ~2 subsets | Designed against reading-proficiency research; generous default tracking. The reading-difficulty option that is not a dyslexia-specific typeface. |

**Licences verified 2026-09-02, not deferred to vendor time.** Both additions were read
directly from their `OFL.txt` in `github.com/google/fonts`, so Task 5 vendors them with
the licence question already closed:

- **Atkinson Hyperlegible** — `ofl/atkinsonhyperlegible/OFL.txt`: *"Copyright 2020 Braille
  Institute of America, Inc. / This Font Software is licensed under the SIL Open Font
  License, Version 1.1."* No reserved font name.
- **Lexend** — `ofl/lexend/OFL.txt`: *"Copyright 2018 The Lexend Project Authors
  (https://github.com/googlefonts/lexend), with Reserved Font Name "RevReading Lexend"."*
  The RFN binds only a **derivative** — vendoring the binary unmodified under the name
  `Lexend` is exactly what the OFL permits, and it is what `public/fonts/README.md`'s
  existing procedure already does for Fredoka and Nunito.

That closes the licensing half of #113 item 3 for all four families. The remaining half —
page-overflow behaviour at print trim size — is unaffected and stays in §Print assessment.

**On "dyslexia-friendly", head-on.** #113 item 1 asks for it by name. The honest answer is
that the *size and spacing* controls do more for a dyslexic reader than the family choice
does — the research consistently favours larger type and increased spacing over
dyslexia-specific letterforms, whose evidence base is weak. That is why the size scale
below carries its own line-height and tracking rather than scaling font-size alone.

**OpenDyslexic is held back, on purpose.** It is the font parents ask for by name, and
that is a real reason to ship it — but the evidence for it is the weakest of the four
candidates, and its licence needs care (OpenDyslexic 3 is OFL 1.1; earlier cuts derive
from Bitstream Vera, so the specific release must be checked, not assumed). Recommendation:
add it on request, with the honest framing "some readers prefer it," not "this helps
dyslexia." Flagged for Nick to overrule if he'd rather have it in v1.

**~~New families cost nothing until used.~~ Wrong — corrected after Task 5 measured it.**
The browser-level claim holds: a `@font-face` block is only fetched when a CSS rule
applies that family, and the two additions are correctly kept out of the
`<link rel="preload">` pair in `client/index.html`. But this app is a PWA.
`client/pwa.config.ts:43` globs `**/*.{js,css,html,svg,webp,woff2}` into the Workbox
precache, so **every** vendored font is downloaded on first visit by any service-worker
visitor whether or not a book uses it. Measured: precache 867 KiB → 973.48 KiB, **+106
KiB** (Lexend is ~74 KiB of it; Atkinson ships four static files, ~34 KiB).

**Ruling: accept the cost; do not narrow the glob.** That glob is deliberate — the comment
above it exists because an extension missing from the list renders a broken asset offline.
Narrowing it so only the two default families precache would mean a book an author set to
Atkinson or Lexend renders offline in fallback system sans: silently wrong type rather
than a visible failure, which is the exact failure mode this project rejects elsewhere.
The honest framing is that a curated set of four families costs 106 KiB of one-time
precache, and that is the price of the offline render working for all four.

### Size scale — four steps, each a triple

Size is not font-size alone; each token sets size, line-height and tracking together.

| Token | Mobile / ≥md | Line-height | Tracking | Intended reader |
|---|---|---|---|---|
| `cozy` | `text-sm` / `text-base` | `leading-relaxed` | normal | More words per spread; confident readers |
| `standard` | `text-base` / `text-lg` | `leading-relaxed` | normal | **Today's exact rendering.** The default. |
| `large` | `text-lg` / `text-xl` | `leading-loose` | `tracking-wide` | Early readers |
| `xlarge` | `text-xl` / `text-2xl` | `leading-loose` | `tracking-wide` | Shared reading, low vision |

The `standard` + `fredoka` pair **must** emit
`text-base md:text-lg text-gray-700 dark:text-gray-200 leading-relaxed font-display`
— the string currently at `BookSpread.tsx:573`, unchanged. A unit test pins it; that test
is the mechanical discharge of the no-visual-change constraint.

Creation-time defaults by bucket: `early` → `fredoka` + `large`; `developing` → `fredoka`
+ `standard`; `independent` → `nunito` + `cozy`.

### Schema / contract changes

**Prisma** (`server/prisma/schema.prisma`, model `Book`) — guardrail, needs confirmation:

```prisma
  // Presentation-only (#113). Both non-null with defaults that reproduce the
  // pre-#113 rendering exactly, so every existing row is visually unchanged.
  // Deliberately NOT snapshotted into BookVersion — see spec §Ruling 2.
  font_family String @default("fredoka")   // 'fredoka' | 'nunito' | 'atkinson' | 'lexend'
  text_size   String @default("standard")  // 'cozy' | 'standard' | 'large' | 'xlarge'
```

Migration name: `add_book_typography`.

**Corrected after Task 1 ran.** This spec originally claimed the migration would be a
metadata-only `ADD COLUMN`. It is not. Because the two columns sit mid-model (after
`style_reference_url` rather than at the end), Prisma emitted a **`RedefineTables`** block
— `CREATE TABLE new_Book` / `INSERT … SELECT` / `DROP` / `ALTER TABLE … RENAME` — which
rewrites the table. Rows are preserved and new rows take the defaults, so the *behaviour*
is what this spec intended; only the cost claim was wrong. Do not quote "metadata-only" at
deploy time. The generated SQL was deliberately left un-hand-edited: forcing
`ALTER TABLE … ADD COLUMN` would risk shadow-DB drift for a cosmetic gain.

**`shared/src/books.ts`** — the vocabulary and the two new `BookSchema` fields:

```ts
export const FontFamilySchema = z.enum(['fredoka', 'nunito', 'atkinson', 'lexend']);
export type FontFamily = z.infer<typeof FontFamilySchema>;

export const TextSizeSchema = z.enum(['cozy', 'standard', 'large', 'xlarge']);
export type TextSize = z.infer<typeof TextSizeSchema>;

// Added to BookSchema. Non-nullable: the columns are non-null with defaults and
// hydrateBook spreads the whole row, so an absent field is drift, not a legacy row.
  font_family: FontFamilySchema,
  text_size: TextSizeSchema,

// PUT /api/books/:id/typography
export const BookTypographyRequestSchema = z.object({
  font_family: FontFamilySchema,
  text_size: TextSizeSchema,
}).strict();
export const BookTypographyResponseSchema = BookWithPagesSchema;
```

`.strict()` for the same reason `BookPdfRequestSchema` uses it: a future per-page override
field cannot land silently.

**Routes:** one new — `PUT /api/books/:id/typography`. Every existing book route response
grows two fields as a side effect of `hydrateBook`; that is the OPS.3 obligation Task 1
carries.

### Data flow

```
Author (owner, book is draft)
  → TypographyControls chip click
  → BookDetail: PUT /api/books/:id/typography { font_family, text_size }
  → requireAuth → validate(BookTypographyRequestSchema) → handler
      → ownership check (404) → isEditable (403)
      → prisma.book.update  [no BookVersion write, no version bump]
      → hydrateBook(book with pages)
  → BookDetail replaces book state
  → BookSpread → resolveTypography(book) → StoryText className
```

State lives in one place: the `Book` row. No client-side persistence, no context, no
localStorage key. The reader has no override in v1 (§Out of scope).

### Files likely touched

- `server/prisma/schema.prisma` — two columns on `Book`
- `server/prisma/migrations/<ts>_add_book_typography/` — generated
- `shared/src/books.ts` — enums, `BookSchema` fields, request/response schemas
- `server/src/lib/typography.ts` — new; `ageBucketFor`, `defaultTypographyForAgeRange`
- `server/src/routes/books.ts` — new `PUT /:id/typography`
- `server/src/routes/generate.ts` — write age-derived defaults on create
- `client/src/lib/typography.ts` — new; token → Tailwind class maps, `resolveTypography`
- `client/src/index.css` — two `@font-face` pairs, two `@theme` tokens
- `client/public/fonts/` — 4 new woff2 + 2 OFL files + README rows
- `client/src/components/BookSpread.tsx` — `StoryText` consumes the resolved class
- `client/src/components/TypographyControls.tsx` — new; the chip picker
- `client/src/pages/BookDetail.tsx` — wire the PUT, pass the handler down
- `e2e/tests/mobile/typography.spec.ts` — new

## Alternatives considered

### Per-page columns now (what the issue title asks for)

**Pros:** matches the filed title; solves the long-page overflow case directly.
**Cons:** multiplies an unmeasured print-overflow surface by page count; invites
page-to-page family mixing, which is a typographic defect; forces the harder version of
Ruling 2.
**Why rejected:** held as an upgrade path, not discarded — the resolver signature already
takes the page parameter, and nullable `Page` columns are additive whenever the print
surface is measured and someone actually asks.

### Nullable columns, so "never chosen" stays distinguishable from "chose the default"

**Pros:** allows retro-applying improved age defaults to books whose author never picked.
**Cons:** a fallback branch in the resolver that can drift from the CSS; nullable fields
on the wire for a value that is never legitimately absent.
**Why rejected:** the capability it buys is one we've explicitly ruled against (Ruling 4:
a book must not change appearance because a default moved), so the nullability is pure
carrying cost.

### A `TypographyPreset` table keyed by age band

**Pros:** editable defaults without a deploy; a natural home for future per-band rules.
**Cons:** a table, a route, an admin UI, and a join — to store eight strings that change
about never. And it requires the enumerated age vocabulary Ruling 3 declines to build.
**Why rejected:** disproportionate. Revisit if defaults ever need to be tuned by someone
without a deploy.

### Numeric size (a px/rem value) instead of four named tokens

**Pros:** finer control; trivially maps to a PDF `fontSize`.
**Cons:** unbounded input to validate, an infinite print-overflow surface instead of four
cases, and no way to bind line-height and tracking to the choice — which is where most of
the legibility gain actually is.
**Why rejected:** four tokens make the print assessment a finite, testable matrix. That is
the whole reason the scale is tokens.

### A reader-side override in localStorage instead of author-side control

**Pros:** arguably the higher-value accessibility feature; needs no schema change at all;
`client/src/lib/narration/prefs.ts` is a ready-made pattern.
**Cons:** answers a different question than #113 asks, and has no bearing on print (the
PDF would still use the book's stored value).
**Why rejected:** out of scope here, not wrong. Named in §Out of scope as a follow-up
with the exact pattern to copy.

## Print assessment (#113 item 3) — recommendation only, no pipeline work

The deliverable for item 3 is this section. **No task in `tasks.md` touches
`server/src/services/pdf.tsx`.**

**Licensing: settled, not open.** OFL 1.1 permits embedding in a document, PDFs included.
All four families are OFL 1.1; the vendoring procedure in `client/public/fonts/README.md`
(binary + `<Family>-OFL.txt` alongside) already satisfies the licence's requirements. The
only open item is verifying the specific release's licence file at vendor time for the two
additions — and for OpenDyslexic, should it be added later, where the pre-3.x cuts are
Bitstream Vera-derived.

**The fidelity gap predates this feature.** `pdf.tsx` renders Helvetica and warns about it
at module scope. Today that is invisible because there is only one web face. After #113 it
becomes user-visible: an author picks Atkinson, exports, and gets Helvetica. Two honest
options for the follow-up, in preference order:

1. **Register the four families and honour `book.font_family`.** The docblock calls this
   "a one-call swap via `Font.register()`", and for one static face it is. **Caveat to
   verify before sizing it:** @react-pdf/renderer 4.x registers TTF/WOFF, not WOFF2, and
   does not resolve variable-font axes — both vendored families are *variable* WOFF2. So
   this likely needs static TTF instances vendored separately from the web bundle, not a
   reuse of `client/public/fonts/*.woff2`. Verify against the installed 4.6.1 before
   committing to an estimate.
2. **Keep Helvetica and label the export.** Cheaper and not dishonest, as long as the
   export is stamped screen-quality. Strictly worse than (1) once an author has made a
   choice the export ignores.

**Overflow is unmeasured, and this spec will not guess.** `styles.storyText` is
`{ flex: 1, fontSize: 14, lineHeight: 1.7 }` inside a fixed-height half-panel on an **A4
landscape** page. @react-pdf does not auto-shrink text to fit; long page text at `xlarge`
will either overflow the panel or push the page number out of view. I could not measure
this — the architect role is read-only and cannot run the renderer.

The print trim target is **8.5" × 8.5" square** with a 0.125" bleed and a 0.25" safe zone
(`docs/print-publishing-research.md`). That is a *different aspect ratio* from the A4
landscape the current exporter uses, so fitting in today's PDF would not be evidence of
fitting at trim even if it were measured.

**Recommended first task of the print follow-up:** a measurement harness — render each of
the four size tokens against the longest page text in the seed catalog, assert page count
and that the page-number element still lands inside the panel. `BookPdfRequestSchema`'s
anticipated `format: 'screen' | 'print'` field is the natural place for typography to
enter the print path.

## Success criteria

- `fredoka` + `standard` emits the exact class string at `BookSpread.tsx:573` today, pinned
  by a unit test; every seeded book renders unchanged after the migration.
- `PUT /api/books/:id/typography` returns 401 unauthenticated, 404 for a non-owner, 403 on
  a published book, 400 on a family outside the enum, and 200 with both fields pinned by
  `toMatchObject` for the owner of a draft.
- A book created through `POST /api/generate` with `ageRange: '3-6'` persists
  `font_family: 'fredoka'`, `text_size: 'large'`.
- Changing typography leaves `book.version` unchanged and writes no `BookVersion` row —
  asserted directly in the route test.
- The chip picker renders with `dark:` partners and ≥44px tap targets, verified in both
  themes at a mobile viewport by Playwright (ADR-009 correctness half).

## Out of scope

- **Any change to `server/src/services/pdf.tsx` or the print pipeline.** Recommendation
  only; see §Print assessment.
- **Per-page overrides.** Upgrade path, Ruling 1.
- **Normalising `age_range`.** Separate issue, Ruling 3.
- **A reader-side accessibility override.** Copy `client/src/lib/narration/prefs.ts` when
  it happens — one namespaced key, hand-written guard, never touches the other four keys.
- **OpenDyslexic**, pending the evidence/licence note above.
- **Typography on the cover, title, or "The End" panel.** Story text only; the cover is a
  brand surface.
- **Free-form font upload or an open picker** — #113's "Not this".

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| Migration lands without `BookSchema` updated → `validate()` 500s every book route in dev (`hydrateBook` spreads the row) | Same task, same commit. Task 1 is explicitly "the data shape", not "the migration". |
| Prisma schema change is a CLAUDE.md guardrail | Task 1 must surface it and stop for Nick's confirmation before running `db:migrate`. Not pre-approved by this spec. |
| Existing books shift visually on deploy | Non-null DB defaults + the class-string pin test. Age defaults apply at creation only (Ruling 4). |
| Two new families bloat first paint | `@font-face` is lazy — unused families are never fetched. Do **not** add them to the `index.html` preload pair. |
| New UI ships without dark variants | Chip picker mirrors `CreateBook.tsx`'s existing chip classes, which already carry `dark:` partners; `dark-mode-parity-check` runs at `/ship`. |
| An author's choice is silently ignored by PDF export | Known and documented; the gap predates #113. Follow-up issue filed in Task 10 rather than discovered by a user. |
| #89 later sweeps typography into `pages_json`, overturning Ruling 2 | Cross-link §Ruling 2 into #89 before that work starts — listed in Task 10. |
| `ageBucketFor` mis-parses an unexpected `age_range` string | Buckets to `developing`, the safe middle, never to an extreme. Unit-tested against both divergent vocabularies plus junk input. |
| Spend exposure | None. No paid API, no `spendGate`, no `COST_CENTS` entry. The new route is auth- and ownership-gated and costs nothing to call. |

## ADR-worthy decisions

All six are tracked as of 2026-09-02 (Task 10). `adr-tracking-check per-page-font-size`
reports zero orphans.

- [x] **Book-level typography, per-page deferred** (Ruling 1) → **ADR-020**.
- [x] **Typography is presentation-only: no version bump, excluded from `BookVersion`**
      (Ruling 2) → **ADR-019**. Cross-linked into
      [#89](https://github.com/slickG0ose/storybook/issues/89) via the ADR's §Binding on
      #89, which names the one way #89 could overturn it silently.
- [x] **Non-null columns with defaults, age-derived values applied at creation only**
      (Ruling 4) → folded into **ADR-020**. It did read thin alone, as predicted.
- [x] **Curated set is four families; OpenDyslexic held back** → recorded as a comment on
      [#113](https://github.com/slickG0ose/storybook/issues/113#issuecomment-5515889233),
      with the evidence argument and the note that widening `FontFamilySchema` after this
      merges is a wire-shape change.
- [x] **Deferred:** PDF font registration + print-overflow measurement (§Print assessment)
      → filed as [#171](https://github.com/slickG0ose/storybook/issues/171), sub-issue of
      [#27](https://github.com/slickG0ose/storybook/issues/27).
- [x] **Deferred:** `age_range` vocabulary divergence between `CreateBook.tsx` and
      `seed.ts` (Ruling 3) → filed as
      [#172](https://github.com/slickG0ose/storybook/issues/172).
