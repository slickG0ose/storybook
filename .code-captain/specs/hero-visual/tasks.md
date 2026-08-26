# Home hero visual — task plan

> Spec: [spec.md](spec.md)
> Status: Complete — all 8 tasks Done (2026-08-26)
> Last updated: 2026-08-25

## Overview

Eight tasks, client-only. Task 1 produces the derived asset and is the gate for everything
else; Task 2 is the guard that keeps a raw PNG from ever landing. Task 3 is the actual
recomposition and is the only substantial code change. Tasks 4-6 are tests (unit, PWA
config, e2e). Task 7 is the human half of done-criterion #2. Task 8 is the ADR/follow-up
sweep.

Natural parallel cut: Tasks 2 and 5 are independent of the layout work and can land beside
Task 3. Tasks 4 and 6 both depend on Task 3's final markup.

## Cross-cutting constraints

- **Wire-shape:** none. No route response is added or changed; the hero fetches nothing.
  There is no Zod schema in this change and no wire-shape assertion is required. Say so
  explicitly in the PR body so the reviewer's Check 4 does not have to infer it.
- **Auth middleware order:** not applicable. No protected route, no session change, no
  cart-session touch.
- **Dark-mode parity:** every new surface — the art column wrapper, the mat, the ring,
  and any changed hero chrome — needs a `dark:` partner. The `dark-mode-parity-check`
  skill runs on `/ship`.
- **Migrations:** none. No Prisma change.
- **No new dependency — hard.** `git diff master...HEAD -- '**/package.json'
  '**/package-lock.json'` must be empty at the end. Derivation runs via `npx -y`, which
  installs nothing into the repo. If neither `npx sharp-cli` nor the `sips` JPEG fallback
  fits the byte budget, **stop and ask the user** rather than adding a package.
- **Guardrails touched:** none of the CLAUDE.md confirm-first list. No `data.json`, no
  seed-shape change, no model or SDK change, no paid API, no auth/session change, no test
  deletions. Surface this as a clean bill in the hand-back rather than staying silent.
- **Do not modify anything under `server/`.** The source PNG is read only.
- **Preserve the pinned H1.** `client/src/pages/__tests__/Home.test.tsx:101` and
  `e2e/tests/home.spec.ts:11` both pin `Magic`; `e2e/tests/dark-mode.spec.ts:12` waits on
  `h1`. The element, its text nodes, and the `<span>Magic</span>` split all stay verbatim.

## Tasks

### Task 1 — Derive and commit the hero asset, and clear the dead scaffold assets

**Zone:** client
**Depends on:** none
**Parallel-safe with:** none (everything else needs the files)

**Status:** Done (2026-08-25)

**Files to add or change:**
- `client/src/assets/hero/spot-for-sunny-bench-960.webp` — new; 960×960, WebP q≈75
- `client/src/assets/hero/spot-for-sunny-bench-480.webp` — new; 480×480, WebP q≈75
- `client/src/assets/hero/README.md` — new; provenance and the exact command that was run
- `client/src/assets/hero.png` — **delete** (unreferenced Vite-template cube; name collision)
- `client/src/assets/react.svg` — **delete** (unreferenced)
- `client/src/assets/vite.svg` — **delete** (unreferenced)

**Derivation contract:**

```
source: server/public/illustrations/b2fa23cf-3156-4b89-83e7-82d98c32c8b7/page-4-v2.png
        (1024x1024 PNG, 2,497,998 bytes — read only, never modified or copied)
crop:   none. native 1:1 preserved.
out:    960x960 and 480x480, WebP, quality ~75, sRGB, metadata stripped
budget: largest file <= 150 KB; total of client/src/assets/hero/ <= 200 KB
tool:   npx -y sharp-cli ...   (runs from the npx cache; nothing enters package.json)
```

Do **not** pick `page-4-v3.png` or `page-4-v4.png`. Those are orphaned revisions and `-v4`
renders Sunny as a dog — the exact defect the v2 feedback corrected. `page-4-v2.png` is the
URL `server/prisma/demo-seed-fixtures/spot-for-sunny.json` points at.

