# Version restore keeps the art on pages that did not change — task plan

> Spec: [spec.md](spec.md)
> Status: Implemented (2026-09-02)
> Last updated: 2026-09-02

## Overview

Six tasks. One server-handler change carries the whole behavior (Task 1); Task 2 is the coverage
that actually fences it. Tasks 3-5 are copy-and-fence work in the client and e2e zones, independent
of the server tasks in file terms but semantically dependent on Task 1 — the new copy is a false
promise until the handler ships, so nothing here merges without Task 1. Task 6 is the ADR
follow-up. Natural parallel cut: {1, 2} on the server against {3, 4, 5} on the client/e2e.

## Cross-cutting constraints

- **Wire-shape:** `PUT /api/books/:id/versions/:version/restore` keeps
  `BookRestoreVersionResponseSchema` exactly as it is — a bare alias of `BookWithPagesSchema`
  (`shared/src/books.ts:160`). **Do not edit anything under `shared/`.** `illustration_url` is
  already pinned via `PageSchema`; the new tests assert its *value* on the existing shape. If the
  work seems to need a new response field, stop — the spec rejects that explicitly.
- **Auth middleware order:** unchanged. Do not touch `requireAuth`, the `validate()` mount, the
  ownership-404-before-status-403 ordering, or the `isEditable` gate on this route.
- **Dark-mode parity:** no new markup. Both client edits replace text inside existing elements.
  Expect `dark-mode-parity-check` to report zero added `className` strings; any added class means
  markup crept in that this plan did not authorize.
- **Migrations:** none. No Prisma schema change, no seed-shape change.
- **Guardrails touched:** none. No new dependency, no auth/session change, no paid API, no model or
  SDK change, no `data.json` touch. Restore stays unmetered — no `spendGate`, no `checkQuota`, no
  provider call. If any task appears to require one of these, surface it before acting.
- **Preserve on the restore route:** the `$transaction`, the self-healing
  `snapshotVersion = Math.max(book.version, (maxExisting._max.version ?? 0) + 1)` bump, the
  pre-restore reversibility `BookVersion` write, the `p.page_number ?? i + 1` legacy synthesis, and
  the conditional `description` / `characters_json` restore.
- **Copy rule:** never quote a price for the free re-attach path — #99 (`c2322e2`) established that
  deliberately.

## Tasks

### Task 1 — Preserve `illustration_url` on unchanged pages in the restore handler

**Zone:** server
**Depends on:** none
**Parallel-safe with:** 3, 4, 5

**Status:** Done (2026-09-02)

**Files to add or change:**
- `server/src/routes/books.ts` — restore handler at `:502-608`: build the current-art lookup before
  the transaction, thread the preserved URL into the create loop, rewrite the comment at `:576-579`

**Signatures / shapes:**
```ts
// Built from the SAME already-loaded `book.pages` array that `currentPages` is built from
// (route loads it with `include: { pages: { orderBy: { page_number: 'asc' } } }`), so the two
// cannot disagree — and built BEFORE `prisma.$transaction` opens, i.e. before deleteMany drops
// the rows it reads from.
const currentByPageNumber = new Map(
  book.pages.map(p => [
    p.page_number,
    { text: p.text, description: p.illustration_description, url: p.illustration_url },
  ]),
);

// Inside the transaction, replacing the create loop's unconditional `illustration_url: null`:
for (const p of restoredPages) {
  const current = currentByPageNumber.get(p.page_number);
  // Keyed on page_number, not array position: snapshots may carry non-contiguous
  // numbers (books.test.ts:503-520 pins 10/20 surviving the `?? i + 1` synth).
  // Exact equality on both fields, same rule the revise handler uses at :449-464.
  const unchanged =
    current !== undefined &&
    current.text === p.text &&
    current.description === p.illustrationDescription;
  await tx.page.create({
    data: {
      book_id: book.id,
      page_number: p.page_number,
      text: p.text,
      illustration_description: p.illustrationDescription,
      illustration_url: unchanged ? current.url : null,
    },
  });
}
```

Rewrite the comment at `:576-579`. It currently asserts the unconditional reset is intentional; left
as-is it would actively contradict the code. The replacement should state the rule (keep art only
when `text` and `illustration_description` both match the snapshot exactly, matched by
`page_number`), note that it is the same predicate the revise handler applies a few dozen lines up,
and — once Task 6 lands — point at the ADR.

**Tests to write:**
- None in this task; Task 2 carries the coverage.
- Wire-shape assertion required: **no** — the response shape is unchanged and already pinned.

**Manual verify (if applicable):** none (server-only).

**Done when:** `cd server && npm test` is green with the existing restore suite unmodified (it
passes both before and after — see the Task 2 note on why that is not evidence), and no new TS
errors.

---

### Task 2 — Retarget and extend the server restore tests

**Zone:** server
**Depends on:** 1
**Parallel-safe with:** 3, 4, 5

