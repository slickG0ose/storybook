# Read-aloud narration ("Read to me") — phase 1, device TTS — task plan

> Spec: [spec.md](spec.md)
> Status: Draft
> Last updated: 2026-08-16
> Architect: Claude Opus 5 via @architect on 2026-08-16

## Overview

Nine tasks in three movements: **build the engine (1–3), surface it (4–6), prove it
(7–9).** The engine is pure logic with no UI, so Tasks 1–3 are fully deterministic under
unit tests and carry essentially no verification risk; the UI tasks then have a tested
substrate to sit on. Task 5 is the only one that edits an existing file, and it is
strictly additive.

Tasks 1 and 2 are the natural parallel cut (pure library vs. browser-API adapter), but
Task 2 needs the `NarrationChunk` type that Task 1 lands, so run 1 first. Task 6 is
optional-shaped by design: it carries a kill switch, and Tasks 7–9 do not depend on it.

`**Status:** <state>` lines under each task heading are how `/execute-task` records
progress.

## Branch base — read this first

**Branch from `agent/feat/mobile-pwa`, not from `master`.** This spec is designed against
mobile-pwa Tasks 1–5 (`useMediaQuery`, `BookSpread` single-page mode, `UpdateToast`, the
service worker, and the `e2e/tests/mobile/_helpers.ts` harness). Branching from `master`
gives a `BookSpread` without single-page mode and an e2e suite without `forEachTheme`, and
every mobile assertion here would be unrunnable.

mobile-pwa Task 6 (offline cart) is in flight and touches `CartContext.tsx`, `Cart.tsx`,
and existing `useCart` mocks. This spec touches none of those — file sets are disjoint —
but rebase before starting rather than after.

## Cross-cutting constraints

- **No server changes.** Nothing under `server/`, `shared/`, or `server/prisma/` is
  touched. **No route is added or modified, so OPS.3 wire-shape obligations do not
  attach.** If any task appears to need a route, a Prisma model, a `COST_CENTS` entry, or
  a `spendGate` mount, **stop and hand back to the architect** — that is the deferred
  generated-audio path, not this spec.
- **No new dependency.** Web Speech API and its TypeScript types (`SpeechSynthesis`,
  `SpeechSynthesisUtterance`, `SpeechSynthesisVoice`, `SpeechSynthesisEvent`) ship in
  `lib.dom.d.ts`. Do not add `zod` to `client/package.json` — it is not a direct client
  dependency today, and the preference guard is hand-written for that reason. If you
  believe a dependency is needed, escalate to the user before installing (CLAUDE.md
  size-gate trigger).
- **Storage guardrail.** Narration state lives under exactly one new key,
  `localStorage['storybook-narration']`. Never read, write, rotate, or reinterpret
  `storybook-session`, `storybook-auth`, `storybook-theme`, or `storybook-cart-cache`.
  Touching the session model requires user confirmation.
- **Dark-mode parity:** every new or changed surface needs `dark:` variants on every state
  — default, hover, focus-visible, disabled, `<details>` open/closed, and the highlight
  span. Run the `dark-mode-parity-check` skill on the diff before marking any client task
  Done.
- **Accessibility (non-negotiable in this feature — it *is* an a11y feature):**
  - The highlighted sentence is **never** in an `aria-live` region. The only live region
    is one visually-hidden `role="status" aria-live="polite"` announcing terse state
    changes.
  - Highlight with `<span>`, **never `<mark>`** (VoiceOver announces "highlighted").
  - Sentence spans get no `role` and no `tabIndex`. The accessible seek path is the
    Previous/Next sentence buttons.
  - Never move focus programmatically — not on play, not on auto page-advance.
  - Icon-only buttons need `aria-label`; both `<select>`s need labels. Do **not** change
    any existing accessible name (`Next spread`, `Previous spread`, `Go to spread N`,
    `Expand to theater mode`) — desktop and mobile e2e specs target them.
- **One DOM shape at every breakpoint.** Reuse `BookSpread`'s existing
  `NARROW_QUERY = '(max-width: 767px)'`; do not introduce a second breakpoint and do not
  render two variants of a control with the same accessible name.
- **Layout invariant:** the narration player is in normal flow at every breakpoint.
  `UpdateToast` remains the app's only bottom-fixed surface.
- **`BookSpread.tsx` changes are additive only.** No change to the two-column spread
  structure, the `md:grid-cols-2` layout, the theater frame widths, the chevron logic, or
  the dot strip. Altering theater behaviour is an ADR-004 amendment — hand back instead.
- **Migrations:** none.
- **TypeScript strict, no `any`.**
- **Manual-verification stance (read before claiming Done).** CLAUDE.md done-criterion #2
  is discharged mechanically for Tasks 4, 5, 6 and 7 by the `forEachTheme` mobile e2e
  assertions plus `dark-mode-parity-check` — say so explicitly in the hand-back rather
  than silently skipping it. **Three things CI cannot do, all listed in the spec's
  autonomy ledger, are not part of any "Done when":** one real listen on desktop Chrome
  (pacing), one real listen on an iPhone including a screen lock, and one look at word
  highlighting on a platform that emits word boundaries. Carry them into the PR body as
  an explicit outstanding list. The iPhone check is **not** blocked on #77 — Web Speech is
  not restricted to secure contexts, so a phone on the LAN pointed at the dev server is
  sufficient.

## Tasks

### Task 1 — Narration core: types, sentence chunking, preference storage

**Status:** Done (2026-08-22)

**Zone:** client
**Depends on:** none
**Parallel-safe with:** none (Tasks 2–6 all import from here)

**Files to add or change:**
- `client/src/lib/narration/types.ts` — new; client-internal shared types.
- `client/src/lib/narration/chunk.ts` — new; the pure chunker.
- `client/src/lib/narration/prefs.ts` — new; localStorage read/write + validation.
- `client/src/lib/narration/__tests__/chunk.test.ts` — new.
- `client/src/lib/narration/__tests__/prefs.test.ts` — new.

**Signatures / shapes:**

