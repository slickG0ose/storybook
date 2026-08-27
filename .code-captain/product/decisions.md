# Product & Technical Decisions Log

Append-only log. Newest entries on top. Each entry should answer: *what was decided, when, why, and what we considered instead.*

---

## ADR-016 — Whose art may appear in the hero pool: editorial eligibility and owner consent are separate columns with separate writers

**Date:** 2026-08-26
**Status:** Accepted
**Scope:** `hero-rotation` Tasks 2, 4, 5. Spec at [.code-captain/specs/hero-rotation/spec.md](../specs/hero-rotation/spec.md) §"The consent seam", plan at [tasks.md](../specs/hero-rotation/tasks.md). Population 2 of [#127](https://github.com/slickG0ose/storybook/issues/127); **#127 stays open.** Paired with **ADR-015** below, which covers delivery and the eligibility signal.

### The problem

A "best-of pool from the catalog" has no catalog art to draw on. Verified against `dev.db` and disk on 2026-08-26: the six canonical seed books have **zero** illustrations, and every one of the 19 PNGs on disk belongs to a user-created book (`is_user_created: true`, `created_by` = the seeded demo admin). The feature is built on user-created work from its first commit.

So the usual shortcut — "it's our own seed data, consent is implied" — is not available. Putting a reader's art on the front page is promotional publishing, and it must not become one code path with "a reader viewing their own art", by accident or by a handler that forgot.

### Decision

**Eligibility and consent are two columns, written by two different actors, and this spec ships a writer for only one of them.**

```prisma
model Book {
  // Editorial: "this is good enough for the front page." Admin-writable.
  is_hero_eligible Boolean   @default(false)
  // Permission for promotional display outside this book's own detail page.
  // NO API writes this column.
  hero_consent_at  DateTime?
}
```

Five seams, all mechanical, all of which must be defeated at once for a stranger's art to reach the pool:

**1. No API writes `hero_consent_at`.** The only writer in the tree is the demo-seed fixture `server/prisma/demo-seed-fixtures/spot-for-sunny.json` — the operator consenting to the operator's own demo book. To place anyone else's art in the pool today, an admin would have to write raw SQL.

**2. The admin route deliberately does not write it, and a test re-reads the row to prove it.** `PUT /api/admin/books/:id/hero-eligible` sets the editorial flag and nothing else; `server/src/routes/__tests__/admin.test.ts` ("does not write hero_consent_at when flagging a book eligible") reads `hero_consent_at` before and after the toggle and asserts null both times. The assertion lives where the temptation lives.

**3. One `where` fragment.** `HERO_POOL_WHERE` in `server/src/lib/heroPool.ts` is the single expression of pool eligibility — `{ deleted_at: null, status: 'published', is_hero_eligible: true, hero_consent_at: { not: null } }` — mirroring `AVAILABLE_BOOK_WHERE`. No route writes its own version.

**4. The wire shape cannot carry a personal frame.** `HeroFrameSchema.source` is `z.literal('pool')`. A personal frame will carry `source: 'personal'` under a different response schema, so a `'personal'` frame emitted from the pool route fails `validate()` loudly rather than shipping. The discriminator looks like dead weight in a single-source world; it is the thing that makes the mistake fail at test time.

**5. `GET /api/hero/pool` has no auth middleware and never calls `getAuthUser` — and the absence is pinned.** The route mounts `validate({ response })` only, and its handler takes `_req`. `hero.test.ts` asserts the same GET returns **byte-identical JSON** with no token, with a normal user's bearer token, and with an admin's; the task's done-when adds `grep -n 'getAuthUser' server/src/routes/hero.ts` returning nothing. The explanatory comment in `routes/hero.ts` is deliberately phrased *around* the identifier so the grep stays a real check rather than matching prose. The moment someone personalises this route, the invariance test goes red.

### Why

- **Consent is the starting state here, not an edge case.** With no catalog art at all, any predicate that tried to sidestep consent would either empty the pool or quietly promote user work.
- **Admin authority and owner permission are different keys.** An admin saying "this is good" is a quality judgment. Only the owner can say "you may show this to strangers." One column each keeps them un-conflatable.
- **Seams that are only prose get crossed.** Each of the five is either a type, a `where` fragment, or an assertion; none of them relies on the next reader having read this ADR.
- **The follow-on spec is already cut against this.** `hero-personal` adds a second route under `/api/hero`, a `source: 'personal'` literal, and frames that join the rotation late. `HERO_POOL_WHERE` does not relax.

### Alternative considered: one column — admin flag only, consent implied by the admin action

Ship `is_hero_eligible` alone and treat an admin flagging a book as sufficient authority to display it.

Rejected because it is exactly the conflation the feature needs to avoid, and it is unrecoverable after the fact: once the flag means both things, there is no way to distinguish "an admin thought this was good" from "the owner agreed to promotion" in existing rows. A nullable timestamp column that nothing writes costs one migration and buys the distinction permanently.

### Alternative considered: derive consent from provenance — `is_user_created: false` or `created_by: null`

Use "the operator made it" as a proxy for "we may promote it."

Rejected on fact: it empties the pool on day one. "A Spot for Sunny" is `is_user_created: true` with `created_by` set to the seeded demo admin, so a provenance predicate excludes the only publishable illustrated book in the database. It also encodes "we only ever promote our own work" as an accident of how the seed happens to be written, rather than as a decision anyone made.

### Alternative considered: folding this into ADR-015 as a grouped decision set

The ADR-004/006/007/008/010/011/012/014 precedent is to group coupled decisions under one entry, and delivery and consent shipped in one PR.

**Declined, and the spec's own reasoning is why:** `hero-personal` will deliberately *extend* this policy, and a policy that is going to be amended is easier to find under its own heading than as decision 8 of an entry titled "delivery". ADR-015 groups decisions that were all answers to the same question (how do N frames reach the page); consent is a different question that happened to arrive in the same PR.

### Consequences

- **Deferred: population 1, the personalised hero.** #127 remains open when this merges — it covers two populations and this PR ships one. Blocked on the server-side derivation decision recorded in ADR-015's alternatives (a native `sharp` install on Render is a CLAUDE.md size-gate item needing its own spec and its own confirmation). Follow-on spec slug: `hero-personal`.
- **Consent has no UI and no writer, on purpose.** When it is designed, the change is an owner-only route plus a surface that states plainly what opting in means. Until then the column reads as an unused field; the comment on it in `schema.prisma` and the doc comment on `HERO_POOL_WHERE` both say why, so it survives a tidy-up pass.
- **Withdrawal is asymmetric today.** Un-flagging a book removes its frames from the pool immediately, end-to-end tested. *Withdrawing consent* has no runtime lever — it needs raw SQL. Accepted while there is exactly one consenting book and its owner is the operator; it becomes a real gap the moment a second party consents, which cannot happen without the owner-only route above.
- **`hero_frames_available` on the admin response is consent-blind and uncapped by design.** It counts derived artifacts on disk, ignoring `HERO_POOL_WHERE` and `MAX_FRAMES_PER_BOOK`, because reporting the pool count would answer `0` both for an underived book and for a consented-but-draft one — collapsing the one distinction the number exists to make. Rationale is on the helper in `server/src/lib/heroPool.ts`, not only here.
- **The admin list shows editorial state only.** `AdminBookListItemSchema` gains `is_hero_eligible`; nothing surfaces `hero_consent_at`, and `BookSchema` gains neither — the storefront has no business reading an editorial flag.
- **Known and accepted: both new columns ride along on the public `GET /api/books` wire.** `hydrateBook` spreads the whole Prisma row and `validate()` does not strip unknown keys — it calls `originalJson` with the untouched object — so `is_hero_eligible` *and* `hero_consent_at` reach an unauthenticated response even though `BookSchema` pins neither. Harmless today: the only consenting book is the operator's own demo book and its timestamp is a seeded constant. It stops being harmless the moment `hero-personal` adds a writer, at which point every reader's promotional-consent decision would be publicly readable from the catalog endpoint as a side effect of a spread nobody is looking at. **`hero-personal` must strip `hero_consent_at` from the public book wire in the same change that gives the column a writer** — not as cleanup afterwards. Flagged by the pre-merge reviewer on the hero-rotation PR and recorded here rather than fixed there, because the fix belongs with the writer.

---

## ADR-015 — Hero rotation delivery: frame 0 stays bundled, rotation frames are served artifacts behind an admin-set eligibility flag

**Date:** 2026-08-26
**Status:** Accepted
**Scope:** `hero-rotation` Tasks 1-10. Spec at [.code-captain/specs/hero-rotation/spec.md](../specs/hero-rotation/spec.md), plan at [tasks.md](../specs/hero-rotation/tasks.md). Population 2 of [#127](https://github.com/slickG0ose/storybook/issues/127) — the best-of pool; **#127 stays open** for population 1. Extends **ADR-014**; the consent half is **ADR-016** above rather than a decision in this entry.

### The problem

ADR-014's delivery decision does not survive contact with N frames. It bundled the hero because a bundled asset renders with the backend cold or down, and it capped `client/src/assets/hero/` at 200 KB because a 2.2 MB PNG above the fold destroys LCP. The single shipped frame is already 140.9 KB of that 200 KB. Four bundled frames at hero quality is roughly 680 KB. **Bundling the rotation set is arithmetically dead** — adopting it means roughly quadrupling the one guard that stops a raw PNG landing above the fold, and shipping every rotation byte to every visitor whether they stay for the rotation or not.

### Decision

Seven coupled decisions, captured as a set per the ADR-004/006/007/008/010/011/012/014 grouped precedent.

**1. Split the budget by frame role.** The two constraints — "never depend on the API for first paint" and "never grow the bundle" — apply to *different frames*, and that is the way out. **Frame 0 is untouched**: same two committed WebPs, same `fetchPriority="high"`, same `sizes`, same byte test, same offline precache, and its `<img>` is never re-`src`ed by rotation. **Frames 1..N are progressive enhancement** — also derived, committed, byte-budgeted WebPs, but living under `server/public/hero/` and served by `express.static` at `/hero`, fetched after first paint from `GET /api/hero/pool`. `client/src/assets/hero/` gains nothing, so `heroAsset.test.ts` stays byte-for-byte as ADR-014 wrote it.

Not more bundled frames, not a build step, and not live user art over the API: **derived-and-committed artifacts, delivered over HTTP instead of through Vite, gated behind first paint.**

**2. The served set gets its own budget test, capped at 400 KB — not 1 MB.** `server/src/__tests__/heroFrameAssets.test.ts` mirrors `heroAsset.test.ts`: no `.png` at all, an extension allowlist, 150 KB per file, 400 KB for the directory, failure messages naming the file and its size. Shipped state is 275,880 bytes across four images plus a 10.3 KB README. The owner's ruling on the number: *a cap permitting five frames when two ship is decoration, not a guard* — the hero-visual budget test earned its keep by sitting close enough to bite. Raise it deliberately, in the same commit that adds the third frame.

**3. The derivation command grows a loop, not a pipeline.** `server/scripts/derive-hero-frames.sh` wraps ADR-014's `npx -y sharp-cli` invocation. It stays out of CI and out of the build, still emits committed artifacts, and adds nothing to any `package.json` or lockfile. ADR-014 named automating this as the first thing to revisit once "the source set grows past a handful of images"; at four files it has not.

**4. A pool frame may only come from a URL the seed fixture actually points at.** Page 5 ships derived from `page-5.png`, **not** `page-5-v3.png`, even though the spec's open-question resolution originally named `-v3`. `spot-for-sunny.json` points page 5 at `page-5.png`, and a hero frame that is not in the book it advertises is a small lie. Both were rendered and compared: same scene, same cast, same style — v3 adds Sunny's backpack and reframes the tree. The `-v4` revision remains the trap ADR-014 flagged (it renders Sunny as a golden retriever). Frame choice is page 1 and page 5; `page-3-v2` was rejected rather than merely unchosen, as a single centred figure that reads at hero scale as "sad kid alone".

**5. The best-of signal is an admin-set boolean plus two caps.** `Book.is_hero_eligible Boolean @default(false)`, and that is the whole signal — there are no orders and no cart history, so a computed popularity signal would rank an empty set today. **Frames, not books, are the unit:** `MAX_FRAMES_PER_BOOK = 2` and `MAX_POOL_FRAMES = 5`, so one book cannot monopolise the rotation as the catalog grows while today's single demo book still yields real rotation.

**6. A frame exists only if its derived artifact exists.** The resolver `stat`s `server/public/hero/<book_id>/p<n>-960.webp` and silently omits frames with no file, so setting the flag without running the derive script does nothing visible. That is why the admin toggle's response carries `hero_frames_available`: `0` tells the operator the artifact step is outstanding.

**7. `GET /api/hero/pool` sets `Cache-Control: public, max-age=300`, and this is a new precedent in this codebase — recorded deliberately.** **No other route here sets a cache header.** It was accepted with eyes open, justified by the cold-Render case the whole split-budget design exists to survive: the pool list is identical for every visitor, changes only when an operator flags a book, and asking a sleeping free-tier instance for the same five-item list once per visitor is the cost this design is trying not to pay. Recorded here so the precedent is *discoverable rather than incidental* — the next route that wants a cache header should point at this decision or argue with it, not rediscover the question.

### Why

- **LCP and CLS are still the whole point.** The LCP candidate cannot regress because the element that *is* the LCP candidate never changes. Only `opacity` animates, inside a `relative aspect-square` box that already reserves height, so CLS is zero by construction and merely confirmed by measurement.
- **The designed degradation is today's hero.** Fetch fails, empty pool, `prefers-reduced-motion: reduce`, or `navigator.connection?.saveData` — all four suppress rotation and leave frame 0. With the backend down, offline, or JS disabled, the hero is exactly what shipped in ADR-014. That is three unit tests, not a hope.
- **Committed bytes stay reviewable.** A build step would make the hero's bytes invisible to review, which is the regression the budget test exists to catch loudly. Two directories, two tests, same discipline.
- **The flag is honest about being taste, not evidence.** It goes stale silently and does not scale past an operator who can hold the catalog in their head. The upgrade path needs no wire-shape change, because the response is already an ordered list.

### Alternative considered: more bundled frames under a raised budget

Keep every ADR-014 property with zero new machinery — no server involvement, works offline and with the backend down.

**Rejected on arithmetic.** The 960 variant is 140.9 KB at q=72 with 9.4 KB of headroom; a 640 px frame lands near 62 KB and still reads soft on a 2x display in a 440 CSS px box. Four frames at hero quality is ~680 KB against a 200 KB directory cap. Adopting it spends the LCP guard to buy variety, for a decorative feature. The hybrid keeps the good half of this option: frame 0 is still bundled and still budgeted.

### Alternative considered: a build step or Vite image plugin deriving frames from the source PNGs

No committed binaries, reproducible in CI, the source set as the source of truth.

Rejected for the same reason ADR-014 rejected it, at four files instead of one: a new dependency, a config surface, per-CI-run cost forever, and bytes that stop being visible in review. **Held as the upgrade path** — the derive *script* is the middle step, the loop without the pipeline. Revisit when the frame set outgrows hand-curation.

### Alternative considered: server-side on-demand derivation (`sharp` on Render, or a resize query param)

Any book becomes poolable the moment it is flagged; the only design that scales to population 1.

Rejected here, but **this is the gate on population 1, not a dead end.** It means a native dependency on a free-tier Render instance, a cache directory, and cold-start CPU on the request that renders the front page — a CLAUDE.md size-gate item needing its own confirmation. Bolting it onto this branch would smuggle a significant infrastructure decision in behind a front-page nicety. Recorded so `hero-personal` starts from a stated position rather than re-deriving it.

### Also rejected, with reasoning in spec §Alternatives

- **Serving the existing `/illustrations/*.png` directly and resizing in CSS** — ~2.2 MB per frame, ~11 MB for a full cycle, much of it on mobile data. It is the LCP regression ADR-014 exists to prevent, moved below the fold in time rather than in space.
- **A `manifest.json` beside the artifacts instead of a DB flag** — cheaper (no migration, no admin route), but it has no runtime withdrawal lever: pulling a frame down would require a deploy. The withdrawal lever is the one operationally serious property here.
- **Popularity derived from `OrderItem` / cart adds** — ranks an empty set today, is gameable once there is data, and cold-starts against exactly the new books most worth showing.

### Consequences

- **Accepted cost: rotating frames are `aria-hidden` decorative.** Frame 0 keeps the accessible name for the whole session; every rotating layer is `alt=""` + `aria-hidden="true"`, so exactly one `<img>` in the hero is ever named. A screen-reader user gets frame 0's description while a different frame is on screen. Recorded rather than left implicit because it is a deliberate a11y trade, made to keep three pinned `/bench/i` selectors deterministic (`client/src/pages/__tests__/Home.test.tsx:190`, `e2e/tests/home.spec.ts:17`, `e2e/tests/mobile/hero.spec.ts:30`). It is defensible only while the rotation is decorative variety with no caption, no link, and no information the page needs — **it stops being defensible the moment attribution is added.**
- **Deferred: attribution / a credit line under the hero, and with it the "visible frame owns the accessible name" a11y upgrade.** `book_id` and `book_title` are already on the wire so it needs no schema change, but the two are one change: the moment the hero credits a book, the visible frame is carrying information and must own the name — which makes the three pinned selectors timing-dependent and needs them rewritten deliberately, not incidentally. Reopen trigger: anyone asking the hero to say which book a frame came from.
- **Deferred: the Admin UI toggle.** The endpoint ships (it is the withdrawal lever); the button does not. A switch that appears to add a book to the hero while the derive step is still outstanding is a worse experience than no switch. Reopen trigger: derivation becoming automatic, at which point the switch tells the truth.
- **Deferred: popularity-derived ordering** (order counts, cart adds), with the flag demoted to an override. Reopen trigger: real order history. Adopting it changes `resolveHeroPool`'s ordering and nothing else — no wire-shape change, no client change — because the response is already an ordered list.
- **Deferred: PWA runtime caching for `/hero/*`.** Pool frames are cross-origin in production (`VITE_API_BASE_URL` points at Render while the client ships from GitHub Pages) and cannot be precached from the client build. Frame 0 stays precached, so offline behaviour is unchanged from ADR-014. Reopen trigger: same-origin hosting, or a deliberate runtime-caching strategy in `client/pwa.config.ts`.
- **Ordering must be deterministic for the cache header to be honest.** The resolver orders by book `created_at` asc **then `id` asc** — SQLite stores millisecond resolution and one seed run can write two books in the same millisecond, so without the tiebreak the "deterministic ordering" that justifies `max-age=300` is not actually deterministic.
- **`.gitignore` was silently swallowing `server/public/hero/`.** `server/public/*` is ignored wholesale — correctly, since it otherwise holds runtime-generated uploads and illustrations. The derived frames were untracked and would have shipped as a 404 in CI and in production. The directory is now re-included with an explanatory comment. Anything else added under `server/public/` that is meant to be committed needs the same treatment.
- **Serving instead of bundling means dev needs a proxy entry.** `/hero` was added to `client/vite.config.ts`'s proxy table beside `/illustrations`; without it, every rotating frame in local dev loads Vite's `index.html`, fires `onerror`, and is skipped — the rotation would be invisible in dev and in the e2e run while passing every unit test.
- **The migration is a `RedefineTables` block, not `ALTER TABLE ADD COLUMN`.** Prisma's SQLite connector emits create-copy-drop-rename for this column pair. The generated SQL was kept unedited and is data-preserving, but it means the "additive migrations are trivially safe" intuition does not read off the SQL here — review the generated file rather than assuming.
- **`AdminBookListItemSchema`'s new field had to land with the Prisma column, not with the other schemas.** It is a *required* field on a `validate()`-checked response, so adding it a task early makes `GET /api/admin/books` return a hard 500 rather than a soft mismatch. Worth remembering as the general rule: a required field on a validated response and the column that fills it are one commit.
- **`heroAsset.test.ts` and `client/src/assets/hero/` are byte-identical to master.** That is a success criterion, not a side effect — `git diff --stat origin/master...HEAD -- client/src/assets/hero/ ':!*.md'` is empty.

---

## ADR-014 — Hero art is a committed, byte-budgeted WebP derived from a seeded book page at native 1:1

**Date:** 2026-08-26
**Status:** Accepted
**Scope:** `hero-visual` Tasks 1-8. Spec at [.code-captain/specs/hero-visual/spec.md](../specs/hero-visual/spec.md), plan at [tasks.md](../specs/hero-visual/tasks.md). Closes [#125](https://github.com/slickG0ose/storybook/issues/125) and [#118](https://github.com/slickG0ose/storybook/issues/118). Related: [#127](https://github.com/slickG0ose/storybook/issues/127) (rotate the hero art), [#126](https://github.com/slickG0ose/storybook/issues/126) (self-host webfonts, same LCP budget).

### The problem

The Home hero was a headline, a line of subtext, and a CTA over two radial gradients. We sell illustrated books and the first screen showed no illustration. #118 asked separately whether to break the hero's centre-symmetry; that question had no good answer while the hero was text-only, because a centred column is the correct layout for centred text. Adding a visual is what makes the asymmetry decision meaningful, so both issues are discharged by one change.

### Decision

Six coupled decisions, captured as a set per the ADR-004/006/007/008/010/011/012 grouped precedent.

**1. The art is a committed artifact, not a build step.** Derivation ran once by hand; the outputs are in the tree. A build step means a dependency, a config surface, and a per-CI-run cost for a single image that changes approximately never. The exact command is recorded in `client/src/assets/hero/README.md` so it is reproducible without being automated.

**2. No new dependency — and the `npx` path is load-bearing, not incidental.** There is no WebP *encoder* on this machine: `sips` reads WebP but its `--formats` table shows it without the `Writable` flag, and there is no `cwebp`, ImageMagick, or `sharp` anywhere. Derivation runs through `npx -y sharp-cli`, which executes from the npx cache and puts nothing in `package.json` or the lockfile. The named fallback was `sips -s format jpeg`, acceptable only inside the byte budget; it was not needed. `git diff master...HEAD -- '**/package.json' '**/package-lock.json'` is empty.

**3. The byte budget is enforced by a test, not by discipline.** `client/src/__tests__/heroAsset.test.ts` walks `client/src/assets/hero/` recursively and fails if any single file exceeds 150 KB, if the directory total exceeds 200 KB, or if any `.png` appears at all. The source PNGs are ~2.2 MB; the PNG rule is the one assertion that stops someone dropping a source file into the folder and wrecking LCP above the fold. Failure messages name the offending file and its size. Shipped state: 140.9 KB + 28.9 KB + a 4.3 KB README = 174.0 KB.

**4. `client/src/assets/`, not `client/public/`.** Files in `public/` ship unhashed and are referenced by literal path — a cache-busting hazard that also interacts badly with the `VITE_BASE_PATH=/storybook/` GitHub Pages deploy. Importing through Vite gets content-hashing and base-prefixing for free. Both variants are far above `assetsInlineLimit`, so they emit as real files rather than data URIs (verified in the build output).

**5. Bundled, not served from `/illustrations/`.** The server is Render and is currently not up (see [docs/deploy-spike-render.md](../../docs/deploy-spike-render.md)). A hero sourced over the API is a broken box whenever the backend is cold or down. A bundled asset renders regardless. `client/pwa.config.ts` now precaches `webp`, so it also survives offline — verified by grepping `client/dist/sw.js` for both variants in the precache manifest.

**6. Native 1:1, no crop — and this lock is for #127's benefit.** Every illustration this product emits is 1024x1024. Locking the hero frame to 1:1 means #127 can swap any book page in without re-deciding aspect ratio or re-cropping. A landscape crop would also leave dead space beside a text column that is much taller than 4:3 at these type sizes.

### Why

- **LCP is the whole point.** The hero is above the fold. Everything above — the budget, the test that enforces it, the format, the two-variant `srcSet` — exists to add a subject to the hero without paying for it in first paint. #126 protects the same budget from the font side.
- **The product should show its own output.** Sourcing from a seeded book rather than generating a new asset is cheaper, spends nothing against the illustration quota, and is honest about what the product actually produces. It also avoids pinning the hero to whichever image model happened to make it — the drift problem ADR-013 exists to fix.
- **A single image does not justify a pipeline.** Adding a build step, a dependency, and a CI cost to process one file that changes approximately never is the wrong shape of solution.

### The frame chosen, and the one that is a trap

`page-4-v2.png` from "A Spot for Sunny" — Mira and Sunny on the bench. It reads as a story rather than a portrait, and its two faces land at ~65 px at hero scale.

**`page-4-v4.png` is a trap and is called out here because the highest version number looks like the safe pick.** It renders Sunny as a golden retriever — the exact defect the v2 feedback string in `spot-for-sunny.json` was written to correct. The `-v3`/`-v4` files are orphaned revisions the seed does not reference. `page-4-v2.png` is the canonical one.

The cover was rejected on composition, not on the lettering premise that was originally assumed: `cover.png` carries no title lettering. It loses on a single figure walking away from the viewer, the second character reduced to a background detail, and a near-monochrome yellow field that would put a large amber wash beside amber brand chrome.

### Alternative considered: a Vite image plugin or a `sharp` build step

Derive at build time from the source PNG, so the committed tree holds no binary artifact and the derivation is reproducible in CI rather than by a documented command.

Rejected on cost-to-benefit for a single file. It adds a dependency to `client/package.json`, a config surface, and per-run CI time forever, to avoid committing 174 KB once. It would also make the hero's bytes invisible to review — a plugin quietly emitting a larger file on a version bump is exactly the regression the byte-budget test is designed to catch loudly. Revisit if the hero becomes dynamic under #127 and the source set grows past a handful of images, at which point the arithmetic flips.

### Alternative considered: a dark-mode brightness filter on the image

`dark:brightness-[0.92]` on the `<img>`, to take the edge off a bright square on a near-black ground.

**Considered against the real rendering and declined.** The mat wrapper (`bg-white dark:bg-gray-800 rounded-[24px] shadow-card` with a `gray-700` ring) already gives the bright square a mid-tone surround instead of a hard glare edge, and `--shadow-card` carries its own dark alphas. The repo owner reviewed both themes on a running dev server: it does not glare, but it is "pretty vivid and 'pops' a bit in dark mode", and "I wouldn't adjust it much if any."

Recording the verdict as "fine, slightly vivid" rather than "correct", because that is what it was. The knob is one class on the `<img>` in `client/src/pages/Home.tsx` and reverting costs nothing — a deliberately low bar to reopen.

### Consequences

- **Quality 72, not the spec's nominal 75, on the 960 variant.** At q=75 it encodes to 151,146 bytes — inside the 150 KB cap by ~2.4 KB. That is too little headroom for a ceiling a test pins exactly; a re-derivation on a different `sharp` build would flip the suite red for no real reason. q=72 costs nothing visible at the rendered size (440 CSS px, 880 px at 2x DPR) and buys ~9 KB. `--effort 6` is also set on both files: pure compression search, more CPU at derivation time, identical quality, zero runtime cost on a committed artifact. Without it, q=75 exceeded the cap outright.
- **`sizes` overstates the desktop render by 20 px.** It is pinned as `(min-width: 1024px) 440px, 300px`, but the image lays out at 420 CSS px at 1440 because `max-w-6xl` minus the gap minus the mat's padding lands at 420. Harmless — it only biases toward the larger candidate, which a 2x display picks anyway. Pinned verbatim in `Home.test.tsx` with a comment, so a future retune updates the pin rather than reading the red as a bug.
- **Hero section padding changed** from `py-20 sm:py-24` to `py-16 sm:py-20 lg:py-24`. With art added to the mobile stack the shorter small-screen padding is the sensible reading, but it is a real visual change beyond the art itself.
- **AVIF variants deferred.** Held as an upgrade path; the `webp`-only precache pattern and the extension-list assertion were both written so adding `avif` later needs no test surgery. Revisit under #127.
- **#118 needs no ADR of its own.** Its done criterion was "either a redesigned hero, or an ADR recording that the centred composition is intentional" — the redesign discharges it directly.
- **#127 inherits the 1:1 lock and the byte budget.** Rotation at N images means the per-file budget matters more, not less, and the derivation command in the README is the thing that would need automating first.

---

## ADR-013 — A book's art is pinned to the image model that made it; `IMAGE_PROVIDER` is only the default for books with no art

**Date:** 2026-08-23
**Status:** Accepted — mitigation A shipped; mitigation B (the Flux Kontext style anchor) deferred to a second PR, which amends this entry rather than opening ADR-014.
**Scope:** `reroll-style-consistency` Tasks 1–5 plus one follow-up fix. Spec at [.code-captain/specs/reroll-style-consistency/spec.md](../specs/reroll-style-consistency/spec.md), plan at [tasks.md](../specs/reroll-style-consistency/tasks.md). No backlog issue — reported by the repo owner in manual review of [PR #83](https://github.com/slickG0ose/storybook/pull/83). **Partially supersedes ADR-006 decision 2** (`IMAGE_PROVIDER` selects the generator) and depends on ADR-003 (Zod wire shapes). Related: [#91](https://github.com/slickG0ose/storybook/issues/91) (user-facing style override), [#62](https://github.com/slickG0ose/storybook/issues/62) (`FAL_KEY` unset in Render).

### The bug this exists to fix

Re-rolling a page illustration on "A Spot for Sunny" returned art that did not match the book. The tempting explanation — a missing style descriptor — was wrong, and worth naming so nobody re-derives it: `Book.style_descriptor` was stored correctly (*"Classic storybook illustration, soft ink outlines with watercolor washes…"*) and passed correctly to `generateIllustration`. The real cause is that **`style_descriptor` is a prompt string, not a style guarantee.** The book's pages were drawn on 2026-05-19 by OpenAI `gpt-image-1`; the re-rolls ran on 2026-08-23 against Fal Flux Pro 1.1, the default since [#60](https://github.com/slickG0ose/storybook/pull/60) merged on 2026-06-05. Same words, different model, visibly different art — flat colored-pencil watercolor became glossy digital painting with bloom lighting. Nothing in the schema recorded which model made a book's art, so every re-roll silently adopted whatever today's default was.

### Decision

Six coupled decisions, captured as a set per the ADR-004/006/007/008/010/011/012 grouped precedent.

1. **`Book.image_provider` + `Book.image_model` pin a book to the model that drew it, and the pin beats `IMAGE_PROVIDER`.** This is the partial supersession of ADR-006 decision 2: the env var no longer selects the generator for any book that has art. It degrades to *the default for books with no art yet*. **Trade-off:** an operator who flips `IMAGE_PROVIDER` will find it does nothing for existing books, which is surprising until you know why — hence the new section in [docs/conventions/server.md](../../docs/conventions/server.md).

2. **The pin is written lazily, on the first successful image — never at book creation.** The pin's job is to describe art that exists, not an intention. A book created before the cutover with `previewMode: 'text'` and first illustrated today should pin to *today's* provider, because it has no established style to match. Creation-time pinning would record the environment's mood at `INSERT` time and then strand that book on a provider its art never came from.

3. **Legacy books are back-filled by runtime inference with write-back, not by a data migration.** Order: earliest page-slot `IllustrationVersion.created_at` → oldest `page-*.png` mtime on disk → current environment default. Art dated before `PROVIDER_CUTOVER_AT` (2026-06-05, the merge of #60 in `1babb2d`) infers `openai`/`gpt-image-1`; on or after infers `fal`/`flux-pro/v1.1`. **Why not a migration:** for pre-`IllustrationVersion` books the only evidence is file mtimes, which SQL inside a Prisma migration cannot read, and `Book.created_at` as the SQL proxy would mis-pin *exactly the book that motivated this work* (created 2026-05-19, re-rolled 2026-08-23). A one-off script would have to be run on every environment and would silently skip any it missed. Runtime inference is self-healing and correct on first read. **Trade-off:** it is a heuristic, not a record. It is keyed on the earliest *art* timestamp, never on `Book.created_at`, and written back once so it cannot silently re-decide.

4. **Inference reads page slots only (`page_number < 1000`), and the pin is persisted only on evidence-based resolution or on the first successful image — never on an env-default resolution.** Both halves are load-bearing and both were verified by deliberately breaking them and watching named tests fail. The first stops a portrait drawn today from dragging a legacy book's pin forward. The second closes a defect found during implementation: persisting unconditionally meant a book with *no* art kept whatever `IMAGE_PROVIDER` happened to be when a request **failed** (501, 409, quota denial) — the "records an intention" failure of decision 2, re-entering through the back door and re-creating the original bug (pin `fal` on a denied request → operator switches to `openai` → openai draws the art → every later re-roll routes to `fal`).

5. **A book pinned to a provider this server has no key for returns 409 — never a silent fallback to the configured default.** 501 remains distinct and unchanged: nothing is configured at all. **A fix whose failure mode is the original bug is not a fix.** Given #62, the silent fallback would have been the *common* path in production, not an edge case. A 409 makes zero provider calls and writes zero `UsageLog` rows. **Trade-off, and it is a real one:** the moment #62 is fixed by setting `FAL_KEY`, every pre-cutover book flips from "re-rolls, wrong style" to "cannot re-roll at all", because they infer to `openai` and no `OPENAI_API_KEY` exists anywhere. That is the honest answer rather than the quiet-wrong one, and [#91](https://github.com/slickG0ose/storybook/issues/91) is the intended unblock.

6. **Spend is provider-aware: `costCentsFor(kind, provider)`, with `OPENAI_IMAGE_COST_CENTS = 25`.** Owner ruling by Nick on 2026-08-23 — the midpoint of ADR-006's documented $0.17–0.45 range for `gpt-image-1`. `COST_CENTS` stays the default table for Fal. Without this, pinning would make `gpt-image-1` calls reachable again while still metering them at 4¢, i.e. **4–11× under cost**; a spend guard that under-estimates is a guard that does not guard. `checkQuota` and `recordUsage` both price through the single `costCentsFor`, so a 25¢-check paired with a 4¢-record is structurally impossible and is pinned by a test. The same pass closed a real leak on the portrait route, which gated at 4¢ via `spendGate('cover')` while recording 25¢.

### Guardrail confirmations

- **Paid-model swap approved by Nick, repo owner, 2026-08-23**: routing the common single-page re-roll from Flux Pro 1.1 to Flux Kontext. That swap lands in mitigation B; recorded here so the audit trail shows the CLAUDE.md guardrail was discharged rather than skipped.
- **`gpt-image-1` becomes reachable again** for every pre-cutover book — it has been unreachable since #60. The 25¢ ruling is the acknowledgment of exactly this.

### Consequences

- `IMAGE_PROVIDER` changes meaning. Documented in [docs/conventions/server.md](../../docs/conventions/server.md); an operator who does not read it will flip the var and wonder why nothing changed.
- `Book` gains two columns that ship on **every** Book-returning route, because `hydrateBook` spreads the whole row. Both are declared in `BookSchema` and pinned by `toMatchObject` on `/illustrate` and `/generate`. Per the plan's scoping, other routes' assertions were not widened.
- `resolveAndPinImagePin` can perform a DB write (the evidence back-fill) *before* a 409 is returned. That records a fact about art that exists, not spend, and it is what makes the 409 stable across retries — but 409 is not fully side-effect-free, and should not be read as such.
- **Manual verification of a real re-roll has never been performed.** `OPENAI_API_KEY`, `FAL_KEY` and `IMAGE_PROVIDER` are unset locally, so no paid call is possible and the 409 path is unreachable (an unconfigured server returns 501). Resolution was confirmed read-only against `dev.db`: "A Spot for Sunny" resolves to `openai`/`gpt-image-1` against an env default of `fal`. The paid path remains unverified.

### Amendment, 2026-08-24 — mitigation B (the style anchor), implemented

Tasks 6–9 on `fix/reroll-style-anchor`. These were deferred when this entry was written; they are now decided and built, and are recorded here rather than in a separate ADR, per the plan's instruction that the second PR amends this entry.

7. **Style anchor = the page's own current illustration, on targeted re-rolls only.** `POST /:id/illustrate` with a `pageNumber` passes that page's existing image as reference 0, routing Fal to `flux-pro/kontext` (1 ref) or `kontext/multi` (2+). A bulk illustrate gets no anchor on any page, because bulk targets pages that have no prior image by definition. `resolveStyleAnchor` returns the path only when the file is genuinely readable — it checks `stat().isFile()`, not merely that `stat` succeeded, because a directory at the anchor path stats fine and then makes `readFile` throw `EISDIR` and 500 the re-roll.

8. **Reference precedence: anchor at index 0, required portraits after, capped at `MAX_REFERENCE_IMAGES = 3`.** Extends ADR-007 decisions 4 and 7. Three is the natural ceiling because required portraits are at most primary + antagonist; truncation only bites when a cast declares multiple primaries, and warns when it does.

9. **The prompt splits on whether feedback is present, and the two clauses are mutually exclusive.** With feedback: keep the style, palette and composition, change only what was asked. Without feedback: keep the style and character designs but produce a fresh composition, pose and camera angle. A prompt carrying both would tell the model to preserve and vary the same thing at once, so both directions are asserted.

   **The accepted cost, stated plainly: a bare "Redo" now returns something *less* different than it does today.** That is the direct price of "match the original", not a side effect. The variation directive is a prompt-level mitigation and **no test can judge it perceptually** — if a bare re-roll comes back a near-copy, the documented fallback is to switch `resolveStyleAnchor` to cover-anchoring rather than ship a 4¢ button that returns the same picture. **That check has never been performed** (see below).

### Does mitigation B still earn its place?

Worth recording honestly, because the answer changed after this entry was first written. **Mitigation A closed the reported bug on its own**, verified on 2026-08-24: "A Spot for Sunny" regenerated on `gpt-image-1` and page 5 v3 reads as the same book as the May original ([#93 comment](https://github.com/slickG0ose/storybook/issues/93#issuecomment-5402574808)).

Mitigation B therefore does **not** fix the reported bug — that is already fixed. It tightens style-lock for **Fal-pinned books**, where the pin alone cannot help because Flux was always the model and drift comes from sampling rather than from a model swap. Its cost is the less-varied bare Redo above, and its central risk has never been observed. Merging it is a genuine judgment call, not a formality.

### Open questions on the anchor, and the verification that has never run

- **UNVERIFIED, and it is the one that decides the design: does a bare "Redo" come back a near-copy?** Task 8's manual step is two re-rolls of `b2fa23cf-…` — one with feedback, one with the box empty. Neither has been done, because reaching the Kontext path needs a Fal-pinned book and a `FAL_KEY`, and the book that motivated all of this is pinned to `openai`. Until someone looks at two images side by side, decision 9's variation directive is an untested hypothesis. Tracked in [#93](https://github.com/slickG0ose/storybook/issues/93).
- **Still open: does `fal-ai/flux-pro/kontext/multi` have a documented maximum reference count?** Re-checked 2026-08-24 alongside the pricing: fal's model page states **no** maximum. So `MAX_REFERENCE_IMAGES = 3` remains our own ceiling (anchor + primary + antagonist), not a published limit — which means it is safe from the direction that matters (we cannot exceed a limit that is not documented), but it is also unverified from the other direction, so a cast declaring multiple primaries still truncates by our rule rather than theirs.
- ~~**Open, blocking that PR's merge: current Fal Kontext and `kontext/multi` pricing.**~~ **RESOLVED 2026-08-24 — re-checked against fal.ai, no code change needed.** `fal-ai/flux-pro/kontext` is **$0.04 per image**, unchanged from the figure ADR-007 dec 4 pinned on 2026-06-05. `fal-ai/flux-pro/kontext/multi`, never verified before, is **also $0.04 per image** — a multi-reference call costs the same as a single-reference one, so reference count does not affect spend. `COST_CENTS.illustration = 4` is therefore correct for the Kontext re-roll path and stays as-is.

  One wrinkle worth writing down, because it looks like a discrepancy and is not: `flux-pro/v1.1` (the prompt-only path) is priced **per megapixel**, "rounded up to the nearest megapixel", while both Kontext models are priced **per image**. We request `image_size: 'square_hd'` = 1024×1024 = 1.048576 MP, so a strict-arithmetic reading of "round up" would give 2 MP = $0.08 and make our existing 4¢ metering half the real cost. It does not: fal's pricing page states image models' "output is based on 1MP images", which is the baseline 1024² is measured against, not a value it exceeds. Both readings were checked; the 1MP-baseline reading is fal's own framing. **The definitive confirmation is a real invoice line, which we have never seen because no key has ever been configured** (see [#93](https://github.com/slickG0ose/storybook/issues/93)) — if a bill ever shows 8¢ for a prompt-only illustration, this paragraph is where to start.

### Deferred indefinitely

- **An unrecognised `image_provider` value re-infers on every call and is never repaired.** The anti-clobber `where: { image_provider: null }` cannot match a junk value. Correctness is unaffected (inference returns the right answer every time) and nothing in the codebase writes such a value; widening the clause would re-open the clobber it exists to prevent.
- **The full positional→options refactor** of the illustration service signatures. Worth doing, not worth doing inside a bug fix that would have had to rewrite the route tests' positional-index assertions.

---

## ADR-012 — "Withdraw to edit": a published book is immutable, and editing one takes it out of the catalog

**Date:** 2026-08-23
**Status:** Accepted
**Scope:** `edit-published-books` phase 1 (Tier 2 Storefront milestone), Tasks 1–10. Spec at [.code-captain/specs/edit-published-books/spec.md](../specs/edit-published-books/spec.md), task plan at [tasks.md](../specs/edit-published-books/tasks.md); backlog issue [#20](https://github.com/slickG0ose/storybook/issues/20), which asked for an ADR by name. Extends ADR-004 decision 2 (no-overlay precedent), depends on ADR-003 (Zod wire shapes) and ADR-008 (the PDF is the buyer's durable artifact), and claims the correctness half of CLAUDE.md done-criterion #2 through ADR-009's `forEachTheme` harness.

### Decision

**A published book is immutable. Editing one means withdrawing it from the catalog first, revising it as a draft with the primitives that already exist, and republishing as the cutover.** The state machine is the two values `Book.status` already holds; the work was making that *true* on the server, *visible* in the client, and *safe on the money path*. Eight coupled decisions, captured as a set per the ADR-004/006/007/008/010/011 grouped precedent. Each names its trade-off.

1. **Fork 3 ("withdraw to edit") over fork 1 ("shadow draft, old version stays public") and fork 2 ("mutate in place").** #20 offered the three as peers; they are not. **Fork 2 was not the cheap option — it was the status quo, restated as a feature, and it is the one to reject loudest.** Four of the six content-mutating book routes shipped with no status check at all, and one of them, `POST /:id/revise`, deliberately nulls `illustration_url` on every page whose text or illustration description changed. Run it against a live book and you have put a half-illustrated book on sale, with no operator action, no signal to the buyer, and no way back except paying to re-illustrate. Fork 2's only real advantage — uninterrupted availability — is the same one fork 1 offers, except fork 2 buys it by shipping unreviewed work to buyers instead of by staging it. **Fork 3 won because it is the only model already structurally true here** and because it keeps **one source of truth for "what is the book"**: the `Page` rows. Catalog list, detail, PDF renderer, narration, illustration generator, cart display, checkout, and version restore all read those rows and are correct by construction. `PUT /:id/unpublish` already existed and was already owner-gated; two routes already enforced the draft precondition with the exact 403 this model wants; `MyBooks.tsx`'s confirm dialog already *explained* the model ("kept as a draft you can keep editing"). The model was never designed away from — it was just never finished or named. **Trade-off, stated plainly: the book is off-sale for the whole duration of the edit.** That is precisely the property fork 1 exists to buy, and phase 1 does not have it. Phase 1's answer is to make the cost explicit in the UI copy rather than surprising, and reversible in one click.

2. **Fork 1 is rejected on implementation surface, not on principle — and the concrete blocker is that `BookVersion.pages_json` cannot serve a public old version at all.** The snapshot is text-only: `{ page_number, text, illustrationDescription }`, with **no `illustration_url`** ([shared/src/books.ts](../../shared/src/books.ts) `:163-168`). So "the old version stays public while the author edits the new one" is not a matter of pointing a read at an existing snapshot — there is nothing in the snapshot to point at, and the public book would lose every image. Closing that gap means one of two things. Either a **second set of `Page` rows** under a shadow `Book` row, which immediately needs an identity story for `CartItem.book_id`, `OrderItem.book_id`, the `/book/:id` URL, and `IllustrationVersion.book_id` history; or an **`illustration_url` column on the snapshot plus a which-content-am-I resolution rule threaded through every read path**: `GET /api/books`, `GET /api/books/:id`, `GET /api/books/mine`, `POST /api/books/:id/pdf`, `BookSpread`, `NarrationPlayer`, `GET /api/cart/:sessionId`, and `POST /api/orders` — **eight, plus version restore and the illustration-history panel**. Every one of those today says "the book is its `Page` rows"; every one of them would have to start asking a question, and every one is a place a future bug can serve the wrong content to a buyer. **That is the cost — eight-plus read paths learning a resolution rule — and what it buys is uninterrupted purchasability for a storefront that is not currently deployed and has no traffic to interrupt** (`MEMORY.md`: deploy down, DB expires 2026-09-14). **Trade-off:** fork 1 is the better long-run model and phase 1 does not have it, so the availability gap in decision 1 stands until one of the five triggers below fires.

3. **Fork 1 is held as a named upgrade path with five triggers, not quietly dropped.** It becomes worth its cost when **any** of these fire: (a) **the deploy is restored ([#77](https://github.com/slickG0ose/storybook/issues/77)) and the catalog has real traffic** — an availability gap only costs something when someone is trying to buy; (b) **an author reports losing a sale, or complains about the book vanishing** while they edit; (c) **a purchased-book library ships**, which changes the calculus twice over by removing the buyer-404 problem and by making "which version did I buy" a question worth answering; (d) **edit sessions become long-running** — a multi-day revise-and-illustrate cycle is a materially different thing to take off-sale than a five-minute typo fix; (e) **scheduled publishing or an editorial review step is requested**, both of which presuppose a staged version that is not live. When one fires, the shape to reach for is a `published_version` pointer on `Book` plus an `illustration_url` field on the `BookVersion` snapshot, so the live view can be served from a snapshot without duplicating `Page` rows. **Trade-off:** recording a sketch invites someone to implement the sketch rather than re-derive the design. It is recorded anyway, because the alternative is the next architect starting from a blank page and re-discovering the text-only-snapshot blocker the expensive way.

4. **Route-layer immutability is one shared helper — `isEditable(book)` in [server/src/lib/availability.ts](../../server/src/lib/availability.ts) — and it runs *after* the owner check, never before.** All six content-mutating routes (`PUT /:id/pages/:pageNumber`, `PUT /:id/versions/:version/restore`, `POST /:id/revise`, `POST /:id/illustrate`, `POST /:id/characters/:characterIndex/portrait`, `PUT /:id/illustrations/:pageNumber/revert`) call it and return the same 403 with the same `PUBLISHED_IMMUTABLE_ERROR` string; the two that already had ad-hoc checks adopted it. It **fails closed** — anything not exactly `'draft'` is immutable — so a future status value cannot silently reopen fork 2. **The ordering is the security property:** returning 403 before the ownership check would tell a stranger that someone else's book exists and is published. A non-owner gets 404 on every mutating route regardless of status, asserted directly. On the two paid routes the gate is the first statement in the handler body, before any provider call and before `recordUsage`, so a 403 writes no `UsageLog` row and makes no provider call. It is a **handler-body check, not middleware** — mounting it before `validate()` would break the `requireAuth → [spendGate] → validate → handler` order that `docs/conventions/server.md` protects. **Trade-off:** six call sites rather than one mount, so a future route can still forget it. Mitigated by the helper being the only place the message lives, and by the conventions note Task 9 added to the "when adding a new route" checklist.

5. **Publishing is a status transition, not a version event: republishing does not bump `book.version`.** `version` tracks *content revisions* and already moves when content changes; `BookVersion` rows are keyed to it by the self-healing `snapshotVersion` transaction. Bumping on publish would make version numbers move with no corresponding snapshot and would retroactively change what every existing `BookVersion` row's number means. This is spec Open question 4, shipped at its stated default. **Trade-off:** there is no record of *when* a book went live or of which content revision the public last saw — see decision 7. The version-history panel works during an edit for free, because the book is a draft and the panel is already `isOwner && isDraft`-gated.

6. **Cart availability is one exported `where` fragment, `AVAILABLE_BOOK_WHERE = { deleted_at: null, status: 'published' }`, used by cart display, add-to-cart, and checkout — and unavailable rows are dropped silently.** This closes a **pre-existing money bug that has nothing to do with #20**: `GET /api/cart/:sessionId` filtered `deleted_at: null` and called it "silent-hide UX" in a comment, while `POST /api/orders` filtered nothing, so a cart containing a soft-deleted book displayed total $X and charged $X plus that book's price. Neither looked at `status`, so withdrawing a book for editing would have left it fully purchasable while `GET /api/books/:id` 404'd it for the buyer who just paid. The regression test for the divergence fails against `master`. Add-to-cart returns the **same 404** as a missing book, not a new status code, so nothing leaks about whether someone's draft exists. **No wire shape changed** — `CartItemSchema`, `CartGetResponseSchema`, and `OrderCreateResponseSchema` are untouched and their existing assertions are the fence. **Trade-off:** a buyer who returns to a cart and finds a book gone gets no explanation, and a cart total can now legitimately shrink between page loads. Silent-hide was chosen because it matches the soft-delete precedent in the same file, needs no field on `CartItemSchema`, and fixes the charging bug in the same motion. The change is strictly in the buyer's favour — they stop being charged for books they cannot open — and the confirmation page renders the server's authoritative total, so nobody is ever charged more than displayed. The withdraw-during-checkout race resolves the same way: the item drops, the total is lower than last seen, no locking in phase 1.

7. **Phase 1 lands zero Prisma schema changes and zero seed changes; `published_at` and `published_version` are deliberately not added.** This is a load-bearing claim rather than an aspiration — `git diff --stat server/prisma/` is empty, which is what keeps the CLAUDE.md seed/cart/order guardrail untripped, and it is why no `db:reset` was needed: `AVAILABLE_BOOK_WHERE` is evaluated at read time, so existing carts in `dev.db` need no migration. **Trade-off, and it is a real one:** with no `published_at`, a never-published draft and a book withdrawn for editing are **indistinguishable**, so the out-of-catalog banner reads identically for both. That copy compromise ships. It is spec Open question 1 at its stated default, and the reversal is cheap — one additive nullable column plus a one-line backfill (`UPDATE Book SET published_at = created_at WHERE status = 'published'`), with no wire-shape change unless the client needs one.

8. **The withdrawal confirmation is an inline in-flow panel — not a modal, not `window.confirm`.** `window.confirm` is what `MyBooks.tsx` used: unstyleable so it cannot honour dark mode, OS-sized so `expectTapTargets` cannot assert it, and reachable in Playwright only through `page.on('dialog')`. For the single most consequential action in the author flow that is the wrong surface. A real modal brings the full modal contract — focus trap, escape-to-close, scroll lock, `aria-modal`, a portal — which **ADR-004 decision 2 already rejected on exactly this reasoning** for theater mode. So the confirm expands in place inside `client/src/components/PublishStateBar.tsx`, which also keeps the new surface inside ADR-009's `forEachTheme` / `expectNoHorizontalOverflow` / `expectTapTargets` harness. **Trade-off:** less arresting than an overlay for an action that takes a book off sale, and the panel can be scrolled past. The consequence copy is the mitigation — it names the actual outcome ("Readers won't be able to find or buy it until you publish again. Anyone who already bought it keeps their receipt") instead of asking "Are you sure?".

9. **A purchase confers no entitlement to draft content, and a prior buyer therefore gets a hard 404 on `/book/:id` for the entire time the author is editing.** This is the sharpest cost of the chosen model and it is stated here rather than softened, because it is the thing most likely to be raised in review. The mechanics: `OrderItem` snapshots `title`, `quantity`, and `price` at checkout and **does not snapshot content** — it is a **receipt, not a copy** — so no edit can retroactively change what the buyer was told they bought or what they were charged. But there is **no purchased-book library** in this product: `OrderConfirmation.tsx` links to `/` and `/my-books` and never to `/book/:id` at all, so access to content is via the public catalog, which is a live view. During the edit window a buyer who navigates to the book hits the existing draft branch of `GET /api/books/:id` and gets **404, "Book not found"** — not a friendly "temporarily unavailable", because that branch deliberately refuses to confirm a non-owner's draft exists. Two things bound it, neither of which is a fix: **ADR-008's PDF export is the durable artifact** a buyer can hold and no edit can touch (the gap being that nothing in the purchase flow prompts the download), and **nothing is deployed**, so there are no real buyers to strand while the model is proven. **Trade-off / why the fix is deferred rather than taken:** granting a purchaser read access to a draft means an entitlement check, and `Order` is keyed on `session_id` with an optional `user_id`. That means either sending the cart-session UUID to a read route — extending a `localStorage` UUID into an authorization token, which is precisely the load-bearing session model CLAUDE.md says not to touch without explicit confirmation — or requiring accounts for purchase, a product decision well outside #20. **This belongs in the PR body and must not ship as an undiscussed surprise.**

### Alternatives considered

- **Fork 2 — mutate a published book in place, no version bump** (rejected, loudly): see decision 1. It is not a design, it is the defect that already existed.
- **Fork 1 — shadow draft with cutover** (deferred, five triggers): see decisions 2 and 3. The right model for a storefront with real traffic; wrong for one with none, at eight-plus read paths of cost.
- **Show the withdrawn book in the cart as an explained "Unavailable" row** (deferred, spec Open question 3): honest, and better UX. It needs a field on `CartItemSchema` — an OPS.3 wire-shape change, a `@storybook/shared` edit, a new cart row state in both themes — plus a decision about what checkout does with such a row, and it is inconsistent unless soft-deleted books get the same treatment, which widens the change again. Phase 1's discipline was zero wire-shape changes; this was the one alternative that would have broken it.
- **Reject checkout with a 409 listing unavailable ids** (rejected): maximally explicit, nothing silently dropped — but a new error shape, a hostile experience, and during a withdraw race an order that fails outright rather than succeeding for the items that are fine.
- **A server-side block on publishing a book with unillustrated pages** (rejected, spec Open question 2): text-only books are legitimate — the seed catalog contains them and `renderBookPdf` handles them — so a server 403 would break them. The guard is a **client-side** confirm instead ("3 of 5 pages have no illustration yet. Publish anyway?"), which is the second net under a revise-then-republish cycle after `/revise` nulls illustrations.
- **A fourth `COST_CENTS` kind (`portrait: 4`)** (rejected): more precise in the ledger, but it means a new `UsageKind` union member, a new env/limits story, and a question about what historical rows should have been — for a figure identical to one already in the table. See the first Consequence below for what this actually costs in the admin view.
- **Granting draft access to a user holding an `OrderItem` for the book** (deferred, spec Open question 5): the humane answer to decision 9, and an auth/entitlement design with its own spec and its own user confirmation, not a follow-up commit.

### Consequences

- **Portrait spend is charged at the `cover` rate, so `GET /api/admin/spend` cannot tell a portrait from a cover.** Task 2 closed a real hole: `POST /api/books/:id/characters/:characterIndex/portrait` is a **paid image call that shipped with no `spendGate` mount and no `recordUsage` call**, so an authenticated, allowlisted user could generate unlimited portraits — invisible to the per-user daily cap and, worse, invisible to the **global monthly ceiling that nobody is allowed to bypass**, because `recordUsage` is what writes the `UsageLog` rows that ceiling sums. Pre-existing, not caused by #20, and fixed here because Task 1 was editing that route's chain anyway. The fix mounts `spendGate('cover')` and records at `cover: 4` — numerically identical today, one line instead of a new union member. **The cost is a real loss of ledger resolution:** every portrait now appears in admin spend reporting as a cover, and no query can separate them retroactively. Recorded deliberately so this is not later rediscovered as a bug. **Revisit when** portrait pricing diverges from cover pricing, or when anyone needs per-kind portrait attribution. **The general lesson, now in `docs/conventions/server.md`:** a paid route needs *both* a `spendGate` mount and a `recordUsage` call — gating without recording defeats the global ceiling silently.
- **A published book with image generation unconfigured now returns 403 rather than 501 on the portrait route.** No test covered that combination, so this was a judgment call made at implementation time, not a design decision: immutability is the more fundamental fact ("you may not edit this book" is true regardless of whether the provider is configured), capability is contingent, and the two sibling paid image routes must not order their checks differently or the client learns three orderings for three routes. The shipped order on all of them is **ownership (404) → mutability (403) → capability (501)**. If a future client wants to distinguish "unconfigured" from "immutable" on a published book, this ordering is what it will have to change.
- **`POST /api/orders` still clears the entire cart, so a withdrawn row is deleted alongside the purchased ones rather than surviving until the author republishes.** Task 3 made checkout stop *charging* for unavailable items, but the existing `cartItem.deleteMany({ where: { session_id } })` line was left as it was — the plan did not rule on it and changing it was outside what Task 3 named. **The user-visible effect:** a buyer who had a withdrawn book in their cart loses it permanently at checkout instead of finding it waiting when it goes back on sale. Worth a ruling before this reaches real traffic; it pairs naturally with the deferred "explained Unavailable row" above, since both are about a withdrawn cart item having a life beyond silent disappearance.
- **A WCAG 2.5.3 fix means the plan text and the shipped code disagree by decision, not by drift.** The task plan specified `aria-label="Take book out of the catalog to edit"` on a control whose visible label is **Edit this book**. That fails **Label in Name**: the accessible name does not contain the visible text, so a voice-control user saying "click Edit this book" gets nothing. The shipped aria-label is **`Edit this book — takes it out of the catalog`** (`client/src/pages/MyBooks.tsx`), which contains the visible label and still carries the consequence. Anyone reconciling the plan against the code should not "fix" the code back.
- **Deferred: pre-existing dark-mode defect on the "Illustrate All" button, found and deliberately not fixed.** `client/src/pages/BookDetail.tsx:665` carries `bg-purple-500 hover:bg-purple-600 text-white` with **no `dark:` partner** — a light-mode purple that does not adapt. It is byte-identical to `master` and predates this branch (the same unpartnered pattern appears across `Cart.tsx`, `Login.tsx`, `Register.tsx`, `Home.tsx`, `MyBooks.tsx`, and `OrderConfirmation.tsx`, so it is a codebase-wide habit rather than one button), and it is **not** a `dark-mode-parity-check` finding against this PR. It is recorded here rather than left in a commit message, following ADR-010's `BookSpread` chevron precedent. **Deferred because** fixing one instance of a house-wide pattern inside a feature PR gives the reviewer a styling diff to audit that has nothing to do with withdraw-to-edit, and fixing all of them is its own change. **Reopen trigger:** the next change that touches the draft-owner control cluster in `BookDetail` for any reason, or a deliberate sweep of the `bg-purple-500` family — whichever comes first. The *new* surfaces in this PR (`PublishStateBar`) use `bg-purple-600` with full `dark:` partners on default, hover, focus-visible, and disabled.
- **All six spec Open questions are closed. Four shipped at their stated default; two were ruled on during execution, both by the main session while the author was away.** (1) `Book.published_at` — **default, no**: a never-published draft and a withdrawn one read identically; the field stays speculative until the copy is seen in use. (2) Server-side block on publishing unillustrated pages — **default, no**: client-side confirm only, because text-only books are legitimate. (3) Withdrawn cart items shown with an explanation — **ruled: no, silent-hide**, overriding nothing but worth recording as a ruling rather than a default, because the "yes" branch adds a field to `CartItemSchema` and phase 1's discipline was **zero wire-shape changes**; that discipline is what kept the seed/cart/order guardrail untripped and it outranked the UX improvement. (4) Republishing bumps `book.version` — **default, no**: see decision 5. (5) Draft access for prior buyers — **default, no**: see decision 9. (6) Whether the portrait spend fix ships as its own PR — **ruled: no, it ships inside this PR, overriding the stated default of "its own PR, landed first."** The reason is test cohesion, not convenience: its 403 and 429 cases share a `describe` block with Task 1's immutability cases against the same route, so splitting the commit would have meant splitting a test block that reads as one argument about one route's chain. The spend exposure was closed in the same series either way; only the commit boundary moved. **Because it did not ship standalone, Task 10 item 2 (a separate issue for the portrait finding) does not apply** — the finding is tracked by the first Consequence above and by the conventions line, which is one tracking action, not two.
- **Six follow-ups are drafted as issues but not created**, under [.code-captain/specs/edit-published-books/issues/](../specs/edit-published-books/issues/), one file each with a `Title:` line and a `gh issue create` invocation in a comment: purchaser entitlement to draft content; a purchased-book library; a checkout-time PDF-download prompt; surfacing withdrawn cart items with an explanation; direct per-page text editing; editing price/title/cover metadata. They follow the `read-aloud/issue-draft.md` precedent and are deliberately uncreated — the repo owner files them. **`Book.published_at` is the one item of the seven that got a `Deferred:` line instead of an issue draft**, and the choice is deliberate: it is not a feature, it is a nullable column whose only justification is copy nobody has read yet, its reversal is one additive migration plus a one-line backfill, and it is already carried twice — by spec §"ADR-worthy decisions"'s `Deferred:` line and by Open question 1's stated default and reversal cost. An issue for it would be a backlog row that gets closed as stale, and it would be a *second* tracking action for an item that already has one.
- **The buyer-facing cost belongs in the PR body, not just here.** Per the task plan: the spec/tasks links, the architect and developer roles, the chosen model and its accepted cost (**the book is off-sale during an edit; a prior buyer sees a 404**), the Task 3 money-path behaviour change, and which half of done-criterion #2 is being claimed.
- **CLAUDE.md done-criterion #2 is discharged mechanically for the correctness half only.** `e2e/tests/mobile/edit-published.spec.ts` runs the withdraw → edit → republish loop under `mobile-pixel` and `mobile-small` in both themes via `forEachTheme`, asserting no horizontal overflow and `PRIMARY_TAP_MIN` tap targets on every new control — the ADR-009 discharge. **The aesthetic half is an outstanding human obligation, deliberately in no task's "Done when":** does the withdrawal read as reassuring rather than alarming, and does the out-of-catalog banner feel like a *state* rather than an *error*? Wording is a product judgement and the strings live in one component for exactly that reason.
- **No wire shape changed, and that is the OPS.3 discharge.** Every route kept its success shape; the changes are new 403/404/429 *paths* and a server-side row filter. The new envelopes are pinned with `toMatchObject({ error: expect.any(String) })`, and every pre-existing success-shape assertion in `books.test.ts`, `cart.test.ts`, and `orders.test.ts` stayed green **unmodified** — that is the fence proving no drift. Likewise the regression e2e fence (`version-history`, `illustration-history`, `cart-checkout`, `book-detail`, `narration`, and the four mobile specs) passed unedited. If a future task under this ADR finds itself editing `shared/src/` or one of those specs, the change has grown past this design and needs an amendment rather than a quiet extension.
- **The remaining deferrals are tracked by the spec's own `Deferred:` line and are not restated as decisions here**, following ADR-011's precedent that one tracking action per item is the rule: story remix, admin editing of others' books, scheduled publishing, buyer notification on update, and WebKit e2e coverage. Each has its reasoning in spec §"Out of scope"; duplicating them into this ADR would create a second tracking action for items that already have one.

---

## ADR-011 — Read-aloud narration: device TTS, sentence highlighting, and the deferred generated-audio seam

**Date:** 2026-08-22
**Status:** Accepted
**Scope:** `read-aloud` phase 1 (Tier 2 Storefront milestone), Tasks 1–8. Spec at [.code-captain/specs/read-aloud/spec.md](../specs/read-aloud/spec.md); built on top of `mobile-pwa` (ADR-009's `forEachTheme` harness, ADR-010's `UpdateToast`). No backlog issue existed when the spec was written — one is drafted at [.code-captain/specs/read-aloud/issue-draft.md](../specs/read-aloud/issue-draft.md).

### Decision

Ship "Read to me" on the browser's own speech synthesiser. Page text is split into sentence-sized chunks, the whole current page is queued into `speechSynthesis` in a single user-gesture-initiated burst, and per-utterance `start`/`end` events drive a sentence highlight and — at the end of the last chunk — a *request* to turn the page. Seven coupled decisions, captured as a set per the ADR-004/006/007/008/010 grouped precedent. Each names its trade-off.

1. **Device TTS (Web Speech API) is phase 1; generated audio is deferred behind a named trigger list.** No paid provider, no `COST_CENTS` entry, no `spendGate` mount, no route, no Prisma model, no new npm dependency — `SpeechSynthesis` and friends are already in `lib.dom.d.ts`. **Why:** the coordination work (chunking, highlighting, page advancement, a control surface that survives a 360 px phone) is the actual product; the synthesis itself is a free browser primitive, and buying one before building the other would have spent money to learn nothing. **Trade-off:** the voice is whatever the OS ships, so the same book sounds like a different product on every device; there is no lock-screen or background playback, because Web Speech produces no `<audio>` element and no `MediaStream`, so Media Session is unreachable; and there is no audio *file* at all, so nothing can be bundled with the PDF, emailed, or played in a car. All three are consequences of this decision, not oversights. **The durable artifact is the trigger list** in spec §"The deferred generated-audio seam" — six named triggers (lock-screen playback becomes a requirement; someone asks for an audio artifact; voice quality becomes a complaint; a locale has no usable local voice; a paid tier needs a differentiator; uniform offline narration), plus a sketch of the deferred design that deliberately mirrors `IllustrationVersion`. When a trigger fires, every deferred cost lands at once — migration, wire shape, OPS.3 obligation, spend gate — which is exactly why none of it was taken on speculatively.

2. **Highlighting is sentence-level, driven by the chunk queue; word-level is a self-activating enhancement, never the foundation.** `NarrationPosition` carries `{ chunkIndex, wordRange }` from day one, and `wordRange` stays `null` unless a `boundary` event with word granularity has actually been observed. **Why:** `start`/`end` are universal; `boundary` is not Baseline — Safari fires it at sentence granularity and Android Chrome does not fire it at all. Building the flagship early-reader feature on `boundary` means it works on the desktop browsers we develop in and silently does nothing on the iPad and Android tablet children actually hold, which is the worst possible failure distribution because we would never see it break. **Trade-off:** on desktop Chrome, where word boundaries are good, the baseline experience is coarser than the platform could deliver, and the enhancement path means two highlight code paths to keep in dark-mode parity rather than one.

3. **The page index is the master; narration requests page turns rather than owning them.** `useNarration` calls `onRequestNext()`; `BookSpread` decides whether to honour it, and its `spreadIndex` remains the single source of truth. **Why:** one-directional state has no reconciliation logic and cannot disagree with itself. The inverse (audio owns the index) would mean lifting page state out of `BookSpread` into `BookDetail`, touching ADR-004-adjacent code and the desktop e2e fence for no user-visible gain. **Trade-off:** the correctness burden moves onto a stale-callback guard — `cancel()` still fires `end`/`error` asynchronously after the new page has mounted, so every handler captures a monotonic `runId` and returns early when it is stale. Without it a fast double-tap on Next produces a phantom auto-advance.

4. **One `NarrationProvider` interface with exactly one implementation, imported directly — no registry, no factory, no feature flag.** `useNarration` imports `deviceProvider` and talks only through the interface. **Why:** this follows the [docs/backlog.md](../../docs/backlog.md) `:51` precedent (Zod schemas kept forward-compatible with OpenAPI, `zod-to-openapi` deferred until a concrete trigger) — preserve the option, build none of the machinery. A registry with one option and a flag nobody can flip is an abstraction built entirely on spec. **Trade-off:** one extra file and one indirection between the hook and `window.speechSynthesis`, which buys nothing today if no trigger ever fires. It is worth paying anyway because the same interface is what makes the hook testable against a fake — the seam pays for itself in testability before it ever pays for optionality.

5. **`NarrationPlayer` is in normal document flow at every breakpoint; `UpdateToast` remains the app's only bottom-fixed surface.** This is an app-wide layout invariant, not a narration detail, and `e2e/tests/mobile/narration.spec.ts` pins it with a computed-style assertion that the player's `position !== 'fixed'`. **Why:** `UpdateToast` is `fixed inset-x-3 bottom-3 z-50` (ADR-010 decision 2). A sticky narration bar would occupy the same 60 px on exactly the phone viewport where both matter, and z-index tuning between two independently-authored surfaces is a bug generator. In flow, the collision cannot happen. The same DOM renders at every breakpoint — Tailwind variants change only spacing and stacking — so no control has a duplicate accessible name, which is the mistake `e2e/tests/mobile/reader.spec.ts` exists to fence. **Trade-off:** on a short viewport the player scrolls out of view mid-story, and Play is then not always reachable the way a music app's is. If a sticky variant is ever wanted, the required change is recorded in spec §Alternatives (player at `z-40`, `UpdateToast` offset by a `--narration-bar-h` custom property) and the `position !== 'fixed'` assertion has to be consciously deleted — which is the point of pinning it.

6. **Narration preferences live in one client-local `localStorage` key, not on the `User` record and not in `@storybook/shared`.** `client/src/lib/narration/prefs.ts` owns `storybook-narration` (`voiceURI`, `rate`, `autoAdvance`) and validates on read with a hand-written guard that returns defaults on any missing, malformed, or out-of-range value. **Why:** the data is device-scoped *by nature* — the available voice list **is** the device, and a voice chosen on an iPhone does not exist on a Windows laptop — so device-scoped storage is the correct model rather than a compromise. Putting the shape in `shared/` would dilute what that package means (cross-network contracts) and would make `zod` a direct client dependency it is not today. **Trade-off:** preferences do not follow a user across devices, and the storage surface grows by one key alongside `storybook-session` / `storybook-auth` / `storybook-theme` / `storybook-cart-cache`. **Guardrail note:** this module never reads, writes, rotates, or reinterprets any of those four; the UUID session model (CLAUDE.md guardrail) is untouched.

7. **A fake speech synthesiser is the test substrate at both the unit and the e2e layer; audibility is verified by one documented manual listen.** `client/src/test/fakeSpeech.ts` (jsdom) and `e2e/tests/_speech.ts` (`addInitScript`, injected before app scripts run) supply a deterministic FIFO-plus-timers stand-in. Neither is installed globally — `fakeSpeech` is installed per test file, deliberately not in `client/src/test/setup.ts`, because the `'unavailable'` path needs the global to genuinely be absent. **Why:** jsdom has no `speechSynthesis` and headless Chromium has no speech engine, so without a fake there is no automated coverage of the highest-risk logic in the feature at all. **Trade-off, stated plainly:** the fake is *our model* of the API, not the API, and every assertion in the suite inherits its assumptions. It is kept deliberately dumb for that reason, and `client/src/lib/narration/__tests__/deviceProvider.test.ts` pins the mapping from real `SpeechSynthesisEvent` fields (`charIndex`, `charLength`, `name`, `error`) so drift surfaces in one file rather than diffusely. **e2e proves the state machine and the UI, not audibility.** The manual listen exists precisely to catch what the fake cannot, and it is named as an outstanding obligation below rather than folded into any task's "Done when".

### Alternatives considered

- **Per-page playback that stops at the end of each page** (rejected): the simplest possible state machine — no auto-advance, no watchdog, no cross-page gesture problem on iOS — but an adult must tap Play once per page, which for a 5-page bedtime book is worse than just reading it aloud yourself. It fails the use case the feature exists for. Note the auto-advance toggle lets any user opt into exactly this behaviour.
- **Audio owns the page index, host follows** (rejected): tidy for a pure listening mode, but manual navigation then has to interrupt and re-seat the audio's notion of position, and two sources of truth exist during the transition. Strictly more coupling for the same behaviour — see decision 3.
- **Word-level karaoke as the primary mechanism, built on `boundary`** (held as the enhancement path, shipped as Task 6): the strongest early-reader experience and the biggest visible differentiator against Childbook.ai and StoryBee, but correct-on-some-platforms is a bonus, not a foundation — see decision 2.
- **No highlighting at all, audio only** (rejected): least code and zero interaction with screen-reader semantics, but following text while hearing it is the mechanism by which read-aloud teaches reading. It drops the cheapest half of the feature's value.
- **Sticky bottom bar on mobile** (held as an upgrade path): the app-like choice, but it collides with `UpdateToast` on exactly the viewport where both matter, permanently consumes ~64 px of a 740 px screen, and can cover the revise panel and the end spread — none of which the overflow assertion can see. Required change recorded; see decision 5.
- **Floating overlay / modal listening mode** (rejected): maximum immersion, but it pulls in the entire modal contract — focus trap, escape-to-close, scroll lock, `aria-modal` — which ADR-004 already rejected for theater mode on the same reasoning. Revisit only if a dedicated Listen mode is actually specced.
- **A scrub bar** (not buildable): the Web Speech API exposes no seek and no playback position, so a progress bar would be one that cannot be dragged. Sentence stepping (Previous/Next sentence, 44 px, keyboard-native) is the equivalent affordance, with tap-a-sentence layered on as a redundant pointer convenience.
- **Persist preferences on the `User` record** (rejected): voice and speed would follow the account, at the cost of a migration, a route, a wire shape, and an OPS.3 obligation — every cost this spec avoids — to sync a setting that is inherently device-specific. See decision 6.
- **No seam; `useNarration` calls `window.speechSynthesis` directly** (rejected): fewer files, but the hook becomes untestable without stubbing a browser global inside itself, and a future provider means rewriting the hook rather than adding a file.
- **A provider registry with a config flag and a runtime selector** (rejected): ready for a second provider on day one, at the price of an abstraction layer built entirely on spec. When a second provider lands, that is when a selector earns its place.

### Consequences

- **The `runId` guard is the non-redundant correctness detail at the *unit* layer, and the spec overstated it at the e2e layer.** The spec calls the stale-callback guard "the single most important line in the feature". That is true of `client/src/hooks/__tests__/useNarration.test.tsx`, which drives an abandoned page's callbacks by hand and asserts no phantom `onRequestNext` — and it is an overstatement everywhere else. In practice two independent guards exist: the provider's per-handle `dead` flag (`client/src/lib/narration/deviceProvider.ts`) and the hook's `runId`. **Deleting either one alone still passes `cd e2e && npm test`** — they are redundant at the e2e layer, and only the unit test distinguishes them. Recorded here so a future reader neither trusts the e2e suite to catch a regression it cannot see, nor deletes the "redundant" one on the strength of a green browser run. If either guard is ever removed, the test that has to go red is the unit one.
- **`NarrationVoice` carries `isDefault: boolean`, added during Task 2 rather than at design time.** The spec's type omitted it, but rung 4 of the default-voice ladder ("the voice flagged `default: true`") was otherwise unimplementable without `useVoices` reaching past the provider seam to `speechSynthesis.getVoices()` — which would have defeated decision 4 on its first use. The mapping happens once, in `deviceProvider.listVoices()`.
- **The two settings `<select>`s have visible labels, not the spec's visually-hidden ones.** Spec §Accessibility says "both `<select>`s get real labels (visually hidden)". Shipped as visible `<span>` labels inside the wrapping `<label>` — inside a `<details>` panel the user opened on purpose, an unlabelled-looking control is worse for sighted users than the two lines of text cost. The accessible name is identical either way; this is a visual-design departure from the spec, not an accessibility one.
- **Word highlighting has a one-line kill switch, and the baseline is unaffected by pulling it.** Stop calling `applyPosition` in `onWordBoundary` (`client/src/hooks/useNarration.ts`) and the feature degrades to sentence-level everywhere. Nothing else changes, because `wordRange: null` is already the Safari and Android Chrome path — the enhancement's absence is a shipped, tested state rather than a new one. This is the documented escape hatch if the outstanding word-highlight listen looks out of sync.
- **Task-plan open question 1 resolved to the stated default: the cover narrates.** Play on the cover reads `"{title}. By {author}."` and then advances, so one Play press reads the book front to back; the end spread reads `"The End."` and never requests a further advance. The alternative (Play on the cover jumps to page 1) remains a one-ternary change at `client/src/components/BookSpread.tsx`.
- **Task-plan open question 3 resolved to the stated default: sentence spans stay tap-to-seek at every breakpoint.** `onSeek` is passed at both the narrow and the wide `StoryText` call sites, ungated by `isNarrow`. The spans keep no `role` and no `tabIndex` — the accessible seek path is the Previous/Next sentence buttons, and the tap is a redundant pointer convenience. If accidental seeks during scrolling show up on a real phone, gating the `onClick` behind `!isNarrow` leaves the accessible path untouched.
- **Task-plan open question 4 resolved to the stated default: the settings `<details>` is closed at every breakpoint**, buying one DOM shape and predictable e2e at the cost of one extra desktop click. Open question 5 (narration in the legacy Reader view) stays out of scope and is covered by the spec's `Deferred:` line.
- **Three things CI cannot do, carried forward as named obligations rather than blockers.** (a) One real listen on desktop Chrome for auto-advance pacing — `AUTO_ADVANCE_DELAY_MS = 400` in `client/src/hooks/useNarration.ts` is a guess, exported as a single constant so tuning is one line; this is task-plan open question 2, still open by design. (b) One real listen on an iPhone including a mid-story screen lock, to confirm the `visibilitychange` pause-and-resume degrades as designed rather than dying silently. **This is not blocked on #77** — Web Speech is not restricted to secure contexts, so a phone on the LAN pointed at the dev server is sufficient. (c) One look at word highlighting on a platform that emits word-granularity boundaries, before leaving the Task 6 enhancement enabled. None of the three is in any task's "Done when"; all three belong in the PR body.
- **CLAUDE.md done-criterion #2 is discharged mechanically for the correctness half only.** `e2e/tests/mobile/narration.spec.ts` runs the flow under `mobile-pixel` and `mobile-small` in both themes via `forEachTheme`, asserting no horizontal overflow, `PRIMARY_TAP_MIN` tap targets, and the not-fixed invariant — that is the ADR-009 discharge. The aesthetic half is the desktop-pacing listen above.
- **No server route changed, so no OPS.3 wire-shape obligation attached** — no route, no Prisma model, no `COST_CENTS` entry, no `spendGate` mount, no schema in `@storybook/shared`, and no new npm dependency. The narration types are client-internal by construction. If a future task appears to need any of them, that is the deferred generated-audio path and it needs an amendment to this ADR, not a quiet extension of it.
- **The roadmap line that predicted this feature has been reconciled, not deleted.** `.code-captain/product/roadmap.md:176` now reads as two halves — shipped phase 1 on device TTS, and deferred generated audio keeping its original "cache audio per page like illustrations" phrasing, because that instinct was right and the deferred design mirrors `IllustrationVersion` deliberately. A future reader must not implement the roadmap version by mistake, nor conclude narration is unbuilt.
- **The installable-fake test pattern is now a convention, not a one-off.** [docs/conventions/client.md](../../docs/conventions/client.md) records it: browser device APIs absent from jsdom get an installable fake under `client/src/test/`, installed per test file and never globally, because the API-absent path is itself a state worth testing. The next device-API feature inherits the pattern instead of re-deriving it.
- **Item 8 of the spec's ADR-worthy list is deliberately not duplicated here.** Generated/premium audio, downloadable audio artifacts, lock-screen playback, a dedicated "Listen" mode, narration in the legacy Reader view, global keyboard shortcuts, multi-language narration, and WebKit e2e coverage are tracked by the explicit `Deferred:` line in spec §"ADR-worthy decisions", each with reasoning in §"Out of scope". One tracking action per item — restating them as ADR decisions would create a second.

---

## ADR-010 — PWA shell, update strategy, and offline-cart posture (MS2)

**Date:** 2026-08-16
**Status:** Accepted
**Scope:** `mobile-pwa` (MS2, Mobile + Series milestone), Tasks 5–6. Spec at [.code-captain/specs/mobile-pwa/spec.md](../specs/mobile-pwa/spec.md); research MS1 in [docs/mobile-strategy-research.md](../../docs/mobile-strategy-research.md) (issue #25).

### Decision

Make the existing SPA installable and offline-tolerant without touching the server. Three coupled decisions, captured as a set per the ADR-004/006/007/008 grouped precedent. Each names its trade-off.

1. **`vite-plugin-pwa` (`^1.3.0`) generates the manifest and the Workbox service worker.** Options live in `client/pwa.config.ts` (a separate module so `client/src/__tests__/pwaOptions.test.ts` can pin the manifest fields without spawning a build) and are spread into `client/vite.config.ts`. **This is a new client dependency and therefore a CLAUDE.md size-gate item — the user was shown all four options from the spec's §Alternatives (plugin, Workbox-direct, hand-rolled SW, manifest-only) and explicitly approved the plugin before `npm install` ran.** Recording the approval, not just the choice: the escalation happened and was answered, so a future reader should not re-open it as an unreviewed dependency. **Why:** the plugin propagates Vite's `base` into the manifest and SW scope, which is exactly the `/storybook/` GitHub Pages trap this project would otherwise hit; it injects `<link rel="manifest">`, ships a typed `virtual:pwa-register/react` hook, and has a `devOptions` switch so the worker stays off the `:5173` dev server the other e2e projects use. **Trade-off:** a build-time abstraction, and a Workbox major bump can arrive transitively. The escape hatch is small — `pwa.config.ts` is the only file holding plugin-shaped config, and the manifest-only fallback remains viable.

2. **`registerType: 'prompt'` with an `UpdateToast`, never `autoUpdate`.** A waiting worker renders a dismissible toast (`client/src/components/UpdateToast.tsx`); the page reloads only when the user asks. **Why:** vite-plugin-pwa's `autoUpdate` calls `skipWaiting` and reloads when the new worker takes control. On `/checkout` with a filled form that silently discards user input — a money-path data loss caused by a deploy the user did not initiate. **Trade-off:** one more UI surface, and therefore one more dark-mode surface to keep in parity; users can stay on a stale shell until they accept.

3. **The offline cart is an explicit read-only `localStorage` snapshot, not SW runtime-caching and not a replay queue.** `client/src/lib/cartCache.ts` writes `localStorage['storybook-cart-cache']` on every successful cart fetch and validates on read with `CartGetResponseSchema` from `@storybook/shared`, returning `null` on corrupt JSON, session mismatch, or schema drift. `CartContextValue` gains `offline: boolean` and `lastSyncedAt: string | null`; `Cart.tsx` shows a banner and disables quantity/remove/checkout while offline. **Why:** deterministic and unit-testable in RTL; a Workbox `StaleWhileRevalidate` on `GET /api/cart/:sessionId` would put personal cart data in an opaque URL-keyed Cache Storage entry that outlives a logout on a shared device, and would only be testable through a browser. **Trade-off:** a little duplicated state, and an offline user cannot change quantities. **Guardrail note:** `cartCache.ts` only *reads* `storybook-session` for a match check — it never writes, rotates, or clears it. The UUID session model (CLAUDE.md guardrail) is untouched, and `cartCache.test.ts` asserts the session key's value is unchanged after every operation.

### Alternatives considered

- **Workbox directly (`workbox-build` + a hand-written `sw.ts`)** (rejected): still a new dependency, so it does not dodge the guardrail, and it hands back every problem the plugin solves — base-path propagation, manifest authoring, HTML injection, dev/prod toggling, registration hook. Strictly more work for the same dependency cost.
- **Hand-rolled zero-dependency service worker** (rejected): the precache list must name Vite's content-hashed filenames, which change every build, so keeping it correct means parsing `dist/.vite/manifest.json` in a post-build script — reimplementing the bad half of Workbox. Stale caches are the most common PWA failure mode and hand-rolled invalidation is where they come from.
- **Manifest only, no service worker** (held as the fallback if the dependency had been declined): installable on Chromium but not offline-capable, which leaves the offline cart with no shell to render into.
- **`registerType: 'autoUpdate'`** (rejected): see decision 2.
- **Queued offline mutations replayed on reconnect** (rejected, held as an upgrade path): the genuinely app-like experience, but it needs conflict resolution against a server-authoritative cart, and the cart routes carry no idempotency key. A replayed "increase quantity" against a cart the server already changed produces a wrong total on a money path. Correct queuing is its own spec and would require server changes, which this spec excludes.

### Consequences

- **`zod` now ships in the client bundle.** `CartGetResponseSchema` is the first *runtime* (not type-only) import from `@storybook/shared` on the client: **+60.8 kB raw / +13.8 kB gzip**, taking the main chunk to 452.01 kB raw / **121.70 kB gzip**. Prescribed by the spec (reuse the OPS.3 contract rather than hand-write a parallel shape) and accepted, but it is a real cost on the mobile connections this slice exists to serve. **Reconsider trigger:** a second runtime schema import, or the gzip total passing ~150 kB — at which point either narrow the import surface or hand-validate the two fields the snapshot actually depends on.
- **A `.svg`-only icon set.** `icons/icon.svg` (`sizes: 'any'`) plus a maskable variant. Chromium accepts SVG icons; iOS Add-to-Home-Screen wants a raster `apple-touch-icon`. *Deferred* — tracked on the spec's `Deferred:` line in §ADR-worthy decisions; it is a one-file addition once #77 makes an iOS test possible.
- **Two offline tests at two fidelities, deliberately.** `e2e/tests/mobile/offline-cart.spec.ts` runs on the `:5173` dev server where `devOptions.enabled: false` means there is no service worker, so it uses `route.abort()` on `**/api/**` as a stand-in for a dropped network. A true cold offline reload there dies with `ERR_INTERNET_DISCONNECTED` before React boots — verified empirically, not assumed. `e2e/tests/pwa/offline-cart.spec.ts` (one file beyond Task 6's file list, added for this reason) does the real thing against `vite preview` on `:4173` with an active worker. Do not "consolidate" them; they cover different failure modes.
- **Swallowing mutation errors briefly regressed `BookDetail`, and the fix is part of this PR.** Wrapping the mutations in `mutate()` changed `addToCart` from *rejecting* on a network throw (as on `master`) to *resolving*, so `BookDetail.handleAdd`'s `await addToCart(...)` fell through to `setAdded(true)` and rendered a green "Added!" for a cart that gained nothing — a user-visible lie on the money path, **introduced by this change, not pre-existing**. Caught by the pre-merge reviewer. `addToCart` now returns `Promise<boolean>`; `BookDetail` renders an "Offline — not added" state instead, and `CartContext.test.tsx` pins both the `false` and `true` resolutions. **The general lesson:** a `catch` that converts rejection into a normal return silently changes every caller's control flow — the swallow must be paired with a return value the caller can act on.
- **Pre-existing dark-mode defect left in place, recorded so it is not lost.** The desktop `BookSpread` prev/next chevrons (`client/src/components/BookSpread.tsx:273,281`) carry `hover:bg-white` with no `dark:hover:` partner, so hovering either arrow in dark mode paints it solid white. The class string is byte-identical to `master` — it appears in this diff only because the lines were re-indented under the new `{!isNarrow && ...}` wrapper — so it is genuine pre-existing debt, not a Check 3 finding against this PR. The *new* narrow-mode chevrons at `:296,304` do carry `dark:hover:bg-gray-600`. **Deferred:** a one-line fix (`dark:hover:bg-gray-600`, matching the theater toggle at `:356`) plus a `dark-mode-parity-check` re-run; deliberately not bundled here because it is desktop styling and this slice is responsive repair. **Reopen trigger:** the next change that touches desktop `BookSpread` styling for any reason.
- **No server route changed, so no OPS.3 wire-shape obligation attached.** The client-side reuse of `CartGetResponseSchema` is asserted by `client/src/lib/__tests__/cartCache.test.ts` instead.
- **Production installability is unproven.** Install prompts, iOS Add-to-Home-Screen, Lighthouse, and `start_url`/`scope` resolution under the `/storybook/` base all need a live HTTPS origin, which #77 has taken away. The checklist lives in the spec's §"Deferred verification (blocked on #77)" and is reproduced in the PR body; nothing in a task's "Done when" depends on it.

---

## ADR-009 — Mobile × dark-mode e2e assertions mechanically discharge CLAUDE.md done-criterion #2

**Date:** 2026-08-16
**Status:** Accepted
**Scope:** `mobile-pwa` (MS2), Task 1's harness and its use by Tasks 2–6. Spec at [.code-captain/specs/mobile-pwa/spec.md](../specs/mobile-pwa/spec.md). Amends the *verification* half of CLAUDE.md §Done criteria #2; a corresponding note is added there pointing here.

### Decision

A Playwright spec that exercises a flow **in both themes at a mobile viewport**, asserting no horizontal overflow and minimum tap-target sizes, **is** the discharge of CLAUDE.md done-criterion #2 ("UI changes MUST be manually verified in browser in both light and dark mode") for the correctness half of that criterion. A human pass remains required only for *aesthetic* judgement, and the spec's §Autonomy ledger names per task where that applies.

The machinery is four items in `e2e/`:

- `forEachTheme(page, fn)` in `e2e/tests/mobile/_helpers.ts` — runs the body once in light and once in dark.
- `expectNoHorizontalOverflow(page)` — the objective "does it fit" assertion.
- `expectTapTargets(page, selector, min)` — takes an **explicit selector list**, never "all buttons", with `PRIMARY_TAP_MIN = 44` for money-path and primary controls and `NAV_TAP_MIN = 24` (WCAG 2.2 AA) for dense nav icons. Exceptions are visible in code and reviewable rather than silently waived.
- Two Chromium viewport projects — `mobile-pixel` (393×851) and `mobile-small` (360×740) — scoped by `testMatch: /tests\/mobile\/.*\.spec\.ts$/`, with the desktop `chromium` project scoped away via `testIgnore: /tests\/(mobile|pwa)\//`.

**The device matrix is Chromium-only; WebKit is deferred.** `devices['iPhone 13'].defaultBrowserType` is `webkit`, so adding it means installing and caching a second browser in `.github/workflows/pr-ci.yml` on every PR. Chromium emulation cannot reproduce WebKit-specific `100vh` address-bar accounting, `env(safe-area-inset-*)`, or iOS service-worker storage eviction — that gap is knowingly accepted here and paired with restoring the deploy (#77), since with nothing deployed there is no iOS surface to validate against anyway.

### Why

- **A 100%-UI feature would otherwise stall on human verification at every task.** Criterion #2 read literally makes six consecutive tasks each wait on someone holding a phone. Landing the harness *first* (Task 1, before any layout change) is what let Tasks 2–6 prove their own done-criteria in CI.
- **The assertions are objective where the criterion is objective.** "Does it overflow at 360 px", "is the checkout button 44 px", "does the dark palette apply" are measurable. "Did it wrap tidily" is not, and this ADR does not claim it.
- **A harness that asserts on itself.** `e2e/tests/mobile/helpers.spec.ts` tests the helpers against fixtures, so a helper that mis-measures fails rather than silently passing everything — the property that makes the discharge trustworthy.
- **The precedent is reusable.** Any future UI work can lean on `forEachTheme` + the overflow/tap-target helpers to satisfy the correctness half of #2, instead of re-arguing autonomy per feature.

### Alternative considered: keep criterion #2 strictly human, or add WebKit now

Keeping #2 strictly human is the honest reading of the rule as written, and it never over-claims. Rejected because it makes agent-executed UI work structurally impossible to complete without a synchronous human, and because the failures it catches at 360 px (overflow, unreachable controls, a missing `dark:` partner) are exactly the ones a machine catches *better* than a tired human — consistently, on every PR, in both themes.

Adding a WebKit project now was rejected on cost/benefit, not principle: a second browser download on every PR run buys coverage of an OS the project cannot currently deploy to. **Revisit trigger:** #77 restored, or the first iOS-specific bug report. That would be an amendment to this ADR, not a new decision.

### Consequences

- **CLAUDE.md §Done criteria #2 now names this ADR.** The note is deliberately small: the criterion is unchanged for aesthetics, and the mechanical discharge is spelled out rather than implied. Future UI specs should state which half they are claiming.
- **Aesthetic review stays a named obligation, not a silent gap.** The spec's §Autonomy ledger flags Task 4 (the mobile reader) as genuinely wanting a human read-through — reading comfort, illustration crop, page-flip feel. Task 4 passed mechanically; the human pass is recommended before merge and is listed in the PR body.
- **Mobile CI cost is bounded and measured.** Mobile projects run only `tests/mobile/**` and the `pwa` project only `tests/pwa/**`, so the desktop 28 are not re-run. Measured on this branch: **96 e2e tests pass in ~14 s locally**, and a cold `vite build` for the `pwa` project's preview server takes **<1 s** (Vite 8/Rolldown). The e2e job's 20-minute `timeout-minutes` is not at risk and needs no change.
- **Correction to the spec's premise about the mobile reader.** `spec.md` asserted that mobile should "step by one page rather than two"; Task 4 found that a `BookSpread` already renders exactly one story page (the left panel is that page's illustration, not a second page), so the described defect did not exist. The mobile work was a layout stack, not a paging change. Recorded here rather than by editing `spec.md`, so a future reader of the spec should treat this ADR as the correction.
- **`vi.mock` factories are a type hole the compiler does not close.** Task 6 added `offline`/`lastSyncedAt` to `CartContextValue`; `npx tsc --noEmit` stayed green at three of four `vi.mock('../../context/CartContext')` sites with the new fields missing, because a mock factory's return value is untyped. The fix — export the context value type and annotate the factory return — is now a paragraph in [docs/conventions/testing.md](../../docs/conventions/testing.md) so the next agent inherits the fence instead of rediscovering the hole.

---

## ADR-008 — PDF digital export pipeline (PS1)

**Date:** 2026-08-15
**Status:** Accepted
**Scope:** `pdf-export` (PS1, first deliverable of the Print/Subscription milestone). Spec at [.code-captain/specs/pdf-export/spec.md](../specs/pdf-export/spec.md); backlog issue #26.

### Decision

Ship `POST /api/books/:id/pdf` — an authed route that renders a screen-quality (RGB) PDF of a book on demand and streams it back. Five coupled decisions, captured as a set per the ADR-004/006/007 grouped precedent. Each names its trade-off.

1. **`@react-pdf/renderer` is the PDF layout library.** The renderer lives at `server/src/services/pdf.tsx` and declares `<Document>` / `<Page>` / `<View>` / `<Text>` / `<Image>` JSX. **Why:** the layout we need already exists as JSX in `client/src/components/BookSpread.tsx`, so a React-shaped library makes the port a translation rather than a redesign; it runs in plain Node with no headless browser, and ships its own types. **Trade-off:** no native CMYK or PDF/X-1a output — fine for PS1 (screen/RGB), but PS2's print-ready variant will need a post-process step or a library swap. Swapping means rewriting `pdf.tsx`; the route boundary and wire shape are unaffected.

2. **PDFs are ephemeral — generated per request, never persisted as a `pdf_url` on `Book`.** No Prisma migration, no new column, no `PdfDownload` model. **Why:** render cost is dominated by image reads, not by the layout engine (sub-second for a 5–12 page book), and persisting would add a cache-invalidation rule to *every* mutation path — revise, re-illustrate, page edit, restore-version. Missing one silently serves a stale book. **Trade-off:** repeat downloads re-render. **Reconsider trigger:** a book downloaded 50+ times by one buyer, or PS2's print-quality PDFs where re-rendering is genuinely expensive — at which point add a `pdf_assets` table keyed `{ book_id, variant, version }` so invalidation falls out of the version bump automatically.

3. **Wire-shape carve-out for binary endpoints.** OPS.3 / ADR-003 pins JSON response shapes with `toMatchObject`. A binary route has no JSON success shape, so the equivalent contract assertions are: `Content-Type` matches `application/pdf`, `Content-Disposition` matches `attachment; filename=".+\.pdf"`, and the body's first five bytes are `%PDF-`. Every 4xx/5xx envelope is still pinned the usual way against `BookPdfErrorResponseSchema`. `validate()` is mounted request-only (`validate({ request })`, no `response` key). **Why:** the rule's intent is "no response field goes unpinned"; for a binary body the pinnable surface is the headers and the format signature. **Trade-off:** this is a precedent — every future binary route (`POST /api/books/:id/epub`, `GET /api/orders/:id/receipt.pdf`) inherits it. **Follow-up:** codify the pattern as a paragraph in [docs/conventions/testing.md](../../docs/conventions/testing.md) so the next agent doesn't re-derive it — done in this PR, so the convention lands with the precedent rather than trailing it.

4. **Always-watermark in MVP; no feature flag.** Every interior story page carries "Created with StoryBook Storefront · storybook.example.com"; cover and end spreads are exempt. The policy is exported as `watermarkFor(book): string | null` — a single function whose body PS3 swaps to make the band tier-aware. **Why:** subscription tiers don't exist yet. A hidden `PDF_WATERMARK=false` env flag now would be config for a decision nobody has made, and would need re-designing anyway once tiers are real. **Trade-off:** PS3 must touch this file. The concrete bar we held: making the watermark conditional per book is a one-function-body edit, never a `<Page>`-template rewrite.

5. **POST, not GET, for the download route.** **Why:** the route performs real work (image reads + layout + render), and PS2 will send a body (`{ format: 'screen' | 'print' }`) that GET can't carry without breaking cache semantics. POST also keeps a stray `<a href>` or a bot crawl from firing renders. **Trade-off:** the client can't use a plain anchor — it fetches, reads the blob, and clicks a synthetic anchor at an object URL. Documented in `handleDownloadPdf` so nobody "fixes" it to GET.

### Alternatives considered

- **`pdfmake`** (rejected): smaller install, but its declarative-JSON document model doesn't map onto our existing JSX, so every layout decision would be re-described from scratch. The bundle-size win lands on the server, where it doesn't matter. Viable rewrite target if `@react-pdf/renderer` proves too slow at scale — the route boundary wouldn't change.
- **`puppeteer` HTML-to-PDF** (rejected): would render `BookSpread.tsx` directly for maximum reuse, but bundles ~150 MB of Chromium and adds a sandbox/proxy surface this project already has friction with (`NODE_TLS_REJECT_UNAUTHORIZED` handling in `server/src/index.ts`).
- **`pdf-lib` / `PDFKit`** (rejected): hand-rolling text wrapping, image positioning, and column layout is not PS1-sized scope.
- **Client-side `jsPDF`** (rejected): ~500 KB added to the browser bundle, worse image fidelity via DOM → canvas → PDF, and per-browser rendering variance. Decisive argument: PS2 must run server-side regardless (POD vendors expect a finished PDF uploaded to them), so a client-side PS1 would be thrown away.
- **Persist the PDF and store `pdf_url` on `Book`** (rejected): see decision 2 — the cache-invalidation surface is larger than the caching win.

### Consequences

- **New server dependencies.** `@react-pdf/renderer` (~1.5 MB, no native deps) plus `react` declared explicitly on the server — it is `@react-pdf/renderer`'s peer, and leaving it to resolve off the client's hoisted copy would be a phantom dependency. React and `react-dom` must stay version-locked across the workspace; a lockfile-only `npm update react react-dom` realigned them to 19.2.8.
- **`server/tsconfig.json` now compiles TSX** (`"jsx": "react-jsx"`, `src/**/*.tsx` in `include`). The server previously had no JSX anywhere.
- **`pdf.tsx` is an intentional duplicate of `BookSpread.tsx`'s layout.** Different reconcilers; the DOM component cannot be imported. When the web spread changes shape, change both — the file header says so.
- **Two accepted visual deltas from the web reader, both recorded in the `pdf.tsx` header.** *Deferred:* (a) the PDF renders in built-in Helvetica rather than the web `font-display` family — registering a bundled OFL font is a one-call `Font.register()` swap if anyone asks for the fidelity; (b) the cover renders a disc tinted with `cover_color` instead of `cover_emoji`, because the standard-14 PDF fonts carry no emoji glyphs and the supported workaround (`Font.registerEmojiSource`) fetches images from a CDN at render time. Neither blocks PS1; both are one-file changes.
- **Text is sanitised to WinAnsi before rendering** (`sanitizeForPdf`). Emoji and CJK in story text would otherwise render as missing glyphs. Revisit if the product ever supports non-Latin stories — that needs a real embedded font, not a wider filter.
- **No rate limiting on the route.** It is authed, and generation costs CPU rather than API spend, so it sits outside the ADR-00x spend-ceiling machinery. Revisit if abuse shows up.

---

## ADR-007 — Per-character portraits + FLUX Kontext consistency (IV2 Phase 2)

**Date:** 2026-06-05
**Status:** Accepted
**Scope:** `character-portraits` (IV2 Phase 2). Spec at [.code-captain/specs/character-portraits/spec.md](../specs/character-portraits/spec.md); backlog issue #23. **Supersedes ADR-006 decision 3** (the `ImageGenerator` interface boundary) and **supplements ADR-002** (JSON-on-Book cast).

### Decision

Phase 2 of Illustration v2 adds one canonical portrait per character, a per-character iterate loop, and feeds approved portraits as reference images into page generation for cross-page character consistency. Eight coupled decisions, captured as a set (per the ADR-004/006 grouped precedent) — they share one feature's context and only make sense together. Each names its trade-off.

1. **Storage: extend the embedded `characters_json` with `portrait_url`, not a promoted Character table.** Add `portrait_url?: string | null` to `CharacterSchema`. **Why:** ADR-002 chose JSON-on-`Book` deliberately (no query pressure, cast always loaded with its book); Phase 2 adds zero query pressure and exactly one field. **Crucially this is NOT a Prisma migration** — `characters_json` is already a `String?` column, so only the JSON shape + the shared Zod wire shape + seed shape change. **Trade-off:** a real table would be a more natural home for per-character data; deferred to Phase 3 (LoRA, #24) as a deliberate ADR-002 supersession, not a side effect of adding a URL. (Supplements ADR-002.)

2. **Portrait version history reuses `IllustrationVersion` via a `page_number` sentinel slot, not a dedicated table.** `page_number = PORTRAIT_SLOT_BASE (1000) + characterIndex`; real pages are 1..MAX_PAGES (15), so no collision. The existing `@@unique([book_id, page_number, version])` gives per-character version numbering for free. **Why:** zero new table, reuses the cascade + unique-version machinery that already does exactly this for pages. **Trade-off:** overloading `page_number` is subtle — the legible fallback is a dedicated `CharacterPortrait` table if the sentinel proves error-prone.

3. **Widen the `ImageGenerator` interface to `generate(prompt, opts?: { referenceImages?: string[] })`.** **This supersedes ADR-006 decision 3** ("the interface owns ONLY the network call"). The optional second arg keeps the no-reference path byte-identical, so IV1's regression tests pass unchanged. **Why:** IP-Adapter-style consistency requires passing reference images to the provider — exactly the "future provider needs the interface widened" case ADR-006 dec 3 anticipated. **Trade-off:** the interface now carries an input concern beyond a bare prompt; kept minimal (one optional field) to limit the blast radius.

4. **Reference mechanism: FLUX Kontext (`fal-ai/flux-pro/kontext` + `/multi`), not the literal IP-Adapter (`fal-ai/flux-general/image-to-image`).** Portraits are generated prompt-only on Flux Pro 1.1 (no reference yet); *page* generation with references routes to Kontext (single ref → `kontext`, 2+ → `kontext/multi`). **Why:** Kontext is purpose-built for cross-scene character preservation, holds the flat **$0.04/image** the cost model assumes, returns the **same `{ images: [{ url }] }`** shape the existing parser handles, and needs no HuggingFace path/encoder config. The literal `flux-general` IP-Adapter prices per-megapixel (~$0.075/MP — reopens the cost shock IV2 closes) and needs HF config. **Trade-off:** Kontext may give slightly less identity-lock than tuned IP-Adapter; swapping is a one-file provider change (the wire/UI design is mechanism-agnostic via `referenceImages: string[]`). Pinned from Fal docs 2026-06-05.

5. **Reference-image plumbing: inline base64 data-URI, not a public URL.** The generator resolves on-disk portrait paths to bytes and inlines them in the request. **Why:** Fal needn't reach `localhost` — works in local dev (where the demo runs) without a tunnel. **Trade-off:** larger request bodies (~1024² PNGs per reference).

6. **Approve-cast is a client-side soft nudge, not server-enforced; no persisted `cast_approved` field.** The client disables bulk-illustrate until required characters have portraits OR the user clicks "Skip portraits — illustrate anyway"; the server never 403s a portrait-less book (it falls back to prompt-only). **Why:** consistent with the F4b no-server-gate posture (ADR-006); approval is a one-time workflow nudge, not durable state worth a migration; the presence of `portrait_url` is itself the readiness signal. **Trade-off:** approval state doesn't survive across devices/sessions beyond what `portrait_url` presence implies.

7. **"Required character" = primary + antagonist only; supporting characters get optional portraits.** The gate and the per-page reference set use primary + antagonist. **Why:** these are the identity-critical recurring figures; forcing portraits for every walk-on supporting character multiplies cost for marginal consistency benefit, and IP-Adapter generalizes unevenly to non-primary subjects (research open-question #5). **Trade-off:** a prominent supporting character won't be consistency-locked unless the user opts in.

8. **Portrait routes address characters by `:characterIndex` (array index into hydrated `characters`), not `:role`.** **Why:** `:role` can't disambiguate two same-role characters (e.g. two supporting) and names aren't guaranteed unique. **Trade-off:** index is positional — reordering the cast would repoint indices, but the cast is a fixed JSON array per book, so this is stable in practice.

### Alternatives considered

- **Promote characters to a Prisma table** (rejected for Phase 2): reverses ADR-002 for zero query benefit, with a large blast radius (`hydrateBook`, `generate.ts` write, `BookVersion` snapshot/restore, a backfill migration). Held as the Phase 3 upgrade path when LoRA + per-page character mapping actually need it.
- **Literal IP-Adapter (`flux-general`)** (rejected): per-megapixel pricing + HF-path config; held as a swap-in if maximum likeness is later needed.
- **Dedicated `CharacterPortrait` history table** (held as fallback): cleaner than the sentinel slot but duplicates `IllustrationVersion` machinery.
- **Always-Kontext** (rejected): Kontext is image-to-image and needs an input image; the first portrait has no reference, so branching on `referenceImages?.length` is unavoidable (and preserves IV1's prompt-only regression test).

### Consequences

- **`CharacterSchema.portrait_url` ships on every hydrated Book response** — a wire-shape change (OPS.3/ADR-003); pinned by a Check-4 `toMatchObject` assertion. Legacy blobs without the key still validate (`.nullable().optional()`).
- **No Prisma migration; there IS a seed-shape change** (`portrait_url` key) — `db:hydrate` must load cleanly with the key present or absent.
- **IV1 regression boundary preserved:** the no-reference `generate(prompt)` path is byte-identical; `IMAGE_PROVIDER=openai` still works (OpenAI uses the `/v1/images/edits` endpoint when references are present).
- **Phase 3 (#24, LoRA)** is the point to revisit decision 1 (promote to a table) and decision 4 (the `@fal-ai/client` SDK for genuinely-async fine-tuning), each as a superseding ADR.

---

## ADR-006 — Image-provider abstraction & Fal.ai migration (IV1 Phase 1)

**Date:** 2026-06-05
**Status:** Accepted
**Scope:** `illustration-fal-migration` (IV1 Phase 1). Spec at [.code-captain/specs/illustration-fal-migration/spec.md](../specs/illustration-fal-migration/spec.md); backlog issue #22.

### Decision

Phase 1 of Illustration v2 migrates image generation from OpenAI `gpt-image-1` (~$0.17–0.45/image) to Fal.ai Flux Pro 1.1 (~$0.04/image, a ~5–8× cost reduction) behind a provider abstraction. Three coupled decisions, captured as a set rather than three separate ADRs — they share one feature's context and only make sense read together. Each names its trade-off honestly.

1. **Raw `fetch`, not the `@fal-ai/client` SDK.** Both `OpenAIImageGenerator` and `FalImageGenerator` call their providers via raw `fetch`. **Why:** zero new `server/package.json` dependency (no guardrail trip); Flux Pro 1.1 has a synchronous `https://fal.run/<model-id>` endpoint that returns inline in ~5–10s, well under the existing 120s `AbortController` cap, so queue polling isn't needed; both providers then share the same timeout + `Buffer` shape and the existing `globalThis.fetch` test mock works for both. **Trade-off:** if Phase 3 (LoRA fine-tuning, genuinely async/multi-minute) lands we'd hand-roll queue polling the SDK gives for free — revisit the SDK then. We own auth-header + response-shape parsing.

2. **Default provider = `fal`; fallback is env-only (no runtime auto-fallback).** `IMAGE_PROVIDER` (default `fal`) selects the generator; an operator reverts by setting `IMAGE_PROVIDER=openai`. A Fal error surfaces as the existing 500 envelope — there is **no** automatic retry against OpenAI. **Why:** default `fal` delivers the cost win this issue exists for; runtime auto-fallback would add double-billing and double-latency risk and would obscure which provider failed. **Trade-off:** a Fal outage requires a manual env flip + redeploy to fail over, rather than degrading automatically.

3. **The `ImageGenerator` interface owns only the network call; versioning + Prisma persistence stay in the public service functions.** `generate(prompt): Promise<Buffer>` returns bytes only; `generateIllustration`/`generateCover` keep owning prompt assembly, on-disk versioning, and the `illustrationVersion` row write (page path only — `generateCover` writes no row, an asymmetry preserved from before). **Why:** keeps persistence DRY and provider-agnostic, and keeps the `books.test.ts` module-boundary mock (which assumes the public fn owns the row write) valid. **Trade-off:** a future provider that needs to influence persistence (e.g. returning a provider-hosted URL instead of bytes) would need the interface widened.

### Alternative considered: `@fal-ai/client` SDK + runtime auto-fallback

Adopt the SDK for uniform queue/auth handling, and have the service automatically retry against OpenAI when Fal errors.

Rejected for Phase 1: the SDK is a new dependency (guardrail) and doesn't mock through `globalThis.fetch`, so it would force a different test strategy for near-zero Phase-1 benefit (Flux Pro 1.1 is synchronous). Runtime auto-fallback was rejected for the double-billing/latency and failure-masking reasons in decision 2. Revisit the SDK if/when Phase 3 LoRA training (genuinely async) is scheduled — that would warrant a superseding ADR.

### Consequences

- **`IMAGE_PROVIDER` is now load-bearing config.** The three former literal `process.env.OPENAI_API_KEY` route gates (`generate.ts` ×2, `books.ts` ×1) are replaced by a provider-aware `isImageGenConfigured()`; with `IMAGE_PROVIDER=fal` the system gates on `FAL_KEY`. Deploys must set both `IMAGE_PROVIDER` and the selected provider's key.
- **OpenAI remains a first-class fallback, not dead code.** Setting `IMAGE_PROVIDER=openai` restores byte-identical prior behavior; the OpenAI regression test pins this.
- **The provider boundary is the extension point for Phase 2/3.** Per-character refs (IP-Adapter, Phase 2) and LoRA (Phase 3) plug in as new generators or interface extensions; they must respect the "persistence stays in the public fn" boundary or explicitly supersede decision 3.

---

## ADR-005 — "Pre-merge follow-ups" task is conditionally emitted by the planner

**Date:** 2026-06-03
**Status:** Accepted
**Scope:** ADR-tracking enforcement (skill + reviewer + planner). Spec at [.code-captain/specs/adr-tracking-enforcement/spec.md](../specs/adr-tracking-enforcement/spec.md); backlog issue #53.

### Decision

The planner emits a final **"Pre-merge follow-ups"** task (whose Done-when runs `adr-tracking-check <slug>` and requires zero orphaned ADR-worthy items) **only when the spec has a non-empty `## ADR-worthy decisions` section** — not on every plan.

This is the load-bearing half of the #53 enforcement mechanism: the conditional task puts the ADR-tracking obligation into the developer's execution path (a real "Done when"), where before it lived only as the planner's punt-language and the reviewer's pre-merge backstop. The condition gates *whether the task appears at all*.

### Why

- **Adapt don't bloat.** An always-emitted task would add a no-op "nothing to track" step to every plan whose spec has zero ADR-worthy items — ceremony for the common small feature. The planner already reads the full spec at workflow step 1, so detecting a non-empty section is free.
- **The obligation belongs in the developer's path, not just the reviewer's.** #53's root finding was that no task's Done-when referenced ADR items, so a developer had no reason to action them. The conditional task fixes exactly that, without taxing plans that don't need it.
- **Defense in depth is preserved.** Even when the planner omits the task (e.g. forgets to check the section), reviewer Check 6 still catches orphaned items at `/ship`. The conditional task is the early gate; the reviewer is the backstop.

### Alternative considered: always emit the task

Unconditionally append the "Pre-merge follow-ups" task to every plan.

**Pros:** no "did the planner check the spec section?" failure mode; uniform task lists. The skill on an empty item set is a clean no-op anyway, so the task would just report "nothing to track."

**Why rejected:** it adds a no-op task to the (common) small feature whose spec flagged no ADR-worthy decisions — against the project's "adapt don't bloat" value. Reconsider if planners are observed skipping the conditional in practice; flipping to always-emit is a one-line planner-rule change.

### Consequences

- **Standing planner behavior.** `.claude/agents/planner.md` carries this as a decompose-step heuristic and shows the conditional task in its `tasks.md` template. Future planners follow it without re-deriving the rationale.
- **The skill is the single source of the rule.** `adr-tracking-check` is invoked by both the conditional developer task (early) and reviewer Check 6 (backstop) — encode once, run at two points. This follows the established reviewer-check → skill extraction pattern (the 3rd instance, after `wire-shape-check`/Check 4 and `dark-mode-parity-check`/Check 3).
- **This very spec dogfooded the rule.** `adr-tracking-enforcement` has a non-empty ADR-worthy section, so its own plan carried the Pre-merge follow-ups task (Task 5) — which produced this ADR.

---

## ADR-004 — Theater mode interaction & layout decisions

**Date:** 2026-06-02
**Status:** Accepted
**Scope:** TS1 — theater-mode feature, shipped in PR #54. Spec at [.code-captain/specs/theater-mode/spec.md](../specs/theater-mode/spec.md).

### Decision

Theater mode (widen the book spread to fill the viewport) is a UI-only client feature governed by six coupled decisions, captured here as a set rather than as six separate ADRs — they're small, share one feature's context, and reading them together is how they make sense. Each names its trade-off honestly.

1. **State lives in the URL (`?theater=1`), not React state or `localStorage`.** Derived via `useSearchParams`; `searchParams.get('theater') === '1'`. **Why:** bookmarkable, deep-link friendly, and the browser Back button exits theater mode for free (`setSearchParams(next, { replace: false })`) — no cross-tab state sync. **Trade-off:** URL pollution if more "view mode" params accumulate over time; strict `=== '1'` means `?theater=true` silently does nothing.

2. **Layout swap in place, not an overlay/portal.** Theater mode widens the existing frame, footer, revise-panel, and page-wrapper rather than rendering a modal. **Why:** simpler component tree — no focus-trap, escape-key, or scroll-lock contracts to honor; no portal. **Trade-off:** less of a "modal" immersive feel than a true full-screen overlay would give.

3. **Toggle hidden on `<md` (<768px) viewports** via `hidden md:inline-flex`; no alternative mobile affordance. **Why:** a ~90vw widen is meaningless on a 375px screen, so mobile keeps the default layout. **Trade-off:** the feature is desktop-only by design.

4. **Inline revise panel stays vertically stacked when widened** — it grows to the same `max-w` as the spread but remains below it. **Why:** smallest diff vs. the current layout; side-docking would require a new grid container. **Trade-off:** at 90vw a stacked revise panel needs more scrolling than a side-docked one would.

5. **Animate via Tailwind `transition-all duration-200 ease-in-out`** on all four widening containers. **Why:** matches the existing page-flip animation duration so the two don't visually fight; plain Tailwind utilities (`transition-all duration-200 ease-in-out`), no new dependency. **Trade-off:** animating `max-width` can be janky on some browsers — mitigated by the short 200ms duration.

6. **Test the lifted prop via a prop-capturing mock.** `BookDetail.test.tsx`'s `BookSpread` mock was upgraded to capture the `theater` prop into a module-level variable and expose `onToggleTheater` as a stub button, so the parent's URL→prop wiring is assertable without rendering the real child. **Why:** isolates the URL-state logic under test from `BookSpread`'s internals. **Trade-off:** a module-level capture variable needs a `beforeEach` reset to avoid cross-test bleed; flagged for promotion to a testing-conventions note if the pattern recurs.

### Alternative considered: full-screen overlay with local state

A `position: fixed` overlay (or React portal) toggled by component state would give a stronger "theater" feel and decouple the widened view from the document flow.

Rejected because it pulls in the full modal contract — focus management, escape-to-close, scroll-lock, and `aria-modal` semantics — for a feature whose value is simply "more horizontal room to read." Local/`localStorage` state would also forfeit the bookmark + Back-button behavior that decision 1 buys for free. If theater mode later needs to hide surrounding chrome entirely (nav, footer), revisit this — an overlay becomes the better tool and would warrant a superseding ADR.

### Consequences

- **`?theater=1` is now a load-bearing URL contract.** Any future "view mode" params should follow the same strict-equality, Back-button-friendly pattern; watch for URL-param accumulation (decision 1's trade-off) and consolidate if a third view param appears.
- **Page-wrapper widens regardless of `viewMode`.** Per the spec's Resolved Question #1, the wrapper widens whenever `?theater=1` is present even in reader view; this is intentional (harmless horizontal-whitespace change) and avoids special-casing. Reviewer treats AC#7 as referring to reader-view *visual rendering*, not wrapper width.
- **The prop-capture test pattern (decision 6) is a candidate testing convention.** If it recurs in other parent→child prop-wiring tests, promote it into `docs/conventions/testing.md` rather than re-deriving it per test file.

---

## ADR-003 — Zod schemas as source of truth for client/server type sharing

**Date:** 2026-05-18
**Status:** Accepted
**Scope:** OPS.3 — wire-shape contracts across all 5 server domains (orders, cart, books, admin, test). Shipped across PRs #22, #23, #24.

### Decision

Adopt Zod schemas (in a source-only `@storybook/shared` workspace package) as the single source of truth for every client/server wire contract. Server routes validate request bodies via a `validate()` Express middleware that consumes the schemas; client and server both import inferred TypeScript types from the same schemas.

Layout:

```
shared/src/
  orders.ts, cart.ts, books.ts, admin.ts, test.ts   ← Zod schemas per domain
  index.ts                                           ← re-exports

server/src/middleware/validate.ts                   ← Express middleware
client/src/types.ts                                   ← re-exports wire shapes from @storybook/shared
server/src/types.ts                                   ← re-exports wire shapes + adds DB/auth-only shapes
```

When OpenAPI's specific capabilities become valuable later (multi-language SDKs, vendor-facing docs, mock servers), generate the OpenAPI spec **from** the existing Zod schemas via `@asteasolutions/zod-to-openapi` or `zod-openapi`. Zod remains the source of truth in every future state — this is **not** "Zod now, OpenAPI rewrite later."

### Why

- **Runtime validation + compile-time inference from one declaration.** `z.object({...})` produces both an Express-validatable schema and a TS type via `z.infer<typeof Schema>`. No drift, no codegen step.
- **OpenAPI's killer features only pay off with non-TS clients or external consumers** — multi-language SDK generation, Swagger UI, mock servers, partner docs. None are on the storefront's near-term roadmap. Adopting OpenAPI now is enterprise tax for capabilities we don't yet use.
- **Refactor-safety.** TS rename-symbol propagates schema changes across client/server in one operation. OpenAPI-first generated TS types are less ergonomic and don't refactor with the source.
- **Forward-compatible.** When a non-TS client (mobile, partner SDK) lands, the migration is "add `zod-to-openapi`," not "rewrite the contract layer."

### Alternative considered: OpenAPI-first

Define the API in `openapi.yaml`, generate TS types and a validation layer from the spec.

Why rejected for the current phase:

- **Enterprise tax without benefit.** OpenAPI is built for cross-language API contracts and external consumers. The storefront has neither today.
- **Less ergonomic generated types.** Codegen produces verbose TS that doesn't compose well with the rest of the codebase. Zod's `z.infer<typeof Schema>` produces idiomatic types.
- **Separate runtime layer.** Validation isn't bundled — you add `ajv` or similar. Zod combines both responsibilities cleanly.

**Reconsider trigger:** a non-TS client lands on the roadmap, or external API consumers/partners need formal docs. At that point we generate OpenAPI *from* Zod — zero contract rewrite, just an additional output.

### Consequences

- **Zod schemas live in `@storybook/shared`** — a source-only workspace package with no build step. Both client and server link it via `"@storybook/shared": "*"`.
- **Auth middleware order rule.** `requireAuth` / `adminGate` runs **before** `validate()` so 401/403 wins over 400. This is now load-bearing — any new protected route must keep this order.
- **Server `types.ts` is split-shape.** `server/src/types.ts` re-exports wire shapes from `@storybook/shared` and *adds* DB-row + auth shapes that stay server-local. `client/src/types.ts` re-exports the same wire shapes only.
- **Pre-existing type drift fixed during migration.** `is_featured` and `is_user_created` were `number` in legacy `server/types.ts`; both are now `boolean` (matching Prisma + Zod). Not a wire-shape change — a latent bug surfaced and corrected.
- **OpenAPI generation is deferred indefinitely.** Add `@asteasolutions/zod-to-openapi` only when a concrete trigger lands. The Zod schemas are forward-compatible — no rework cost when that trigger fires.

---

## ADR-002 — Character cast persisted as JSON column, not separate table

**Date:** 2026-05-14
**Status:** Accepted
**Scope:** MVP-1 of the illustration/authoring upgrade (see [roadmap.md](roadmap.md))

### Decision

Persist the character cast on `Book.characters_json` (a `String?` column holding a JSON-encoded array) rather than introducing a `Character` table with a foreign key to `Book`.

Shape:

```ts
type Character = {
  role: 'primary' | 'antagonist' | 'supporting';
  name: string;
  descriptor?: string;
  relationship?: string;
};
```

### Why

- **Matches an existing precedent.** `BookVersion.pages_json` already encodes structured data as JSON in a column. Following the same pattern keeps the schema small and the mental model consistent.
- **No query pressure.** We do not search, filter, or aggregate by character. Characters are always loaded with their parent Book.
- **Migration is additive and reversible.** One nullable column; no FKs, no joins to update, no risk to existing rows.
- **Caps are small.** Max 6 characters per book (enforced at the UI) keeps the JSON blob tiny — typically well under 1 KB.

### Alternative considered: separate `Character` table

A normalized `Character` table with a FK to `Book` would be more "correct" if any of these become true later:
- We want to query characters across books (e.g. "all books featuring a character named Luna").
- Characters carry their own per-page state (which pages they appear on, screen time, etc.).
- We need referential integrity from other entities (e.g. character ↔ reference photo).

If those needs land, migration is straightforward: read `characters_json`, write rows to a new `Character` table, drop the column. We accept that re-migration cost as cheap insurance for the simpler initial design.

### Consequences

- **Hydration helper required.** `server/src/routes/books.ts` exports `hydrateBook()` which parses `characters_json` into `characters: Character[]` on every read. All GET/POST/PUT response builders must funnel through it (already wired in this commit).
- **No DB-level validation of character shape.** The hydrator tolerates bad JSON by returning `[]`. The server route validates the shape on write via `normalizeCharacters()` in [generate.ts](../../server/src/routes/generate.ts).
- **Phase 2 work (character reference photos) needs this revisited.** If photos attach per-character with their own URL/metadata, the JSON blob may need to expand or be split out. Flag a follow-up ADR at that point.

---

## ADR-001 — Documented harness on the upstream Code Captain template

**Date:** 2026-05-14
**Status:** Accepted with deferred upgrade — see [harness-backlog.md](harness-backlog.md)

### Decision

Continue running on the local project-specific `.claude/agents/` (booksmith, qa, storefront) rather than installing `npx @devobsessed/code-captain` v0.6.0.

### Why

Demo is the day after this decision was made (2026-05-15). The full template install adds 4 new generic agents, 7 commands, 6 skills, an `.mcp.json`, and a `.code-captain/` directory structure — substantial diff with non-zero risk of conflict with the existing custom agents. Not worth the rollback risk this close to a stakeholder demo.

### What we adopted *from* the template anyway

- The `.code-captain/product/` directory convention (this file, plus [roadmap.md](roadmap.md)). Lightweight; matches what the template would have produced via `plan-product`.

### What's deferred

See [harness-backlog.md](harness-backlog.md) for the full list of upstream items worth revisiting after the demo.
