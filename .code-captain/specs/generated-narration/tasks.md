# Read-aloud: generated voices (Kokoro via fal) — task plan

> Spec: [spec.md](spec.md)
> Status: Accepted — Nick Konecny, 2026-11-08. Guardrails confirmed: (a) paid-API usage (Kokoro on fal, `narration` spend line); (b) Prisma schema change (`NarrationClip`). Open questions 1–3 ruled to their stated defaults: per-sentence clips; any signed-in reader may generate, billed to them; `generated:af_heart` on by default.
> Last updated: 2026-11-08

## Overview

There are eleven tasks in three runs. **Shared + server (Tasks 1–6)** build the contract, the
`NarrationClip` model, char-priced metering, the fal adapter, the cache-or-generate
service, and the three routes. **Client (Tasks 7–9)** widen the provider seam, add the
`<audio>` provider, and wire selection, fallback, prefetch, and disclosure into the hook
and player. **Proof (Tasks 10–11)** adds the mobile e2e in both themes and the ADR
follow-through. Task 1 is the only shared prerequisite. After Task 1, the client run
(Task 7) can proceed in parallel with the server run.

## Cross-cutting constraints

- **Guardrails touched. Stop and confirm with Nick before Task 2:** (a) new paid-API
  usage (Kokoro on fal, `FAL_KEY` reused, new `narration` spend line); (b) Prisma schema
  change (`NarrationClip`). The spec's Status line must read `Accepted` with Nick's
  name before either lands.
- **Wire-shape:** `GET /api/narration/voices` → `NarrationVoicesResponseSchema`;
  `GET /api/books/:id/narration` → `NarrationGetResponseSchema` (both `ready` and
  `missing`); `POST /api/books/:id/narration` → request `NarrationGenerateRequestSchema`
  (`.strict()`), response `NarrationGenerateResponseSchema`. All schemas go in
  `shared/src/narration.ts`, and every one is pinned with `toMatchObject`.
- **Auth middleware order:** POST is `requireAuth → spendGate('narration') → validate →
  handler`. The two GETs have no `requireAuth`. Book GET uses `getAuthUser` for draft
  visibility only, exactly like `GET /api/books/:id`.
- **Spend:** price only through `costCentsFor('narration', undefined, chars)`. Pass the
  same `chars` to `checkQuota` and `recordUsage`. Never call either on a cache hit.
  `recordUsage` runs only after every segment is stored and the row is written.
- **No client text on paid routes:** the server derives text with
  `narrationTextFor(book, slot)`. No route accepts a text field.
- **Migrations:** `add_narration_clip` (SQLite, `npm run db:migrate`) +
  `add_narration_clip` (Postgres, `npm run db:migrate:postgres`). Additive only. Never
  edit a committed migration.
- **Storage:** only `getStorage().put(key, bytes, 'audio/wav')`. Keys are
  `<bookId>/narration/<slot>-<voiceId>-<hash16>-<i>.wav`. No new mount, no new seam.
- **Dark-mode parity:** every new class in `NarrationPlayer` and `BookSpread` has a
  `dark:` partner.
- **Server-zone tasks run one at a time.** Two server suites share `test.db`.
- **AI path honesty:** no test makes a live fal call. A real-key generation and listen
  are PR-body obligations, not "Done when" items.

## Tasks

### Task 1 — Narration contract in `@storybook/shared`

**Zone:** multi-zone (shared + client)
**Depends on:** none
**Parallel-safe with:** none (everything depends on it)

