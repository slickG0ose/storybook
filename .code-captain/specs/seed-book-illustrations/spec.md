# Seed-book illustrations

> Status: Draft
> Last updated: 2026-11-11
> Backlog: none filed. Owner request after the 2026-11-11 live-site audit. Related: PR #223 — fall back to the emoji cover when a book image fails to load (https://github.com/slickG0ose/storybook/pull/223)

## Owner decisions

These five need a yes or no before Task 5 runs. Tasks 1–4 are safe to run first, because they spend nothing and write no art URL.

1. **Spend.** Approve a one-time Fal image generation on your `FAL_KEY`: 43 images (6 covers, 30 pages, 7 character portraits), about **$1.72** at 4¢ each. The script is hard-capped at **60 images ($2.40)**, re-rolls included. **Recommended: yes.**
2. **Seed data shape.** `seed.ts` starts writing values into columns that already exist on the 6 seed books: `Book.cover_url`, `Page.illustration_url`, `Book.style_descriptor`, `Book.characters_json`, `Book.image_provider`, `Book.image_model`. There is no new column and no Prisma migration. Ids, prices, page text and page count stay the same. **Recommended: yes.**
3. **How prod gets the art.** Nobody writes to the prod DB or to R2 by hand. The art reaches prod through the deploy-time seed that already runs in the `render.yaml` buildCommand, on the first deploy after merge. Every later deploy writes it again. **Merging the PR is the prod write.** **Recommended: yes.**
4. **Format and repo size.** Commit the art as 1024×1024 JPEG at quality 82: about **9–10 MB**, and it stays in git history for good. Raw PNG would be about 95 MB, and the whole repo pack is 32 MB today. These are the first illustrations in the repo that are not `.png`. That is safe because seed books have no owner, so no re-roll, version-history or portrait code path can reach them. **Recommended: JPEG.**
5. **Art review.** You look at the 43 images and name any to redo before they are committed. This review is the aesthetic half of Done criterion #2. **Recommended: yes, about 15 minutes.**

## Problem

The six canonical seed books (`luna-star-garden`, `captain-bear-submarine`, `robot-learns-to-hug`, `dinosaur-bakery`, `cloud-painter`, `brave-little-seed`) have no art. `Book.cover_url` is null and every `Page.illustration_url` is null, so they show an emoji on a flat colour. Three of them are the "Featured stories" at the top of the home page, so the first thing a visitor sees is the app's weakest content. Books users create are fully illustrated. The owner wants the default content to show what the app can do.

## Constraints

- **Guardrails (CLAUDE.md).** Paid image generation, a change to seed data, and any write to prod DB or R2 all need owner confirmation. See §Owner decisions.
- **Never `db:reset`.** Both seeds stay upsert-only.
- **No new dependency.** Compression uses macOS `sips`. The fallback is `npx -y sharp-cli` from the npx cache, the precedent set in `server/scripts/derive-hero-frames.sh`. Nothing enters a `package.json`.
- **No Prisma schema change.** Every field this needs already exists on `Book` and `Page`.
- **Stored URLs stay relative** (`/illustrations/<bookId>/<file>`), following `docs/conventions/data.md` §Illustration storage.
- **Prod facts, checked against the repo on 2026-11-11:**
  - The `render.yaml` buildCommand ends `npx tsx prisma/seed.ts`. It runs against Neon on every deploy. `demo-seed.ts` does **not** run in prod.
  - `/illustrations/*` is `express.static` against local disk first (`server/src/index.ts:89-90`). Under `STORAGE_BACKEND=r2`, a disk miss redirects to R2. So committed files are served from the deploy bundle under either backend, exactly like the Sunny fixture (`b2fa23cf-…`).
- **Server suites share `test.db`** (`fileParallelism: false`). Never run two server-zone tasks at once.

## Proposed shape