```ts
// client/src/lib/narration/types.ts
/** A speakable unit plus its [start, end) offsets into the original page text. */
export interface NarrationChunk { text: string; start: number; end: number }

export interface NarrationVoice {
  uri: string;            // SpeechSynthesisVoice.voiceURI — the stable identifier
  name: string;
  lang: string;
  localService: boolean;  // local voices work offline and sound better on Apple platforms
}

export type NarrationState = 'idle' | 'playing' | 'paused' | 'unavailable';

export interface NarrationPosition {
  chunkIndex: number;
  /** Offsets into the *page* text, not the chunk. Null unless a word-granularity
   *  boundary event has actually been observed — see Task 6. */
  wordRange: { start: number; end: number } | null;
}
```

```ts
// client/src/lib/narration/chunk.ts
/** Chrome silently truncates a single utterance past ~15s / ~200-250 chars and can wedge
 *  the queue (chromium#41346274). This is a correctness limit, not a tuning knob. */
export const MAX_CHUNK_CHARS = 200;

export function splitIntoUtterances(text: string, maxChars?: number): NarrationChunk[];
```

Chunker rules, in order:
1. Split on sentence terminators `.` `!` `?` `…` including trailing quotes/brackets
   (`!"`, `?'`, `."`) and any following whitespace. Children's-book dialogue is full of
   these.
2. Do **not** split on a terminator that is part of a short abbreviation. Keep the list
   tiny and literal — `Mr. Mrs. Ms. Dr. St.` — and comment that this is a heuristic, not
   an NLP problem worth solving here.
3. Hard-split any resulting chunk longer than `maxChars` at the **last word boundary**
   before the limit; if a single word exceeds the limit, split mid-word rather than
   emitting an over-length chunk.
4. Trim each chunk's `text` but keep `start`/`end` pointing at the untrimmed span, so
   `text.slice(start, end)` always covers the rendered region including its trailing
   space. Highlighting a sentence should visually include its own punctuation.
5. Empty or whitespace-only input returns `[]`. Never return a zero-length chunk.

```ts
// client/src/lib/narration/prefs.ts
const NARRATION_PREFS_KEY = 'storybook-narration';

export interface NarrationPrefs {
  voiceURI: string | null;
  rate: number;         // clamped to [0.75, 1.5]
  autoAdvance: boolean;
}

export const DEFAULT_PREFS: NarrationPrefs = { voiceURI: null, rate: 1, autoAdvance: true };
export const RATE_OPTIONS = [0.75, 1, 1.25, 1.5] as const;

/** Never throws. Returns DEFAULT_PREFS on missing, malformed, or out-of-range values. */
export function readPrefs(): NarrationPrefs;
export function writePrefs(prefs: NarrationPrefs): void;
```

Hand-written type guard, not Zod — there is no wire shape and `zod` is not a direct
client dependency. Guard each field independently so one bad field falls back to its own
default rather than discarding the whole blob. Wrap both functions in try/catch:
`localStorage` throws in Safari private mode and in some embedded webviews, and a reader
that crashes because a preference could not be saved is a worse bug than a lost
preference.

**Tests to write:**
- `chunk.test.ts` —
  - multi-sentence prose splits one chunk per sentence;
  - **round-trip invariant**: `chunks.map(c => text.slice(c.start, c.end)).join('')` equals
    the original text (no dropped or duplicated characters);
  - **length invariant**: no chunk's `text.length` exceeds `MAX_CHUNK_CHARS`, asserted
    against a 2000-character run-on with **no terminator at all** — the adversarial case
    that motivates rule 3;
  - dialogue `"Stop!" said Luna.` splits after the closing quote, not before it;
  - `Mr. Fox ran.` is one chunk, not two;
  - ellipsis `Wait… what?` splits into two;
  - `''` and `'   '` return `[]`;
  - offsets are monotonically non-decreasing and non-overlapping.
- `prefs.test.ts` — round-trip; missing key → defaults; malformed JSON → defaults;
  `rate: 99` → clamped to 1.5; `rate: 'fast'` → default rate with other fields preserved;
  unknown extra keys ignored; a throwing `localStorage` (stub `setItem` to throw) does not
  propagate; **asserts that no other `storybook-*` key is read or written** (spy on
  `Storage.prototype.getItem`/`setItem` and check the key argument).
- Wire-shape assertion required: **no** — no server route, no network response.

**Manual verify:** none — pure functions.

**Done when:** listed tests pass, `cd client && npm test` green, `npx tsc --noEmit` clean.

---

### Task 2 — Provider seam, device provider, voice list, and the fake synth

**Status:** Done (2026-08-22)

**Zone:** client
**Depends on:** Task 1
**Parallel-safe with:** none (Task 3 imports both)

**Files to add or change:**
- `client/src/lib/narration/provider.ts` — new; the interface. Interface only, no logic.
- `client/src/lib/narration/deviceProvider.ts` — new; the only implementation.
- `client/src/hooks/useVoices.ts` — new; async voice list + status + default pick.
- `client/src/test/fakeSpeech.ts` — new; installable fake `speechSynthesis`.
- `client/src/lib/narration/__tests__/deviceProvider.test.ts` — new.
- `client/src/hooks/__tests__/useVoices.test.ts` — new.

**Signatures / shapes:**

```ts
// client/src/lib/narration/provider.ts
export interface NarrationEvents {
  onChunkStart(chunkIndex: number): void;
  onWordBoundary(chunkIndex: number, charIndex: number, charLength: number): void;
  onChunkEnd(chunkIndex: number): void;
  onDone(): void;
  onError(reason: 'canceled' | 'not-allowed' | 'synthesis-failed' | 'unknown'): void;
}

export interface NarrationHandle { cancel(): void; pause(): void; resume(): void }

export interface NarrationSpeakOptions {
  voiceURI: string | null;
  rate: number;
  fromChunk: number;
}

export interface NarrationProvider {
  readonly id: 'device';                 // future: | 'generated'
  isAvailable(): boolean;
  listVoices(): NarrationVoice[];
  speak(chunks: NarrationChunk[], opts: NarrationSpeakOptions, events: NarrationEvents): NarrationHandle;
}
```

