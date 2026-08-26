# Hero rotation — the best-of pool

> Status: Draft
> Last updated: 2026-08-26
> Backlog: [#127](https://github.com/slickG0ose/storybook/issues/127) — **this spec covers population 2 only.** #127 stays open.

## Problem

The Home hero renders one static illustration (ADR-014, shipped as `hero-visual`). It is
a good frame, but it is one frame: it can only ever represent one art style, one theme,
and one book, and the front page looks identical on every visit forever. #127 asks for
rotation, and names two populations that it is explicit are **different features, not one
feature with a flag**:

1. **The visitor's own characters** — a signed-in reader sees their own cast.
2. **A best-of pool from the catalog** — signed-out visitors and readers with no books
   rotate through illustrations from the strongest books.

**Scope judgment: these are two specs and two PRs, and this one is population 2.**
Reasoning is in §"Why the pool ships alone" below — it is not padding-avoidance, it is
that population 1 is blocked on a decision this spec deliberately does not make.

The hard part is not the rotation. It is that **ADR-014's delivery decision does not
survive contact with N frames.** The byte budget is enforced by a test
(`client/src/__tests__/heroAsset.test.ts`: 150 KB per file, 200 KB for the directory) and
the single shipped frame is already 140.9 KB of it. Four bundled frames at hero quality
would be ~680 KB. Bundling the rotation set is arithmetically dead.

## Constraints

- **The byte budget test is not to be relaxed for the bundled directory.** ADR-014
  decision 3 exists because a 2.2 MB source PNG above the fold destroys LCP. Raising
  `MAX_TOTAL_BYTES` to make room for rotation frames spends the one guard that stops that.
- **The server is Render and is currently down** (`docs/deploy-spike-render.md`).
  ADR-014 decision 5 chose bundled precisely so the hero is never a broken box on a cold
  backend. Any design that makes first paint depend on the API regresses that.
- **Zero CLS, and LCP must not regress.** The current hero achieves this with intrinsic
  `width`/`height` + `aspect-square` + `fetchPriority="high"` and no `loading="lazy"`.
- **1:1 is locked** (ADR-014 decision 6). Every illustration this product emits is
  1024x1024; any book page can swap in without re-cropping. Do not re-litigate.
- **Three pinned selectors depend on the hero's accessible name matching `/bench/i`:**
  `client/src/pages/__tests__/Home.test.tsx:190`, `e2e/tests/home.spec.ts:17`,
  `e2e/tests/mobile/hero.spec.ts:30`. Rotation must not make them flaky.
- **`sizes` is pinned verbatim** at `client/src/pages/__tests__/Home.test.tsx:240`.
- **No new runtime dependency.** Derivation runs through `npx -y sharp-cli` from the npx
  cache (ADR-014 decision 2). `git diff master...HEAD -- '**/package.json'
  '**/package-lock.json'` must be empty. A server-side `sharp` install is a CLAUDE.md
  size-gate item and is explicitly out of scope here.
- **New route ⇒ OPS.3.** Zod schemas in `@storybook/shared`, `validate()` mounted, every
  response field pinned by `toMatchObject` in a Supertest test.
- **Prisma column ⇒ migration**, additive only, never edit a committed migration.

### The catalog as it actually is today

Worth stating because it changes the answer. Verified against the running `dev.db` and the
main checkout's disk on 2026-08-26 (an earlier draft of this spec undercounted; these are
the corrected figures):

`server/public/illustrations/` holds **19 PNGs across two book directories**, and `dev.db`
has **8 books**:

| Books | `is_user_created` | `created_by` | Status | Art on disk |
|---|---|---|---|---|
| 6 canonical seed books | `false` | `null` | published (3 featured) | **none** |
| "A Spot for Sunny" (`b2fa23cf-…`) | `true` | demo admin `8b0971b0` | published | 13 files |
| "Bailey's Big Easter" (`bc056849-…`) | `true` | demo admin `8b0971b0` | **draft** | 6 files |