**Bytes ship as committed fixtures, the way the Sunny demo book's do.** The art is generated once on the owner's machine, compressed to JPEG, and committed under `server/public/illustrations/<seed-book-id>/`. That directory is in the Render deploy bundle, so prod serves it from disk. Under `r2` this works too: the static handler runs before the R2 redirect. A fresh environment has the bytes as soon as it checks out the repo. `seed.ts` writes the URLs on every run. No R2 upload happens and nothing writes to the prod DB by hand. This confirms the owner's leaning, with one change: JPEG instead of PNG, for size. See §Alternatives.

**Seed-book art is seed-owned content, like the page text.** It is reasserted on every seed run. Every route that can change a book's art requires `book.created_by === user.id`: `/illustrate`, the portrait routes, version listing and revert (`server/src/routes/books.ts` lines 749, 799, 960, 1073, 1098, 1119). Seed books have `created_by = null`, so the app has no way to change their art. Writing the art fields unconditionally in `update:` therefore overwrites nothing a user made, and it lets a redone image reach prod on the next deploy. The same reasoning means **no `IllustrationVersion` rows are needed**. The history viewer and re-roll are owner-only, and `listIllustrationVersions` already synthesises history from storage if an owner ever exists.

**Generation is an offline script that reuses the app's prompt assembly, not the routes.** `generateIllustration` and `generateCover` write `IllustrationVersion` rows and pick versioned filenames (`page-1-v2.png` on a re-run). Those side effects are wrong for committed fixtures. So Task 3 pulls the three prompt builders out of `server/src/services/illustrations.ts` as pure exported functions. The output must be byte-identical, and the existing prompt tests are the fence for that. The script then runs prompt builder → `getImageGenerator(SEED_ART_PIN).generate()` → a raw PNG cache → JPEG. It gets the same prompts, the same Fal models (Flux Pro 1.1 for portraits, Kontext / Kontext-multi for pages and covers with portrait references) and the same reference precedence (`collectRequiredPortraitRefs` + `composeReferenceImages`) that a user book with an approved cast gets. That is the "show what the app can do" bar.

**Spend gates: the script does not call `checkQuota` or `recordUsage`, and that is deliberate.** Those meter a route's caller against the DB the server runs on. The script has no caller, and the only DB it could reach is the developer's local `dev.db`. Recording there would charge the developer's local daily cap and show up nowhere in prod's monthly ceiling. The script has its own gates instead:

- it is a dry run by default (prints the plan and the cost)
- it calls the provider only with `--spend`
- `--max-images` defaults to the planned count, and code enforces an absolute ceiling of 60
- it refuses to run unless `STORAGE_BACKEND` is `local` or unset
- it refuses unless `isImageGenConfigured('fal')`
- it makes no DB query

**Re-runnable without paying twice.** Each successful provider call writes its raw PNG to a gitignored cache, `server/.seed-art/<bookId>/<slot>.png`, before anything else happens. The planner skips a slot when its cached PNG or its committed JPEG exists. `--redo <bookId>:<slot>` deletes both and regenerates; that counts against the cap. `--compress-only` rebuilds every JPEG from the cache for $0. If a portrait's raw PNG is missing from the cache (say, on another machine), the script rebuilds it from the committed portrait JPEG with `sips` rather than paying again. A redone portrait prints a warning that its book's pages were drawn against the old one. They are not regenerated automatically.

**One consistent style per book, pinned.** Each seed book gets:

- a `style_descriptor`, chosen to differ across books to show the app's range
- a `characters_json` cast whose descriptors come from the existing `illustration_description` text
- an explicit pin, `image_provider: 'fal'`, `image_model: 'fal-ai/flux-pro/v1.1'`

The pin is set outright rather than inferred. `imagePin.ts` would otherwise infer from file mtimes, which on Render is the checkout time. `style_reference_url` stays null: that field is a user-uploaded style image, and the seed has none. Each `primary` character gets a portrait. Portraits are committed as JPEGs and referenced from `characters_json[].portrait_url`, so a seed row looks exactly like an app-made book with an approved cast. Committing them also means a single page can be redone on any machine.