**Status:** Done (2026-09-02)

**Files to add or change:**
- `server/src/routes/__tests__/books.test.ts` — inside
  `describe('PUT /api/books/:id/versions/:version/restore')` at `:269`

**Signatures / shapes:**

Rename and retarget the existing test at `:411`,
`'clears illustration_url on every restored page'` → something like
`'clears illustration_url on pages whose content changed'`. Do not delete it. Note for the
implementer: this test passes **both before and after** Task 1, because its fixture differs on every
restored page — so it is not evidence the change works. The new cases below are.
The revise block already has a sibling named `'clears illustration_url on a page whose text
changes'` (`:571`); keep the restore names distinguishable from it.

The existing `setupDraftWithSnapshot` helper (`:270`) sets every current page's URL to
`https://example.com/current.png` and inserts a v1 snapshot that differs on all three pages. New
cases need a fixture where at least one snapshot page matches the current page byte-for-byte; the
seeded `luna-star-garden` pages are `'Page 1 text'`.. with their own descriptions, so build the
matching snapshot rows from the seeded values (read them from the DB in the helper rather than
hardcoding, so a seed change fails loudly instead of silently un-matching).

New cases:
- **unchanged page keeps its art** — snapshot page 2 byte-identical to current page 2 (same `text`
  *and* same `illustrationDescription`); assert `res.body.pages[1].illustration_url` equals the
  pre-restore URL while the differing pages come back `null`.
- **text-only difference clears** — descriptions equal, `text` differs by one word.
- **description-only difference clears** — `text` equal, `illustrationDescription` differs.
- **whitespace-only difference clears** — snapshot `text` is the current text plus a trailing space.
  This is the test that pins exact equality; if someone later adds `.trim()`, this fails.
- **snapshot page number with no current counterpart** — e.g. snapshot carries `page_number: 9`;
  assert 200, the page is created, and its `illustration_url` is `null`.
- **snapshot shorter than current** — 5 current pages, 2-page snapshot; assert exactly 2 pages
  remain and the surviving unchanged one kept its URL.
- **snapshot longer than current** — assert the extra pages are created with `null` and the
  overlapping unchanged ones kept their URLs.
- **`IllustrationVersion` rows survive a restore** — insert a couple of rows for a page that gets
  cleared, restore, assert the rows are still present. This is the fact #99's free re-attach depends
  on (the cascade hangs off `Book`, not `Page`), and nothing currently fences it.

Leave every pre-existing assertion in the describe block intact: version bump to 3, the pre-restore
`BookVersion` write with 5 pages, `description` / `characters` restore, the legacy
`page_number`-less snapshot case at `:425`, and the 401 / 403 / 404 cases.

**Tests to write:** as enumerated above, all in `books.test.ts`.
- Wire-shape assertion required: **no** — response shape unchanged.

**Done when:** `cd server && npm test` green, every listed case present, no test deleted, no new TS
errors.

---

### Task 3 — Rewrite the two restore copy strings

**Zone:** client
**Depends on:** none (but must not merge without Task 1 — see Sequencing notes)
**Parallel-safe with:** 1, 2

**Status:** Done (2026-09-02)

**Files to add or change:**
- `client/src/pages/BookDetail.tsx` — confirm dialog at `:411-413`, panel blurb at `:1225`

**Signatures / shapes:**
```ts
// :411-413 — handleRestore confirm
`Restore version ${version}? This replaces the current story text and illustration prompts. ` +
`Illustrations are kept on pages that don't change and cleared on pages that do — a cleared page ` +
`can be put back for free from its illustration history.`