Keep this file to the interface plus its doc comment. **No registry, no factory, no
config flag** — the spec's §Alternatives explains why, and a future reader should see the
restraint, not a framework.

```ts
// client/src/lib/narration/deviceProvider.ts
export const deviceProvider: NarrationProvider;
```

Implementation requirements:
- `isAvailable()` — `typeof window !== 'undefined' && 'speechSynthesis' in window &&
  typeof SpeechSynthesisUtterance === 'function'`. Never assume the constructor exists
  just because the synthesis object does.
- `listVoices()` — maps `speechSynthesis.getVoices()` to `NarrationVoice[]`, sorted
  `localService` first then by `name`. Returns `[]` when unavailable; never throws.
- `speak()` — constructs one `SpeechSynthesisUtterance` per chunk from `fromChunk`
  onward and calls `speechSynthesis.speak()` for **all** of them in a single synchronous
  burst. This is what keeps the whole page inside one user gesture on iOS Safari; do not
  schedule subsequent chunks from `end` handlers.
- Per-utterance handlers map to events, tagging each with its own `chunkIndex` via a
  closure: `onstart → onChunkStart(i)`, `onend → onChunkEnd(i)` (plus `onDone()` after
  the last), `onboundary → onWordBoundary(i, e.charIndex, e.charLength ?? 0)` **only when
  `e.name === 'word'`**, `onerror → onError(mapError(e.error))`.
- `mapError`: `'canceled' | 'interrupted'` → `'canceled'`; `'not-allowed'` → `'not-allowed'`;
  `'synthesis-failed' | 'synthesis-unavailable' | 'audio-busy' | 'audio-hardware'` →
  `'synthesis-failed'`; anything else → `'unknown'`.
- `cancel()` calls `speechSynthesis.cancel()` and marks the handle dead so its own
  late-firing handlers stop emitting. **Chrome's `cancel()` still fires `end`/`error` on
  the in-flight utterance asynchronously** — the handle must not emit `onDone()` after
  being cancelled, or Task 3's auto-advance fires on a page the reader already left.
- `pause()` / `resume()` delegate to `speechSynthesis.pause()` / `.resume()`.
- Voice resolution: look up `voiceURI` in the current `getVoices()` list and assign
  `utterance.voice` only on a hit. Assigning a stale voice object is a common source of
  silent failure — leave it unset and let the engine pick rather than setting garbage.
- Clamp `rate` into `[0.75, 1.5]` at the boundary as well as in prefs. Defence in depth;
  an out-of-range `rate` makes some engines refuse to speak at all.

```ts
// client/src/hooks/useVoices.ts
export const VOICE_LOAD_TIMEOUT_MS = 2000;

export interface UseVoicesResult {
  voices: NarrationVoice[];
  status: 'loading' | 'ready' | 'unavailable';
  defaultVoiceURI: string | null;
}

export function useVoices(persistedVoiceURI: string | null): UseVoicesResult;
```

- Read `listVoices()` synchronously on mount; if non-empty, `status: 'ready'` immediately.
- Otherwise subscribe to `speechSynthesis.onvoiceschanged` (add **and** remove the
  listener; it fires repeatedly on some engines) and start a `VOICE_LOAD_TIMEOUT_MS`
  timer. On timeout with a still-empty list → `'unavailable'`. **Never leave the UI in
  `'loading'` forever.**
- `defaultVoiceURI` picks in this exact order — persisted-and-still-present → `lang`
  matching `navigator.language` with `localService` → `lang` prefix match on the document
  language → the voice flagged `default` → `voices[0]` → `null`. Each step gets its own
  test.
- **No hand-maintained voice name allow/deny list.**

```ts
// client/src/test/fakeSpeech.ts
export interface FakeVoiceSpec { voiceURI: string; name: string; lang: string; localService: boolean; default?: boolean }
export interface FakeSpeechOptions {
  voices?: FakeVoiceSpec[];
  /** Emit word-granularity boundary events. Default false — matches Safari/Android. */
  emitWordBoundary?: boolean;
  /** Simulated ms per utterance under fake timers. Default 100. */
  chunkMs?: number;
  /** Populate getVoices() only after this many ms, mimicking Chrome's empty first call. */
  voicesReadyAfterMs?: number;
}

export function installFakeSpeech(opts?: FakeSpeechOptions): FakeSpeechControl;
export function uninstallFakeSpeech(): void;

export interface FakeSpeechControl {
  /** Every utterance text passed to speak(), in order — the queue assertion surface. */
  spoken(): string[];
  cancelCount(): number;
  /** Force an error on the currently-speaking utterance. */
  failCurrent(error: string): void;
}
```

**Install it explicitly per test file — do NOT add it to `client/src/test/setup.ts`.**
jsdom has no `speechSynthesis`, and that absence is exactly what the `'unavailable'` path
needs in order to be testable. A global install would make the most important degraded
state unreachable.

Keep the fake dumb: a FIFO queue advanced by timers, no clever behaviour. It is a model
of the API, not the API — `deviceProvider.test.ts` is where that model is pinned.

**Tests to write:**
- `deviceProvider.test.ts` (fake timers + `installFakeSpeech`) —
  - `isAvailable()` false when the global is absent, true when installed;
  - `speak()` with 3 chunks calls `speechSynthesis.speak` **3 times synchronously**
    (assert via `control.spoken()`), not once-then-scheduled;
  - `fromChunk: 1` queues 2 utterances and reports `chunkIndex` 1 and 2 — indices are
    absolute, not re-based;
  - `onChunkStart` / `onChunkEnd` fire per chunk in order; `onDone` fires exactly once,
    after the last `onChunkEnd`;
  - `cancel()` calls `speechSynthesis.cancel()` and **suppresses a subsequent `onDone`**
    from the late-firing in-flight utterance — the regression fence for Task 3's
    auto-advance;
  - `onboundary` with `name: 'sentence'` does **not** produce `onWordBoundary`;
  - `mapError` — one case per branch, including an unrecognised code → `'unknown'`;
  - an unknown `voiceURI` leaves `utterance.voice` unset rather than assigning null/garbage;
  - `rate: 4` is clamped to 1.5 on the utterance.