### Style and cast per book (proposed — owner may edit before Task 5)

| Book | `style_descriptor` | Cast (`role` — `name`: `descriptor`) |
|---|---|---|
| `luna-star-garden` | Soft gouache-and-watercolour picture-book painting, deep indigo and violet night palette lit by glowing gold, silver and rose starlight, gentle rounded shapes, luminous soft-edged glow, dreamy and cosy | primary — Luna: a girl of about seven with warm brown skin and big curly dark hair tied with a yellow ribbon, round cheerful face, lavender dress with a tiny star print, navy cardigan, red rain boots |
| `captain-bear-submarine` | Cheerful coloured-pencil and soft watercolour storybook illustration, warm woodland browns and greens against bright lake blues and teals, light ink outlines, rounded friendly animals, sunny and playful | primary — Captain Bear: a large round friendly brown bear with a cream muzzle, navy captain's hat with a gold anchor badge, red neckerchief, brass telescope · supporting — Rabbit: a slender grey rabbit with long ears in a blue-and-white striped sailor shirt · supporting — Fox: a slim orange fox with a white-tipped tail and a green scarf · supporting — Mouse: a tiny brown mouse with big pink ears in a yellow life vest |
| `robot-learns-to-hug` | Clean modern digital picture-book illustration with soft cel shading, warm red and teal on cream, simple geometric shapes, gentle gradients, expressive faces, heartfelt | primary — Bolt: a small round red-and-silver robot about a child's height, dome head with a screen face showing big round expressive digital eyes, stubby jointed arms with three-fingered hands, small chest panel · primary — Maya: a girl of about eight with light brown skin and two long black braids, teal overalls over a yellow t-shirt |
| `dinosaur-bakery` | Bold funny cartoon picture-book style, thick wobbly ink outlines, flat bright colours, candy-pastel bakery palette of mint, pink and butter-yellow against leafy greens, exaggerated expressions, slapstick energy | primary — Rexy: a cheerful bright-green Tyrannosaurus rex with a big toothy grin, comically tiny arms, tall white chef's hat and a pink apron · supporting — Triceratops: an orange Triceratops with three cream horns, a frilled crest and a blue bow tie |
| `cloud-painter` | Expressive loose watercolour with visible brush strokes and paint splatters, airy sky blues and whites bursting with saturated sunset orange, magenta and purple, dreamy and imaginative | primary — Zara: a girl of about nine with dark brown skin and a puff of black hair held by a red headband, paint-stained fingers, mustard-yellow smock over a striped shirt, ornate wooden paintbrush with a gold ferrule |
| `brave-little-seed` | Gentle soft-textured picture-book art in muted pastel gouache with visible paper grain, warm earthy soil browns giving way to fresh spring greens and golden sunlight, very simple rounded shapes for toddlers | primary — Little Seed: a tiny teardrop-shaped brown seed with a cute round face, rosy cheeks and big expressive eyes · supporting — Earthworm: a friendly soft-pink earthworm with a kind smile |

Notes on the table:

- The Storm King is named in Luna's description but appears on no page. He is left out of the cast on purpose: an `antagonist` portrait would be passed as a reference to every page and the cover, and that would put him on all of them.
- Luna's cover scene comes from a script-only override, not from `description`: "Luna standing in her glowing star garden at night, surrounded by star-flowers in silver, gold, pale blue and rose pink". Her description is about the Storm King, for the same reason as above. The override is input to the script and is not stored on the row. Every other cover uses `description`, the same as the app does.
- Seven portraits in total: Luna, Captain Bear, Bolt, Maya, Rexy, Zara, Little Seed. Bolt and Maya are both `primary`, so robot pages use Kontext-multi with two references. Every other book uses single-reference Kontext.