Fallback if `npx sharp-cli` will not run: `sips -s format jpeg -Z 960 -s formatOptions 72`
(local `sips` reads WebP but cannot write it; there is no `cwebp`, ImageMagick, or `sharp`
on this machine). Accept the JPEG only if it lands inside the budget. If it does not,
**stop and ask** — do not add a dependency and do not ship a heavier asset.

`README.md` must record: source path, book ID `b2fa23cf-3156-4b89-83e7-82d98c32c8b7`,
"no crop, native 1:1", the encoder and quality actually used, the verbatim command, and
the resulting byte sizes.

**Tests to write:** none in this task — Task 2 is the guard.
- Wire-shape assertion required: no (no route touched).

**Manual verify:**
- Open both `.webp` files and confirm they are the bench scene, not the dog revision.
- `ls -l client/src/assets/hero/` — sizes inside budget.
- `git status` shows the three scaffold deletions and no `package.json` churn.

**Done when:** both variants exist inside budget, the README reproduces them, the three
dead scaffold files are gone, and no repo grep finds a reference to the deleted names.

---

### Task 2 — Byte-budget and provenance guard

**Zone:** client
**Depends on:** Task 1
**Parallel-safe with:** 3, 5

**Status:** Done (2026-08-25). Walk is recursive; dotfiles count toward the byte total and
the no-PNG rule but are exempt from the extension allowlist so a `.DS_Store` cannot red the
suite.

**Deviation from the signature in this task body:** `new URL('../assets/hero/',
import.meta.url)` is intercepted by Vite's `asset-import-meta-url` transform and resolves to
an `http://` URL under Vitest, so `fileURLToPath` throws. The shipped test uses
`join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'hero')`. Do not copy the
snippet below into a new test without this fix.

**Files to add or change:**
- `client/src/__tests__/heroAsset.test.ts` — new (sits beside the existing
  `pwaOptions.test.ts`, which is the precedent for a config/artifact test in this folder)

**Signatures / shapes:**

```ts
// Reads from disk with node:fs — jsdom is the environment but the runtime is Node.
const HERO_DIR = new URL('../assets/hero/', import.meta.url);
const MAX_SINGLE_BYTES = 150 * 1024;
const MAX_TOTAL_BYTES  = 200 * 1024;
const ALLOWED_EXT = ['.webp', '.jpg', '.md'];   // .md is the README
```

**Tests to write:**
- `client/src/__tests__/heroAsset.test.ts` — asserts:
  - the directory contains at least one image and every image file is `.webp` or `.jpg`;
  - **no `.png` exists under `client/src/assets/hero/`** — the single assertion that stops
    a raw 2.2 MB source file from being dropped in;
  - no single file exceeds `MAX_SINGLE_BYTES`;
  - the sum of all files in the directory does not exceed `MAX_TOTAL_BYTES`;
  - `README.md` exists and mentions the source book ID `b2fa23cf-3156-4b89-83e7-82d98c32c8b7`,
    so provenance cannot silently rot.
- Failure messages must name the offending file and its actual size. A guard that fails
  with "expected true to be false" teaches the next person nothing.
- Wire-shape assertion required: no.

**Done when:** `cd client && npm test` green; deliberately dropping the source PNG into
the folder makes this test fail (verify by hand, then remove it).

---

### Task 3 — Recompose the hero around the art

**Zone:** client
**Depends on:** Task 1
**Parallel-safe with:** 2, 5

**Status:** Done (2026-08-25). Dark-mode brightness filter judged unnecessary by the
developer's own screenshot pass and left off; Task 7 still owns the formal call.

**Shipped `HERO_ALT` (Tasks 4 and 6 select on this):**
`Watercolour illustration of two young girls sitting side by side on a wooden bench under a leafy tree, an orange backpack between them, one turning to greet the other.`

**Two deviations worth carrying forward:**
- **Section padding is now `py-16 sm:py-20 lg:py-24`**, from `py-20 sm:py-24`. The task
  body's target markup said so, but the prose above it said the section keeps its existing
  background verbatim. The markup won. Real visual change the prose did not name.