So:

- **The six catalog books have no illustrations at all.** A "best-of pool from the catalog"
  draws from an empty catalog. Every frame that exists belongs to a user-created book.
- The second illustrated book is a **draft**, so it is not publicly eligible regardless of
  consent. The practical day-one pool is ~5 page frames from "A Spot for Sunny" alone.
- Every one of those files is a **2.2 MB PNG** served raw from `/illustrations/`. Whatever
  the pool serves, it cannot be those files.
- "A Spot for Sunny" is `is_user_created: true` and its `created_by` is the seeded **demo
  admin** user (`server/prisma/demo-seed.ts:226`). Any consent predicate written as
  `is_user_created: false` or `created_by: null` empties the pool on day one. That fact
  drives the consent design below.

The correction strengthens rather than weakens the argument: it is not that the catalog is
thin, it is that the catalog has no art whatsoever and the feature is *necessarily* built
on user-created work from its first commit. Consent is not an edge case here; it is the
starting state.

## Proposed shape

### 1. Delivery: frame 0 stays bundled; rotation frames come over the API

The budget problem and the server-down problem pull in opposite directions, and the way
out is to notice they apply to **different frames**.

**Frame 0 — the LCP frame — does not change at all.** Same two committed WebPs, same
`fetchPriority="high"`, same `sizes`, same byte budget, same test, same offline precache.
Its `<img>` element and its `src` are **never mutated by rotation**. A visitor with a dead
backend, a cold Render instance, an offline PWA, or JS disabled gets exactly today's hero.

**Frames 1..N are progressive enhancement, fetched after first paint.** They are *also*
derived, committed, byte-budgeted WebPs — the same artifact discipline ADR-014 chose —
but they live under `server/public/hero/` and are served by Express as static files, not
compiled into the client bundle. `client/src/assets/hero/` gains nothing, so
`heroAsset.test.ts` stays exactly as written.

This answers the central question directly rather than around it: **not more bundled
frames, not a build step, and not live user art over the API. Derived-and-committed
artifacts, delivered over HTTP instead of through Vite, gated behind first paint.** Every
property ADR-014 bought is preserved, because the frame that carries those properties is
still the bundled one.

The derivation command becomes a **script** rather than a documented one-liner —
ADR-014's Consequences named this as the thing to automate first once "the source set
grows past a handful of images". It runs from `npx -y sharp-cli`, stays out of CI and out
of the build, and still produces committed artifacts. That is the *documented manual
command* growing a loop, not a pipeline.

**Loading policy:** frames are fetched **one ahead**, not all at once. A visitor who
bounces after five seconds downloads frame 0 (bundled) plus at most one pool frame. The
directory budget is therefore a ceiling on a full-cycle visitor, not a first-paint cost.

### 2. Eligibility: an admin-set flag, and a per-frame cap

`Book.is_hero_eligible Boolean @default(false)`. That is the whole signal. #127 calls the
flag "the cheap honest version" and it is right, for a reason specific to this catalog:
there are no orders and no cart history to derive popularity from, so a computed signal
would rank an empty set. A `COUNT(OrderItem)` ordering costs a join and returns nothing
useful until the store has real traffic; the flag costs one defaulted boolean column and
one migration.

**What the flag costs:** it is taste, not evidence. It goes stale silently — nobody is
notified when a flagged book stops being the best thing in the catalog — and it does not
scale past the point where an operator can hold the catalog in their head. The upgrade
path (order counts, with the flag demoted to an override) is recorded in §Alternatives and
needs no wire-shape change to adopt, because the response already returns an ordered list.

**Frames, not books, are the unit.** One book yields several illustrated pages. The pool
resolver takes up to `MAX_FRAMES_PER_BOOK = 2` frames per eligible book (page order
ascending) and `MAX_POOL_FRAMES = 5` overall, so one book cannot monopolise the rotation
once the catalog grows, and today's single demo book still yields real rotation.

