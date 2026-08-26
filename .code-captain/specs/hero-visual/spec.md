# Home hero visual — real illustration, asymmetric composition

> Status: Accepted
> Last updated: 2026-08-25
> Backlog: [#125](https://github.com/slickG0ose/storybook/issues/125) (closes [#118](https://github.com/slickG0ose/storybook/issues/118))

## Problem

The Home hero is a headline, a line of subtext, a CTA, and a search bar stacked in a
centred column over two radial gradients (`client/src/pages/Home.tsx:201-245`). There is
no image. We sell illustrated children's books and the first screen a visitor sees shows
none of the illustration — the product's entire output is invisible above the fold. The
gradient treatment that landed in the design pass is a background, not a subject.

This also settles #118. That issue asks whether to break the hero's centre-symmetry and
correctly declines to answer while the hero is text-only: a centred column *is* the right
layout for a text-only hero, and offsetting text for its own sake is churn. Introducing a
visual gives the asymmetry something to be asymmetric about, so the two land together.

Source: `design-taste-frontend` skill audit, 2026-08-25, section 4.8. The companion
finding (#126, self-host webfonts) is a separate branch.

## Constraints

- **Ruled 2026-08-25 (do not re-litigate):** the art comes from the already-seeded
  "A Spot for Sunny" (`b2fa23cf-3156-4b89-83e7-82d98c32c8b7`), not a newly generated
  asset. Static single image; rotation is #127 and blocked on this.
- **Every source file is a 1024×1024 PNG between 1.5 MB and 2.5 MB.** Shipping a raw one
  above the fold would destroy LCP — the exact metric #126 exists to protect. The shipped
  asset must be a derived, responsive, byte-budgeted artifact.
- **No new dependency.** This repo has no image pipeline and #125 did not ask for one.
  Nothing may appear in any `package.json` or lockfile as a result of this work.
- **Palette tokens are settled** in `client/src/index.css` `@theme`. Purple is the single
  ACTION accent; amber is brand chrome and SELECTED state. The hero must not introduce a
  third accent token, and must not blunt the purple CTA's salience.
- **Both themes** (CLAUDE.md done-criterion #2). The art must read on cream `#fffbf0`
  and on `gray-900` `#1b1714`.
- **Zero CLS.** The image box is reserved before the bytes arrive.
- **`alt` describes the art, not the product.**
- The H1 string is pinned twice and must survive: `client/src/pages/__tests__/Home.test.tsx:101`
  asserts `getByText('Magic')` (exact), `e2e/tests/home.spec.ts:11` asserts the `h1`
  contains `Magic`. `e2e/tests/dark-mode.spec.ts:12` waits on `h1` visibility.
- Mobile viewport work uses the existing helpers in `e2e/tests/mobile/_helpers.ts`
  (`forEachTheme`, `expectNoHorizontalOverflow`, `expectTapTargets`) per ADR-009.

## Proposed shape

**Which frame.** `page-4-v2.png` — Mira and Sunny sitting together on the bench, the
orange backpack between them. Four reasons, and one premise correction:

1. *The cover premise was wrong and is worth recording.* `cover.png` carries no title
   lettering, so it was never disqualified on that basis. It is rejected on composition
   instead: it is a single figure walking away from the viewer with the second character
   tiny in the background, and its field is a near-monochrome yellow wash that would put
   a large amber block directly beside amber brand chrome.
2. *It reads as a story, not a portrait.* Two characters in a legible relationship —
   one turning to greet the other — is what this product actually produces. A hero should
   show the output, and the output is narrative.
3. *Faces are large and legible at hero scale.* Both heads occupy roughly 150 px of the
   1024 px source, so at a 440 CSS px render they are ~65 px — comfortably readable.
   `page-5-v3.png` (four children under the oak) is the runner-up and loses on exactly
   this: four faces at ~50 px each is a busy thumbnail.
4. *It is the canonical seeded asset.* `spot-for-sunny.json` points page 4 at
   `page-4-v2.png`. The `-v3`/`-v4` revisions of that page are **not** canonical and
   `page-4-v4.png` in particular reintroduces the exact defect the v2 feedback fixed
   (it renders Sunny as a golden retriever). Do not pick from the orphaned revisions.

Palette check: the frame's hues are warm greens, ochre, cream paper, one saturated orange
(the backpack) and a small area of denim blue. No purple anywhere, so the purple CTA
remains the only cool-saturated element in the hero and keeps its "do this" salience. The
orange sits inside the existing amber hue family. **No new `--color-*` token is added;**
the frame chrome uses only existing `gray-*` tokens.

**Composition.** Below `lg` the hero stays a single centred column and simply gains the
art at the bottom of the stack. At `lg` and up it becomes a two-column grid: the text
block (H1 → paragraph → CTA → search) moves to the left and left-aligns, the art sits in
the right column, slightly lower than optical centre. **DOM order is fixed across all
breakpoints** — text block, then art — so no `order-*` utility is needed and reading
order always matches visual order. The search bar stays inside the text column rather
than being re-centred underneath, which keeps the left column internally consistent
instead of half-left-half-centred.

**Per-theme treatment.** The illustration is an opaque square with a pale cream-yellow
paper ground. On cream it blends at the edges; on `gray-900` it would be a bright
rectangle butted straight against near-black — a glare edge. The concrete answer is to
frame it as what it is, a page from a book: a mat wrapper carrying the app's existing
card language (`bg-white dark:bg-gray-800 rounded-[24px] shadow-card`) with a small pad,
and the image itself at `rounded-[16px]`. In dark mode the mat gives the bright square a
mid-tone surround instead of a hard jump, and `--shadow-card` already has its own dark
alphas (`client/src/index.css:89-93`). No CSS filter on the image by default — see
Alternatives.

### Asset derivation (the hard constraint)

**Committed artifact, not a build step.** Derivation runs once, by hand, and the outputs
are committed. Rationale: a build step means a dependency, a config surface, and a CI
cost, for a single image that changes approximately never. Recorded as ADR-014.

| Decision | Value |
|---|---|
| Source | `server/public/illustrations/b2fa23cf-3156-4b89-83e7-82d98c32c8b7/page-4-v2.png` |
| Crop | **None.** Native 1:1 preserved. |
| Format | WebP, quality ≈ 75, sRGB, metadata stripped |
| Variants | `960` and `480` (two files) |
| Destination | `client/src/assets/hero/` — imported through Vite, so URLs are content-hashed and `base`-prefixed automatically |
| Byte budget | largest file ≤ 150 KB; **sum of all files under `client/src/assets/hero/` ≤ 200 KB** |
| Tooling | one-shot `npx -y sharp-cli …`, run from the npx cache. **Nothing enters `package.json` or the lockfile.** |
| Reproducibility | exact command recorded in `client/src/assets/hero/README.md` |

**Why 1:1 and no crop.** Every illustration this product emits is 1024×1024. Locking the
hero frame to 1:1 means #127 (rotate the hero art) can swap any book page in without
re-deciding aspect ratio or re-cropping, and means no crop decision has to be defended
against future frames. A landscape crop would also leave dead space beside a text column
that is much taller than 4:3 at these type sizes.

**Why not `client/public/`.** Files in `public/` ship unhashed and are referenced by
literal path, which is a cache-busting hazard and interacts badly with the
`VITE_BASE_PATH=/storybook/` GitHub Pages deploy. Importing from `src/assets/` gets both
handled by Vite. Both files are far above `assetsInlineLimit`, so they emit as real files
rather than data URIs.

**Why bundled rather than served from `/illustrations/`.** The server is Render and is
currently not up (see `docs/deploy-spike-render.md`). A hero sourced over the API is a
broken box whenever the backend is cold or down. A bundled asset renders regardless.

**Fallback if no WebP encoder is reachable.** Local `sips` can *read* WebP but not write
it, and there is no `cwebp`, ImageMagick, or `sharp` on this machine — the `npx` path is
load-bearing. If it is unavailable, the fallback is `sips -s format jpeg -Z 960 -s
formatOptions 72`, acceptable **only** if the output lands inside the byte budget. If
JPEG blows the budget, stop and ask rather than shipping a heavier asset or adding a dep.

### Files likely touched

- `client/src/assets/hero/spot-for-sunny-bench-960.webp` — new, derived hero asset
- `client/src/assets/hero/spot-for-sunny-bench-480.webp` — new, small variant
- `client/src/assets/hero/README.md` — new; provenance, crop params, exact derivation command
- `client/src/pages/Home.tsx` — hero section recomposed (lines 195-245)
- `client/src/pages/__tests__/Home.test.tsx` — hero image assertions; existing H1 assertions unchanged
- `client/src/__tests__/heroAsset.test.ts` — new; byte-budget + provenance guard
- `client/pwa.config.ts` — add `webp` to `workbox.globPatterns`
- `client/src/__tests__/pwaOptions.test.ts` — pin the new glob pattern
- `e2e/tests/home.spec.ts` — hero image visible + accessible name
- `e2e/tests/mobile/hero.spec.ts` — new; single-column collapse, no overflow, tap targets, both themes
- `client/src/assets/{hero.png,react.svg,vite.svg}` — **deleted** (see below)

### Dead scaffold assets

`client/src/assets/` already contains `hero.png` (13 KB, a Vite-template isometric cube),
`react.svg`, and `vite.svg`. A repo-wide grep finds zero references to any of them; they
are leftovers from the generated scaffold that commit 24839b4 partly cleared. `hero.png`
in particular is a name collision waiting to trap the next reader of this feature. Delete
all three here — it is in scope precisely because of the collision.

### Data flow

None. The hero takes no props, makes no fetch, and touches no context. No route changes,
no Zod schema changes, no Prisma changes. The asset is resolved at build time by Vite.
This is the reason #127 is a genuinely separate issue: rotation is the change that
introduces a wire shape, and this one has none.

## Alternatives considered

### `cover.png` as the hero frame

**Pros:** single large subject; biggest face in the set; the "cover" is the conventional
marketing frame.
**Cons:** the subject is walking away from the viewer; the second character is a
background detail; the field is a near-uniform yellow that would sit as a large amber
wash beside amber brand chrome.
**Why rejected:** it reads as a portrait, not a story, and it costs the most palette
tension of any candidate.

### AVIF alongside WebP via `<picture>`

**Pros:** roughly 30% smaller than WebP at matched quality.
**Cons:** doubles the artifact count from 2 to 4, requires a `<picture>` element with two
`<source>` sets, and adds a second encoder to the reproducibility story — all for maybe
40 KB on an asset already inside a 200 KB budget.
**Held as upgrade path:** revisit if the budget is ever contested, or under #127 where
the asset count multiplies.

### A Vite image plugin / build-time derivation

**Pros:** the source PNG stays the single source of truth; variants regenerate on demand.
**Cons:** a new dependency, a config surface, CI build time, and a lockfile change — for
one image that changes never. Directly against the "no new dependency" constraint.
**Why rejected:** the committed artifact plus a recorded command is the same
reproducibility for none of the cost. Reconsider only if #127 lands with N assets.

### Dark-mode CSS filter on the image (`dark:brightness-[0.92]`)

**Pros:** takes the edge off a bright square on near-black.
**Cons:** dimming artwork to fit a theme degrades the one thing the hero exists to show
off, and filters on an LCP element are a smell.
**Held as an aesthetic knob:** default is **no filter**; the mat wrapper is the treatment.
If the human dark-mode pass in Task 7 judges it glaring, add it there and record the call.

### Keeping the centred composition and adding the art below the text

**Pros:** smallest diff; no risk to the pinned H1 selectors.
**Cons:** leaves #118 unanswered and pushes the CTA and search bar further down; a
full-width square under centred text is a worse use of the fold than a side-by-side.
**Why rejected:** #118 explicitly wants either a redesigned hero or an ADR defending the
symmetry, and the redesign is the better outcome now that there is art to compose against.

## Success criteria

- The Home hero renders a real illustration from the seeded "A Spot for Sunny", visible
  above the fold at desktop and mobile viewports, in both themes.
- Every file under `client/src/assets/hero/` is WebP (or budget-compliant JPEG); the
  largest is ≤ 150 KB and the total is ≤ 200 KB — asserted by
  `client/src/__tests__/heroAsset.test.ts`, which fails loudly on a raw-PNG drop.
- `git diff master...HEAD -- '**/package.json' '**/package-lock.json'` is empty.
- The image carries intrinsic `width`/`height` attributes and a reserved
  `aspect-square` box, is not `loading="lazy"`, and declares `fetchPriority="high"`.
- `alt` describes the artwork (two children on a bench), not the product.
- At `lg` and up the hero is a two-column split with left-aligned text; below `lg` it is
  a single centred column with the art last in the stack — asserted in
  `e2e/tests/mobile/hero.spec.ts` under `forEachTheme`.
- `expectNoHorizontalOverflow` passes on `/` at both mobile projects in both themes.
- Existing assertions still pass unchanged: `Home.test.tsx` `getByText('Magic')`,
  `home.spec.ts` `h1` contains `Magic`, `dark-mode.spec.ts` `h1` visible.
- Client, e2e, and root suites green; `npx tsc --noEmit` clean in `client/`.
- Human sign-off on the aesthetic half of done-criterion #2 in both themes (Task 7).

## Out of scope

- **Changing the headline copy or the CTA.** Both strings stay exactly as they are.
- **The H1 title-case / H2 sentence-case inconsistency.** Real, two minutes, does not ride
  along. Filed as #128.
- **Self-hosting the webfonts (#126).** Separate branch. This spec protects the same LCP
  budget but does not touch the font loading path.
- **Rotating the hero art (#127).** Static single image. This spec deliberately locks the
  1:1 aspect so #127 does not have to re-decide it.
- **Any server, shared, or Prisma change.** No route, no Zod schema, no migration.
- **The `og-image.jpg` social card** — still the old asset; not touched here.

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| A 2.2 MB PNG lands in the bundle and destroys LCP | `heroAsset.test.ts` asserts a per-file and total byte ceiling **and** that no `.png` exists under `client/src/assets/hero/`. Fails at `cd client && npm test`, i.e. in CI. |
| `npx sharp-cli` unavailable → developer reaches for a dependency | Constraint is explicit and the fallback (`sips` → JPEG) is named. Reviewer checks `package.json`/lockfile diff is empty. If neither path fits the budget, stop and ask — do not add a dep. |
| Dark-mode parity miss on new hero chrome | Every new surface (mat wrapper, ring, art column) carries a `dark:` partner. Reviewer's `dark-mode-parity-check` skill runs on `/ship`. |
| CLS from an unreserved image box | `aspect-square` on a `w-full` grid child reserves height before bytes arrive, plus intrinsic `width`/`height` attributes as the belt-and-braces. Verified by eye in Task 7. |
| The pinned H1 selectors break during restructure | H1 element, text node, and the `<span>Magic</span>` split are all preserved verbatim; only wrapper classes change. Tests run in Task 3. |
| Hero is a broken box when offline | `workbox.globPatterns` currently lists only `js,css,html,svg,woff2` — WebP is not precached. Task 5 adds `webp` and pins it in `pwaOptions.test.ts`. |
| Desktop horizontal overflow from the new grid | The existing overflow helper is mobile-only. Task 7 includes an explicit desktop-width manual check; if any decorative offset or rotation is added, it must be contained. |
| Picking an orphaned illustration revision | `page-4-v4.png` renders Sunny as a dog — the exact bug the v2 feedback corrected. The canonical URL is the one in `spot-for-sunny.json`; the spec names the file explicitly. |
| Asset goes stale if the seeded book is regenerated | `client/src/assets/hero/README.md` records the source path, book ID, and derivation command so the asset can be re-derived deliberately. |
| Wire-shape (OPS.3) | **Not applicable.** No route response is added or changed; the hero fetches nothing. Stated so the reviewer does not have to infer it. |
| Auth / session / Prisma / paid-API guardrails | **None touched.** No auth, no cart session, no schema, no Claude or Fal call, no spend surface. |

## ADR-worthy decisions

- [x] **ADR-014 — Hero art is a committed, byte-budgeted WebP derived from a seeded book
  page at native 1:1.** Written 2026-08-26 to
  [.code-captain/product/decisions.md](../product/decisions.md). Covers all six coupled
  decisions plus the q=72 deviation, the `sizes` 440-vs-420 gap, and the padding change.
  Note: the plan originally said "ADR-013", which was already taken by the image-model
  pinning decision of 2026-08-23; renumbered to 014 before writing.
- [x] **Deferred: AVIF variants.** Held as an upgrade path; revisit under #127. Recorded
  in ADR-014's Consequences. Both the `webp` precache pattern and the extension-list
  assertion were deliberately written so adding `avif` later needs no test surgery.
- [x] **RESOLVED: no dark-mode brightness filter.** Task 7's human pass (2026-08-26)
  reviewed both themes on a running dev server and declined it: does not glare, but
  "pretty vivid and 'pops' a bit in dark mode", and "I wouldn't adjust it much if any."
  Recorded in ADR-014 as considered-and-declined, with the verdict stated as "fine,
  slightly vivid" rather than "correct" — the knob is one class and reopening is cheap.
- [x] **Deferred: H1 title case vs. H2 sentence case.** Out of scope per #125; filed as
  #128 (2026-08-25). The hero pins the H1 verbatim for three test assertions, so the copy
  change could not ride along with the layout change.
- [x] **#118 needs no ADR.** Its done criterion is "either a redesigned hero, or an ADR
  recording that the centred composition is intentional" — the redesign discharges it
  directly, and ADR-014 states that reasoning. Close #118 with this branch. Listed here so
  the reviewer's Check 6 sees it was considered rather than dropped.