- **`sizes` overstates the desktop render by 20px.** The image lays out at 420 CSS px at
  1440, not 440, because `max-w-6xl` minus the gap minus the mat's `p-2.5` lands at 420.
  Left verbatim rather than quietly retuned, since Task 4 may pin it. Harmless: it only
  biases toward the larger candidate, which a 2x display picks anyway.

**Files to add or change:**
- `client/src/pages/Home.tsx` — the hero `<section>` at lines 195-245

**Signatures / shapes:**

```tsx
import heroArt960 from '../assets/hero/spot-for-sunny-bench-960.webp'
import heroArt480 from '../assets/hero/spot-for-sunny-bench-480.webp'

const HERO_ALT =
  'Watercolour illustration of two young girls sitting side by side on a wooden bench ' +
  'under a leafy tree, an orange backpack between them, one turning to greet the other.'

// Section keeps its existing background + both radial-gradient stacks verbatim,
// drops `text-center` from the section (it moves onto the text column), and gains
// a max-w-6xl grid wrapper.
<section className="relative bg-cream dark:bg-gray-900 py-16 sm:py-20 lg:py-24 px-4 transition-colors
                    bg-[radial-gradient(...unchanged...)] dark:bg-[radial-gradient(...unchanged...)]">
  <div className="relative max-w-6xl mx-auto grid gap-10 lg:gap-14 lg:items-center
                  lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">

    {/* Text column — DOM order is fixed at all breakpoints; no `order-*`. */}
    <div className="text-center lg:text-left">
      <h1 …unchanged text, `max-w-4xl mx-auto` -> `max-w-4xl mx-auto lg:mx-0`>
        Stories Made with <span className="text-purple-500 dark:text-purple-300">Magic</span>
      </h1>
      <p  …unchanged text, `mx-auto` -> `mx-auto lg:mx-0`>
      <div className="flex flex-col sm:flex-row items-center lg:items-start
                      justify-center lg:justify-start gap-4"> …CTA unchanged… </div>
      <div className="max-w-xl mx-auto lg:mx-0 mt-8"> …search bar unchanged… </div>
    </div>

    {/* Art column. Mat carries the app's existing card language so the bright square
        has a mid-tone surround on gray-900 instead of a hard glare edge. */}
    <div className="w-full max-w-[300px] sm:max-w-[380px] lg:max-w-[440px]
                    justify-self-center lg:justify-self-end lg:mt-4">
      <div className="p-2 sm:p-2.5 bg-white dark:bg-gray-800 rounded-[24px] shadow-card
                      ring-1 ring-gray-200 dark:ring-gray-700">
        <img
          src={heroArt960}
          srcSet={`${heroArt480} 480w, ${heroArt960} 960w`}
          sizes="(min-width: 1024px) 440px, 300px"
          width={960}
          height={960}
          alt={HERO_ALT}
          decoding="async"
          fetchPriority="high"
          className="w-full aspect-square object-cover rounded-[16px]"
        />
      </div>
    </div>
  </div>
</section>
```

Rules this markup is obeying, stated so they are not silently dropped:

- **No `loading="lazy"`.** The image is above the fold; lazy would defer the LCP candidate.
- **`width`/`height` + `aspect-square`** together reserve the box before bytes arrive.
- **No CSS filter on the image.** The mat is the dark-mode treatment. If Task 7's human
  pass judges it glaring, `dark:brightness-[0.92]` is the sanctioned knob — add it there
  and record the call, do not pre-emptively add it here.
- **No rotation or decorative offset that can overflow.** The mobile overflow helper does
  not run at desktop widths; anything that could push past the viewport at `lg`+ has to be
  hand-checked in Task 7.
- **The H1, its text, and the `<span>Magic</span>` split are unchanged.** Only wrapper
  classes move.
