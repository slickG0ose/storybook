### agent/feat/hero-rotation — 2026-08-26

**Issue:** #127 — rotate the hero illustration: the reader's own characters, or a best-of pool.
**Base:** `6a30a50` (#132, the static hero) — this branch builds directly on it.
**Spec:** pending — @architect dispatched

**Plan**
- [ ] (placeholder — architect fills this in as tasks.md)

**Inherited from ADR-014, both load-bearing**
- The byte budget is enforced by a test (`client/src/__tests__/heroAsset.test.ts`): 150 KB per file, 200 KB for the directory. N rotating frames cannot each be 140 KB and stay bundled. This is the constraint that most shapes the design.
- Derivation is a documented manual command, not a pipeline. ADR-014 explicitly said automating it is the thing to revisit here.
- The hero frame is locked to native 1:1 so any book page can swap in without re-cropping.

**Open decisions the architect owns**
- Sequencing: the issue argues best-of pool first, personalised second. Confirm or overturn.
- "Biggest hit" has no signal in the schema today. Cart adds? Order counts? An admin-set flag?
- Consent for the pool — a user's own art on their own screen is fine; the same art shown to strangers is publishing.
- Signed-out first paint: rotation that waits on an auth check will flash or block.