**A frame exists only if its derived artifact exists.** The resolver checks the filesystem
and silently omits frames with no derived file. Setting the flag without running the
derive script therefore does nothing visible, which is why the admin toggle's response
returns `hero_frames_available` — so the operator sees `0` and knows the artifact step is
outstanding.

### 3. The consent seam

A user's own art on their own screen is private display. The same art in a pool that
strangers see is promotional publishing, and the two must not be one code path by accident.
Four independent seams, all mechanical:

1. **Two columns, two writers, two actors.** `is_hero_eligible` is *editorial quality*
   and only an admin may write it. `hero_consent_at DateTime?` is *permission for
   promotional display* and **this spec ships no API that writes it.** The only writer is
   the demo-seed fixture, i.e. the operator consenting to the operator's own demo book.
   To place a stranger's art in the pool today, an admin would have to write raw SQL.
   Admin authority and owner consent are not the same key and cannot be conflated by a
   handler that forgot.
2. **One `where` fragment, mirroring `AVAILABLE_BOOK_WHERE`.** `HERO_POOL_WHERE` in
   `server/src/lib/heroPool.ts` is the single expression of eligibility:
   `{ deleted_at: null, status: 'published', is_hero_eligible: true, hero_consent_at: { not: null } }`.
   No route writes its own version.
3. **The wire shape cannot carry a personal frame.** `HeroFrameSchema` has
   `source: z.literal('pool')`. A personal frame will carry `source: 'personal'` and a
   different response schema; `validate()` returns a loud 500 in dev if a `'personal'`
   frame is ever emitted from the pool route. The discriminator is not decoration — it is
   the thing that makes the mistake fail at test time.
4. **The pool response is identical with and without a bearer token**, asserted directly:
   the same request signed-out, signed-in as a normal user, and signed-in as an admin
   returns byte-identical JSON. The pool route never calls `getAuthUser`. That test is the
   seam's tripwire — the moment someone personalises the pool route, it goes red.

When consent *is* designed, the change is to add a writer for `hero_consent_at` behind an
owner-only route plus a UI surface that says plainly what opting in means. Nothing about
`HERO_POOL_WHERE` needs to relax.

### 4. Signed-out first paint, and rotation behaviour

**The defined default is frame 0, for everyone, always.** Auth state is never consulted
before painting the hero, and the pool fetch is not awaited by render. There is no flash
and no block because there is no state in which the hero is empty. `AuthContext.loading`
is irrelevant to this component in this spec — and when population 1 lands, its rule is
already fixed: personal frames may only *join* the rotation after `loading === false`,
never gate the first frame.

**Rotation mechanics:**

- The art box becomes `relative aspect-square` with two stacked `<img>` layers. Layer 0 is
  the bundled frame, unchanged and never re-`src`ed. Layer 1 is the rotating layer,
  absolutely `inset-0`, crossfading on opacity only. No layout property animates, so CLS
  stays zero by construction rather than by measurement.
- The next frame's bytes are assigned to a preload image ~1 s before the swap; the
  crossfade begins on `load`. A frame that never loads is skipped, never shown blank.
- Dwell `HERO_ROTATE_MS = 7000`, crossfade `HERO_FADE_MS = 600`, both exported and pinned.
- **Rotation is suppressed entirely** — hero stays on frame 0 — when
  `prefers-reduced-motion: reduce` matches, when `navigator.connection?.saveData` is true,
  or when the pool fetch fails or returns `frames: []`. It pauses on
  `document.visibilityState === 'hidden'`.
- Frame order is server-deterministic (cacheable); the **client picks a random start
  index** at mount, so variety comes without defeating an HTTP cache.