- Keep the existing explanatory comment above the section and extend it to say why the
  composition is now split (it answers #118).

**Tests to write:** none new here — Task 4 owns them. Existing suites must stay green.
- Wire-shape assertion required: no.

**Manual verify:**
- `npm run dev:client`, load `/` at ~1440px and at ~380px, in **both** light and dark mode.
- The image occupies its box before it decodes (throttle to Slow 3G and watch for shift).

**Done when:** `cd client && npm test` green (including the pre-existing `Magic`
assertions), `npx tsc --noEmit` clean in `client/`, `npm run lint` and `npm run build`
clean.

---

### Task 4 — Client RTL coverage for the hero image

**Zone:** client
**Depends on:** Task 3
**Parallel-safe with:** 5, 6

**Status:** Done (2026-08-25). Purely additive — 5 tests, +66 lines, 0 deletions, so both
pinned `Magic` assertions are untouched. Suite 268 -> 273.

**Decision:** `sizes` is pinned verbatim as `(min-width: 1024px) 440px, 300px`, with an
inline comment recording the 440-vs-420 gap from Task 3 so a future retune updates the pin
rather than reading the red as a bug.

**Files to add or change:**
- `client/src/pages/__tests__/Home.test.tsx` — extend the existing
  `'renders the hero section with "Stories Made with Magic"'` block or add a sibling
  `describe('Home hero art')`

**Tests to write:**
- `client/src/pages/__tests__/Home.test.tsx` — asserts:
  - `screen.getByRole('img', { name: /bench/i })` is in the document (the accessible name
    comes from `alt`, and this is the same selector shape the e2e spec will use);
  - the `alt` text describes the artwork and does **not** contain product words — assert
    it does not match `/\b(AI|book|storybook|create)\b/i`. This is the mechanical form of
    the "`alt` describes the art, not the product" constraint;
  - `width` is `'960'` and `height` is `'960'`;
  - `loading` is not `'lazy'`;
  - `fetchpriority` is `'high'` (React 19 lowercases the attribute in the DOM);
  - `srcSet` names exactly two candidates (`split(',').length === 2`) and `sizes` is
    non-empty.
  - The two existing `Magic` assertions stay exactly as they are — do not rewrite them.
- Wire-shape assertion required: no.

**Done when:** `cd client && npm test` green, no existing assertion weakened or deleted.

---

### Task 5 — Precache the hero asset so offline Home is not a broken box

**Zone:** client
**Depends on:** Task 1
**Parallel-safe with:** 2, 3

**Status:** Done (2026-08-25) — the `pwa`-project e2e confirmation in the done-criterion is
deferred to Task 6's run; Playwright was not run here because Task 3's markup was in flux.

**Files to add or change:**
- `client/pwa.config.ts` — `workbox.globPatterns` is currently
  `['**/*.{js,css,html,svg,woff2}']`; add `webp` (and `jpg` only if Task 1 took the
  fallback path)
- `client/src/__tests__/pwaOptions.test.ts` — pin the new pattern

**Signatures / shapes:**

```ts
workbox: {
  globPatterns: ['**/*.{js,css,html,svg,webp,woff2}'],
  // …navigateFallback and denylist unchanged…
}
```

Leave `navigateFallbackDenylist` alone: `/illustrations/` must still reach the network
untouched. The hero is a bundled asset, not an `/illustrations/` path, so the denylist
does not apply to it.

**Tests to write:**
- `client/src/__tests__/pwaOptions.test.ts` — asserts `workbox.globPatterns` includes the
  hero's extension, with a comment saying why (offline Home would otherwise render a
  broken image box). The file has no `globPatterns` assertion today; this adds the first.
- Wire-shape assertion required: no.

**Done when:** `cd client && npm test` green; the `pwa` e2e project (production build on
`:4173`) still passes.

---

### Task 6 — E2E: hero image, mobile collapse, both themes

**Zone:** e2e
**Depends on:** Task 3
**Parallel-safe with:** 4, 5

**Status:** Done (2026-08-25) — claims the **correctness** half of done-criterion #2 only,
per ADR-009. Task 7 owns the aesthetic half. Desktop-width overflow is not covered here;
`expectNoHorizontalOverflow` needs a fixed viewport and this file runs only at the two
mobile projects.

**Also discharges Task 5's deferred `pwa` confirmation:** `pwa` project 4/4, and
`client/dist/sw.js` was grepped directly — both hero variants appear in the precache
manifest and `navigateFallbackDenylist` is intact as `[/^\/api\//,/^\/illustrations\//]`.

