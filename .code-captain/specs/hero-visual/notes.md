### agent/feat/hero-visual — 2026-08-25 → 2026-08-26

**Issue:** #125 — Home hero had no real visual; it was text over a gradient. Absorbed #118 (centre-symmetry).
**Spec:** [spec.md](spec.md) · **Plan:** [tasks.md](tasks.md) · **ADR:** ADR-014
**Outcome:** shipped. 8 of 8 tasks Done. Commit `d2c788a`.

**Source:** `design-taste-frontend` skill audit, section 4.8 ("text + gradient blob is not a hero"). Companion finding filed as #126 (self-host webfonts), deliberately not in this branch.

## What actually landed

- **The art:** `page-4-v2.png` from the seeded "A Spot for Sunny" — Mira and Sunny on the bench. Derived once by hand into two committed WebP variants at native 1:1, 960 and 480, in `client/src/assets/hero/`.
- **Bytes:** 144,238 + 29,566 + a 4,359-byte README = 178,163 total, against a 200 KB cap. Largest single file 140.9 KB against a 150 KB cap.
- **Encoder:** `npx -y sharp-cli`, quality **72** (not the spec's nominal 75) at `--effort 6`. Nothing entered `package.json`. Reasoning in ADR-014 and in the asset README.
- **Composition:** split left-text / right-art at `lg`, single centred column below with the art last in a fixed DOM order. The mat (`bg-white dark:bg-gray-800`, `rounded-[24px]`, `shadow-card`, `ring-gray-200 dark:ring-gray-700`) is the dark-mode treatment.
- **Guards:** `heroAsset.test.ts` fails on any `.png`, any file over 150 KB, or a directory total over 200 KB. `pwa.config.ts` precaches `webp` so offline Home is not a broken box.

## Rulings made during the work

- **Seeded art, not generated** (repo owner, 2026-08-25). Cheaper, spends no illustration quota, honest about product output, and avoids pinning the hero to whichever image model made it.
- **No dark-mode brightness filter** (repo owner, 2026-08-26, after reviewing both themes on a running dev server). Verdict was "does not glare, but pretty vivid and pops a bit"; "I wouldn't adjust it much if any." Recorded as considered-and-declined, not overlooked. The knob is one class on the `<img>` — reopening is cheap.
- **1:1 locked deliberately** so #127 can swap any book page in without re-deciding aspect ratio.

## Traps found, worth not re-deriving

- **`page-4-v4.png` renders Sunny as a golden retriever** — the exact defect the v2 feedback string was written to correct. The `-v3`/`-v4` files are orphaned revisions the seed does not reference. The highest version number is the wrong pick here.
- **`new URL('...', import.meta.url)` throws under Vitest.** Vite's `asset-import-meta-url` transform rewrites it to an `http://` URL, so `fileURLToPath` fails. Use `join(dirname(fileURLToPath(import.meta.url)), ...)`. Now also in `docs/conventions/testing.md`.
- **`reuseExistingServer: !CI` can run e2e against the wrong code.** A dev server from another checkout on :5173 will be silently reused. Filed as #130.
- **`client npm run lint` lints exactly one file** — the config matches only `**/*.{js,jsx}` and the client is TypeScript. Filed as #129.

## Follow-ups filed

#126 (self-host webfonts) · #127 (rotate hero art, blocked on this) · #128 (H1 title case) · #129 (client lint) · #130 (e2e hardcoded ports)
