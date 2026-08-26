# Hero rotation pool frames — provenance

The `.webp` files under this directory are **derived, committed artifacts** served by
Express as static files from `/hero/*`. There is no build step and no image pipeline
dependency: derivation runs by hand through `server/scripts/derive-hero-frames.sh`, and
the outputs are committed. See ADR-014 and
`.code-captain/specs/hero-rotation/spec.md`.

They are the **rotation** frames only. Frame 0 — the LCP frame — is a different artifact
with a different delivery path: it is bundled through Vite from
`client/src/assets/hero/` and is never fetched, never re-`src`ed, and never affected by
anything in this directory. If this whole directory 404s, the hero is exactly the static
hero that shipped in ADR-014. That is the designed degradation, not a fallback bolted on.

## Layout, and why the filename is the lookup key

```
server/public/hero/<book_id>/p<page_number>-960.webp
server/public/hero/<book_id>/p<page_number>-480.webp
```

`server/src/lib/heroPool.ts` resolves a frame by `existsSync()` on that exact path —
there is no manifest. **A frame filed under a different name is silently invisible rather
than loudly broken**, so the naming convention is pinned by
`server/src/__tests__/heroFrameAssets.test.ts`.

## Source

| | |
|---|---|
| Book | "A Spot for Sunny", book ID `b2fa23cf-3156-4b89-83e7-82d98c32c8b7` |
| Source directory | `server/public/illustrations/b2fa23cf-3156-4b89-83e7-82d98c32c8b7/` |
| Source dimensions | 1024×1024 PNG |
| Crop | **None. Native 1:1 preserved** (ADR-014 decision 6). |

The sources are **read only** — never modified, never copied here.

| Frame | Source file | Source bytes | Scene |
|---|---|---|---|
| page 1 | `page-1.png` | 2,249,303 | Mira, Bea and Leo bursting out of the red schoolyard door |
| page 5 | `page-5.png` | 2,284,478 | All four children in a circle under the oak, Sunny holding a ladybug |

Both are files that `server/prisma/demo-seed-fixtures/spot-for-sunny.json` actually points
at, which is the rule for this directory (see the trap below).

### Which pages, and why not the others

Chosen by the repo owner on 2026-08-26 after reviewing 420 px renders:

- **Page 4 is deliberately absent.** `page-4-v2.png` *is* frame 0 — the bundled bench
  frame. A rotation that fades to the same picture is a bug report waiting to happen.
- **Page 3 was rejected, not merely unchosen.** It is a single centred figure with a
  downcast expression, compositionally the closest of the candidates to frame 0, and at
  hero scale it reads as "sad kid alone".
- **Watch item on page 1:** the red door is a large saturated area, and ADR-014
  established the purple CTA as the hero's only cool-saturated element. If the door
  competes with the CTA in the human pass, swap page 1 for page 3 and record the swap —
  do not quietly restyle the CTA to compensate.

### The `-v3` / `-v4` trap, restated because the highest version number looks safest

`server/public/illustrations/` holds orphaned revisions the seed does not reference.
**`page-4-v4.png` renders Sunny as a golden retriever** — the exact defect the v2 feedback
string in `spot-for-sunny.json` was written to correct. Derive **only** from files the
fixture points at:

```
page-1.png  page-2.png  page-3.png  page-4-v2.png  page-5.png
```

Note that page 5's canonical source is `page-5.png` (the original), **not**
`page-5-v3.png`. `page-5-v3.png` is a good frame — it is the regeneration Nick reviewed
under ADR-013 — but it is not what the book shows, and a hero frame that does not appear
in the book it advertises is a small lie. If it is preferred, change the fixture and the
`FRAMES` list in the derive script together, in the same commit.

## Output

| File | Dimensions | Encoder | Quality | Effort | Bytes |
|---|---|---|---|---|---|
| `b2fa23cf-…/p1-960.webp` | 960×960 | WebP (sharp) | 72 | 6 | 105,482 (103.0 KB) |
| `b2fa23cf-…/p1-480.webp` | 480×480 | WebP (sharp) | 75 | 6 | 29,630 (28.9 KB) |
| `b2fa23cf-…/p5-960.webp` | 960×960 | WebP (sharp) | 72 | 6 | 109,792 (107.2 KB) |
| `b2fa23cf-…/p5-480.webp` | 480×480 | WebP (sharp) | 75 | 6 | 30,976 (30.2 KB) |