- **Accessibility rule: frame 0 keeps the accessible name; rotating layers are
  `alt=""` + `aria-hidden="true"`.** Exactly one `<img>` in the hero is ever named. This
  is what keeps the three pinned `/bench/i` selectors stable, and it is an accepted cost —
  a screen-reader user gets frame 0's description while a different frame is on screen.
  Defensible because the rotation is decorative variety with no caption, no link, and no
  information the page needs. It stops being defensible the moment attribution is added,
  which is why attribution is explicitly out of scope (§Out of scope).

### Schema / contract changes

**Prisma** (`server/prisma/schema.prisma`, one additive migration
`add-hero-eligibility-and-consent`):

```prisma
model Book {
  // Editorial: "this is good enough for the front page." Admin-writable.
  is_hero_eligible Boolean   @default(false)
  // Permission for promotional display outside this book's own detail page.
  // NO API writes this column in the hero-rotation spec — see spec §consent seam.
  hero_consent_at  DateTime?
}
```

**Zod, new file `shared/src/hero.ts`**, re-exported from `shared/src/index.ts`:

```ts
export const HeroFrameSchema = z.object({
  id: z.string(),                 // `${book_id}-p${page_number}` — stable React key
  source: z.literal('pool'),      // provenance discriminator; the consent seam
  src: z.string(),                // server-relative path; client wraps in api()
  src_small: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  alt: z.string(),
  book_id: z.string(),
  book_title: z.string(),         // carried for a future credit line; unrendered in v1
});
export const HeroPoolResponseSchema = z.object({ frames: z.array(HeroFrameSchema) });
```

`src` is a **server-relative path** (`/hero/<book_id>/p4-960.webp`), matching the existing
`api(page.illustration_url)` convention in `BookSpread.tsx` and `BookDetail.tsx`. Absolute
URLs would break the `VITE_API_BASE_URL` split between GitHub Pages and Render.

**Admin schemas** (`shared/src/admin.ts`), mirroring the `is_featured` pair:

```ts
export const AdminBookHeroEligibleRequestSchema = z.object({ is_hero_eligible: z.boolean() });
export const AdminBookHeroEligibleResponseSchema = BookWithPagesSchema.extend({
  is_hero_eligible: z.boolean(),
  hero_frames_available: z.number().int(),  // 0 ⇒ flagged but not yet derived
});
```

`AdminBookListItemSchema` gains `is_hero_eligible: z.boolean()` so the admin list shows
state. **`BookSchema` does not gain it** — the storefront has no business reading an
editorial flag, and `validate()`'s response check strips rather than rejects unknown keys,
so the extra column riding along in `/api/books` responses is harmless and unpinned by
design. Say that in the PR body so Check 4 does not have to infer it.

**Routes:**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/hero/pool` | **none — and must stay none** | Ordered pool frames |
| PUT | `/api/admin/books/:id/hero-eligible` | `adminGate` | Toggle the editorial flag |

`GET /api/hero/pool` is public, read-only, touches no paid API, and has no spend surface —
it reads flags and stats files. It sets `Cache-Control: public, max-age=300` so a cold
Render instance is not asked for the same list by every visitor.

### Data flow

```
first paint    Home → HeroArt → bundled frame 0            (no fetch, no auth, no await)
after paint    HeroArt → GET /api/hero/pool                (no Authorization header)
server         HERO_POOL_WHERE → books → illustrated pages
               → existsSync(server/public/hero/<book>/p<n>-960.webp)
               → cap 2/book, 5 total → HeroFrameSchema[]