- `useVoices.test.ts` (RTL `renderHook`) —
  - empty first call + later `voiceschanged` → `'loading'` then `'ready'`;
  - empty forever → `'unavailable'` after `VOICE_LOAD_TIMEOUT_MS`, not stuck on `'loading'`;
  - no `speechSynthesis` global at all → `'unavailable'` immediately;
  - default-pick order: one test per rung, including "persisted URI no longer in the list
    falls through to rung 2" — the cross-device case;
  - the `voiceschanged` listener is removed on unmount.
- Wire-shape assertion required: **no**.

**Manual verify:** none.

**Done when:** listed tests pass, `cd client && npm test` green, `npx tsc --noEmit` clean.

---

### Task 3 — `useNarration`: the playback state machine

**Status:** Done (2026-08-22)

**Zone:** client
**Depends on:** Tasks 1, 2
**Parallel-safe with:** none

**Files to add or change:**
- `client/src/hooks/useNarration.ts` — new.
- `client/src/hooks/__tests__/useNarration.test.tsx` — new.

This is the highest-risk logic in the feature and the only place a subtle bug can produce
audio playing over the wrong page. It is also entirely deterministic under fake timers, so
it should be tested harder than anything else here.

**Signatures / shapes:**

```ts
// client/src/hooks/useNarration.ts
/** Settle before turning the page so the last word does not collide with the flip. */
export const AUTO_ADVANCE_DELAY_MS = 400;
/** iOS may refuse a speak() that did not originate in a gesture; do not appear frozen. */
export const START_WATCHDOG_MS = 1500;

export interface UseNarrationArgs {
  /** The text of the page currently on screen, or null on cover/end/no-page spreads. */
  text: string | null;
  /** Changes whenever the visible page changes. Any change cancels in-flight audio. */
  pageKey: string | number;
  /** Called after the last chunk when auto-advance is on. The host decides whether to honour it. */
  onRequestNext: () => void;
  /** False on the last spread, so narration stops instead of requesting a turn. */
  hasNext: boolean;
}

export interface UseNarrationResult {
  state: NarrationState;                 // 'idle' | 'playing' | 'paused' | 'unavailable'
  position: NarrationPosition | null;    // null when not speaking
  chunks: NarrationChunk[];              // for the renderer's spans; [] when text is null
  /** Set when the watchdog fires — the UI shows "Tap play to continue". */
  needsGesture: boolean;
  play(fromChunk?: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
  nextSentence(): void;
  previousSentence(): void;
  prefs: NarrationPrefs;
  setPrefs(next: Partial<NarrationPrefs>): void;
  voices: NarrationVoice[];
  voiceStatus: 'loading' | 'ready' | 'unavailable';
}
```

Required behaviour, each of which maps to a test below:

- **`runId` guard.** A `useRef<number>` incremented on every `play`, `stop`, `pageKey`
  change, and unmount. Every provider callback closes over the `runId` current at
  `speak()` time and returns immediately if it no longer matches. **Without this, a fast
  double-tap on Next produces a phantom `onRequestNext` and a highlight on the wrong
  page.** This is the single most important line in the feature.
- **`pageKey` change** → `handle.cancel()`, bump `runId`, clear `position`. If `state` was
  `'playing'`, re-`play(0)` on the new text; if `'paused'` or `'idle'`, stay stopped.
- **Auto-advance** on `onDone` only when *all* of: `runId` current, `state === 'playing'`,
  `prefs.autoAdvance`, and `hasNext`. Fire `onRequestNext()` after
  `AUTO_ADVANCE_DELAY_MS`. When `hasNext` is false, transition to `'idle'` and announce
  "Finished".
- **Watchdog.** After a `play()` that did not originate in a user gesture (i.e. the
  re-arm following an auto-advance), if no `onChunkStart` arrives within
  `START_WATCHDOG_MS`, set `state: 'paused'` and `needsGesture: true`. Any subsequent
  user-initiated `play()` clears `needsGesture`.
- **`visibilitychange`** → when `document.hidden` and `state === 'playing'`,
  `handle.pause()` and set `'paused'`, preserving `position.chunkIndex`. Do **not**
  auto-resume on return — iOS may have torn the session down, and a story restarting by
  itself in a pocket is worse than a Play button.
- **Rate or voice change while playing** → `cancel()` then re-`speak()` from the current
  `chunkIndex`. There is no way to change either on a queued utterance.
- **`nextSentence` / `previousSentence`** → `cancel()` then `play(clamp(chunkIndex ± 1))`.
  `previousSentence` at chunk 0 restarts chunk 0 rather than doing nothing — matching how
  every audio player behaves.
- **Unmount** → `handle.cancel()` unconditionally. An uncancelled utterance keeps talking
  over the next route.
- **`onError('canceled')`** is expected and must be swallowed silently — it is what our
  own `cancel()` produces. `'not-allowed'` sets `needsGesture`. `'synthesis-failed'` and
  `'unknown'` transition to `'idle'`; do not retry in a loop.
- **`deviceProvider.isAvailable()` false** → `state: 'unavailable'` and every method is a
  safe no-op. Nothing may throw.

