# StoryBook Storefront — Illustration & Authoring Upgrades

## Status (as of 2026-05-14, evening)

- **MVP Phase 1 — SHIPPED via [PR #1](https://github.com/nkonecnyAGP/storybook-storefront/pull/1).** All five pieces below are live on `master`.
- **Post-MVP follow-ups — SHIPPED via [PR #3](https://github.com/nkonecnyAGP/storybook-storefront/pull/3) and [PR #4](https://github.com/nkonecnyAGP/storybook-storefront/pull/4):**
  - Clearer illustration-mode wording + per-action cost hints in the wizard, on Illustrate All, and on per-page generate buttons. Confirm dialog before multi-image generation.
  - Variable page count (3-15) at creation, and the ability to expand or contract page count during draft revision. Existing illustrations on overlapping pages are preserved across revisions.
- **Workflow changes:** Adopted a `develop`-as-integration / `master`-as-release branching model with a hotfix path. See [branching-workflow.md](branching-workflow.md). Going forward, feature branches target `develop`, not `master`.

## Open / planned (next features queued in chat)

- **Browse navbar button fix** — SHIPPED via [PR #5](https://github.com/nkonecnyAGP/storybook-storefront/pull/5) (merged to develop), released to master via [PR #6](https://github.com/nkonecnyAGP/storybook-storefront/pull/6).
- **dev.db snapshot safety net** — same as above. Backs up `server/prisma/dev.db` to `server/.backups/` on every server start with 7-day retention. Closes the data-loss gap.
- **Demo seed (`db:seed-demo`)** — in flight via [PR #7](https://github.com/nkonecnyAGP/storybook-storefront/pull/7). Creates a persistent `demo@storybook.local` user with 3 sample books for demo prep, reusing orphaned illustration files from the wiped session.

## Surfaced during demo prep — needs implementation

Captured 2026-05-14 evening while using the app to prep demo books. Ranked roughly by user impact during the demo flow.

1. **Edit illustration prompt before sending the image AI request.** SHIPPED via [PR #11](https://github.com/nkonecnyAGP/storybook-storefront/pull/11) (Phase 0).

2. **Expandable book-view layout (theater mode).** The book-spread view today renders inside the narrow main column. For reading and editing the expanded illustration descriptions, a fullscreen / wider mode would help — particularly with the suggestion-revise panel visible alongside. UX: a toggle button in the spread footer that expands the spread to ~90% viewport width and keeps the inline revise panel docked. No data changes. **Still open.**

3. **Visual consistency across pages for the same character + provider migration.** Today each page is illustrated independently — the same character can look noticeably different page to page. Combined with the realization that real OpenAI spend is ~$0.20-$0.45 per image (10× our paper estimate, so a 15-page Full book is $3-$7), both problems are now planned together. See [illustration-providers-and-character-consistency.md](illustration-providers-and-character-consistency.md) for the full research — recommended path is **Fal.ai Flux Pro 1.1** as the new primary provider plus **character-sheet portraits passed via IP-Adapter** to every page generation. Estimated impact: ~5-8× cost reduction *and* solves the consistency gap. **Phase 0 SHIPPED in PR #11. Phase 1 (Fal migration) and Phase 2 (IP-Adapter character refs) still open.**

4. **Bug: navigation chevrons in BookSpread overlay text on long pages.** SHIPPED via PR #11 alongside Phase 0.

## Surfaced 2026-05-15 (post-Phase-0)

Captured while wrapping up after the Phase 0 PR merged. Heavier than the demo-prep items — this is the next thematic area we need to address.

5. **Auth durability + admin role + data persistence.** Multiple data-loss / can't-log-in events keep happening:
   - The demo user account and all user-created books were wiped today (2026-05-15) somewhere between 11:20 (last confirmed snapshot) and ~17:30 (when the loss was noticed). We recovered from `.backups/dev-20260515-112056.db` but the root cause is still unknown — best guess is a `npm run db:reset` or `prisma migrate reset` running from a parallel CLI session or hook we haven't audited.
   - As an unauthenticated viewer, *user-created published books* (the "community books" that demo users would publish) disappeared from the public catalog after the data wipe — they had been visible earlier.
   - There's no admin role today. The owner-of-the-app can't see other users' accounts, recover orphaned books, or run integrity checks except by writing one-off Prisma scripts.

   **What we need:**
   - Investigate the root cause of the periodic data wipes. The dev.db snapshot script (added in PR #5) is buying us recovery time, but we haven't closed the door on the wipe itself. Audit scripts, hooks, parallel CLI sessions, anything that could invoke `prisma migrate reset` silently.
   - Add an "admin" role on `User` (e.g., `User.role String @default("user")`). Boot the first registered user, or one explicitly marked, as admin.
   - Admin-only endpoints: list users, list orphaned illustration directories, force-restore a snapshot, mark a book as featured, soft-delete vs. hard-delete.
   - Consider soft-delete on User and Book (add `deleted_at DateTime?`) so accidental destructive operations are recoverable from within the app, not just from `.backups/`.
   - For the "community published books not visible" symptom — confirm the `/api/books` (anonymous) query still returns user-created published books correctly after the data restore. If it does, the issue was just data, not a query bug. If it doesn't, it's a separate bug to chase.

6. **Claude.md / agent setup audit.** User has homework for the next session: research Claude Code's `CLAUDE.md` options and integration, including the `.claude/agents/` subagent system (already in this repo at booksmith/qa/storefront), commands (`.claude/commands/`), and skills (`.claude/skills/`). See also [harness-backlog.md](harness-backlog.md) for the upstream Code Captain follow-ups we deferred. Should inform how we structure the next big chunk of work.

The Phase 2 and Phase 3 sections further down in this file still apply.

## Context

Today's creation flow is thin in three ways the user wants to fix:

1. **The preview is text-first.** Stories generate fast, but illustrations are opt-in *per page* after the fact. Until a user clicks "Generate illustration" on every page, the preview shows `illustration_description` as italic text in a gray box (`client/src/pages/BookDetail.tsx:304-323`). There is no "this is what the book looks like" moment — and no spread/cover layout that feels like a real book.
2. **The cast is one person.** Only a single `characterName` string is captured (`client/src/pages/CreateBook.tsx:130-139`), and **it isn't even persisted** — it's used in the Claude prompt and discarded. Revisions can't keep antagonists or supporting characters consistent because the schema never knew about them.
3. **There's no way to steer the visuals.** Style is hard-coded as "Whimsical, colorful, warm" in `server/src/services/illustrations.ts:15`. Users can't upload a reference image, a photo of their kid, or a sketch.

This plan delivers the MVP that unlocks all of the above, then stubs the next phases so we can pivot before committing to them.

---

## MVP (Phase 1) — Ship First

Five tightly scoped pieces. Each is independently useful; together they cover the user's three core asks.

### 1. Multi-character data model and authoring UI

**Why first:** Everything else (consistent illustrations, richer stories, reference photos of "Grandma") depends on the schema knowing who is in the book. Today the prompt mentions one name and forgets it.

**Schema (Prisma — `server/prisma/schema.prisma:22`):**
- Add `characters_json String?` to `Book` (JSON-encoded array). Single column, no new table — keeps queries unchanged and matches the existing `BookVersion.pages_json` pattern.
- Shape:
  ```ts
  type Character = {
    role: 'primary' | 'antagonist' | 'supporting';
    name: string;
    descriptor?: string;       // "8-year-old with curly hair, loves dinosaurs"
    relationship?: string;     // "best friend", "older sister", "pet dog"
  };
  ```
- Create migration: `npx prisma migrate dev --name add_book_characters`.

**Server:**
- Update `GenerateRequestBody` in [generate.ts:7](storybook-storefront/server/src/routes/generate.ts:7) to accept `characters: Character[]` (require at least one with `role: 'primary'`; keep `characterName` accepted as a legacy alias that gets normalized to `[{ role: 'primary', name }]` so existing tests don't break).
- Expand the Claude prompt at [generate.ts:42](storybook-storefront/server/src/routes/generate.ts:42) to list the cast with roles. Persist `characters_json` on book create.
- Same treatment in `/revise` ([books.ts:112](storybook-storefront/server/src/routes/books.ts:112)) — pass cast through, allow revising it.

**Client:**
- Add `characters: Character[]` to the `Book` types in both `server/src/types.ts` and `client/src/types.ts` (serialize/deserialize JSON in the route layer to keep the shape clean for consumers).
- Replace the single-input step 2 in [CreateBook.tsx:126-161](storybook-storefront/client/src/pages/CreateBook.tsx:126) with a cast builder:
  - Primary character (required, name + descriptor)
  - "Add antagonist" button → expandable inputs (name + descriptor, repeatable)
  - "Add supporting character" button → name + relationship dropdown ("best friend", "sibling", "parent", "grandparent", "pet", "other") + descriptor
  - Cap at 6 total to keep prompts focused.

### 2. Theme expansion: presets + custom + style templates

**Why:** Users want themes the 8-preset grid doesn't cover, and the visual *style* preset library doubles as the "art style" entry-point for uploads in piece 5.

**Client (`CreateBook.tsx:12-21`):**
- Keep the 8-theme grid; add a 9th "✏️ Custom…" tile that reveals a 60-char text input.
- New step or sub-section: **Art Style** (separate from narrative theme). Preset gallery: Watercolor, Storybook Classic, Pixar-style 3D, Anime, Crayon Sketch, Photoreal Soft. Each preset is a hard-coded `style_descriptor` string (no schema work needed).
- Selected theme + style passed in the generate payload.

**Server:**
- Pass user-supplied `theme` straight through (already does; no whitelist exists).
- Add `style_descriptor: string` to the illustration prompt builder ([illustrations.ts:15](storybook-storefront/server/src/services/illustrations.ts:15)) — replace the hard-coded "Whimsical, colorful, warm" with the selected preset.
- New column `Book.style_descriptor String?` so revisions and on-demand re-illustrations use the same style.

### 3. Book-template / spread preview layout

**Why:** Costs nothing (no extra API calls), is a visible "wow" the moment the story finishes generating, and stages the UI hook where the auto-generation modes (piece 4) will plug in.

**New component:** `client/src/components/BookSpread.tsx`
- Renders the book as facing-page spreads with paper texture (CSS gradient + subtle shadow), cover + back-cover, and page-turn animation (Tailwind `transition-transform` + a `rotateY` flip — no animation library needed).
- Each spread shows: left page = illustration (image if `illustration_url`, otherwise a styled placeholder card *labelled* with the description), right page = text.
- Cover page reuses the existing `cover_emoji` + `cover_color` block but framed in a book shape.

**Wiring:** In [BookDetail.tsx:235](storybook-storefront/client/src/pages/BookDetail.tsx:235), add a view toggle ("📖 Book view" / "📄 Reader view") above the page reader. Book view defaults on for newly generated books; reader view stays the existing component for accessibility / long-form reading.

### 4. Preview generation modes (Quick / Cover-first / Full)

**Why:** The user explicitly asked for "all of the above as user-selectable preview modes". Today everything is implicitly "Quick" (no images). This piece exposes the choice.

**Client (final step of `CreateBook.tsx`):**
- Radio group above the "Generate My Story" button:
  - **Quick** (free, ~15s) — story text only; book-spread preview with styled placeholders.
  - **Cover-only** (~+30s, ~$0.08) — also auto-generates the cover illustration.
  - **Full book** (~+90s, ~$0.40) — auto-generates cover + all 5 pages.
- Default: Quick. Show the estimated time and cost beside each option so the choice is informed.

**Server:**
- Extend `POST /api/generate` to accept `previewMode: 'quick' | 'cover' | 'full'`.
- After the Claude story finishes, kick off the illustration job synchronously for `cover` and `full` modes (reusing `generateIllustration()` from [illustrations.ts:6](storybook-storefront/server/src/services/illustrations.ts:6)). Stream progress via SSE or just block — for the MVP, a single request with a longer timeout is fine and matches the current UX.
- Cover generation needs a new "page 0" convention or a separate `cover_url String?` column on `Book` — go with the column; cleaner than overloading the page table.

### 5. Reference image upload — art style only

**Why MVP slice:** Three of the four upload kinds the user mentioned (style references, real-person photos, PDF sketches) require image-to-image generation which DALL-E 3 doesn't support. Style-reference is the only one that works *today* using a vision-to-text bridge — we read the image with Claude vision and inject the description into the DALL-E prompt. The other three become Phase 2.

**Server:**
- Install `multer` (only new dep). Single endpoint:
  - `POST /api/books/:id/style-reference` (multipart) — saves to `server/public/uploads/{bookId}/style-ref.{ext}`, then calls Claude with the image and a prompt like "Describe the art style of this image in 2 sentences: medium, color palette, line quality, mood. Do not describe the subjects." Stores the result on `Book.style_descriptor`.
- Reference image URL also stored on `Book.style_reference_url` so the UI can show what the user uploaded.

**Client:**
- New optional control in the creation wizard (step 3): "Upload art style reference (optional)" with drag-drop area. Accepts JPG/PNG, max 5MB.
- Show the uploaded thumbnail + the generated style descriptor (editable text) so users can tweak before generation runs.

**Note for the user:** Reusing the same `style_descriptor` for every page is the simplest way to keep visual consistency across pages — call this out in the UI ("This style is applied to all illustrations").

### MVP files touched (summary)

| Area | Files |
|---|---|
| Schema | [server/prisma/schema.prisma](storybook-storefront/server/prisma/schema.prisma) |
| Server routes | [server/src/routes/generate.ts](storybook-storefront/server/src/routes/generate.ts), [server/src/routes/books.ts](storybook-storefront/server/src/routes/books.ts) (new style-reference endpoint), [server/src/services/illustrations.ts](storybook-storefront/server/src/services/illustrations.ts) |
| Server types | [server/src/types.ts](storybook-storefront/server/src/types.ts) |
| Client wizard | [client/src/pages/CreateBook.tsx](storybook-storefront/client/src/pages/CreateBook.tsx) |
| Client preview | [client/src/pages/BookDetail.tsx](storybook-storefront/client/src/pages/BookDetail.tsx), new `client/src/components/BookSpread.tsx` |
| Client types | [client/src/types.ts](storybook-storefront/client/src/types.ts) |
| Deps | `multer` (+ `@types/multer`) on server |

---

## Phase 2 — Stubbed (decide after MVP lands)

- **Photo-of-real-person uploads.** Migrate illustration generation from DALL-E 3 → `gpt-image-1` (supports image inputs). Attach character reference photos to each character in the cast; pass them into the image API per page. Adds character likeness consistency.
- **PDF / sketch uploads.** Extract text with `pdf-parse`; extract embedded images and re-run them through the same vision-to-text pipeline as style references. Merge into the Claude story prompt and DALL-E prompts.
- **Per-page reference attachments.** Image upload alongside the existing per-page feedback textbox (`BookDetail.tsx:257-264`).
- **Character visual consistency across pages.** Even within Phase 1's DALL-E flow, the same character is drawn differently on every page. Build a "character sheet" pass: generate one canonical portrait per character, distill its visual traits into a short text block, append to every page prompt.
- **Save drafts mid-wizard.** Today abandoning the wizard loses everything. Add `WIP` book status.

## Phase 3 — Stretch / Stub

- **Variable page counts** (3 / 5 / 7 / 10). Currently hard-coded to 5 in [generate.ts:42](storybook-storefront/server/src/routes/generate.ts:42).
- **Read-aloud narration — SHIPPED via [PR #80](https://github.com/slickG0ose/storybook/pull/80) (phase 1, device TTS).**
  The Web Speech API reads the current page aloud with sentence highlighting — narrowing to
  word level on platforms that emit word-granularity `boundary` events, and staying at
  sentence level everywhere else — plus automatic page advance; no provider, no per-call
  cost, no cached assets, no new dependency. Design, platform limits, and what
  phase 1 deliberately leaves out: [.code-captain/specs/read-aloud/spec.md](../specs/read-aloud/spec.md).
  - **Deferred — generated / premium audio** via OpenAI TTS or ElevenLabs; cache audio per
    page like illustrations (the deferred model deliberately mirrors `IllustrationVersion`).
    Do not build this off this line — it is a separate phase, not the one that shipped. It
    is the only route to lock-screen playback, a downloadable audio artifact, or a
    consistent brand voice, and it lands a Prisma migration, a wire shape, and a spend gate
    all at once. Start it when one of the named triggers fires: see §"The deferred
    generated-audio seam" in the spec above.
- **PDF export / print-ready download.** Reuses the BookSpread component server-rendered to PDF (`puppeteer` or `@react-pdf/renderer`).
- **Multi-language stories.** Add `language` to the generate payload; Claude handles translation.
- **Story remix.** "Use this book as a starting point" → clone with edits.
- **Reading-level controls** beyond age range (Lexile / Flesch-Kincaid target).
- **Direct text editing per page** (the revise flow always goes through Claude; sometimes you just want to change one word).
- **Share preview link** for non-account viewers to read drafts (signed URL).
- **Cover designer.** Pick layout, fonts, title color — currently emoji + flat color is the only option.
- **Story safety guardrails** — content filter pass on both text and illustrations before showing to a kid.

---

## Verification

Run after each MVP piece lands; the whole flow at the end.

1. **Local dev:** `npm run dev` from repo root → client `:5173`, server `:3001`.
2. **Migration applied:** `npx prisma migrate dev` succeeds; `sqlite3 dev.db ".schema Book"` shows `characters_json`, `style_descriptor`, `style_reference_url`, `cover_url`.
3. **Cast persistence:** Create a book with primary + antagonist + 2 supporting → reload `/book/:id` → all four characters render correctly on a "Cast" badge row added under the existing theme/age badges.
4. **Story uses cast:** Verify the generated story text actually mentions the antagonist and supporting characters (not just the primary). Sanity-check with a unit test on the prompt builder.
5. **Custom theme:** Type "Pirate Bakery" → story respects it; theme value persists in DB.
6. **Style picker:** Pick "Watercolor" → generate cover → image is recognizably watercolor. Repeat with a different preset; visible difference.
7. **Book-spread view:** Toggle on/off, page-turn animation runs, placeholders show illustration descriptions clearly when no image yet.
8. **Preview modes:**
   - Quick → no image API call (verify in network tab); spread shows placeholders.
   - Cover-only → exactly one DALL-E call; cover image renders; pages still placeholders.
   - Full → six DALL-E calls (cover + 5 pages); all render in spread view.
9. **Style upload:** Drop a watercolor reference image → Claude vision produces a sensible descriptor → next illustration generation reflects the style.
10. **Regression:** Existing tests pass (`cd server && npm test`, `cd client && npm test`). Existing e2e specs in `e2e/` still green; add one new spec covering "create book with antagonist".
11. **Cost guardrail:** Confirm the cost-estimate text matches reality after a real Full run (1 DALL-E 3 standard 1024² ≈ $0.04, so ~$0.24 for 6 calls — update the displayed estimate if off).