sRGB; metadata stripped (`sharp-cli` excludes EXIF/XMP/IPTC unless `-m` is passed).

Quality settings are ADR-014's, unchanged: q=72 on the 960 variant because q=75 lands
within ~2.4 KB of the 150 KB per-file cap, which is too little headroom for a ceiling a
test pins exactly; q=75 on the 480, which is nowhere near it. `--effort 6` is pure
compression search — more CPU at derivation time, identical quality, zero runtime cost on
a committed artifact.

### Byte budget

Enforced by `server/src/__tests__/heroFrameAssets.test.ts`, which runs in
`cd server && npm test` and therefore in CI:

- every single file ≤ 150 KB (153,600 bytes) — largest actual is 109,792, **43,808 bytes
  of headroom**
- total of this directory ≤ **400 KB** (409,600 bytes) — actual 275,880 for the four
  images, plus this README
- no `.png`, ever, and no extension outside `.webp` / `.jpg` / `.md`

**400 KB, not 1 MB.** Repo owner's ruling, 2026-08-26: a cap permitting five frames while
two ship is decoration, not a guard. The bundled-hero budget test earned its keep by
sitting close enough to bite. **Raise it deliberately, in the same commit that adds the
third frame** — not in advance.

The budget is a ceiling on a *full-cycle* visitor, not a first-paint cost. Frames load one
ahead, so someone who bounces after five seconds has downloaded frame 0 (bundled) plus at
most one file from here.

## Setting the eligibility flag without deriving does nothing

`Book.is_hero_eligible` and the derived artifact are two independent halves, and the
resolver silently omits any frame whose `p<n>-960.webp` is missing. Flipping the flag on a
book with no files here changes nothing a visitor can see.

That is why `PUT /api/admin/books/:id/hero-eligible` returns `hero_frames_available` —
a `0` means "flagged, but nobody has run the derive script yet." When you flag a new book,
add it to the `FRAMES` list in `server/scripts/derive-hero-frames.sh`, re-run the script,
check the budget, and commit the outputs.

Note also that eligibility is not consent: `hero_consent_at` is a separate column with no
API writer at all. See `.code-captain/specs/hero-rotation/spec.md` §"The consent seam".

## Reproducing

```bash
bash server/scripts/derive-hero-frames.sh            # derive + report the budget
bash server/scripts/derive-hero-frames.sh --check    # report only, derive nothing
```

The script wraps this command, once per frame per size:

```bash
npx -y sharp-cli \
  --input server/public/illustrations/<book_id>/<source>.png \
  --output server/public/hero/<book_id>/p<n>-960.webp \
  --format webp --quality 72 --effort 6 resize 960 960
```

`npx -y` resolves `sharp-cli` from the npx cache — **nothing enters `package.json` or the
lockfile**, which is a hard constraint of this feature. Since the sources are already 1:1,
`resize 960 960` is a straight downscale: sharp's default `cover` fit crops nothing when
the aspect ratios match.

Derived 2026-08-26 with `sharp-cli` 6.0.0 on Node 24.19.0.

If no WebP encoder is reachable, the sanctioned fallback is
`sips -s format jpeg -Z 960 -s formatOptions 72` — acceptable **only** if the output lands
inside the byte budget above (`.jpg` is in the test's extension allowlist for exactly this
reason). Local `sips` can read WebP but cannot write it. **Do not add an image dependency
to satisfy this.** A server-side `sharp` install is a CLAUDE.md size-gate item and its own
confirmation — stop and ask instead.

## Consumers

Served by `app.use('/hero', express.static(...))` in `server/src/index.ts`, listed by
`GET /api/hero/pool`, and rendered by the rotating layer in
`client/src/components/HeroArt.tsx`. Paths on the wire are **server-relative**
(`/hero/<book_id>/p1-960.webp`) and the client wraps them in `api()`, matching the
existing `api(page.illustration_url)` convention — absolute URLs would break the
`VITE_API_BASE_URL` split between GitHub Pages and Render.

Unlike `client/src/assets/hero/`, these files are **not** content-hashed and **not**
precached by the service worker. They are cross-origin in production, which is why PWA
runtime caching for `/hero/*` is explicitly out of scope.