**Tests to write:**
- `useNarration.test.tsx` (RTL `renderHook`, fake timers, `installFakeSpeech`) —
  - `play()` queues every chunk and reports `position.chunkIndex` 0 → 1 → 2 in order;
  - after the final chunk, `onRequestNext` is called **exactly once**, and only after
    `AUTO_ADVANCE_DELAY_MS`;
  - `autoAdvance: false` → `onRequestNext` is never called and `state` returns to `'idle'`;
  - `hasNext: false` → no `onRequestNext` even with auto-advance on;
  - **stale-`runId` guard, asserted directly**: start playback, change `pageKey`, then let
    the abandoned page's `end` events fire — `onRequestNext` must **not** be called and
    `position` must not point into the old page (success criterion 4);
  - changing `pageKey` while `'playing'` cancels and restarts at chunk 0 on the new text;
  - changing `pageKey` while `'paused'` cancels and does **not** start;
  - watchdog: an auto-advance re-arm with a fake that emits no `start` → `'paused'` and
    `needsGesture` true after `START_WATCHDOG_MS`;
  - `visibilitychange` to hidden while playing → `'paused'` with `chunkIndex` preserved;
    returning to visible does not auto-resume;
  - `setPrefs({ rate })` mid-playback cancels once and re-speaks from the current chunk,
    not from 0;
  - `previousSentence()` at chunk 0 restarts chunk 0;
  - unmount calls `cancel()` (assert `control.cancelCount()`);
  - `onError('canceled')` does not change `state`;
  - no `speechSynthesis` global → `state: 'unavailable'`, and `play()`, `pause()`,
    `stop()`, `nextSentence()` all no-op without throwing.
- Wire-shape assertion required: **no**.

**Manual verify:** none — every transition is deterministic under fake timers.

**Done when:** listed tests pass, `cd client && npm test` green, `npx tsc --noEmit` clean.

---

### Task 4 — `NarrationPlayer` component

**Status:** Done (2026-08-22)

**Zone:** client
**Depends on:** Task 3
**Parallel-safe with:** Task 8

**Files to add or change:**
- `client/src/components/NarrationPlayer.tsx` — new.
- `client/src/components/__tests__/NarrationPlayer.test.tsx` — new.

**Signatures / shapes:**

```tsx
interface NarrationPlayerProps {
  narration: UseNarrationResult;
  /** Announced in the visually-hidden status region: "Reading page 3". */
  pageLabel: string;
  className?: string;
}

export default function NarrationPlayer({ narration, pageLabel, className }: NarrationPlayerProps): JSX.Element;
```

Structure — **one DOM shape at every breakpoint**, Tailwind variants change spacing only:

```
<div role="group" aria-label="Read aloud" data-testid="narration-player" class="...">
  <span class="sr-only" role="status" aria-live="polite">{statusMessage}</span>

  <!-- transport row: four real <button>s, min-h-11 min-w-11 -->
  <button aria-label="Previous sentence">        <SkipBack />
  <button aria-label={playing ? 'Pause' : 'Play'} aria-pressed={playing}>  <Play/Pause />
  <button aria-label="Next sentence">            <SkipForward />
  <button aria-label="Stop reading">             <Square />

  <details data-testid="narration-settings">     <!-- closed by default at ALL breakpoints -->
    <summary>Voice settings</summary>
    <label> Voice   <select>...   <!-- narration.voices -->
    <label> Speed   <select>...   <!-- RATE_OPTIONS, rendered 0.75x / 1x / 1.25x / 1.5x -->
    <label> <input type="checkbox"> Turn pages automatically
  </details>
</div>
```

Rules:
- **Layout:** `flex flex-wrap items-center justify-center gap-2` with the `<details>` on
  its own line below `md` (`w-full md:w-auto`). **No `fixed` / `sticky` / `absolute`
  positioning** — Task 7 asserts the computed `position` is not `fixed`, and
  `UpdateToast` remains the app's only bottom-fixed surface.
- **Palette:** mirror `UpdateToast` / `BookSpread` — `bg-white dark:bg-gray-800`,
  `border-amber-200 dark:border-gray-700`, `text-amber-700 dark:text-amber-300`.
  Every state gets a `dark:` partner, including `disabled:` and `focus-visible:`.
- **Tap targets:** `min-h-11 min-w-11` on all four transport buttons and on both
  `<select>`s. The `<summary>` needs padding to clear 44 px too.
- **`voiceStatus === 'loading'`** → transport disabled with a spinner, no error text.
- **`state === 'unavailable'` or `voiceStatus === 'unavailable'`** → transport controls
  `disabled` + `aria-disabled`, the `<details>` not rendered, and one line of text:
  **"Read-aloud isn't available in this browser."** Not a toast, not hidden. A play button
  that silently does nothing is worse than an honest disabled one.
- **`needsGesture`** → the Play button is enabled and the status line reads
  "Tap play to continue."
- **Status region text** — transitions only, terse: `Reading {pageLabel}` / `Paused` /
  `Finished` / `Tap play to continue`. Never the sentence text. Never re-announce the same
  string twice in a row.
- **Preferences persist through `narration.setPrefs`**, which owns `writePrefs`. The
  component holds no narration state of its own.
- **Never call `focus()`.**

**Tests to write:**
- `NarrationPlayer.test.tsx` (RTL; drive it with a hand-built `UseNarrationResult` object
  rather than the real hook — the hook has its own suite) —
  - all four transport buttons render with their `aria-label`s and call the matching
    handler on click;
  - Play/Pause name and `aria-pressed` flip with `state`;
  - `state: 'unavailable'` → controls disabled, the exact copy is present, clicking a
    disabled control does not throw, and the settings `<details>` is absent;
  - `voiceStatus: 'loading'` → disabled without the unavailable copy;
  - voice `<select>` lists `narration.voices` and calls `setPrefs({ voiceURI })`;
  - speed `<select>` offers exactly `RATE_OPTIONS` and calls `setPrefs({ rate })`;
  - auto-advance checkbox reflects and toggles `prefs.autoAdvance`;
  - the status region has `role="status"` and `aria-live="polite"` and is `sr-only`;
  - `needsGesture: true` renders the tap-to-continue copy with Play enabled;
  - a snapshot-free class assertion that the root has **no** `fixed` or `sticky` class.
- Wire-shape assertion required: **no**.

**Manual verify:** discharged mechanically by Task 7 (`forEachTheme` × two mobile
viewports) plus `dark-mode-parity-check` on the diff. Aesthetic judgement — whether the
bar sits well under the frame — is non-blocking; note it in the hand-back.

**Done when:** listed tests pass, `dark-mode-parity-check` clean on the diff,
`cd client && npm test` green, `npx tsc --noEmit` clean.