client         random start index → preload next → crossfade layer 1 → repeat
failure        fetch rejects / [] / reduced-motion / saveData → frame 0 forever
```

No state leaves the component. No context, no localStorage, no cart session.

### Files likely touched

- `shared/src/hero.ts` — new; pool wire shape
- `shared/src/index.ts` — re-export
- `shared/src/admin.ts` — hero-eligible request/response pair
- `server/prisma/schema.prisma` + one new migration folder — two additive columns
- `server/prisma/demo-seed-fixtures/spot-for-sunny.json` — sets both new fields
- `server/prisma/demo-seed.ts` — passes the two fields through `upsertFixture`
- `server/src/lib/heroPool.ts` — new; `HERO_POOL_WHERE`, caps, alt derivation, frame resolver
- `server/src/routes/hero.ts` — new; `GET /api/hero/pool`
- `server/src/routes/admin.ts` — `PUT /api/admin/books/:id/hero-eligible`
- `server/src/index.ts` — mount `/hero` static + `/api/hero` router
- `server/public/hero/**` — new; derived committed frames + README
- `server/scripts/derive-hero-frames.sh` — new; the loop around the ADR-014 command
- `server/src/__tests__/heroFrameAssets.test.ts` — new; byte budget for the served set
- `server/src/routes/__tests__/hero.test.ts` — new; wire shape + consent seam
- `client/src/components/HeroArt.tsx` — new; extracted markup + rotation
- `client/src/lib/useHeroPool.ts` — new; fetch hook
- `client/src/pages/Home.tsx` — hero art column swaps to `<HeroArt />`
- `client/src/components/__tests__/HeroArt.test.tsx` — new
- `client/src/pages/__tests__/Home.test.tsx` — existing hero pins stay green
- `e2e/tests/hero-rotation.spec.ts` — new

## Why the pool ships alone

Confirming #127's sequencing, and adding the reason it does not give:

1. **The pool is the fallback path the personalised version needs anyway.** Population 1
   still needs something to show a signed-in reader with zero books, and something to show
   before their fetch resolves. That is this.
2. **It has no consent surface**, so it can land while the consent question is still being
   designed rather than being blocked on it.
3. **The delivery decision, the rotation component, the a11y rule, and the CLS-safe
   layering are all shared** and land once, here.
4. **The reason #127 does not state: population 1 is blocked on a decision this spec
   refuses to make.** A reader's own art is a 2.2 MB PNG under `/illustrations/`, generated
   at runtime, with no derived variant and no human in the loop to run a derive script.
   Personalisation therefore requires **server-side derivation at image-write time** — a
   native `sharp` install on the server, on Render, which is a new dependency and a
   CLAUDE.md size-gate item needing its own spec and its own confirmation. Bolting that
   onto this branch would smuggle a significant infrastructure decision in behind a
   front-page nicety.

The follow-on spec is `hero-personal`. Its seam is already cut: a second route under
`/api/hero`, a `source: 'personal'` literal, a frame list that joins the same rotation
queue late, and `HERO_POOL_WHERE` untouched.

## Alternatives considered

### More bundled frames under a raised budget

**Pros:** no server involvement at all; keeps every ADR-014 property with zero new
machinery; works offline and with the backend down.
**Cons:** the arithmetic does not close. The 960 variant is 140.9 KB at q=72 with 9.4 KB
of headroom; a 640 px frame lands near ~62 KB and still reads soft on a 2x display in a
440 CSS px box. Four frames at hero quality is ~680 KB against a 200 KB directory cap, so
adopting it means roughly quadrupling the one guard that stops a raw PNG landing above the
fold — and every byte ships to every visitor whether they stay for the rotation or not.
**Why rejected:** it spends the LCP guard to buy variety, which is the wrong trade for a
decorative feature. Note the *hybrid* keeps the good half of this option: frame 0 is still
bundled and still budgeted.

### A build step / Vite image plugin deriving frames from the source PNGs

**Pros:** no committed binaries; reproducible in CI; the source set is the source of truth.
**Cons:** a new dependency, a config surface, and per-CI-run cost — the exact thing ADR-014
rejected. It also makes the bytes invisible to review, which is what the budget test exists
to prevent.
**Held as upgrade path:** ADR-014 said to revisit "if the source set grows past a handful
of images". At ≤5 curated frames it has not. The derive *script* is the middle step: the
loop without the pipeline.

### Serving the existing `/illustrations/*.png` directly and resizing in CSS

**Pros:** zero derivation, zero new artifacts, works today.
**Cons:** ~2.2 MB per frame, ~11 MB for a full cycle, on the marketing page, much of it on
mobile data. Every frame decodes at 1024 px to display at 440.
**Why rejected:** it is the LCP regression ADR-014 exists to prevent, just moved below the
fold in time instead of in space.

### Server-side on-demand derivation (`sharp` on Render, or a resize query param)

**Pros:** any book becomes poolable the moment it is flagged; the only design that scales
to population 1.
**Cons:** a native dependency on a free-tier Render instance, a cache directory, a cold-start
CPU cost on the request that renders the front page, and a CLAUDE.md size-gate confirmation.
**Held as upgrade path — and it is the gate on population 1.** Recorded here so the next
spec starts from a stated position rather than re-deriving it.

### A manifest file (`server/public/hero/manifest.json`) instead of a DB flag

**Pros:** no migration, no schema, no admin route; artifact and metadata are one source of
truth; trivially cacheable.
**Cons:** no runtime withdrawal lever — pulling a frame down requires a deploy — and the
pool has no connection to the catalog it claims to be a best-of *of*.
**Why rejected:** the withdrawal lever is the one operationally serious property here, and
#127 explicitly asks for an editorial flag on the catalog. Noted as the cheaper shape if
the DB half ever proves to be dead weight.

### Popularity derived from `OrderItem` / cart adds

**Pros:** evidence rather than taste; self-updating.
**Cons:** ranks an empty set today (no order history), is gameable by the ranked party once
there is one, and has a cold-start problem for exactly the new books most worth showing.
**Held as upgrade path:** the response is already an ordered list, so adopting an ordering
signal later changes the resolver and nothing else — no wire-shape change, no client change.

### Letting the visible frame own the accessible name

**Pros:** the alt always describes what is on screen — the a11y-correct answer.
**Cons:** three pinned `/bench/i` selectors across the client and e2e suites become
non-deterministic the moment the pool is non-empty, and the "which img is named" invariant
becomes timing-dependent in every future hero test.
**Why rejected for v1:** decorative rotation with no caption does not carry information the
page needs. Revisit *together with* attribution — the two are the same change.

## Success criteria

- `client/src/assets/hero/` is **byte-identical to `master`**, and
  `client/src/__tests__/heroAsset.test.ts` is unmodified and green.
- `GET /api/hero/pool` returns `{ frames: [...] }` matching `HeroPoolResponseSchema`, with
  every field pinned by `toMatchObject` in `server/src/routes/__tests__/hero.test.ts`.
- **Consent seam, asserted:** (a) the pool response is byte-identical with no auth header,
  with a normal user's token, and with an admin's token; (b) a published book with
  `is_hero_eligible: true` and `hero_consent_at: null` never appears; (c) a draft or
  soft-deleted book never appears; (d) `grep -n 'getAuthUser' server/src/routes/hero.ts`
  returns nothing.
- On a fresh `npm run db:reset && npm run db:hydrate`, the pool returns **≥ 2 frames** from
  the demo book — i.e. the feature demonstrably works on a clean machine.
- `server/src/__tests__/heroFrameAssets.test.ts` fails on any `.png` under
  `server/public/hero/`, any file over 150 KB, or a directory total over 1 MB.
- The hero renders frame 0 with `fetchpriority="high"`, `width`/`height` `960`, no
  `loading="lazy"`, and `sizes="(min-width: 1024px) 440px, 300px"` — the existing pins in
  `Home.test.tsx` pass **unmodified**.
- With the pool fetch mocked to reject, to hang, and to return `[]`, `HeroArt` renders
  frame 0 and never a blank box (three separate unit tests).
- With `prefers-reduced-motion: reduce`, no rotation occurs and no crossfade class is
  applied.
- Exactly one `<img>` inside the hero has a non-empty accessible name at all times,
  asserted after a simulated rotation.
- `e2e/tests/hero-rotation.spec.ts` observes the rotating layer's `src` change to a
  `/hero/` path while the hero box's bounding rect is unchanged (zero CLS, measured).
- Existing hero specs pass untouched: `e2e/tests/home.spec.ts`,
  `e2e/tests/mobile/hero.spec.ts`, `e2e/tests/dark-mode.spec.ts`.
- `git diff master...HEAD -- '**/package.json' '**/package-lock.json'` is empty.
- Server, client, e2e, and root suites green; `npx tsc --noEmit` clean in `client/` and
  `server/`.