### Schema / contract changes

- **Prisma:** none.
- **`@storybook/shared`:** none. `cover_url`, `illustration_url`, `style_descriptor`, `characters_json` (→ `characters: Character[]`), `image_provider` and `image_model` are already on the wire. `characters_json` must parse under the existing `CharacterSchema`.
- **Routes:** none. So no new wire-shape test is owed (OPS.3).
- **Seed *values* change; seed *shape* does not.** The same 6 ids, the same 30 pages, and the same set of columns.

**Committed files.** There are 43 files under `server/public/illustrations/<id>/`:

- `cover.jpg`
- `page-1.jpg` … `page-5.jpg`
- `portrait-1000.jpg` (and `portrait-1001.jpg` for Maya)

There is also one `.gitignore` re-include line per seed book, following the comment at `.gitignore:23`.

**Byte estimate.**

| Format | Per image | Total for 43 |
|---|---|---|
| Raw PNG (current Sunny fixtures, measured) | 2.21 MB average | about 95 MB |
| JPEG q82 (estimate; Task 5 records the real figure) | 180–300 KB | about 9.5 MB (range 7.7–13 MB) |

The test budget is ≤ 500 KB per file and ≤ 15 MB total.

### Data flow

1. **Once, on the owner's machine (Task 5):** `cd server && npx tsx scripts/generate-seed-art.ts` (dry run) → `--spend`. For each book, in order:
   1. Portraits are generated prompt-only on Flux Pro 1.1.
   2. Each raw PNG is cached to `server/.seed-art/<id>/`.
   3. The raw PNG is copied to the local storage key `<id>/portrait-<slot>.png`, so `toDataUri` can resolve it as a reference.
   4. The cover and pages 1–5 are generated with the portrait references on Kontext and cached.
   5. All cached PNGs are converted to JPEG in `server/public/illustrations/<id>/`.
   6. The staged `portrait-*.png` files are removed from the public directory.

   The script also writes `server/src/seed/seed-art-manifest.json`, holding prompt, model, bytes and timestamp per slot, as provenance.
2. **The owner reviews the images and redoes any that need it**, then commits them.
3. **Every seed run (local `db:seed`, CI, Render build):** `seedCanonicalBooks(prisma)` upserts each book with metadata, style, cast, art URLs and pin, then each page with its text, description and `illustration_url`.
4. **Request time:** the client `<img src={api(url)}>` → `express.static` serves the JPEG from disk. If the file is missing (for example, a rollback to an older bundle), `FallbackImage` from PR #223 shows the emoji.

### Files likely touched

- `server/src/seed/canonicalBooks.ts` (new) — the 6 books, their pages, style, cast and art paths, plus `seedCanonicalBooks(prisma)`
- `server/prisma/seed.ts` — reduced to a thin runner around `seedCanonicalBooks`
- `server/src/services/illustrations.ts` — export `buildIllustrationPrompt` / `buildCoverPrompt` / `buildPortraitPrompt`, with no behaviour change
- `server/src/seed/seedArt.ts` (new) — the planner, the cost/cap logic, and the generate/compress runner with an injectable generator
- `server/scripts/generate-seed-art.ts` (new) — thin CLI
- `server/src/seed/seed-art-manifest.json` (new, written by the script)
- `server/public/illustrations/<6 ids>/*.jpg` (new, 43 files)
- `.gitignore` — 6 re-include lines, plus `server/.seed-art/`
- `server/src/services/__tests__/illustrations.test.ts`, `server/src/services/__tests__/pdf.test.ts` — rekey off `luna-star-garden` (see §Risks)
- `server/src/seed/__tests__/*.test.ts` (new)
- `docs/conventions/data.md`, `render.yaml` (comments only)

## Alternatives considered

### Generate once, upload to R2, write URLs in prod

