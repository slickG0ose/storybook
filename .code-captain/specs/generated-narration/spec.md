# Read-aloud: generated voices (Kokoro via fal)

> Status: Accepted — Nick Konecny, 2026-11-08. Guardrails confirmed: (a) paid-API usage (Kokoro on fal, `narration` spend line); (b) Prisma schema change (`NarrationClip`). Open questions 1–3 ruled to their stated defaults: per-sentence clips; any signed-in reader may generate, billed to them; `generated:af_heart` on by default.
> Last updated: 2026-11-08
> Backlog: [#156 — Read-aloud: move to generated voices](https://github.com/slickG0ose/storybook/issues/156)
> Serves: [#157 — MVP beta: restore deploy for family/friends feedback](https://github.com/slickG0ose/storybook/issues/157), `docs/mvp-alpha-plan.md`
> Amends: ADR-011 (read-aloud phase 1) decisions 1, 4, 6. Builds on ADR-025 (storage seam), ADR-026 (redirect serving), ADR-027 (R2), ADR-028 (two-history migrations).

## Problem

Phase-1 read-aloud (ADR-011) speaks through the browser's own synthesiser, so the same
book sounds like a different product on every device, and on most devices it sounds bad.
Nick's note on #156: "default browser is clunky and most voices are awful… need a more
professional sounding voice." That is ADR-011's trigger #3 close to verbatim
(`.code-captain/specs/read-aloud/spec.md` §"The deferred generated-audio seam"). The
family/friends alpha (#157) is the first time people other than Nick will hear a book read
aloud, and the voice is the first thing they will judge.

This spec is scoped for **the alpha**: two good voices, cached per page, metered, with the
device voice as a fallback that always works. It is not the final narration product.

## Decisions already made (not reopened here)

- **Provider: Kokoro-82M via fal.** `POST https://fal.run/fal-ai/kokoro/american-english`,
  header `Authorization: Key $FAL_KEY`, body `{ prompt, voice, speed }`, response
  `{ audio: { url } }` → a 24 kHz mono 16-bit WAV on `fal.media`. That URL is
  **temporary**: the bytes must be copied to our storage. $0.02 per 1,000 characters.
  Reuses the existing `FAL_KEY` (illustrations already use it).
- **Not ElevenLabs**: its use policy bans products directed at under-18s without written
  approval. **Not OpenAI TTS**: models shut down 2027-01-06. **Amazon Polly** is the named
  fallback provider if Kokoro/fal has to go.
- Kokoro weights are Apache-2.0, so self-hosting is a real exit path.

## Constraints

- **The client never sends text for paid synthesis.** The server reads the text from the
  database and derives what to speak. A client-supplied string on a paid route is an
  open TTS proxy billed to us.
- **CLAUDE.md guardrails touched:** new paid-API usage (Kokoro on fal: same key, new
  endpoint and new spend line) and a Prisma schema change. Both need Nick's explicit
  confirmation, recorded on this spec's Status line, before any developer task runs.
- **Spend gates** (`server/src/services/spend.ts`): every paid route mounts `spendGate`,
  re-checks with `checkQuota` at the real price, and calls `recordUsage` on success, all
  priced through `costCentsFor` so check and record agree.
- **Middleware order:** `requireAuth → spendGate → validate → handler`
  (`docs/conventions/server.md` §Middleware order).
- **Storage:** bytes go through `getStorage()` (ADR-025). No second storage seam.
- **Migrations ship twice** (ADR-028): SQLite + Postgres history, both committed.
- **Wire shapes** live in `@storybook/shared` with `toMatchObject` pins in route tests (OPS.3).
- **ADR-011 invariants survive:** page index is the master (decision 3), the player stays
  in document flow (decision 5), sentence highlighting is the baseline (decision 2), the
  `runId` stale-callback guard stays.
- **Dark-mode parity** on every new UI string and control.
- **fal's terms (2026-09-08)** require a Customer Solution's End Users to be 18+. Account
  holders here are adults, the same posture already accepted for illustrations. Recorded
  as an open risk, not a blocker.

## Proposed shape

**One server route generates a page's narration; one free route reads it back; the client
grows a second `NarrationProvider` backed by `<audio>`.** Generation is lazy: the first
Play on a page asks the server for that page in the chosen voice. The server derives the
page's spoken text itself, splits it into the same sentences the client highlights, has
Kokoro speak **each sentence as its own clip**, copies the WAVs into storage under the
book's prefix, writes one `NarrationClip` row, and charges once. Every later listen of
that page in that voice, by anyone, is a cache hit and costs nothing. While the page plays,
the client prefetches the next one so auto-advance does not stall.

The **cache key is `(book, page slot, voice, model, sha256(text))`**. An edited page has a
new hash and regenerates; an unedited page never re-bills. A version restore brings back
old text and therefore old audio, also free.

**Device TTS remains the floor.** If generation is not configured, the reader is signed out
and nothing is cached, the user is over quota, fal fails, or the audio will not load, that
page is read with the device voice and the player says so in one line. Nothing about
phase 1 is removed.

### Design question 1 — When to generate: lazy per page, prefetch next

**Default: lazy, on first Play per page, plus a prefetch of the next spread once the
current one starts playing.**

- **First-Play latency:** one fal round trip per sentence, run in parallel (concurrency 4),
  plus the fal.media download and the storage put. Expect roughly 2–4 s for a cold page.
  This is an estimate, not a measurement. The Play button shows its existing
  `LoaderCircle` spinner and a "Preparing voice…" status while it waits.
- **Auto-advance:** the next page is usually already cached by the time it's needed, so the
  page turn is near-instant.
- **Why not at publish time:** it pays for every page in every voice of every book, heard
  or not. It also adds a paid step to `PUT /publish` (a route that is currently free), and a
  publish-time failure would have to either block publishing or leave partial audio. The
  cost at Kokoro pricing is trivial (about 2.2¢ per 5-page book per voice), but the coupling is
  not. Held as an upgrade path ("Prepare narration" as an explicit owner action) if
  first-Play latency is the top alpha complaint.

### Design question 2 — Cache key, and interaction with edits and versions

`NarrationClip` is unique on `(book_id, slot, voice_id, model, text_hash)`.

- `slot` is `'cover' | 'end' | 'p<N>'`, a string so the cover and end spreads (which have
  no `Page` row) are first-class. The text for each slot comes from one shared function,
  `narrationTextFor(book, slot)` (see Schema). Today `BookSpread.tsx:160-164` composes
  `"{title}. By {author}."` / `"The End."` inline, and that moves into shared so client and
  server cannot drift.
- `text_hash` = SHA-256 hex of exactly the text the server synthesised.
- `model` is the fal endpoint id. The pin lesson from ADR-013: a model change must
  regenerate, never silently mix voices within a book.
- **Edit published books (ADR-012, "withdraw to edit"):** editing changes `Page.text`, so
  the hash changes and the next Play regenerates. Old rows and objects stay, harmless and
  unreferenced. **Version restore (#95/#196):** restored text hashes to an existing row, so
  it's a free cache hit. **Revise with a new page count:** page numbers shift, but the hash
  is in the key, so stale audio is never served for the wrong text.
- **`BookVersion` is not touched.** Narration is derived from text, not snapshotted; this
  mirrors ADR-019 (presentation does not bump versions).
- **Deletion:** the admin purge removes the `<bookId>/` storage prefix, which includes
  narration. A hard delete cascades the rows.
- Pruning superseded clips is deferred alongside illustration pruning (ADR-025
  Consequences).

### Design question 3 — Voices, prefs, and fallback

**Default: two curated voices, server-owned: `af_heart` (female) and `am_michael` (male).**

- The catalog is a constant in `shared/src/narration.ts` (`NARRATION_VOICES`: id, label,
  short persona description, gender). `GET /api/narration/voices` returns it with
  `available: boolean`. The server owns availability, the shared constant owns the list,
  and a `z.enum` of the ids is the only voice the paid route will accept. Labels lean on
  Nick's persona framing ("Heart: warm storyteller", "Michael: calm and steady"). Exact
  copy is a developer call; Nick's listen decides whether these two are the right two.
- **Prefs coexistence:** `prefs.voiceURI` keeps its type and its localStorage key
  (`storybook-narration`). Generated voices use the namespaced URI `generated:<id>`
  (e.g. `generated:af_heart`), and device voices keep their `SpeechSynthesisVoice.voiceURI`.
  So no prefs migration is needed, and an old stored device URI still works.
- **Selection:** the hook speaks through `generatedProvider` when the effective voice URI
  starts with `generated:` **and** the voices route said `available: true`. Otherwise it uses
  `deviceProvider`. This is a two-branch conditional, not a registry. ADR-011 decision 4
  said the selector earns its place when a second provider lands, and it now has.
- **Default ladder:** new rung 0. When generated voices are available and nothing is
  persisted, the default is `generated:af_heart`. A persisted `generated:*` URI while
  generation is unavailable falls through to the existing device ladder. That is rung 1's
  existing "only if it is still in the list" rule, unchanged.
- **Fallback to device TTS, per page, when:** voices route unavailable; signed-out reader
  and the page is not cached; POST returns 501/409/429/503/5xx or the network fails; a clip
  fails to load; or the server's sentence offsets do not match the client's chunks. The
  page plays from the failed sentence on the device default voice. The player shows one
  line, e.g. "Using this device's voice — daily limit reached." **Quota denial is sticky
  for the session** (no POST storm page after page). Other failures retry on the next page.
- **R2 not configured:** in production, narration is reported unavailable unless
  `STORAGE_BACKEND=r2`. Paid bytes on Render's ephemeral disk would be lost on the next
  spin-down while their row survives. That's the exact dead-path bug ADR-025 fixed for
  images. Locally, `local` storage is fine.

### Design question 4 — Spend

**Default: per-character cost, rounded up per page, minimum 1¢. Cache hits are free and
never quota-checked.**

- `UsageKind` gains `'narration'`. `COST_CENTS.narration = 1` is the reservation
  `spendGate('narration')` makes before the book is loaded. It's the floor, because no
  page costs less.
- `costCentsFor('narration', undefined, chars)` returns
  `max(1, ceil(chars × NARRATION_CENTS_PER_1K_CHARS / 1000))` with
  `NARRATION_CENTS_PER_1K_CHARS = 2`. The handler calls `checkQuota` and `recordUsage` with the
  same `chars`, so both go through the single choke point (`costCentsFor`) the file already
  mandates.
- **Accepted overcount:** `UsageLog.cost_cents` is an integer, so a 220-char page (0.44¢
  actual) records 1¢, and the cover and end spreads record 1¢ each. A 5-page book records
  about 7¢ per voice against about 2.2¢ actual. Rounding up matches the file's stated rule
  ("a spend guard that under-estimates is not a guard"). Moving `UsageLog` to millicents
  costs a migration and is not worth it at alpha volumes.
- **Quota context:** `render.yaml` now pins `QUOTA_DAILY_PER_USER_CENTS=200` (#199,
  superseding the alpha plan's suggested 150) and `QUOTA_MONTHLY_GLOBAL_CENTS=2000`. A
  15-page book in one voice records about 17¢, which is noise next to illustration spend.
  Because the cache is global, **total narration exposure is bounded by catalog characters
  × 2 voices**, however many times books are played.
- **Who pays:** `POST` is `requireAuth` and bills the requesting user. Any signed-in reader
  may generate narration for any book they can read (published, or their own draft). Others
  then hear it free. `GET` (read cached audio) mirrors `GET /api/books/:id` visibility and
  needs no auth, so signed-out readers hear cached audio and get device TTS on a miss.
- **Double-billing race:** two concurrent first-Plays of the same page. Mitigated by an
  in-process in-flight map keyed on the cache key (Render runs one instance) plus the
  unique constraint. A losing `create` reads the winner's row, and only the winner records
  usage.

### Design question 5 — Playback

**Default: one `HTMLAudioElement` per provider instance, one clip per sentence played in
sequence. Rate via `playbackRate`. Media Session and lock-screen playback are out of scope
for the alpha.**

- **iOS gesture rule:** `play()` must originate in a gesture, but the first Play has to
  wait for a network call. The provider keeps **one** audio element for its lifetime and
  **primes it synchronously inside `speak()`** (a tiny silent WAV data URI, `play()`
  before any `await`). Later sources, including auto-advanced pages, play on the
  already-unlocked element. `play()`'s rejected promise (`NotAllowedError`) maps to
  `onError('not-allowed')`, so the generated path reports refusal deterministically and
  does **not** arm the 1.5 s watchdog, which a slow cold fetch would otherwise trip as a
  false "Tap play to continue". The priming technique is an assumption that only the iPhone
  listen can confirm.
- **Events:** `onChunkStart(i)` on the clip's `playing`, `onChunkEnd(i)` on `ended`, then
  the next clip. `onDone` after the last. `pause()`/`resume()` map to the element. The next
  clip is preloaded while the current one plays, to keep inter-sentence gaps small.
- **Rate:** clips are always synthesised at `speed: 1` (so rate is not part of the cache
  key) and played at `audio.playbackRate = prefs.rate` with pitch preserved (the default).
  `RATE_OPTIONS` (0.75–1.5) is unchanged. A rate change applies live without a restart.
- **Word highlighting:** Kokoro returns no word timings, so the generated provider never
  fires `onWordBoundary`. `wordRange` stays `null` and the highlight is sentence-level.
  That is already the shipped Safari/Android path (ADR-011 decision 2), so it is a tested
  state, not a new one. The device provider's word-boundary enhancement is untouched, and
  its one-line kill switch still works.
- **Backgrounding:** the existing `visibilitychange` pause is kept for both providers.
  Lock-screen playback via Media Session is the natural next step (ADR-011 trigger #1) but
  is deferred. It needs the pause removed and a Media Session handler, plus an iOS listen,
  which is more than the alpha needs.

### Per-sentence vs per-page synthesis (ruled 2026-11-08: per-sentence)

| | **Per-sentence (default)** | Per-page |
|---|---|---|
| Sentence highlighting | Exact, free: clip *i* is chunk *i* | Needs a timing map Kokoro does not return; would have to estimate by character share (drifts) |
| Previous/Next sentence, tap-to-seek | Swap clip, exact | Seek to an estimated offset |
| fal requests per 5-page book | ~30–40 | 7 |
| Storage objects | ~30–40 small WAVs | 7 larger WAVs |
| Prosody across sentences | Each sentence spoken in isolation, slight reset at boundaries | Natural flow across the page |
| Gaps | Small gap per sentence (mitigated by preload) | None |
| Cost | Identical **if** fal bills per character with no per-request rounding | Identical |

**Recommended: per-sentence.** It keeps ADR-011's highlight, sentence stepping, and tap-to-
seek exact with zero estimation code, and Nick's sample was produced this way. **The
one fact that could flip it:** fal's pricing page states "$0.02 per 1000 characters" and
says nothing about per-request rounding or minimums (checked 2026-11-08). If fal rounds each
request up to 1K characters, per-sentence costs about 6–8× more. That is still pennies,
but it should be known. Checking the billed amount of the existing sentence-by-sentence
sample in the fal dashboard settles it.

### Design question 6 — AI-voice disclosure

**Default: disclose in the voice picker and in the playing status, not in a modal.**

- Generated voices render in an `<optgroup label="AI voices">`, and device voices in
  `<optgroup label="This device's voices">`.
- A one-line note sits under the voice select whenever a generated voice is selected:
  "AI-generated voice." It's visible text, not a tooltip, with `dark:` variants.
- fal does not mandate disclosure. It's good practice for a product parents read to
  children, and it costs one line.

### Design question 7 — Schema / contract changes

**`shared/src/narration.ts`** (new, re-exported from `shared/src/index.ts`):

```ts
// Pure logic moved from client — the contract both sides split by.
export function splitIntoUtterances(text: string, maxChars?: number): NarrationChunk[]   // moved verbatim from client/src/lib/narration/chunk.ts
export interface NarrationChunk { text: string; start: number; end: number }             // moved from client types.ts
export type NarrationSlot = 'cover' | 'end' | number                                      // number = Page.page_number (>= 1)
export function narrationTextFor(book: { title: string; author: string; pages: { page_number: number; text: string }[] }, slot: NarrationSlot): string | null

export const NARRATION_MODEL = 'fal-ai/kokoro/american-english' as const
export const NARRATION_VOICES = [
  { id: 'af_heart',   label: 'Heart',   description: 'Warm storyteller', gender: 'female' },
  { id: 'am_michael', label: 'Michael', description: 'Calm and steady',  gender: 'male' },
] as const
export const NarrationVoiceIdSchema = z.enum(['af_heart', 'am_michael'])
export const NarrationSlotSchema = z.union([z.literal('cover'), z.literal('end'), z.number().int().min(1)])

export const NarrationVoicesResponseSchema = z.object({
  available: z.boolean(),
  voices: z.array(z.object({ id: NarrationVoiceIdSchema, label: z.string(), description: z.string(), gender: z.enum(['female', 'male']) })),
})

export const NarrationSegmentSchema = z.object({
  index: z.number().int().nonnegative(),
  start: z.number().int().nonnegative(),   // offsets into narrationTextFor(...) — same space as the client's chunks
  end: z.number().int().positive(),
  url: z.string(),                         // '/illustrations/<bookId>/narration/<file>.wav' — relative, like illustration_url
  durationMs: z.number().int().nonnegative(),
})

export const NarrationReadySchema = z.object({
  status: z.literal('ready'),
  voiceId: NarrationVoiceIdSchema,
  slot: NarrationSlotSchema,
  textHash: z.string(),
  cached: z.boolean(),                     // POST only meaningfully; GET always true
  segments: z.array(NarrationSegmentSchema).min(1),
})
export const NarrationMissingSchema = z.object({ status: z.literal('missing') })
export const NarrationGetResponseSchema = z.discriminatedUnion('status', [NarrationReadySchema, NarrationMissingSchema])
export const NarrationGenerateRequestSchema = z.object({ voiceId: NarrationVoiceIdSchema, slot: NarrationSlotSchema }).strict()
export const NarrationGenerateResponseSchema = NarrationReadySchema
```

The `status` literal is a deliberate discriminator (server.md §wire shapes). Moving
`splitIntoUtterances` into shared amends ADR-011 decision 6: segmentation now *does* cross
the network, so it belongs with the contracts.

**Prisma: `NarrationClip`** (migration `add_narration_clip`, SQLite + Postgres):

```prisma
model NarrationClip {
  id            Int      @id @default(autoincrement())
  book_id       String
  slot          String   // 'cover' | 'end' | 'p<N>'
  voice_id      String   // 'af_heart' | 'am_michael'
  model         String   // 'fal-ai/kokoro/american-english'
  text_hash     String   // sha256 hex of the synthesised text
  chars         Int      // what was billed against
  segments_json String   // [{ index, start, end, key, durationMs }]
  created_by    String?  // who paid
  created_at    DateTime @default(now())

  book Book @relation(fields: [book_id], references: [id], onDelete: Cascade)

  @@unique([book_id, slot, voice_id, model, text_hash])
}
```

`Book` gains the back-relation `narration_clips NarrationClip[]`. Additive only: no
existing column or row changes. Segments are a JSON column, not a child table, following
the ADR-002 precedent (cast as JSON). They are read and written whole, never queried.

**Routes:**

| Method | Path | Chain | Returns |
|---|---|---|---|
| GET | `/api/narration/voices` | `validate` → handler | `NarrationVoicesResponse` (public, no user data) |
| GET | `/api/books/:id/narration?voice=<id>&slot=<slot>` | `validate` → handler (visibility = `GET /api/books/:id`: draft only to owner via `getAuthUser`) | `NarrationGetResponse`. Free, never touches fal |
| POST | `/api/books/:id/narration` | `requireAuth → spendGate('narration') → validate → handler` | `NarrationGenerateResponse`. 404 not visible / no such slot, 501 not configured, 502 upstream failed (nothing charged), 429/503 via `sendQuotaDenied` |

**Storage:** keys `<bookId>/narration/<slot>-<voiceId>-<hash16>-<i>.wav`, written with
`put(key, bytes, 'audio/wav')` through `getStorage()`. They are served by the existing
`/illustrations` mount (static first, then the ADR-026 302 to R2), so the URL is
`/illustrations/<key>`. Verified that existing `list()` consumers are safe:
`listBookFiles` (`illustrations.ts:462`) and `imagePin.ts:86` both drop subdirectory keys,
and the admin orphan scan (`admin.ts:285`) groups by the first segment, which correctly
treats narration as part of its book. The `/illustrations` name now covers audio. That's
a naming wart, accepted to avoid a second seam and a second redirect (see Alternatives).

### Design question 8 — Test strategy (no live AI calls)

- **Synthesizer seam:** `server/src/services/narration/synthesizer.ts` defines
  `NarrationSynthesizer { synthesize(text, voiceId): Promise<Buffer> }`. `FalKokoroSynthesizer`
  (raw `fetch`, no SDK, mirroring `providers/fal.ts`) is the only real implementation, chosen by
  `getNarrationSynthesizer()`.
- **Adapter test:** `vi.stubGlobal('fetch')` pins the request (URL, `Authorization: Key …`
  header, body `{ prompt, voice, speed: 1 }`), the two-leg response parse (`audio.url` →
  download), host check on the download URL, size cap, timeout, and every failure mapping.
  This is the only place the fal contract is asserted, so it is asserted exactly.
- **Service and route tests:** `vi.mock` the synthesizer module (the existing
  `vi.mock('../../services/illustrations')` pattern in `books.test.ts`) with a fake that
  returns a fixed small WAV buffer and counts calls. That proves cache hits make zero
  synth calls and zero `UsageLog` rows, a miss makes N calls and one row, the text is
  server-derived, quota is denied before any synth call, and the in-flight dedupe works.
- **Client:** a `fakeAudio` installable fake under `client/src/test/` (the ADR-011
  convention in `docs/conventions/client.md`), plus `vi.stubGlobal('fetch')` for the two
  routes.
- **E2E:** CI has no `FAL_KEY`, so the real server reports `available: false`. That path
  (device fallback, unchanged UX) is covered by the existing narration specs. The
  generated path is covered by `page.route` stubs of the three routes, a committed tiny
  silent WAV fixture, and a Media fake injected with `addInitScript` (mirroring
  `e2e/tests/_speech.ts`), in both themes at mobile viewports (ADR-009).
- **Stated plainly:** like every AI path here, green tests prove the wiring, not that
  Kokoro is called correctly or sounds right. One manual generation against a real
  `FAL_KEY` and one real listen on desktop and iPhone are named obligations for the PR body.

### Data flow

1. `BookSpread` → `useNarration({ text, pageKey, target: { bookId, slot } … })`. The
   effective voice is `generated:af_heart`.
2. Play (gesture) → `generatedProvider.speak()` primes the audio element synchronously, then
   `GET /api/books/:id/narration?voice=af_heart&slot=3`.
3. `missing` and signed in → `POST /api/books/:id/narration { voiceId, slot }` with the bearer
   token. The server loads the book (visibility check), computes
   `text = narrationTextFor(book, slot)`, `hash`, and cache lookup → miss →
   `checkQuota(…, chars)` → split → synth each sentence (≤4 parallel) → `put` each WAV →
   `NarrationClip.create` → `recordUsage(…, chars)` → `NarrationReady`.
4. The client verifies the segment offsets equal its own chunks, then plays clip *i* from
   `API_BASE + url`. The server serves from local disk or 302s to R2.
5. When clip 0 starts, prefetch the next slot (GET, then POST if signed in and not
   quota-blocked).
6. On any failure in 2–4, the hook re-speaks the page from the failed chunk through
   `deviceProvider` and sets `notice`.

### Files likely touched

- `shared/src/narration.ts` (new), `shared/src/index.ts`: contracts, voice catalog, moved segmentation
- `client/src/lib/narration/chunk.ts`, `types.ts`: re-export from shared
- `server/prisma/schema.prisma` + both migration histories + `postgres/schema.prisma`: `NarrationClip`
- `server/src/services/spend.ts`: `'narration'` kind and char-priced cost
- `server/src/services/narration/{synthesizer,falKokoro,narration}.ts` (new): seam, adapter, cache-or-generate service
- `server/src/routes/narration.ts` (new) + `server/src/index.ts` mount: voices and book narration routes
- `client/src/lib/narration/{provider,generatedProvider}.ts`: widened seam, `<audio>` provider
- `client/src/hooks/{useNarration,useVoices}.ts`, `client/src/components/{BookSpread,NarrationPlayer}.tsx`: selection, fallback, prefetch, disclosure UI
- `e2e/tests/mobile/narration-generated.spec.ts` (new), `e2e/tests/_media.ts` (new), fixture WAV
- `docs/conventions/call-graph.md`, `CLAUDE.md` Spend gates table: new edges and the new cost line

## Alternatives considered

### Per-page clips instead of per-sentence
See the comparison table. **Held as an upgrade path** if sentence-boundary prosody is the
top listening complaint. It would need a char-share timing estimate for highlighting.

### Generate at publish time
**Rejected for the alpha**, because it pays for unheard pages and makes publish a paid,
fallible step. Held as an explicit "Prepare narration" owner action if first-Play latency
bites.

### A separate `/narration` storage namespace and mount
Clean naming. **Rejected:** it needs a second storage root, a second static mount, and a
second R2 redirect handler, which is the "second seam" ADR-025 exists to prevent. The
orphan scan and admin purge would also need teaching. Under `<bookId>/narration/` they
already work.

### Client sends the text to synthesise
Simplest server. **Rejected:** it is an open, paid TTS proxy. The server must derive the text.

### Fixed `COST_CENTS.narration` per page with no char pricing
Simpler. **Rejected:** a long page would be under-priced, and the table would have no link
to the per-character price that actually moves.

### Transcode WAV to MP3/Opus before storing
About 10× smaller (a 5-page book is about 3.5 MB of WAV per voice). **Deferred:** it needs
ffmpeg or a codec dependency. R2's free tier has zero egress fees and 10 GB of storage,
which covers the alpha.

### Amazon Polly now
**Held as the named fallback provider.** The `NarrationSynthesizer` seam is what makes a
swap one new file plus a `NARRATION_MODEL` change, and the model is in the cache key, so a
swap regenerates cleanly.

## Success criteria

- A signed-in tester presses Play on an uncached page and hears `af_heart` within a few
  seconds, with sentence highlighting in step, and auto-advances through the book without a
  stall on cached or prefetched pages.
- A second listener (or a replay) of the same page makes **zero** fal calls and writes
  **zero** `UsageLog` rows. A server test asserts this.
- Editing a page's text and replaying regenerates that page only. A test asserts this via
  the hash.
- `POST` with any text-like field in the body is a 400, and the server never synthesises
  anything not derived from the DB. A test asserts this.
- With `FAL_KEY` unset, or in production without R2, or when over quota, read-aloud still
  works on the device voice with a one-line explanation. Unit and e2e tests cover this.
- Every new response shape is pinned with `toMatchObject`. The narration mobile e2e passes
  in both themes, with no overflow and tap targets ≥ 44 px.
- Manual: one real generation with a real `FAL_KEY`, plus one listen on desktop Chrome and one
  on an iPhone (including the first-Play gesture path).

## Out of scope

- Lock-screen / background playback (Media Session). This is ADR-011 trigger #1, deferred.
- Word-level highlighting for generated voices.
- More than two voices, voice previews or samples in the picker, non-English voices.
- Downloadable audio, audio in the PDF export.
- Pruning superseded clips (rides the illustration pruning follow-up).
- Publish-time generation.
- Narration in the legacy Reader view (still deferred per ADR-011).

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| **Paid API usage (guardrail)**: new spend line on fal | Nick's explicit confirmation on Status before Task 1. `POST` is `requireAuth` + `spendGate` + handler `checkQuota` + `recordUsage`. Cache bounds total exposure. |
| **Unauthenticated paid endpoint** | The only paid route is `POST`, behind `requireAuth`. `GET` routes never call fal (asserted by a test that fails if the fake synthesizer is touched). |
| **Open TTS proxy** | Request schema is `.strict()` with only `voiceId` + `slot`. Text is derived server-side via `narrationTextFor`. |
| **Schema change (guardrail)** | Additive `NarrationClip` model + `Book` back-relation. Two migrations per ADR-028 (`add_narration_clip`). `postgresMigrations.test.ts` enforces the second. |
| **Wire-shape drift (OPS.3)** | Five schemas in `shared/src/narration.ts`. `toMatchObject` on voices, GET ready, GET missing, POST ready, and the error envelopes. |
| **Auth middleware order** | `requireAuth → spendGate → validate → handler` on POST. GET uses `getAuthUser` only for draft visibility, matching `GET /api/books/:id`. |
| **fal 18+ End User term** | Account holders are adults, same posture as illustrations. **Open risk → ADR.** Exit paths: Polly (named), self-host Kokoro (Apache-2.0). |
| **fal per-request rounding unknown** | If rounded to 1K chars per request, per-sentence costs ~6–8× more. Check the sample's billed amount in the fal dashboard. If rounding is confirmed, the char-priced gate under-counts real spend, so `costCentsFor('narration')` must switch to `segments × 2¢` (one billing unit per request) in the same task. Otherwise the caps are wrong. |
| **Paid bytes lost on ephemeral disk** | Production availability requires `STORAGE_BACKEND=r2`. Otherwise `available: false` and the route returns 501. |
| **iOS refuses `play()` after the fetch** | Prime the single audio element synchronously in `speak()`. `NotAllowedError` → `onError('not-allowed')` → the existing "Tap play to continue". Confirmed only by the iPhone listen. |
| **Double billing on concurrent first Play** | In-process in-flight map plus the unique constraint. The loser reads the winner's row and records nothing. |
| **Client/server sentence split disagree** | One shared `splitIntoUtterances`. The client also verifies offsets and falls back to device on mismatch. |
| **SSRF / oversized download from fal response** | Only download `https://` URLs on `fal.media` (or `*.fal.media`). Cap the size per clip. 60 s timeout. |
| **Dark-mode parity** | Every new string and control (optgroups, disclosure line, fallback notice, preparing status) carries `dark:` partners. Mobile e2e runs both themes. |
| **Mixed voices within one book** | Possible when one page falls back. The player states it. Accepted for the alpha. |
| **UUID cart session / auth model** | Untouched. The provider reads the existing bearer token from `AuthContext`, and `prefs.ts` still writes only `storybook-narration`. |

## ADR-worthy decisions

- [ ] **ADR-033: Generated narration on Kokoro-82M via fal.** Why not ElevenLabs (under-18 policy), OpenAI TTS (2027-01-06 shutdown), or Polly (named fallback). Self-host exit (Apache-2.0). fal 18+ End-User term recorded as an accepted open risk. Write via /create-adr after spec approval.
- [ ] **Per-sentence clip granularity, and a cache key of `(book, slot, voice, model, sha256(text))` with server-derived text.** Includes the per-request-rounding caveat and Nick's ruling. Write via /create-adr.
- [ ] **Narration audio lives in the illustration keyspace (`<bookId>/narration/`) and is served by the `/illustrations` mount.** Amends ADR-025's scope wording. Write via /create-adr.
- [ ] **Narration is char-priced through `costCentsFor`, rounded up per page with a 1¢ floor. Cache hits are free. `POST` bills the requesting reader and `GET` is public for published books.** Write via /create-adr.
- [ ] **ADR-011 amendment: a second provider, selected by the `generated:` voice-URI namespace (no registry). Segmentation and spread-text composition move to `@storybook/shared`. Device TTS is the per-page fallback.** Write via /create-adr (amendment note on ADR-011 plus the new ADR).
- [ ] **Deferred: Media Session / lock-screen playback, WAV→compressed transcoding, publish-time generation, per-page synthesis.** Track with a `Deferred:` line with reasoning, or one follow-up issue.