- Human sign-off on the aesthetic half of done-criterion #2: the rotation watched through a
  full cycle in both themes.

## Out of scope

- **Population 1, the personalised hero.** Separate spec (`hero-personal`), blocked on the
  server-side derivation decision. **#127 stays open when this merges.**
- **Any API that writes `hero_consent_at`.** The column ships with no writer but the seed —
  that is the seam, not an oversight.
- **The Admin UI toggle.** The endpoint ships (it is the withdrawal lever); the button does
  not. A UI switch that appears to add a book to the hero while the derive step is still
  outstanding is a worse experience than no switch. Revisit with the derive step.
- **Attribution / a credit line under the hero.** `book_id` and `book_title` are on the
  wire so it can be added without a schema change, but adding it changes the a11y answer
  (§Alternatives) and is its own decision.
- **Rotation controls** — dots, arrows, pause. Decorative rotation, not a carousel.
- **PWA runtime caching for `/hero/*`.** Pool frames are cross-origin in production and
  cannot be precached from the client build. Frame 0 remains precached, so offline is
  unchanged from today.
- **AVIF variants.** Still deferred (ADR-014). The new byte-budget test's extension list is
  written so adding `avif` needs no test surgery.
- **Any change to `client/src/assets/hero/`, its budget test, or the bundled frame's
  markup attributes.**