**Pros:** no bytes in git, and the serving path matches user books.
**Cons:**
- a fresh or local environment has no art
- it needs an R2 write and a prod DB write by hand
- the art would only exist under `r2`, but tests, e2e and CI run `local`
- the storage-key URLs would still need the seed to agree
**Why rejected:** two manual prod writes, and not reproducible. Committed fixtures already work for Sunny, and the r2 local-disk fallback exists for exactly this reason.

### Commit raw PNG (the owner's original leaning)

**Pros:** one format across the repo, and no compression step.
**Cons:** about 95 MB permanently in history, triple today's 32 MB pack. A home page with 6 covers at about 2.2 MB each is about 13 MB on a phone.
**Why rejected:** size. Every reader of a seed book can handle JPEG: `<img>`, `express.static`, and `pdf.tsx` `detectFormat` (`server/src/services/pdf.tsx:109`). The `.png` assumptions (`getNextVersion`, `listIllustrationVersions` regex, the `image/png` data-URI in `providers/fal.ts:168`) all sit on owner-only paths that seed books cannot reach.

### Palette-quantised PNG

**Pros:** keeps `.png`.
**Cons:** no quantiser on the machine (`pngquant` and `magick` are absent), so it needs `npx sharp-cli --palette`. Estimated 0.6–1 MB per image, about 30 MB total, with banding risk on watercolour gradients.
**Why rejected (held as upgrade path):** about 3× JPEG's size for a property no reachable path needs. Revisit if seed books ever gain an owner who can re-roll them.

### Drive the app UI (create a book per seed title as the demo admin)

**Pros:** zero new code.
**Cons:**
- produces new UUID books, not the 6 seed ids
- writes `IllustrationVersion` rows and `page-N-vK.png` names
- the art lands in R2 in prod or in local storage, and then has to be copied by hand
- not reproducible
**Why rejected:** it doesn't produce what the seed needs.

### Fill-if-null on re-seed instead of always-set

**Pros:** would preserve an in-app art change.
**Cons:** no such change is possible (seed books are unowned), and a redone fixture would never reach an environment that already has a URL.
**Why rejected:** guards against nothing and blocks the redo path. Revisit if seed books ever get an owner or an admin re-roll.

### OpenAI gpt-image-1 as the generator

**Pros:** a different look.
**Cons:** 25¢ an image (`OPENAI_IMAGE_COST_CENTS`), so about $10.75. It is not today's default provider.
**Why rejected:** cost, and the seed should show the provider users actually get.

## Success criteria

- After `cd server && npm run db:seed`, all 6 seed books have a non-null `cover_url`, all 30 pages have a non-null `illustration_url`, and every URL resolves to an existing JPEG under `server/public/illustrations/`. A server test pins this.
- Every committed file in a seed-book directory is referenced by the seed. No stray PNGs, no orphans. A test pins this.
- `.gitignore` re-includes all 6 directories. A test pins this, so an untracked fixture can't pass locally and 404 in prod.
- Running the seed twice gives identical rows. Running it never changes `deleted_at`, `created_by`, or any user-created book.
- `characters_json` for each seed book parses as `Character[]` under `CharacterSchema`. `image_provider = 'fal'`.
- `cd server && npm test`, `cd client && npm test`, and `cd e2e && npm test` all pass, with no assertion deleted.
- With the server suite running, `server/public/illustrations/<seed-id>/` is untouched. A guard test pins this.
- Home, book detail and the reader show art for the seed books, in both light and dark mode (browser check).
- After the first prod deploy post-merge, `curl -sI https://<render-host>/illustrations/luna-star-garden/cover.jpg` answers `200`. That is a check run after deploy, not something this spec claims.

## Out of scope