// :1225 — version-history panel blurb (JSX text node)
Restore a previous draft of the story. Pages whose text and prompt are unchanged keep their
illustrations; changed pages have theirs cleared, and can be put back for free from the page's
own history.
```

Constraints on the wording: it must keep the literal substring `Illustrations` and, case-
insensitively, `cleared` (the e2e assertions at `e2e/tests/version-history.spec.ts:222-223, 254-255`
match on both); it must **not** contain `regenerate`/`regenerated`; and it must quote no price. Reuse
#99's vocabulary from `BookSpread` ("put it back", "Free") so the three surfaces describing this one
recovery path agree.

Text-only edits. Do not add elements, wrappers, or `className`s.

**Tests to write:** none here; Task 4 fences the strings.

**Manual verify (if applicable):**
- Open a draft book you own, scroll to "Version history": read the blurb in **light and dark mode**.
- Click Restore on a prior version and read the confirm dialog; cancel.
- Correctness half of CLAUDE.md criterion #2 only — the aesthetic half still needs your eye, though
  no layout changed.

**Done when:** both strings updated, `cd client && npm test` green, `npm run lint` and the typecheck
clean.

---

### Task 4 — Fence the new copy in client tests

**Zone:** client
**Depends on:** 3
**Parallel-safe with:** 1, 2

**Status:** Done (2026-09-02)

**Files to add or change:**
- `client/src/pages/__tests__/BookDetail.test.tsx` — the version-history describe block (the restore
  cases live around `:328-386`)

**Signatures / shapes:**
- Assert on the message passed to the mocked `window.confirm`: it contains `Illustrations`, contains
  `cleared`, contains `free`, and **does not match** `/regenerat/i`. The negative assertion is the
  point of this task — it is what stops the pre-#99 promise from coming back in a future edit.
- Assert the panel blurb renders its new text when the version-history panel is shown for an
  owner-draft book.

**Tests to write:**
- `client/src/pages/__tests__/BookDetail.test.tsx` — confirm-copy assertions (positive + the
  `/regenerat/i` negative) and a panel-blurb render assertion.
- Wire-shape assertion required: **no** (client zone).

**Done when:** `cd client && npm test` green, both assertions present, no new TS errors.

---

### Task 5 — Tighten the e2e dialog assertions

**Zone:** e2e
**Depends on:** 3
**Parallel-safe with:** 1, 2

**Status:** Done (2026-09-02)

**Files to add or change:**
- `e2e/tests/version-history.spec.ts` — the two dialog blocks at `:222-223` and `:254-255`

**Signatures / shapes:**
- Keep the existing `toContain('Illustrations')` / `toLowerCase().toContain('cleared')` assertions.
- Add, in both places, a negative assertion that the message does not promise regeneration
  (`expect(dialogMessage).not.toMatch(/regenerat/i)`).
- Leave the mocked restore response at `:132-170` as-is. It returns every page with
  `illustration_url: null`, which is still a legitimate outcome (that fixture's snapshot differs on
  every page) — do not rewrite it into a partial-preservation fixture; the server suite already owns
  that case, and this spec is route-mocked, so it would assert the mock rather than the handler.

**Tests to write:**
- `e2e/tests/version-history.spec.ts` — the two negative assertions above.

**Manual verify (if applicable):** none beyond Task 3's browser check.

**Done when:** `cd e2e && npm test` green with both negative assertions in place.

---

### Task 6 — Pre-merge follow-ups

**Status:** Done (2026-09-02)

**Zone:** docs (harness) · **Depends on:** none (run last)

The spec's ADR-worthy list has one item, so this task is required. Run `/create-adr` for:

**"Version restore preserves art on pages that did not change; the clear-predicate is exact equality
on `text` + `illustration_description`, keyed by `page_number`."**

The ADR must record, at minimum: the predicate and the fact that restore and revise now share it;
why exact equality rather than trimmed (the failure-mode asymmetry — over-clearing costs two free
clicks via #99, under-clearing ships a text/image mismatch onto a book that may then become immutable
per ADR-012); the accepted cast-rollback risk from the spec's Risks table; and, as a rejected
alternative, the decision *not* to extend `BookRestoreVersionResponseSchema` with a cleared-pages
list. It supersedes the intent recorded in the old `books.ts:576-579` comment — say so explicitly, so
a reader who finds that comment in `git blame` lands on the reversal rather than the original.

Once the ADR exists, update the rewritten comment from Task 1 to cite its number.

**Done when:** `adr-tracking-check restore-keeps-unchanged-art` reports zero orphaned items.

## Sequencing notes

- **Parallel cut:** {1, 2} server and {3, 4, 5} client/e2e touch disjoint files and can run
  concurrently.
- **One PR.** Tasks 3-5 make a promise ("unchanged pages keep their illustrations") that is false
  until Task 1 ships. Do not merge the copy ahead of the handler. If the work is split across PRs
  for review size, the server PR must land first.
- Task 2 must run after Task 1 or its new cases fail by design. Task 4 and Task 5 must run after
  Task 3 or they assert copy that does not exist yet.
- Task 6 runs last, after the code settles, so the ADR describes what actually shipped.
- **PR body:** link this spec and `tasks.md`, note architect + developer ownership, and state that
  the PR covers **#95 items 1 and 3 only** — item 2 shipped in #99 / `c2322e2`. Say plainly that
  restore no longer discards valid art, since that is the user-visible headline and the spend
  argument the issue was filed on.

## Open questions

None blocking. Two judgment calls the implementer may hit:

- **Where the shared predicate lives.** This plan inlines it in the restore handler, matching how
  revise inlines its own copy. If the implementer would rather extract a small helper both call
  (e.g. `pageContentChanged(current, snapshotPage)` in `server/src/lib/`), that is an acceptable
  improvement — but it means editing the revise handler too, which this spec listed as out of scope.
  Surface it rather than doing it silently.
- **Whether the new test fixtures read the seeded page text from the DB or hardcode it.** Task 2
  recommends reading from the DB so a seed change fails loudly. If that makes a case unreadable,
  hardcoding with a comment naming the seed dependency is acceptable.
