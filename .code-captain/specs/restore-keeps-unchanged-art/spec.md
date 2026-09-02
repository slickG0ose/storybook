# Version restore keeps the art on pages that did not change

> Status: Implemented (2026-09-02)
> Last updated: 2026-09-02
> Backlog: https://github.com/slickG0ose/storybook/issues/95 (items 1 and 3 only)

## Problem

`PUT /api/books/:id/versions/:version/restore` (`server/src/routes/books.ts:502-608`) replaces the
book's pages by deleting all of them and re-creating each one from the snapshot with
`illustration_url: null` — **on every page, unconditionally**, whether or not that page's content
actually differs from the snapshot. The PNGs on disk and the `IllustrationVersion` rows both
survive; only the pointer is dropped. So rolling a 5-page book back one version to fix a typo on
page 3 discards four perfectly valid illustrations, and the only *paid* way back is to redraw them:
20c at the current Fal pricing, $1.25 on a book pinned to OpenAI per ADR-013.

The unconditional null-ing is asserted as deliberate in a code comment at
`server/src/routes/books.ts:576-579` ("the old image URLs no longer correspond to the restored
text/description"), which is true of *changed* pages and false of unchanged ones. The revise handler
in the same file (`:449-464`) already got this right — it clears art only when `text` or
`illustration_description` actually moved. Restore is the outlier.

Item 2 of the issue — re-attaching art that has already been orphaned — **shipped in PR #99 /
commit `c2322e2`** and is explicitly not re-specified here. It matters to this spec only as a
backstop: it means over-clearing is now recoverable for free, which is what makes the predicate
below safe to bias toward clearing. The current UI copy predates it and still tells users cleared
illustrations "need to be regenerated", which is no longer true.

## Constraints

- **No snapshot-shape change.** `BookVersion.pages_json` stays `{ page_number, text,
  illustrationDescription }`. The design must derive "did this page change?" from data already in
  scope, not from a new snapshot field. (Confirmed feasible: `book.pages` is loaded on the route
  with `include: { pages: { orderBy: { page_number: 'asc' } } }` at `:516-519`, so the current
  per-page `illustration_url`, `text`, and `illustration_description` are all available before the
  transaction opens.)
- **Guardrails, all clear.** No Prisma schema change, no migration, no seed-data shape change, no
  new dependency, no auth/session change, no Claude-model or SDK change, no new paid API. Restore
  is and stays unmetered — no `spendGate`, no `checkQuota`, no provider call. This change *reduces*
  spend.
- **Published books stay immutable** (ADR-012). The route's existing `isEditable` 403 is untouched.
- **Wire shape unchanged.** `BookRestoreVersionResponseSchema` stays a bare alias of
  `BookWithPagesSchema` (`shared/src/books.ts:160`). Nothing in `shared/` is edited — see
  "Alternatives considered".
- **Existing restore behaviors are load-bearing and must survive:** the `$transaction`, the
  self-healing `snapshotVersion = Math.max(book.version, maxExisting + 1)` version bump, the
  pre-restore reversibility snapshot, the `p.page_number ?? i + 1` legacy synthesis, the conditional
  `description` / `characters_json` restore, and the 403/404 gates.

## Proposed shape

Restore adopts the predicate the revise handler already ships. Before the transaction opens, build a
lookup of the book's current pages keyed by `page_number`, carrying each page's `text`,
`illustration_description`, and `illustration_url`. Inside the transaction, when re-creating each
restored page, look up the current page at the same `page_number`: if one exists and **both** its
`text` and its `illustration_description` are exactly equal to the snapshot's, the new row keeps
that page's `illustration_url`; in every other case it gets `null`. The stale comment at `:576-579`
is rewritten to state the new rule rather than contradicting it.

**The predicate, exactly.** For a restored page `r` (after `page_number` normalization) and the
current page `c` where `c.page_number === r.page_number`:

```
keep art  ⟺  c exists  ∧  c.text === r.text  ∧  c.illustration_description === r.illustrationDescription
```

Anything else — either field differs, or no current page carries that number — yields `null`.

**Exact equality, not trimmed or normalized.** Two reasons. First, `pages_json` is a
`JSON.stringify` of the DB values verbatim and restore writes those strings back verbatim; no
formatting pass exists anywhere in the round-trip that could introduce cosmetic whitespace, so
trimming could only ever mask an edit a user really made. Second, the failure modes are asymmetric:
clearing art that could have been kept costs the user two clicks on the free #99 re-attach, while
keeping art that should have been cleared ships a page whose picture contradicts its text — and if
that book is then published it becomes immutable (ADR-012), so the mismatch is expensive to walk
back. When the two errors are not equally bad, the predicate should lean toward the cheap one.
Exact equality also keeps restore and revise governed by one rule instead of two that can drift.

**Matching is by `page_number`, not by array position.** Snapshots do not guarantee contiguous
1..N numbering — the `?? i + 1` synthesis only fills in *missing* numbers, and an existing test
(`books.test.ts:503-520`) pins that a snapshot carrying `page_number: 10, 20` keeps those values.
Positional matching would silently pair the wrong pages on such a snapshot; keyed matching cannot.

**The handler keeps its `deleteMany` + `create`-per-page shape.** The preserved URL threads through
the lookup rather than the write pattern changing. Rewriting restore into revise's
update-overlap / create-additions / delete-tail form would require a three-way diff keyed on
arbitrary page numbers rather than revise's contiguous positions — more branches and more risk for
zero behavioral gain. `Page.id` churn from the delete/recreate is not load-bearing: nothing carries
a foreign key to `Page` (`IllustrationVersion` keys on `(book_id, page_number, version)` and
cascades from `Book`, which is exactly why the art survives the delete at all), and the client keys
spreads on `page_number`.

**Page-count and numbering mismatches, defined.**

| Case | Behavior |
|---|---|
| Snapshot page number **has** a current counterpart, both fields equal | Keeps that page's `illustration_url` (which may itself be `null` — no special case needed) |
| Snapshot page number **has** a current counterpart, either field differs | `illustration_url: null` |
| Snapshot page number has **no** current counterpart (snapshot longer, or renumbered) | `illustration_url: null` — there is no candidate URL. #99's probe still offers free recovery, because `IllustrationVersion` is keyed by `(book_id, page_number, version)`, not by `Page.id` |
| Current page number **absent** from the snapshot (snapshot shorter) | Page is deleted, exactly as today. Its `IllustrationVersion` rows survive the delete, so a later restore that re-creates that page number can still recover the art through #99 |
| Snapshot contains a duplicate `page_number` | Unchanged from today: the second `tx.page.create` violates `@@unique([book_id, page_number])`, the transaction rolls back, the handler returns 500. Malformed-snapshot handling is out of scope |

**Copy.** Both strings in `client/src/pages/BookDetail.tsx` are rewritten. Their "changed pages"
phrasing becomes accurate the moment the server change lands, but "need to be regenerated" is
already wrong post-#99 and must go. The new copy states the keep/clear rule and names the free
recovery path, in the vocabulary #99 established in `BookSpread` ("put it back", "Free"), and
**quotes no price** — matching the deliberate choice recorded in `c2322e2`.

- Confirm dialog (`BookDetail.tsx:411-413`):
  `Restore version ${version}? This replaces the current story text and illustration prompts. Illustrations are kept on pages that don't change and cleared on pages that do — a cleared page can be put back for free from its illustration history.`
- Version-history panel blurb (`BookDetail.tsx:1225`):
  `Restore a previous draft of the story. Pages whose text and prompt are unchanged keep their illustrations; changed pages have theirs cleared, and can be put back for free from the page's own history.`

Both retain the substrings the existing e2e assertions match on (`Illustrations` and, case-
insensitively, `cleared` — `e2e/tests/version-history.spec.ts:222-223, 254-255`), so those specs stay
green on wording alone; the tasks tighten them so the old promise cannot creep back.

### Schema / contract changes

**None.** No Prisma migration, no `shared/` edit, no route signature change. The restore response
stays `BookWithPagesSchema`; the only observable difference is that some `pages[].illustration_url`
values are now non-null where they previously were not. That field is already part of the pinned
shape via `PageSchema`, so no new wire-shape schema is required — the existing per-page assertions
in `books.test.ts` continue to pin it, and the new tests assert its *value*.

### Data flow

```
user clicks "Restore v1"  →  confirm dialog (new copy)  →  PUT /api/books/:id/versions/1/restore
  → requireAuth → validate(response: BookRestoreVersionResponseSchema) → handler
      load book + pages (ordered)  →  404 if not owner  →  403 if not draft  →  404 if no snapshot
      build currentArtByPageNumber from book.pages          ← NEW, before the transaction
      $transaction:
        write pre-restore BookVersion (reversibility)       ← unchanged
        deleteMany pages                                    ← unchanged
        create each restored page, illustration_url =       ← CHANGED
          unchanged-page ? preserved URL : null
        book.update { version: newVersion, ...desc, ...cast } ← unchanged
  → hydrateBook → 200 BookWithPages
    → client setBook(updated) → #99 probe re-runs over the pages that came back null
      → BookSpread offers the free re-attach on those pages only
```

State lives entirely in the DB. Nothing new is held client-side.

### Files likely touched

- `server/src/routes/books.ts` — the restore handler: build the lookup, thread the URL into the
  create loop, rewrite the now-false comment at `:576-579`
- `server/src/routes/__tests__/books.test.ts` — retarget the over-claiming
  `'clears illustration_url on every restored page'` test (`:411`) and add the new cases
- `client/src/pages/BookDetail.tsx` — the two copy strings (`:411-413`, `:1225`)
- `client/src/pages/__tests__/BookDetail.test.tsx` — fence the copy
- `e2e/tests/version-history.spec.ts` — tighten the dialog assertions (`:222-223`, `:254-255`)

## Alternatives considered

### Carry `illustration_url` in the snapshot (`BookVersion.pages_json`)

**Pros:** restore could re-point each page at the art that was attached *when the snapshot was
taken*, which is arguably more faithful to "restore this version" than keeping today's art.
**Cons:** changes the snapshot shape, which the issue rules out; every pre-existing `BookVersion`
row lacks the field, so the code would need the compare-based path anyway as a fallback and would
carry both forever; and the restored URL might point at a file a later cleanup removed, so restore
would need to stat the filesystem or verify against `IllustrationVersion` before trusting it.
**Why rejected:** strictly more machinery for a case the compare-based rule already covers well, and
it violates a stated constraint.

### Rewrite restore as update-overlap / create-additions / delete-tail (mirror revise's write shape)

**Pros:** stable `Page.id` across a restore; one write pattern shared with revise.
**Cons:** revise can index positionally because it always writes contiguous `1..N`; restore must
honor whatever `page_number` values the snapshot carries, so the same shape becomes a three-way keyed
diff. More branches, more ways to get a legacy snapshot wrong, and `Page.id` stability buys nothing —
no table references it.
**Why rejected:** cost with no benefit. Held as an upgrade path only if something ever does take a
foreign key on `Page.id`.

### Trimmed / whitespace-normalized comparison

**Pros:** would keep art across a purely cosmetic whitespace edit.
**Cons:** the round-trip introduces no cosmetic whitespace, so the only diffs it would absorb are
ones a user actually typed; it would put restore and revise on two different rules; and it errs
toward the expensive failure mode (a text/image mismatch on a book that may then be published).
**Why rejected:** solves a problem the pipeline cannot produce, at the cost of the worse error.

### Extend the restore response with a list of cleared page numbers

**Pros:** the client could show "3 illustrations were cleared — put them back for free".
**Cons and why rejected — recommend NO.** Four reasons, and the first is decisive: **the confirm
dialog fires before the request, so it can never consume a response field.** The panel blurb is
static. So no copy in this spec needs it. Second, the client can already derive it: `BookDetail`
holds the pre-restore `book` in state and receives the post-restore `pages`, so "had a URL, now
`null`" is a local computation. Third, #99's probe already keys off `illustration_url === null` and
surfaces the free re-attach on exactly those pages, so the affordance appears with no new field.
Fourth, the cost is real — `BookRestoreVersionResponseSchema` would stop being a bare alias and
become an extension, requiring a `shared/` edit, a fresh wire-shape assertion (OPS.3 / ADR-003), and
a client type update, for a field with no consumer.
**Held as upgrade path:** if a post-restore toast is ever wanted, extend then, the way
`BookIllustrateResponseSchema` extends `BookWithPagesSchema` today.

### Auto-re-attach the newest surviving `IllustrationVersion` on changed pages

**Pros:** zero-click recovery.
**Cons:** on a *changed* page the surviving art is precisely the art that no longer matches the
text — auto-attaching it is the mismatch this whole design is trying to avoid, done automatically
and invisibly.
**Why rejected:** wrong on the merits, and #99 already gives the user the one-click version with
consent.

## Success criteria

Server (`server/src/routes/__tests__/books.test.ts`):

- Restoring a snapshot whose page 2 is byte-identical to the current page 2 returns
  `pages[1].illustration_url` equal to the pre-restore URL, while pages that differ come back `null`.
- A text-only difference clears that page's art; an `illustration_description`-only difference
  clears it; a trailing-whitespace-only difference clears it (pins exact equality).
- A snapshot page number with no current counterpart restores with `illustration_url: null` and does
  not throw.
- A snapshot shorter than the current book drops the surplus pages and preserves art correctly on
  the survivors; a snapshot longer than the current book creates the extra pages with `null`.
- All pre-existing restore assertions still pass unchanged: version bump to 3, pre-restore
  `BookVersion` snapshot written with the current 5 pages, `description` and `characters` restored,
  legacy `page_number`-less snapshot restores as 1..3, 401 / 403-on-published / 404-missing-book /
  404-other-user / 404-missing-version.

Client (`client/src/pages/__tests__/BookDetail.test.tsx`):

- The confirm string contains neither `regenerate` nor `regenerated`, and does say art is kept on
  unchanged pages and that recovery is free.
- The panel blurb renders the new wording.

E2E (`e2e/tests/version-history.spec.ts`):

- Both dialog assertions still pass, plus a new negative assertion that the message does not promise
  regeneration.

Cross-cutting:

- `cd server && npm test`, `cd client && npm test`, `cd e2e && npm test` all green; no new TS errors.
- `dark-mode-parity-check` reports zero added `className` strings (this change adds no markup).

## Out of scope

- **Item 2 of #95, re-attaching already-orphaned art** — shipped in PR #99 / `c2322e2`. Do not touch
  `BookSpread`'s orphan strip or `BookDetail`'s probe effect beyond what the copy tasks name.
- Changing `BookVersion.pages_json` to carry `illustration_url`.
- Any change to the revise handler, whose predicate this change is adopting.
- A "N illustrations were cleared" toast, or any restore-response shape change.
- Auto-re-attaching art without user action.
- Repairing books already orphaned by past restores (#99 covers them interactively; no backfill).
- Malformed-snapshot hardening (duplicate `page_number`, non-integer numbers).

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| **A kept illustration contradicts a restored *cast*.** Restore also rolls back `characters_json`. If the cast changed between versions but a page's `text` and `illustration_description` did not, that page keeps art drawn under the newer cast while the book now describes the older one. This is the strongest form of the argument the original null-everything comment was making. | Accepted, and named in the ADR. The image is generated from the page's `illustration_description` plus the style anchor, so a cast edit that leaves every page description untouched is unlikely to have changed what the art depicts. Where it does, the per-page re-roll and the free revert both remain one click away. Widening the predicate to "any book-level field changed" would clear all art on every restore that touches the cast — i.e. re-introduce the bug for a rarer case. |
| **Wire-shape (OPS.3 / ADR-003).** Scope creep into a response-shape change would require a `shared/` edit plus new assertions. | The design explicitly adds no field; `shared/src/books.ts` is not in "files likely touched". `illustration_url` is already pinned through `PageSchema`, and the new tests assert its value on the existing shape. |
| **The existing test `'clears illustration_url on every restored page'` (`books.test.ts:411`) still passes after the change** — its fixture happens to differ on all three restored pages — so it silently stops fencing what its name claims. | Task 2 renames and retargets it rather than deleting it, and the new cases carry the actual coverage. A test that passes for the wrong reason is worse than no test. |
| **Copy drift between the two strings and the #99 `BookSpread` strip.** Three places now describe the same free-recovery path. | Reuse #99's vocabulary ("put it back", "free"), quote no price anywhere, and fence both new strings in client tests plus a negative e2e assertion. |
| **Auth / session:** none. The route's `requireAuth` → `validate` → handler order and the ownership-before-status check are untouched. | Task list does not permit editing the route's middleware or gate lines. |
| **Prisma / dev.db:** none. No schema field, no migration, no seed change. | If an implementation reaches for a schema change, it has left the design — stop and re-spec. |
| **Dark-mode parity:** no new UI surface; both edits replace text inside elements that already carry `dark:` variants. | Reviewer Check 3 should report zero added classNames; if it reports any, markup crept in that this spec did not authorize. |
| **Spend:** this is a spend *reduction*. Restore has no `spendGate` and makes no provider call, before or after. | No quota or cost-table change; `COST_CENTS` untouched. |

## ADR-worthy decisions

- [x] **Recorded as ADR-019** (`.code-captain/product/decisions.md`) — **Version restore preserves art on pages that did not change; the clear-predicate is exact
  equality on `text` + `illustration_description`, keyed by `page_number`** — this reverses a
  behavior the code at `server/src/routes/books.ts:576-579` explicitly documents as intentional, so
  the reversal needs a record rather than a replacement comment. The ADR should capture: the
  predicate itself and that revise and restore now share it; why exact equality rather than trimmed
  (failure-mode asymmetry, backstopped by #99's free re-attach); the accepted cast-rollback risk from
  the Risks table; and — as a rejected alternative — the decision *not* to extend
  `BookRestoreVersionResponseSchema` with a cleared-pages list, so a future reader does not re-open
  that question cold. **Done:** ADR-019 records all four, states explicitly that it supersedes the
intent in the old `books.ts` comment (now reachable only via `git blame`), and the rewritten
handler comment cites it by number.
