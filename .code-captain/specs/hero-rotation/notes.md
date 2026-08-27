### agent/feat/hero-rotation — 2026-08-26

**Issue:** #127 — rotate the hero illustration: the reader's own characters, or a best-of pool.
**Base:** `6a30a50` (#132, the static hero) — this branch builds directly on it.
**Spec:** [spec.md](spec.md) · **Plan:** [tasks.md](tasks.md)

**Scope ruling (architect, accepted):** this branch ships **population 2 only** — the
best-of pool. The personalised hero is a separate spec (`hero-personal`), blocked on the
server-side derivation decision, and **#127 stays open when this merges.**

**Plan** — ten tasks; status is tracked per task in `tasks.md`, this is the map.

- [x] 1 — Wire shape: `shared/src/hero.ts` (`HeroFrameSchema`, `HeroPoolResponseSchema`) + the admin request/response pair
- [x] 2 — Prisma `is_hero_eligible` / `hero_consent_at`, the migration, and the demo fixture's consent
- [x] 3 — `derive-hero-frames.sh`, the four committed WebPs, the served-set byte budget test
- [x] 4 — `server/src/lib/heroPool.ts` + `GET /api/hero/pool`
- [x] 5 — `PUT /api/admin/books/:id/hero-eligible`
- [x] 6 — Extract `HeroArt` with no behaviour change (deliberately a no-op commit)
- [x] 7 — The rotation itself: `useHeroPool` + the crossfading layer
- [x] 8 — e2e: rotation happens, and nothing shifts (measured CLS)
- [x] 9 — Documentation (this file, both hero READMEs, `docs/conventions/server.md`)
- [x] 10 — Pre-merge follow-ups: ADR-015 / ADR-016, #127 note, deferred items

**Inherited from ADR-014, both load-bearing**
- The byte budget is enforced by a test (`client/src/__tests__/heroAsset.test.ts`): 150 KB per file, 200 KB for the directory. N rotating frames cannot each be 140 KB and stay bundled. This is the constraint that most shapes the design.
- Derivation is a documented manual command, not a pipeline. ADR-014 explicitly said automating it is the thing to revisit here.
- The hero frame is locked to native 1:1 so any book page can swap in without re-cropping.

**How the open decisions were settled**
- **Sequencing:** pool first, confirmed — it is also the fallback path population 1 needs anyway.
- **"Biggest hit" has no signal:** an admin-set `is_hero_eligible` flag, because there are no orders to derive popularity from; a computed signal would rank an empty set. Order counts stay an upgrade path that needs no wire-shape change.
- **Consent:** a second column, `hero_consent_at`, with **no API writer at all** — only the demo-seed fixture, i.e. the operator consenting to the operator's own book.
- **Signed-out first paint:** the hero never awaits auth or the pool. Frame 0 is synchronous and bundled; rotation is progressive enhancement.

## Surprises this build actually hit

Recorded here because each cost real time and none of them is visible from the spec.

**1. `.gitignore` was silently swallowing `server/public/hero/` (Task 3).**
`server/public/*` is ignored wholesale — correctly, since it otherwise holds
runtime-generated uploads and illustrations. The derived frames landed, the budget test
passed locally, and `git status` reported nothing to commit. Untracked artifacts are
invisible locally and a **404 in CI and in production**, where the rotation would simply
never start — which is indistinguishable from the designed degradation, so nothing would
have looked broken. Fixed with a directory-wide `!server/public/hero/` re-include (no
per-book line needed, unlike `illustrations/`), and written into
`server/public/hero/README.md` with a `git status --short` check to run after deriving.

**2. `AdminBookListItemSchema`'s new field had to move from Task 1 to Task 2.**
The plan put every schema change in Task 1. But `is_hero_eligible` is a **required** field
on a `validate()`-checked *response*, and in dev `validate()` is loud: a response missing a
required field is a hard **500**, not a warning. Landing the schema before Task 2's Prisma
column would have made `GET /api/admin/books` 500 for everyone in between. The user ruled
the field moves into Task 2 so the column and the schema land in the same commit. General
form worth remembering: **a required response field and the column that fills it are one
atomic change**, and schema-first ordering is only safe for optional fields.

**3. Prisma emitted `RedefineTables`, not `ALTER TABLE ADD COLUMN` (Task 2).**
Two additive columns — one defaulted boolean, one nullable datetime — on SQLite. The
generated migration is a create-copy-drop-rename block rather than the two-line `ALTER`
that was expected. It is what the SQLite connector does for this pair and it *is*
data-preserving, but it reads alarming in review. The SQL was kept **unedited** (never
edit a generated migration into something you have not tested), and the note lives on
Task 2 in `tasks.md` so the next reader does not re-litigate it at review time.

**4. Page 5 comes from `page-5.png`, not `page-5-v3.png` (Task 3).**
The spec's resolved open question named `-v3`. The fixture points page 5 at `page-5.png`,
and "derive only from URLs `spot-for-sunny.json` actually points at" is the harder rule —
a hero frame that does not appear in the book it advertises is a small lie. Both were
rendered and compared: same scene, same cast, same style (v3 adds Sunny's backpack and
reframes the tree; neither has the `-v4` golden-retriever defect). The developer's call
was put to the owner and **upheld**, and open question 1 in `tasks.md` was amended to
match. Changing it back means changing the fixture and the script's `FRAMES` list in one
commit.

**5. Two smaller ones, for completeness.**
- The served-directory cap is **400 KB, not the 1 MB** the task body sketched (owner's
  ruling: a cap permitting five frames while two ship is decoration, not a guard).
- `resolveHeroPool` orders by `[{ created_at: 'asc' }, { id: 'asc' }]`. The `id` tiebreak
  is not decoration: SQLite stores millisecond resolution and one seed run can write two
  books in the same millisecond, so without it the "deterministic ordering" that justifies
  the 300 s cache header is not actually deterministic.