**Canonical e2e run: DONE (2026-08-26) — 122/122 passed.** The shared checkout's dev
servers were stopped and `cd e2e && npm test` was run on canonical ports from the main
session. `admin.spec.ts:277` passes here; it only fails under a port shift, which is what
the developer hit. The suite is green end to end.

**Worktree-run brittleness filed as #130** (unrelated to the hero): `admin.spec.ts:277`
hardcodes `http://localhost:5173/`, ten more specs hardcode `http://localhost:3001`, and
`reuseExistingServer: !CI` means a worktree run can silently test the *wrong code* — the
shared server on :5173 had no hero in it.

**Files to add or change:**
- `e2e/tests/home.spec.ts` — add a desktop assertion that the hero image is visible
- `e2e/tests/mobile/hero.spec.ts` — new

**Signatures / shapes:**

```ts
import { expectNoHorizontalOverflow, expectTapTargets, forEachTheme, PRIMARY_TAP_MIN }
  from './_helpers';

// mobile/hero.spec.ts — runs under the mobile-pixel (393x851) and mobile-small (360x740)
// projects, same as the other specs in this folder.
test('hero collapses to a single column with the art in the stack', async ({ page }) => {
  await page.goto('/');
  await forEachTheme(page, async () => {
    const art = page.getByRole('img', { name: /bench/i });
    await expect(art).toBeVisible();
    await expectNoHorizontalOverflow(page);
    // Single column: the art's box must start at or below the CTA's bottom edge.
    const cta = page.getByRole('link', { name: /Create Your Own Book/i });
    // compare boundingBox().y — art.y >= cta.y + cta.height
    await expectTapTargets(page, 'main a[href$="/create"]', PRIMARY_TAP_MIN);
  });
});
```

Per ADR-009 this discharges the **correctness** half of done-criterion #2. Say so in the
spec's header comment, and say that the aesthetic half is Task 7's — a spec should state
which half it is claiming.

**Tests to write:**
- `e2e/tests/mobile/hero.spec.ts` — art visible; no horizontal overflow; art stacked
  below the CTA (single column, not a side-by-side squeeze); CTA still meets the 44px
  floor. All of it inside `forEachTheme`.
- `e2e/tests/home.spec.ts` — one added assertion: the hero image is visible on `/` at the
  default desktop project. Leave the existing `h1` / `Magic` assertion untouched.
- Wire-shape assertion required: no.

**Done when:** `cd e2e && npm test` green. Run it **alone** — the server suite and e2e
share a DB and a concurrent run fails spuriously; re-run in isolation before calling it red.

---

### Task 7 — Human verification of both themes, and the notes sweep

**Zone:** multi-zone (verification + docs)
**Depends on:** Tasks 3, 4, 5, 6
**Parallel-safe with:** none

**Status:** Done (2026-08-26) — repo owner reviewed `/` in both themes on the running dev
server and signed off. This is the **aesthetic** half of done-criterion #2; Task 6 carries
the correctness half per ADR-009.

**The deferred dark-mode filter question is CLOSED: no filter.** The owner's verdict, in
their words: it does not glare, but it is "pretty vivid and 'pops' a bit in dark mode",
and "I wouldn't adjust it much if any." So `dark:brightness-[0.92]` was considered against
the real rendering and declined, not overlooked. The `gray-800` mat plus `gray-700` ring is
carrying the dark-mode treatment on its own.

Worth stating plainly for whoever revisits this: the call was "fine, slightly vivid",
not "perfect". If the vividness ever bothers someone, the knob is one class on the `<img>`
in `client/src/pages/Home.tsx` and reverting it costs nothing. That is a deliberately low
bar to reopen, not a settled aesthetic.

**Files to add or change:**
- `.code-captain/specs/hero-visual/notes.md` — replace the placeholder plan with what
  actually landed; record the frame chosen and the derivation numbers
- `.code-captain/specs/hero-visual/spec.md` — flip `Status:` if the user has accepted it

**Manual verify (this is the whole task):**
- `/` at ~1440px, **light** then **dark**: the art reads on both surfaces; the mat is doing
  its job on `gray-900` and is not a grey slab on cream.
