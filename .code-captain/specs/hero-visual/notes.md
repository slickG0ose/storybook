### agent/feat/hero-visual — 2026-08-25

**Issue:** #125 — Home hero has no real visual; it is text over a gradient. Absorbs #118 (centre-symmetry).
**Spec:** pending — @architect not yet dispatched

**Source:** `design-taste-frontend` skill audit, section 4.8. Companion finding filed as #126 (self-host webfonts), not in this branch.

**Plan**
- [ ] (placeholder — architect fills this in as tasks.md)

**Known constraints going in**
- `client/src/pages/Home.tsx:201-221` is the hero block.
- Palette tokens are already settled in `client/src/index.css` `@theme`. Purple is the action accent, amber is brand chrome and selected-state. The hero art must not introduce a third accent.
- Both themes required (CLAUDE.md done-criterion #2). Art has to read on cream `#fffbf0` and on `gray-900` `#1b1714`.
- Reserve the image box; CLS budget is real since this is above the fold.
- **Ruled 2026-08-25:** art comes from the already-seeded book, not a generated asset. Source is "A Spot for Sunny" at `server/public/illustrations/b2fa23cf-3156-4b89-83e7-82d98c32c8b7/` (cover + 5 pages, several with -v2/-v3/-v4 revisions).
- **Every source file is a ~2.2 MB PNG.** A raw one in the hero would blow the LCP budget that #126 exists to protect. The spec must derive an optimized, responsive web asset.
- Static single image for now. Rotation (reader's own characters, or a best-of pool) is #127, blocked on this landing.
