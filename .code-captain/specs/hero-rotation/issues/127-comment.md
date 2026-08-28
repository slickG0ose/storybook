# Draft comment for issue #127 — NOT POSTED

Stored as a file so it survives the dispatch that drafted it, following the
`edit-published-books` precedent (`.code-captain/product/decisions.md:339`).
Post it with `gh issue comment 127 --body-file <this file>` once the owner approves.

**#127 must stay open.** The PR body deliberately avoids `Closes`/`Fixes` keywords —
this branch ships population 2 (the best-of pool) only.

---

This PR ships **population 2 only — the best-of pool.** Leaving this issue open for population 1.

**What landed:** an admin-set `is_hero_eligible` flag plus an owner-consent column, `GET /api/hero/pool`, derived-and-committed WebP frames served from `server/public/hero/` under a 400 KB directory budget test, and a crossfading second layer in the hero that never touches frame 0. Frame 0 stays the bundled, byte-budgeted LCP artifact from #125, so with the backend cold or down the hero is exactly what it is today. Rotation is suppressed under `prefers-reduced-motion`, under `saveData`, and on an empty or failed pool.

**Why population 1 is not in it, and what it is waiting on:** a reader's own art is a 2.2 MB PNG under `/illustrations/`, generated at runtime, with no derived variant and nobody in the loop to run a derive script. Personalisation therefore needs **server-side derivation at image-write time** — a native `sharp` install on Render. That is a new dependency and a CLAUDE.md size-gate item, so it needs its own spec and its own confirmation rather than riding along behind a front-page nicety.

The seam for it is already cut and does not need re-litigating: a second route under `/api/hero`, a `source: 'personal'` literal that the pool response schema cannot emit, frames that join the same rotation queue late, and `HERO_POOL_WHERE` untouched. Follow-on spec slug: `hero-personal`.

Decisions recorded in ADR-015 (delivery + the eligibility signal) and ADR-016 (the consent seam — editorial eligibility and owner consent are separate columns with separate writers, and no API writes the consent column today) in `.code-captain/product/decisions.md`. Spec and plan: `.code-captain/specs/hero-rotation/`.