---

### Task 5 — Wire narration into `BookSpread`: highlight, auto-advance, cancel-on-nav

**Status:** Done (2026-08-22)

**Zone:** client
**Depends on:** Task 4
**Parallel-safe with:** Task 8

The only task that edits an existing file. **Additive only.**

**Files to add or change:**
- `client/src/components/BookSpread.tsx` — mount the player, thread highlight state into
  `StoryText`, wire `onRequestNext` to the existing `turnPage('next')`.
- `client/src/components/__tests__/BookSpread.test.tsx` — extend.

**Signatures / shapes:**

```tsx
// inside BookSpread, alongside the existing spreadIndex state
const narration = useNarration({
  text:
    spread.kind === 'story' ? spread.page.text :
    spread.kind === 'cover' ? `${book.title}. By ${book.author}.` :
    'The End.',
  pageKey: spreadIndex,          // the existing index IS the key — do not add parallel state
  hasNext: canNext,
  onRequestNext: () => turnPage('next'),
});
```

```tsx
// StoryText gains two optional props; the desktop and mobile call sites both pass them.
function StoryText({ page, className, chunks, position }: {
  page: Page;
  className: string;
  chunks?: NarrationChunk[];
  position?: NarrationPosition | null;
}) { /* ... */ }
```

Rendering rules for `StoryText`:
- When `chunks` is absent/empty or `position` is null, render `page.text` **exactly as
  today** — one `<p>`, one text node. No behaviour change when narration is idle.
- When highlighting, render the same `<p>` containing one `<span>` per chunk sliced by
  `[start, end)`. The active chunk gets
  `bg-amber-200 dark:bg-amber-500/30 rounded motion-safe:transition-colors` and
  `data-testid="narration-highlight"`. **`<span>`, never `<mark>`.**
- Spans get `onClick={() => narration.play(i)}` and `cursor-pointer` **only when
  narration is available**. No `role`, no `tabIndex` — the accessible seek path is the
  Previous/Next sentence buttons.
- The chunk offsets come straight from `narration.chunks`; do not re-split the text in
  the renderer.

Placement of `<NarrationPlayer>`: a single instance in normal flow, **after** the frame
and the narrow-mode chevron bar, **before** the existing footer strip (dots / position /
theater). One instance, both breakpoints — do not render a desktop copy and a mobile copy.

`pageLabel` mirrors the existing `spread-position` text: `Cover` / `page N of M` / `End`.

**Do not change:** the `md:grid-cols-2` spread structure, `PageCanvas`, the theater frame
widths (`frameWidthClass`), the chevron logic, the dot strip, or any existing
`aria-label`. Altering theater behaviour is an ADR-004 amendment — hand back instead.

**Tests to write:**
- `BookSpread.test.tsx` (extend; `installFakeSpeech` per test) —
  - the player renders once and only once on a story spread — assert
    `getAllByTestId('narration-player')` has length 1 in **both** the default (desktop)
    matchMedia branch and with `matchMedia` overridden to match `NARROW_QUERY`;
  - with narration idle, the page text renders unchanged (no highlight spans) — the
    regression fence for the untouched case;
  - `play()` renders exactly one `narration-highlight` span, containing the first sentence;
  - clicking a non-active sentence span starts playback from that chunk;
  - cover spread narration text is `"{title}. By {author}."`;
  - the end spread does not request a page turn;
  - existing `BookSpread.test.tsx` assertions all still pass unchanged.
- Wire-shape assertion required: **no**.

**Manual verify:** correctness is discharged by Task 7. **One real listen on desktop
Chrome is genuinely needed** — does `AUTO_ADVANCE_DELAY_MS = 400` feel right, or does the
page turn tread on the last word? Complete the task, then flag it in the hand-back; do not
block on it. The constant is deliberately a single named export so tuning is a one-line
change.

**Done when:** listed tests pass, `dark-mode-parity-check` clean, `cd client && npm test`
green, `npx tsc --noEmit` clean, and `cd e2e && npm test` still green on the pre-existing
desktop + mobile suites (`book-detail`, `version-history`, `illustration-history`,
`dark-mode`, `mobile/reader`).

---

### Task 6 — Word-level highlight, as a self-activating enhancement

**Status:** Not started