**Files to add or change:**
- `shared/src/narration.ts` (new): voice catalog, slot type, schemas, moved segmentation, `narrationTextFor`
- `shared/src/index.ts`: `export * from './narration'`
- `client/src/lib/narration/chunk.ts`: becomes a re-export of `splitIntoUtterances` / `MAX_CHUNK_CHARS` from shared (keep the file so imports don't churn)
- `client/src/lib/narration/types.ts`: `NarrationChunk` re-exported from shared. Update the header comment: chunks now cross the network
- `client/src/components/BookSpread.tsx`: replace the inline cover/end text (lines ~160–164) with `narrationTextFor(book, slot)`
- `client/src/lib/narration/__tests__/chunk.test.ts`: stays under client, importing from `@storybook/shared` (`shared/` has no test runner, verified 2026-11-08). New shared-logic tests also live under `client/src/lib/narration/__tests__/`

**Signatures / shapes:** exactly as spec §"Design question 7", `shared/src/narration.ts`
block. Additionally:
```ts
export function slotKey(slot: NarrationSlot): string            // 'cover' | 'end' | `p${n}`
export function nextSlot(slot: NarrationSlot, pageNumbers: number[]): NarrationSlot | null   // cover→first page→…→last→end→null
export const GENERATED_VOICE_PREFIX = 'generated:'
```
`narrationTextFor` returns `"{title}. By {author}."` for `'cover'`, `"The End."` for
`'end'`, the page's `text` for a number, and `null` for a page number that does not exist.

**Tests to write:**
- the existing chunk tests, now running against the shared function, all still green with assertions unmodified
- `narrationTextFor`: cover / end / page / missing page → null. Its output equals what `BookSpread` rendered before (string-identical)
- `nextSlot` ordering, including a book with zero pages (cover → end)
- schema tests: `NarrationGenerateRequestSchema` rejects an extra `text` key; `NarrationSlotSchema` rejects `0`, `-1`, `'p3'`
- Wire-shape assertion required: no (no route yet)

**Done when:** client and any shared tests pass, `cd client && npx tsc --noEmit` and the server typecheck are clean, and `e2e/tests/narration.spec.ts` + `e2e/tests/mobile/narration.spec.ts` still pass (behaviour unchanged).

---

### Task 2 — `NarrationClip` model and migrations

**Zone:** server
**Depends on:** Task 1, plus Nick's guardrail confirmation (schema change)
**Parallel-safe with:** Task 7

**Files to add or change:**
- `server/prisma/schema.prisma`: `NarrationClip` model + `Book.narration_clips` back-relation, exactly as the spec
- `server/prisma/migrations/<ts>_add_narration_clip/`: via `cd server && npm run db:migrate -- --name add_narration_clip`
- `server/prisma/postgres/migrations/<ts>_add_narration_clip/` + regenerated `server/prisma/postgres/schema.prisma`: via `npm run db:migrate:postgres -- add_narration_clip`
- `server/src/__tests__/setup.ts`: add `narrationClip` to `resetDatabase()` if it deletes per-table (check whether cascade from `book` already covers it)

**Tests to write:**
- `server/src/__tests__/narrationClip.test.ts`: unique constraint on `(book_id, slot, voice_id, model, text_hash)` rejects a duplicate. Deleting a book cascades its clips.
- Existing `postgresMigrations.test.ts` and `postgresSchema.test.ts` stay green (they enforce the second migration)
- Wire-shape assertion required: no

**Done when:** `cd server && npm test` is green, both migration folders are committed, and `migrate:postgres` printed no `DROP` / `ALTER COLUMN … TYPE` warnings.

---

### Task 3 — Char-priced `narration` spend kind

**Zone:** server
**Depends on:** Task 2
**Parallel-safe with:** Task 7

**Files to add or change:**
- `server/src/services/spend.ts`: `UsageKind` + `'narration'`; `COST_CENTS.narration = 1` (the reservation floor); `NARRATION_CENTS_PER_1K_CHARS = 2`; `costCentsFor` gains an optional `chars`; `checkQuota` / `recordUsage` gain an optional trailing `chars` passed straight to `costCentsFor`
- `CLAUDE.md` §Spend gates: add `narration` to the `COST_CENTS` line with the char-pricing rule (one sentence)

**Signatures / shapes:**
```ts
export const NARRATION_CENTS_PER_1K_CHARS = 2;
export function costCentsFor(kind: UsageKind, provider?: ImageProvider, chars?: number): number
// 'narration': Math.max(COST_CENTS.narration, Math.ceil((chars ?? 0) * NARRATION_CENTS_PER_1K_CHARS / 1000))
export async function checkQuota(userId, kind, isAdmin, now?, provider?, chars?): Promise<QuotaDecision>
export async function recordUsage(userId, kind, provider?, chars?): Promise<void>
```
Existing call sites stay byte-identical (all new params are trailing and optional).

**Tests to write:**
- `server/src/services/__tests__/spend.test.ts`: 0 chars → 1; 220 → 1; 500 → 1; 501 → 2; 1,000 → 2; 1,001 → 3. `checkQuota` and `recordUsage` agree for the same `chars`. Image kinds are unchanged with and without `chars`. `spendGate('narration')` reserves 1¢.
- Wire-shape assertion required: no

**Done when:** listed tests pass, `cd server && npm test` is green, no TS errors.

---

### Task 4 — Synthesizer seam and the fal Kokoro adapter

**Zone:** server
**Depends on:** Task 3 (sequencing only; server suites can't run concurrently)
**Parallel-safe with:** Task 7

**Files to add or change:**
- `server/src/services/narration/synthesizer.ts` (new): interface, `getNarrationSynthesizer()`, `isNarrationConfigured()`
- `server/src/services/narration/falKokoro.ts` (new): raw-`fetch` adapter, header comment pinning the endpoint contract and its date like `providers/fal.ts`

**Signatures / shapes:**
```ts
export interface NarrationSynthesizer {
  /** Returns WAV bytes for exactly `text`, at speed 1. Throws NarrationSynthesisError on any failure. */
  synthesize(text: string, voiceId: NarrationVoiceId): Promise<Buffer>;
}
export class NarrationSynthesisError extends Error {}
export function getNarrationSynthesizer(): NarrationSynthesizer      // FalKokoroSynthesizer
/** FAL_KEY usable (isUsableApiKey) AND (NODE_ENV !== 'production' || resolveBackendName() === 'r2'). */
export function isNarrationConfigured(): boolean

// falKokoro.ts
// POST https://fal.run/${NARRATION_MODEL}  headers { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' }
// body { prompt: text, voice: voiceId, speed: 1 }  → { audio: { url } }
// download audio.url: must be https and host fal.media or *.fal.media; cap 5 MB; timeout 60 s per leg
// verify the bytes start with 'RIFF'…'WAVE'
export function wavDurationMs(bytes: Buffer): number                 // from the WAV header (data size / byte rate)
```

**Tests to write:**
- `server/src/services/narration/__tests__/falKokoro.test.ts` with `vi.stubGlobal('fetch')`: exact URL, `Authorization: Key <key>`, JSON body `{ prompt, voice, speed: 1 }`. Success returns the downloaded bytes. Each of these maps to `NarrationSynthesisError`: non-2xx run, missing `audio.url`, non-fal host, `http:` URL, oversize body, non-WAV bytes, timeout. The key never appears in an error message.
- `wavDurationMs` on a committed tiny fixture WAV (`server/src/services/narration/__tests__/fixtures/silence-100ms.wav`)
- `isNarrationConfigured`: the four env combinations
- Wire-shape assertion required: no

**Done when:** listed tests pass, `cd server && npm test` is green, no TS errors.

---

### Task 5 — Cache-or-generate narration service

**Zone:** server
**Depends on:** Task 4
**Parallel-safe with:** Task 7, Task 8

**Files to add or change:**
- `server/src/services/narration/narration.ts` (new)

**Signatures / shapes:**
```ts
export interface NarrationBook { id: string; title: string; author: string; pages: { page_number: number; text: string }[] }

/** Free lookup. Never calls the synthesizer. */
export async function findNarration(book: NarrationBook, slot: NarrationSlot, voiceId: NarrationVoiceId): Promise<NarrationReady | null>

export type GenerateOutcome =
  | { kind: 'ready'; clip: NarrationReady }                     // cached:true → no charge happened
  | { kind: 'no-such-slot' }
  | { kind: 'quota'; decision: QuotaDecision }
  | { kind: 'upstream-failed' };

/** Lookup → (miss) checkQuota(chars) → split → synth ≤4 parallel → put each → create row → recordUsage(chars). */
export async function generateNarration(
  book: NarrationBook, slot: NarrationSlot, voiceId: NarrationVoiceId,
  requester: { id: string; isAdmin: boolean },
): Promise<GenerateOutcome>
```
- `text_hash` = `sha256(text)` hex. `chars` = `text.length`. Segments come from `splitIntoUtterances(text)` (shared). Each segment synthesises `chunk.text`.
- In-flight dedupe: a module `Map<cacheKey, Promise<GenerateOutcome>>`. Concurrent callers share one promise, and only the originator records usage. On a unique-constraint violation from `create`, re-read and return `cached: true` without recording.
- Any synth or put failure → `upstream-failed`: no row, no `UsageLog`. Partially uploaded keys are left; they are deterministic and get overwritten on retry.
- URLs on the wire are `/illustrations/${key}`.

**Tests to write:** `server/src/services/narration/__tests__/narration.test.ts`, with the synthesizer `vi.mock`ed to a call-counting fake returning the fixture WAV:
- miss → N synth calls (N = chunk count), N objects under `<bookId>/narration/`, one row, one `UsageLog` of `costCentsFor('narration', undefined, chars)`
- second call → `cached: true`, zero synth calls, zero new `UsageLog`
- edited `Page.text` → new hash, regenerates. Restoring the old text → cache hit
- segment `start`/`end` equal `splitIntoUtterances(text)` offsets
- quota denied → zero synth calls
- one segment throws → `upstream-failed`, no row, no usage
- two concurrent calls → one set of synth calls, one `UsageLog`
- `'cover'` / `'end'` speak `narrationTextFor` output. A missing page → `no-such-slot`
- existing `illustrations` `listBookFiles` / `imagePin` behaviour unaffected by `narration/` objects (one assertion each)
- Wire-shape assertion required: no (service layer)

**Done when:** listed tests pass, `cd server && npm test` is green, no TS errors.

---

### Task 6 — Narration routes

**Zone:** multi-zone (server + docs)
**Depends on:** Task 5
**Parallel-safe with:** Task 8

**Files to add or change:**
- `server/src/routes/narration.ts` (new): `narrationRouter` (`/api/narration/voices`) and the two book routes (mount on `/api/books` via a second router, or add them to `routes/books.ts`. Prefer a new file to keep `books.ts` from growing. Mount order must not shadow `/api/books/:id`)
- `server/src/index.ts`: mount
- `docs/conventions/call-graph.md`: client → route and route → service edges, and the `shared/src/narration.ts` fan-out
- `docs/conventions/server.md` Routes table: a GET-narration row noting "no auth, never calls fal"

**Signatures / shapes:**
```
GET  /api/narration/voices                  validate(response: NarrationVoicesResponseSchema)
     → { available: isNarrationConfigured(), voices: NARRATION_VOICES }
GET  /api/books/:id/narration?voice=&slot=   validate(response: NarrationGetResponseSchema)
     query parsed with NarrationVoiceIdSchema / NarrationSlotSchema (slot: 'cover'|'end'|digits) → 400 on bad query
     404 if book missing/deleted or draft-not-owner (same rule as GET /api/books/:id)
     → findNarration() ?? { status: 'missing' }
POST /api/books/:id/narration               requireAuth → spendGate('narration') → validate(request, response) → handler
     visibility 404 (published, or own draft) → 501 if !isNarrationConfigured()
     → generateNarration(): ready → 200 | no-such-slot → 404 | quota → sendQuotaDenied | upstream-failed → 502 { error }
```

**Tests to write:** `server/src/routes/__tests__/narration.test.ts`, synthesizer `vi.mock`ed, `FAL_KEY` set in-test:
- voices: `toMatchObject({ available: expect.any(Boolean), voices: [{ id, label, description, gender }] })`. `available` false with `FAL_KEY` unset.
- GET ready (seed a row via the service): pin `status, voiceId, slot, textHash, cached, segments[0].{index,start,end,url,durationMs}`. GET missing: pin `{ status: 'missing' }`. GET draft as stranger → 404. GET never touches the fake synthesizer (assert call count 0).
- POST: 401 no token (before 400 for a bad body). 400 on an extra `text` field. 404 stranger's draft. 404 for slot `99`. 501 with `FAL_KEY` unset. 501 in `NODE_ENV=production` with `STORAGE_BACKEND=local`. 429 envelope + `Retry-After` at the daily cap. 502 on synth failure with zero `UsageLog`. 200 miss then 200 `cached: true`. A signed-in non-owner of a published book may generate and is the user charged.
- Wire-shape assertion required: **yes** (`NarrationVoicesResponse`, `NarrationGetResponse` both arms, `NarrationGenerateResponse`, error envelopes `{ error }` and the quota envelope)

**Done when:** listed tests pass, the `wire-shape-check` skill reports every field pinned, `cd server && npm test` is green, no TS errors.

---

### Task 7 — Widen the provider seam and add `generatedProvider`

**Zone:** client
**Depends on:** Task 1
**Parallel-safe with:** Tasks 2–6

**Files to add or change:**
- `client/src/lib/narration/provider.ts`: `id: 'device' | 'generated'`; optional `target` in speak options; new error reasons; optional `onPreparing`; optional `prefetch`; update the header comment (two implementations, selected in the hook)
- `client/src/lib/narration/generatedProvider.ts` (new): `createGeneratedProvider(deps)`
- `client/src/lib/narration/api.ts` (new): typed `fetchVoices`, `getNarration`, `postNarration` against `API_BASE`, parsing with the shared schemas' inferred types
- `client/src/test/fakeAudio.ts` (new): installable `HTMLAudioElement` fake (per-file install, never global, per `docs/conventions/client.md`)

**Signatures / shapes:**
```ts
export type NarrationErrorReason =
  | 'canceled' | 'not-allowed' | 'synthesis-failed' | 'unknown'
  | 'generation-unavailable'   // 501, voices unavailable, signed-out miss
  | 'quota'                    // 429/503
export interface NarrationTarget { bookId: string; slot: NarrationSlot }
export interface NarrationSpeakOptions { voiceURI: string | null; rate: number; fromChunk: number; target?: NarrationTarget }
export interface NarrationEvents { /* existing */; onPreparing?(): void }
export interface NarrationProvider {
  readonly id: 'device' | 'generated'
  isAvailable(): boolean
  listVoices(): NarrationVoice[]
  speak(chunks, opts, events): NarrationHandle
  prefetch?(target: NarrationTarget, voiceURI: string): void
  /** False for providers that report gesture refusal themselves (no watchdog needed). */
  readonly needsStartWatchdog: boolean
}
export interface NarrationHandle { cancel(): void; pause(): void; resume(): void; setRate?(rate: number): void }

export function createGeneratedProvider(deps: {
  getToken: () => string | null
  fetchImpl?: typeof fetch
  createAudio?: () => HTMLAudioElement
}): NarrationProvider
```
Behaviour (spec §Design question 5): one audio element per provider. `speak()` primes it
synchronously with a silent WAV data URI before any `await`, then fires `onPreparing`,
then GET → (missing and token) POST → verifies segment offsets === chunk offsets → plays clip
`fromChunk…`. `playing` → `onChunkStart`, `ended` → `onChunkEnd` then the next clip,
preloading the next one. `play()` rejection `NotAllowedError` → `onError('not-allowed')`.
The provider never fires `onWordBoundary`. It is silent after `cancel()` (its own `dead`
flag, like `deviceProvider`). `prefetch` does GET, then POST if a token is present, and
caches the result in an in-memory map keyed by `(bookId, slot, voiceId)`. A
quota-denied prefetch makes the provider remember `quotaBlocked` for the session.

**Tests to write:** `client/src/lib/narration/__tests__/generatedProvider.test.ts` (fakeAudio + stubbed fetch):
- the prime happens synchronously inside `speak()` (before the first fetch resolves)
- cached GET → no POST. Missing + token → POST with `{ voiceId, slot }` and the bearer header, never a text field. Missing + no token → `onError('generation-unavailable')`
- event order across 3 clips: start0, end0, start1 … onDone. `fromChunk: 2` starts at clip 2
- 501 → `generation-unavailable`; 429/503 → `quota` (and the next speak short-circuits); 502/network/clip `error` → `synthesis-failed`; offset mismatch → `synthesis-failed`
- `NotAllowedError` → `not-allowed`
- `cancel()` mid-fetch and mid-clip → no further events
- `setRate` sets `playbackRate` live. Rate is never sent to the server.
- Wire-shape assertion required: no (client)

**Done when:** listed tests pass, `cd client && npm test` + typecheck + lint are green, `deviceProvider` tests are unchanged and green.

---

### Task 8 — Hook integration: voices, selection, fallback, prefetch

**Zone:** client
**Depends on:** Task 7 (and Task 6 for a live manual check only)
**Parallel-safe with:** Tasks 5–6

**Files to add or change:**
- `client/src/hooks/useVoices.ts`: fetch `/api/narration/voices` once per session (module-level promise cache). Merge generated voices (as `NarrationVoice` with `uri: 'generated:<id>'`, `kind: 'generated'`) ahead of device voices. Add the rung-0 default `generated:af_heart` when available. `status` is `'ready'` if *either* list is non-empty.
- `client/src/lib/narration/types.ts`: `NarrationVoice.kind: 'device' | 'generated'`. `deviceProvider.listVoices()` sets `'device'`.
- `client/src/hooks/useNarration.ts`: new arg `target: NarrationTarget | null`. Choose the provider per `startPlayback`: `generated` iff the effective voice URI starts with `GENERATED_VOICE_PREFIX`, generated is available, and `target` is non-null. Arm the watchdog only when `provider.needsStartWatchdog`. New result fields `preparing: boolean` and `notice: string | null`. On `generation-unavailable` / `quota` / `synthesis-failed` from the generated provider, set `notice` and re-run the same run from the failed chunk on `deviceProvider` with the device default voice (same `runId` discipline). Quota is sticky for the session. On the first `onChunkStart` of a page, call `provider.prefetch?.(nextSlot)` when `autoAdvance` is on. A rate change calls `handle.setRate` when present, instead of restarting.
- `client/src/components/BookSpread.tsx`: pass `target: { bookId: book.id, slot }` (null for books without an id, e.g. previews), and pass the token getter from `useAuth()` into the hook's provider (via `useMemo(() => createGeneratedProvider({ getToken }), [])`, reading the token through a ref)

**Tests to write:**
- `client/src/hooks/__tests__/useNarration.test.tsx`, extended with a fake generated provider:
  - selection by voice URI prefix
  - fallback to device on each of the three reasons, resuming at the failed chunk, with `notice` set
  - quota is sticky across a page turn
  - no watchdog on the generated path, and the existing watchdog test is unchanged on the device path
  - prefetch is called with `nextSlot` and not called when `autoAdvance` is off
  - a stale `runId` callback from the generated provider after a page turn produces no `onRequestNext` (copy the existing phantom-advance test)
- `client/src/hooks/__tests__/useVoices.test.tsx`:
  - generated voices listed first
  - rung 0 default
  - a persisted `generated:*` voice with generation unavailable falls through to the device ladder
  - device-unavailable + generated-available → `status: 'ready'`
- Wire-shape assertion required: no

**Done when:** listed tests pass, every existing narration test passes unmodified (except where a signature gained an argument), and `cd client && npm test` + typecheck + lint + build are green.

---

### Task 9 — Player UI: AI disclosure, preparing state, fallback notice

**Zone:** client
**Depends on:** Task 8
**Parallel-safe with:** none

**Files to add or change:**
- `client/src/components/NarrationPlayer.tsx`:
  - the voice `<select>` gets two `<optgroup>`s, "AI voices" and "This device's voices", with options showing `label — description` for generated voices
  - a visible line `AI-generated voice.` under the select when a generated voice is selected
  - the Play button shows `LoaderCircle` (spinning) and the status region says "Preparing voice…" while `preparing`
  - `notice` renders as one line in the player (not a toast)
  - all new classes carry `dark:` partners; no `position: fixed`

**Tests to write:**
- `client/src/components/__tests__/NarrationPlayer.test.tsx`: optgroups and labels; disclosure line present only for a generated voice; preparing state (spinner + status text, Play still labelled); notice rendered; the existing unavailable copy still shown when *both* lists are empty
- Wire-shape assertion required: no

**Manual verify:**
- In light **and** dark mode, desktop + 360 px: the picker groups, the disclosure line, the preparing spinner, and the fallback notice (unset `FAL_KEY` to force it) are legible, and nothing overflows.

**Done when:** listed tests pass, the `dark-mode-parity-check` skill is clean on the diff, and `cd client && npm test` + typecheck + lint + build are green.

---

### Task 10 — Mobile e2e for the generated path, both themes

**Zone:** e2e
**Depends on:** Task 9
**Parallel-safe with:** none

**Files to add or change:**
- `e2e/tests/_media.ts` (new): `addInitScript` fake for `HTMLMediaElement.prototype.play/pause` + `ended` timers, mirroring `_speech.ts`. Deterministic, deliberately dumb.
- `e2e/fixtures/silence-100ms.wav` (new, tiny, committed)
- `e2e/tests/mobile/narration-generated.spec.ts` (new): `page.route` stubs for the three narration routes (voices `available: true`, GET `missing`, POST `ready` with segment URLs routed to the fixture)

**Tests to write** (`forEachTheme`, `mobile-pixel` + `mobile-small`):
- Play on the cover → preparing state → sentence highlight advances by segment → auto-advances to page 1
- the disclosure line is visible with the default `generated:af_heart`
- POST stubbed 429 → the page plays on the device fake (`_speech.ts`) and the notice is visible; the next page does not POST again
- voices `available: false` → the existing device flow is unchanged (no narration request after the voices call)
- `expectNoHorizontalOverflow`, `expectTapTargets`, and the player is not `position: fixed`
- the existing `e2e/tests/narration.spec.ts` + `mobile/narration.spec.ts` pass unmodified
- Wire-shape assertion required: no

**Done when:** `cd e2e && npm test` is green. The spec states it discharges the **correctness** half of done-criterion #2 only (ADR-009).

---

### Task 11 — Pre-merge follow-ups

**Zone:** docs (harness) · **Depends on:** none (run last)

For each item in spec §"ADR-worthy decisions", ensure exactly one tracking action exists:
a matching ADR (expected: ADR-031 for the Kokoro/fal choice and the 18+ term risk, plus
ADRs or grouped decisions for the cache key and granularity, the storage keyspace, the
pricing, and the ADR-011 amendment), a linked issue, or an explicit `Deferred:` line with
reasoning (Media Session, transcoding, publish-time generation, per-page synthesis). Add an
amendment note under ADR-011 pointing at the new ADR. Update ADR-025's Scope line to
mention `<bookId>/narration/`.

The PR body must carry the three manual obligations: one real generation with a real
`FAL_KEY` (and the fal-dashboard check of per-request rounding, if not done before Task
3), one desktop Chrome listen, and one iPhone listen covering the first-Play gesture prime.

**Done when:** `adr-tracking-check generated-narration` reports zero orphaned items.

## Sequencing notes

- **Two lanes after Task 1:** server (2 → 3 → 4 → 5 → 6, strictly serial because the
  suites share `test.db`) and client (7 → 8 → 9). The lanes can run in separate worktrees.
  Tasks 8–9 do not need the real routes, because they test against fakes. Task 10 needs
  both lanes merged into one branch.
- **One PR** is fine: about 20 files, one feature, one migration. If it gets big, split at
  Task 6 (server-only PR, invisible to users because nothing calls the routes) and Tasks 7–11.
- **Before Task 2:** Nick's confirmation of the two guardrails on the spec Status line.
- **Before Task 3:** ideally, Nick reads the fal-dashboard charge for the existing
  sentence sample. If fal rounds per request, Task 3's formula becomes
  `segments × 2¢` instead of char-priced. That is a one-function change, but it should
  land right the first time.
- **Ops, not code:** production availability needs `STORAGE_BACKEND=r2` and the five
  `R2_*` vars set in Render (blob-storage-r2 Scope B landed in #194. Whether the bucket is
  live in prod is an operator fact to confirm). Without them, the routes answer 501 and
  the player falls back. That is safe, but the alpha would hear device voices.

## Open questions

1. **Per-sentence vs per-page synthesis.** **Ruled 2026-11-08: per-sentence.** The
   fal-dashboard rounding check is still unverified; if fal rounds per request, Task 3
   switches pricing per the spec's Risks row.
2. **Who may generate.** **Ruled 2026-11-08: the default.** any signed-in reader of a readable book, billed to them.
   The alternative is owner-and-admin only, with other readers getting cached audio or
   device TTS.
3. **Generated voice as the default.** **Ruled 2026-11-08: the default.** `generated:af_heart` is selected
   automatically when available. The alternative is opt-in via the picker.
