# Home hero art — provenance

The two `.webp` files in this directory are **derived, committed artifacts**. There is no
build step and no image pipeline dependency: derivation was run once by hand with the
command recorded below, and the outputs were committed. See ADR-014 and
`.code-captain/specs/hero-visual/spec.md`.

## Source

| | |
|---|---|
| Source file | `server/public/illustrations/b2fa23cf-3156-4b89-83e7-82d98c32c8b7/page-4-v2.png` |
| Book | "A Spot for Sunny", book ID `b2fa23cf-3156-4b89-83e7-82d98c32c8b7`, page 4 |
| Source dimensions | 1024×1024 PNG, 2,497,998 bytes |
| Crop | **None. Native 1:1 preserved.** |

The source is **read only** — it is never modified or copied by this work. It is the same
file `server/prisma/demo-seed-fixtures/spot-for-sunny.json` points page 4 at.

**Do not re-derive from `page-4-v3.png` or `page-4-v4.png`.** Those are orphaned revisions
that the seed does not reference, and `page-4-v4.png` renders Sunny as a golden retriever —
the exact defect the v2 feedback string was written to correct. The frame you want is two
girls on a wooden bench under a leafy tree with an orange backpack between them.

## Why 1:1 and no crop

Every illustration this product emits is 1024×1024. Locking the hero frame to 1:1 means a
future hero-rotation change (#127) can swap in any book page without re-deciding aspect
ratio or re-cropping.

## Output

| File | Dimensions | Encoder | Quality | Effort | Bytes |
|---|---|---|---|---|---|
| `spot-for-sunny-bench-960.webp` | 960×960 | WebP (sharp) | 72 | 6 | 144,238 (140.9 KB) |
| `spot-for-sunny-bench-480.webp` | 480×480 | WebP (sharp) | 75 | 6 | 29,566 (28.9 KB) |

sRGB; metadata stripped (`sharp-cli` excludes EXIF/XMP/IPTC unless `-m` is passed).

### Byte budget

Enforced by `client/src/__tests__/heroAsset.test.ts`:

- largest single file ≤ 150 KB (153,600 bytes) — actual 144,238, **9,362 bytes of headroom**
- total of this directory ≤ 200 KB (204,800 bytes) — actual 173,804 for the two images,
  plus this README

**Why quality 72 and not the nominal ≈75.** At q=75 / effort 6 the 960 variant encodes to
151,146 bytes. That is inside the 150 KB cap by only ~2.4 KB, which is too little headroom
for a cap the test pins exactly — any future re-derivation on a different `sharp` build
would flip the suite red. Dropping to q=72 costs no visible quality at the rendered size
(the 960 file is displayed at 440 CSS px, i.e. 880 px at 2× DPR) and buys ~9 KB of margin.
The 480 variant is nowhere near the cap, so it stays at the nominal 75.

`--effort 6` (above the WebP default of 4) is a pure compression-search setting: it spends
more CPU at derivation time for a smaller file at identical quality. It costs nothing at
runtime because the artifact is committed.

## Reproducing

Run from the repo root. `npx -y` resolves `sharp-cli` from the npx cache — **nothing enters
`package.json` or the lockfile**, which is a hard constraint of this feature.

```bash
npx -y sharp-cli \
  --input server/public/illustrations/b2fa23cf-3156-4b89-83e7-82d98c32c8b7/page-4-v2.png \
  --output client/src/assets/hero/spot-for-sunny-bench-960.webp \
  --format webp --quality 72 --effort 6 resize 960 960

npx -y sharp-cli \
  --input server/public/illustrations/b2fa23cf-3156-4b89-83e7-82d98c32c8b7/page-4-v2.png \
  --output client/src/assets/hero/spot-for-sunny-bench-480.webp \
  --format webp --quality 75 --effort 6 resize 480 480
```

Derived 2026-08-25 with `sharp-cli` 6.0.0 on Node 24.19.0.

Since the source is already 1:1, `resize 960 960` is a straight downscale — `sharp`'s
default `cover` fit performs no crop when the aspect ratios match.

If no WebP encoder is reachable, the sanctioned fallback is
`sips -s format jpeg -Z 960 -s formatOptions 72` — acceptable **only** if the output lands
inside the byte budget above. Local `sips` can read WebP but cannot write it. Do not add an
image dependency to satisfy this; stop and ask instead.

## Consumers

Imported by `client/src/pages/Home.tsx` through Vite, so the emitted URLs are
content-hashed and `base`-prefixed automatically (the GitHub Pages deploy serves under
`/storybook/`). Both files are well above `assetsInlineLimit`, so they emit as real files
rather than data URIs. They live in `src/assets/` rather than `public/` for exactly that
hashing and base-path handling.