**Zone:** client
**Depends on:** Task 5
**Parallel-safe with:** Task 7 (re-run Task 7's specs after this lands)

Scoped small on purpose. The sentence-level baseline is already shipped and correct; this
only ever *narrows* an already-correct highlight.

**Files to add or change:**
- `client/src/hooks/useNarration.ts` — populate `position.wordRange` from
  `onWordBoundary`.
- `client/src/components/BookSpread.tsx` — render the word span inside the active
  sentence span.
- `client/src/hooks/__tests__/useNarration.test.tsx` — extend.
- `client/src/components/__tests__/BookSpread.test.tsx` — extend.

**Signatures / shapes:**

```ts
// useNarration — no new exported surface; wordRange stops being permanently null.
onWordBoundary(chunkIndex, charIndex, charLength) {
  if (runId !== currentRunId.current) return;              // same guard as everything else
  if (charLength <= 0) return;                             // some engines omit charLength
  const chunk = chunks[chunkIndex];
  setPosition({
    chunkIndex,
    wordRange: { start: chunk.start + charIndex, end: chunk.start + charIndex + charLength },
  });
}
```

Note the offsets are translated into **page-text** space, matching `NarrationChunk`, so
the renderer needs no second coordinate system.

Rendering: inside the active sentence span, slice at `wordRange` and wrap the word in
`<span data-testid="narration-word" class="bg-amber-400/70 dark:bg-amber-400/40 rounded">`.
When `wordRange` is null the active sentence renders exactly as it does after Task 5.

**Self-activation is the whole design.** `wordRange` is only ever non-null because a real
`boundary` event with `name === 'word'` arrived. On Safari (sentence-granularity
boundaries) and Android Chrome (no boundary events) nothing changes, by construction —
there is no capability sniffing, no user-agent test, and no setting to get wrong.

**Kill switch.** If the manual check shows word highlighting lagging or leading the audio,
the fix is one line — stop setting `wordRange` in `onWordBoundary` — and the shipped
sentence-level behaviour is unaffected. Say so in the hand-back so the option is visible
to the reviewer rather than buried.

**Tests to write:**
- `useNarration.test.tsx` — with `installFakeSpeech({ emitWordBoundary: true })`,
  `position.wordRange` tracks successive words **in page-text coordinates** (assert the
  absolute offsets, not chunk-relative ones); with `emitWordBoundary: false` (the default,
  matching Safari/Android) `wordRange` stays null through a whole page and nothing throws;
  a boundary event arriving after a `pageKey` change is ignored by the `runId` guard;
  `charLength: 0` is ignored rather than producing a zero-width span.
- `BookSpread.test.tsx` — a `narration-word` span renders inside the active
  `narration-highlight` span when `wordRange` is set, and is absent when it is null.
- Wire-shape assertion required: **no**.

**Manual verify:** **one look on a platform that emits word boundaries** (desktop Chrome
or Edge) before leaving the enhancement enabled. This is the one thing in the task a fake
cannot tell you. Non-blocking for task completion; flag it in the hand-back with the kill
switch named.

**Done when:** listed tests pass, `cd client && npm test` green, `npx tsc --noEmit` clean,
and Task 7's specs still pass (sentence-level assertions must be unaffected).

---

### Task 7 — E2E: fake-speech injection, desktop spec, mobile × theme spec

**Status:** Not started

**Zone:** e2e
**Depends on:** Task 5
**Parallel-safe with:** Task 6 (re-run after 6 lands), Task 8

**Files to add or change:**
- `e2e/tests/_speech.ts` — new; shared, used by both the desktop and mobile specs.
- `e2e/tests/narration.spec.ts` — new; `chromium` project.
- `e2e/tests/mobile/narration.spec.ts` — new; `mobile-pixel` + `mobile-small`.

Note the file placement: `_speech.ts` sits in `e2e/tests/`, not `e2e/tests/mobile/`, since
both projects import it. `playwright.config.ts` narrows `testMatch` to `*.spec.ts`, so a
bare `.ts` helper is not picked up as a test file — the same reason
`e2e/tests/mobile/_helpers.ts` is safe. **No config change is needed for this task**;
if you find yourself editing `playwright.config.ts`, stop and re-check.

**Signatures / shapes:**

```ts
// e2e/tests/_speech.ts
import type { Page } from '@playwright/test';

export interface FakeSpeechOptions {
  voices?: { voiceURI: string; name: string; lang: string; localService: boolean }[];
  emitWordBoundary?: boolean;
  /** Wall-clock ms per utterance. Keep small — the whole book is read in real time. */
  chunkMs?: number;
}

/** Installs a deterministic window.speechSynthesis via addInitScript, before app scripts run. */
export async function installFakeSpeech(page: Page, opts?: FakeSpeechOptions): Promise<void>;

/** Deletes window.speechSynthesis entirely — drives the 'unavailable' path. */
export async function installNoSpeech(page: Page): Promise<void>;
```

**Why this exists, and it must be said in the file's doc comment:** headless Chromium has
no speech engine. `getVoices()` returns `[]` and `speak()` produces no reliable events, so
without injection every narration assertion would be vacuous. **These specs prove the
state machine and the UI, not that anything is audible.** Audibility is the manual listen
in the spec's autonomy ledger.

Both must be called **before** `page.goto` — `addInitScript` runs per navigation, and
`forEachTheme` reloads, so the fake must survive a reload (it will, since `addInitScript`
re-runs).

`e2e/tests/narration.spec.ts` (desktop), against the seeded `/book/luna-star-garden`
fixture used by `mobile/reader.spec.ts`:
1. Player is visible with `role="group"` name "Read aloud".
2. Play → a `narration-highlight` span appears; the page-turn chevrons still work.
3. The highlight advances to a second sentence without any further interaction.
4. After the final chunk of a page, `spread-position` advances by one page on its own —
   the auto-advance assertion.
5. Click **Next spread** mid-playback → the highlight clears and no *further* auto-advance
   occurs from the abandoned page (the user-visible face of the `runId` guard).
6. Pause → the highlight stops advancing; Play → it resumes from the same sentence.
7. `installNoSpeech` → the "Read-aloud isn't available in this browser." copy renders and
   the transport controls are disabled.

`e2e/tests/mobile/narration.spec.ts`, wrapped in `forEachTheme` and running under both
mobile projects:
1. `expectNoHorizontalOverflow(page)` with the player mounted and the settings `<details>`
   both closed and open — the open panel is the realistic overflow risk.
2. `expectTapTargets(page, '[data-testid="narration-player"] button, [data-testid="narration-player"] select', PRIMARY_TAP_MIN)`.
3. Exactly **one** `narration-player` in the DOM (the duplicate-accessible-name fence that
   `mobile/reader.spec.ts` established for the chevrons).
4. **The player is not bottom-fixed** — assert
   `getComputedStyle(el).position !== 'fixed'`, with a comment naming the invariant
   ("`UpdateToast` is the app's only bottom-fixed surface") so a future sticky change has
   to consciously delete this rather than silently ship an occlusion bug.
5. Play → highlight appears → auto-advance turns the page, at 360 px and 393 px, in both
   themes.
6. The single-page-mode fences still hold with the player mounted: `book-page-panel` has
   count 1, and `Next spread` / `Previous spread` each resolve to exactly one element.

Use `chunkMs` small (~150 ms) and set an explicit `test.setTimeout` — `mobile/reader.spec.ts`
uses 90 s for two themed read-throughs and this spec does more per theme.

**Tests to write:** the two spec files above are themselves the tests.
- Wire-shape assertion required: **no** — no server route is involved.

**Manual verify:** this task **is** the mechanical discharge of CLAUDE.md done-criterion
#2 for the whole feature. State that explicitly in the hand-back.

**Done when:** `cd e2e && npm test` is green across `chromium`, `mobile-pixel`, and
`mobile-small`, with the pre-existing suites unchanged and unskipped.

---

### Task 8 — Reconcile the roadmap; record the fake-speech test pattern

**Status:** Not started

**Zone:** docs
**Depends on:** none
**Parallel-safe with:** all

**Files to add or change:**
- `.code-captain/product/roadmap.md` — rewrite line 176.
- `docs/conventions/client.md` — a short note under "When adding a new component".

Roadmap line 176 currently reads:

> **Read-aloud narration** via OpenAI TTS or ElevenLabs; cache audio per page like illustrations.

Replace it with a two-part entry: read-aloud **shipped** on device TTS
(`.code-captain/specs/read-aloud/spec.md`), and generated/premium audio **deferred** with
a pointer to that spec's trigger list. Keep the "cache audio per page like illustrations"
phrasing on the deferred half — it is the right instinct and the deferred design mirrors
`IllustrationVersion` deliberately. A future reader must not implement the roadmap version
by mistake, nor conclude narration is unbuilt.

`docs/conventions/client.md` gains ~6 lines: browser device APIs absent from jsdom
(`speechSynthesis` today) get an installable fake in `client/src/test/`, installed **per
test file, never globally in `setup.ts`**, because the API-absent path is itself a state
worth testing. Reference `client/src/test/fakeSpeech.ts` as the pattern. Do not restate
anything already in the spec.

**Tests to write:** none — documentation only. Root `npm test` (harness) must stay green,
since it validates cross-reference conventions.

**Manual verify:** none.

**Done when:** both edits are in place, root `npm test` green, and no other doc still
describes read-aloud as unbuilt.

---

### Task 9 — Pre-merge follow-ups

**Status:** Not started

**Zone:** docs (harness)
**Depends on:** none (run last)
**Parallel-safe with:** all

The spec's ADR-worthy list is non-empty, so this task is required.

For each of the eight items under `## ADR-worthy decisions` in
[spec.md](spec.md), ensure exactly **one** tracking action exists — a matching ADR in
`.code-captain/product/decisions.md`, a linked GitHub issue, or an explicit `Deferred:`
line with reasoning.

Suggested grouping, following the ADR-004 / ADR-006 / ADR-007 / ADR-008 precedent of one
bundled ADR per feature with numbered decisions:

- **One ADR — "Read-aloud narration: device TTS, sentence highlighting, and the deferred
  generated-audio seam"** — bundling decisions 1–7 (device TTS + trigger list; sentence
  vs. word highlighting; page-index-as-master; the one-implementation provider seam; the
  in-flow player / bottom-fixed-surface invariant; client-local preference storage; the
  fake-synth test substrate). Each decision names its trade-off, per the house style.