- **Popularity-derived ordering** (order counts, cart adds).

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| **Wire-shape (OPS.3)** — a new public route and a new admin route | `shared/src/hero.ts` + the admin pair; `validate({ request, response })` on both; every response field pinned by `toMatchObject` in the Supertest tests. Named in `tasks.md` §Cross-cutting so Check 4 has the schema names. |
| **A reader's art reaches the pool** | Four seams: no writer for `hero_consent_at`; single `HERO_POOL_WHERE`; `source: z.literal('pool')` in the schema (a `'personal'` frame 500s in dev); and the auth-invariance test. All four must be defeated at once. |
| **Prisma / migration** | Two additive columns (one defaulted boolean, one nullable datetime), one new migration `add-hero-eligibility-and-consent`. No column dropped or retyped; existing rows default to not-eligible and not-consented, so the pool is empty until deliberately populated. Never edit a committed migration. |
| **Seed-shape change (CLAUDE.md guardrail)** | `spot-for-sunny.json` gains two keys. Additive and optional; `db:hydrate` is upsert-only, so no cart or order is invalidated. **The developer must surface this to the user before Task 2 rather than assuming it is covered.** |
| **Byte budget quietly leaks into the bundle** | `client/src/assets/hero/` must be byte-identical to `master` — stated as a success criterion and trivially checked with `git diff --stat master...HEAD -- client/src/assets/hero/`. |
| **A raw PNG lands in the newly-served directory** | `heroFrameAssets.test.ts` mirrors `heroAsset.test.ts`: no `.png`, extension allowlist, 150 KB per file, 1 MB directory total, failure messages naming the file. Runs in `cd server && npm test`, i.e. in CI. |
| **LCP regression** | Frame 0's `<img>`, its `src`, and its attributes are untouched; rotation only ever adds a sibling layer. The LCP candidate cannot change because the element that is it never changes. |
| **CLS regression** | Only `opacity` animates, inside a `relative aspect-square` box that already reserves height. No layout property is touched. Measured in the e2e spec by comparing the hero's bounding rect across a rotation. |
| **Signed-out flash / auth-gated first paint** | The hero never awaits auth or the pool. Frame 0 is synchronous. Asserted by the fetch-rejects / fetch-hangs unit tests. |
| **The three pinned `/bench/i` selectors go flaky** | Frame 0 keeps the accessible name for the whole session; rotating layers are `alt=""` + `aria-hidden`. Existing specs must pass **unmodified** — if one needs editing, the a11y rule was broken. |
| **Rotation burns mobile data** | One-ahead loading, suppressed under `saveData`, paused when the tab is hidden, capped at 5 frames. |
| **Dark-mode parity** | The mat, ring, and art column keep their existing `dark:` partners; the rotating layer adds no colour class. Any new chrome needs a `dark:` partner — `dark-mode-parity-check` runs on `/ship`. |
| **Server down / cold Render** | The pool fetch fails, rotation is suppressed, and the hero is exactly today's static hero. This is the designed degradation, and it is a unit test, not a hope. |
| **Flag set, artifact missing** | The resolver omits frames with no file; the admin toggle returns `hero_frames_available` so the operator sees `0`. Documented in `server/public/hero/README.md`. |
| **New dependency** | None. Derivation is `npx -y sharp-cli` from the npx cache. Server-side `sharp` is explicitly out of scope and is the named gate on population 1. |
| **Paid APIs / spend exposure** | **None.** No Claude call, no image generation, no `spendGate`, no `UsageLog`. `GET /api/hero/pool` is public but read-only over flags and `stat` calls, capped at 5 frames, and cached for 300 s. Stated so the reviewer does not have to infer it. |
| **Auth / session** | The cart-session UUID model is untouched. The admin route follows `adminGate → validate → handler`; the pool route has no auth middleware **on purpose**, which is itself pinned by the auth-invariance test. |