- Making seed books hero-eligible (`is_hero_eligible` / `hero_consent_at`). That is a separate editorial and consent decision; see #127 — Rotate the hero illustration (https://github.com/slickG0ose/storybook/issues/127).
- `Cache-Control` / long-lived caching for `/illustrations/*`. Seed filenames are stable but their bytes can change on a redo, so immutable caching would be wrong without content-hashed names.
- Generated narration audio for seed books.
- Admin re-roll of unowned books.
- Changing `setup.ts`'s test seed. Server tests keep seed books art-less on purpose. See §Risks.

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| **Server tests delete the fixtures.** `illustrations.test.ts` (TEST_BOOK_ID and two `BOOK_ID = 'luna-star-garden'` blocks) and `pdf.test.ts` run `rm(<illustrations>/luna-star-garden, { recursive: true })` in `afterEach`. Committed art would vanish from every working tree after a local test run, `git add -A` would commit the deletion, and a concurrent local e2e run would 404. | Task 2 moves both files onto a test-only book id they create themselves, before any art exists. A guard test fails if any server test file mentions both `public/illustrations` and a seed-book id, apart from an explicit allowlist. `books.test.ts` is allowlisted: it removes only the `page-N.png` files it wrote, and those cannot collide with `.jpg` fixtures. |
| **Untracked fixture: green locally, 404 in prod.** `server/public/*` is ignored wholesale. | One `!server/public/illustrations/<id>/` line per seed book, plus a test that reads `.gitignore` and asserts all 6. Task 6 also requires `git status --short server/public/illustrations/` before committing. |
| **Deploy ordering.** The Render build runs the seed against Neon while the old instance still serves without the files. | That gives a window of about a minute. Missing images fall back to the emoji (PR #223), the current look. Rollback to an older bundle degrades the same way. |
| **Paid API (guardrail).** | Owner decision 1. The script is dry-run by default, needs `--spend`, caps at 60, and makes no route or prod contact. The task that spends (Task 5) is marked gated. |
| **Spend exposure.** | No new route and no new paid endpoint. The script runs only on the operator's machine with the operator's key. |
| **Seed data change (guardrail).** | Owner decision 2. Values only, in existing columns. No migration. |
| **Prod DB write (guardrail).** | Owner decision 3. It happens only through the existing upsert-only deploy seed, never by hand. |
| **Prompt refactor changes the bytes sent to Fal.** | Task 3 is a pure extraction. The existing prompt assertions in `illustrations.test.ts` must pass unedited. Per memory, AI calls are never live-tested, so these string tests are the only fence. |
| **Style drift on a later redo.** | The pin is explicit on the row and constant in `canonicalBooks.ts`, and the script always passes it. Portraits are committed, so a redo on any machine uses the same references. |
| **Kontext output size or aspect differs from 1024².** | Task 5 records the dimensions of each JPEG in the manifest. The budget test bounds bytes, not dimensions. Flag anything non-square to the owner. |
| **Reader layout changes for seed books.** The mobile reader and narration e2e specs use `luna-star-garden`. | Those specs now exercise the illustrated layout, which is stronger coverage. If they fail, it is a real layout bug to fix, not an assertion to delete. |
| **Dark-mode parity.** | No new UI surface. The manual check of both themes still applies, because the seed books' look changes. |
| **Auth / session.** | Not touched. |
| **A prod admin edit of `is_featured` on a seed book is overwritten every deploy.** | This already happens today and is noted in `render.yaml:49-51`. Not in scope, but the comment gains "and art". |

## ADR-worthy decisions

- [ ] Seed-book art ships as committed JPEG fixtures in the deploy bundle (not R2, not PNG), served from local disk under both storage backends — write via /create-adr after spec approval
- [ ] Seed-book art, style, cast and image pin are seed-owned and overwritten on every seed run (always-set). No `IllustrationVersion` rows. This holds only while seed books stay unowned — write via /create-adr after spec approval
- [ ] Offline generation scripts do not call `checkQuota`/`recordUsage`. They gate with dry-run by default, an explicit `--spend`, a hard image ceiling, and local storage only — write via /create-adr after spec approval