- **The `Deferred:` item** (item 8) is already an explicit deferral with reasoning in the
  spec; confirm the skill reads it as tracked and do not duplicate it into an ADR.

Two additional follow-ups to record while here:

- **Open a backlog issue** for read-aloud under the Tier 2 Storefront milestone — there is
  none today, and the spec's Backlog line says so. Link it back to the spec.
- **Carry the three manual checks into the PR body** as an explicit outstanding list
  (desktop pacing listen, iPhone screen-lock listen, word-highlight look). They are
  deliberately not in any task's "Done when". The iPhone check is **not** blocked on #77.

**Done when:** `adr-tracking-check read-aloud` reports zero orphaned items.

## Sequencing notes

- **Rebase onto `agent/feat/mobile-pwa` before Task 1**, not after Task 5. See §"Branch
  base".
- **Tasks 1 → 2 → 3 → 4 → 5 are a strict chain.** Each consumes the previous one's exported
  types. There is no useful parallelism inside the chain, and trying to build the player
  before the hook's result shape exists just means writing it twice.
- **Tasks 6, 7, 8 fan out from Task 5.** Task 8 (docs) is parallel-safe with everything and
  is the natural filler while the chain runs.
- **Task 6 before Task 7 if you want one e2e run**; Task 7 before Task 6 if you want the
  sentence-level baseline fenced before touching it. Either order works — the second option
  is safer and is the recommended one, since it means Task 6 has a regression fence to
  break.
- **Commit boundaries.** Tasks 1–3 are a coherent "narration engine, no UI" commit and
  could ship as one PR that changes nothing user-visible — worth doing if review bandwidth
  is tight, since it is the highest-logic, lowest-risk half. Tasks 4–7 are the user-visible
  half. Task 8 can ride with either.
- **One PR or two is a judgement call**; if one, the PR body must record the spec link,
  agent ownership, and the three outstanding manual checks (CLAUDE.md).

## Open questions

Genuinely open — resolve before or during the task that hits them. ADR-worthy decisions
are **not** listed here; they belong to Task 9.

1. **Should the cover spread narrate at all?** The design has Play on the cover read
   `"{title}. By {author}."` then advance, so one Play press reads the whole book. The
   alternative is that Play on the cover jumps straight to page 1. The current choice is
   more book-like; the alternative is faster. Cheap to change in Task 5 (one ternary).
2. **`AUTO_ADVANCE_DELAY_MS = 400`** is a guess that needs one real listen. Named as a
   single exported constant precisely so tuning is a one-line change.
3. **Should the sentence spans be clickable at all on mobile?** A tap-to-seek target that
   is also the body text may cause accidental seeks while scrolling. The Previous/Next
   sentence buttons already cover the need. If it feels wrong on a phone, gate the
   `onClick` behind `!isNarrow` — the accessible path is unaffected either way.
4. **Does the settings `<details>` want to be open by default on desktop?** Closed
   everywhere buys one DOM shape and predictable e2e; the cost is one extra desktop click
   to change voice. If a reviewer objects, `open={!isNarrow}` is the change, and Task 7's
   assertions must then cover both states.
5. **Should narration reach the legacy Reader view** (`viewMode === 'reader'`)? Out of
   scope by design, and `useNarration` is host-agnostic so it is a small follow-on — but
   two UI hosts double the verification surface. Decide after seeing whether anyone uses
   Reader view at all.