## ADR-worthy decisions

- [ ] **ADR-015 — Hero rotation delivery and the eligibility signal.** Frame 0 stays a
  bundled, byte-budgeted artifact and is never mutated; rotation frames are derived,
  committed, byte-budgeted WebPs served from `server/public/hero/` behind
  `GET /api/hero/pool`; the derivation command becomes a script but not a pipeline; the
  best-of signal is an admin-set `is_hero_eligible` flag with per-book and total frame
  caps. Records the arithmetic that killed the all-bundled option and the rejected
  alternatives above. Write via `/create-adr` after spec approval.
- [ ] **ADR-016 — Whose art may appear in the hero pool.** The consent seam: editorial
  eligibility and promotional consent are different columns with different writers; no API
  writes `hero_consent_at`; `HERO_POOL_WHERE` is the single expression; the wire shape
  carries a `source` literal; the pool response is auth-invariant by test. *May be folded
  into ADR-015 as a grouped decision set per the ADR-014 precedent — but it is listed
  separately because a future spec will deliberately extend it, and a policy that will be
  amended is easier to find under its own heading.*
- [ ] **Deferred: population 1 (the personalised hero).** #127 remains open after this
  merges; the follow-on needs either its own child issue or an explicit note on #127.
  Blocked on the server-side derivation decision recorded in §Alternatives.
- [ ] **Deferred: the Admin UI toggle.** Endpoint ships, button does not. Reopen trigger:
  the derive step becoming automatic, at which point the switch tells the truth.
- [ ] **Deferred: attribution / credit line**, and with it the "visible frame owns the
  accessible name" a11y upgrade. The two are one change.
- [ ] **Accepted cost: rotating frames are `aria-hidden` decorative.** Recorded rather than
  left implicit, because it is a deliberate a11y trade made to keep three pinned selectors
  deterministic.
- [ ] **Deferred: popularity-derived ordering** (order counts / cart adds). No wire-shape
  change needed to adopt later.
- [ ] **Deferred: PWA runtime caching for `/hero/*`.** Frame 0's precache is unchanged.