- Decide the deferred filter question: does the image glare in dark mode? If yes, add
  `dark:brightness-[0.92]` to the `<img>` and record it; if no, record that it was
  considered and declined. Either way it stops being an open question.
- `/` at ~1024px and ~1200px — the breakpoint where the split engages. Confirm the text
  column does not get squeezed to an awkward measure and the art does not shrink to a
  thumbnail.
- **Desktop horizontal overflow**, which no automated assertion covers: at 1280px and
  1440px confirm `document.documentElement.scrollWidth` equals the viewport width.
- Throttle to Slow 3G and reload: confirm no layout shift when the image lands.
- Confirm the purple CTA still reads as the primary action with the art beside it. If the
  art out-shouts it, that is a real finding — report it rather than quietly restyling the CTA.

**Done when:** both themes signed off by a human at desktop and mobile, the filter question
is resolved either way, and `notes.md` reflects what shipped.

---

### Task 8 — Pre-merge follow-ups

**Zone:** docs (harness) · **Depends on:** none (run last)

**Status:** Done (2026-08-26). ADR-014 written; #128, #129, #130 filed; #127 filed earlier
in the session; `adr-tracking-check hero-visual` reports 5 items, all tracked, zero
orphaned. The PR body carries the spec link, agent ownership, and the explicit
no-wire-shape statement.

For each ADR-worthy item in the spec, ensure exactly one tracking action exists — a
matching ADR, a linked issue, or an explicit `Deferred:` line with reasoning.

- **ADR-014** — "Hero art is a committed, byte-budgeted WebP derived from a seeded book
  page at native 1:1." Write via `/create-adr`. Must cover: committed artifact over build
  step; no new dependency; the 200 KB budget enforced by test; `src/assets` over `public/`;
  bundled over API-served; and the 1:1 aspect lock that #127 inherits.
- **AVIF variants** — `Deferred:` line, held as an upgrade path, revisit under #127.
- **Dark-mode brightness filter** — resolved in Task 7; record the outcome as a
  `Deferred:` or as a note in the ADR, whichever matches what was decided.
- **H1 title case vs. H2 sentence case** — file a GitHub issue (`type:chore`,
  `zone:client`, `complexity:s`), link it from the spec's Out of scope section.
- **#118** — needs no ADR; its done criterion is satisfied by the redesign. State that
  reasoning in the PR body and close #118 alongside #125.
- PR body must record the spec link and agent ownership, and must state explicitly that
  **no wire shape was added or changed** so the reviewer's Check 4 has an answer.
- Confirm `git diff master...HEAD -- '**/package.json' '**/package-lock.json'` is empty.

**Done when:** `adr-tracking-check hero-visual` reports zero orphaned items.

## Sequencing notes

- **Task 1 gates everything.** Nothing else can be written against an asset that does not
  exist, and Task 1 is also where the no-new-dependency constraint is either honoured or
  broken.
- **Tasks 2, 3, 5 can run in parallel** once Task 1 lands. They touch disjoint files
  (`__tests__/heroAsset.test.ts`, `pages/Home.tsx`, `pwa.config.ts` + its test).
- **Tasks 4 and 6 both need Task 3's final markup** — specifically the `alt` string and
  the `role="img"` accessible name, which both specs select on. Do not start them against
  a draft `alt`.
- **Commit boundaries:** Task 1 alone (asset + deletions — a large binary-ish commit that
  is easier to review on its own), then Tasks 2-6 as one or two commits, then Task 7's
  notes update. One PR closing both #125 and #118.
- Run the e2e suite **alone**. Server tests and e2e share a DB; a concurrent run produces
  spurious failures.
- CI runs Node 22 while local is Node 24. Nothing here is runtime-sensitive, but do not
  treat local green as proof — wait for the PR checks.

## Open questions

None blocking. The two judgement calls that remain are both scheduled rather than open:
the dark-mode filter is resolved by Task 7's human pass, and the aesthetic sign-off on the
composition is the same task. If Task 1's byte budget cannot be met by either the `npx`
path or the `sips` fallback, that becomes a real open question — stop and ask the user
rather than adding a dependency.
