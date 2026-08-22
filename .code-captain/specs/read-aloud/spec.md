# Read-aloud narration ("Read to me") — phase 1, device TTS

> Status: Draft
> Last updated: 2026-08-16
> Architect: Claude Opus 5 via @architect on 2026-08-16
> Supersedes (for phase 1): `.code-captain/product/roadmap.md:176` — "Read-aloud narration via OpenAI TTS or ElevenLabs; cache audio per page like illustrations." That line describes the **deferred** generated-audio path, not what ships here. See §"Reconciling the roadmap".
> Related: `docs/mobile-strategy-research.md:93` (background audio is a native-only capability), `docs/marketing-research.md:22-23` (Childbook.ai and StoryBee already ship narration), `.code-captain/specs/mobile-pwa/spec.md` (this merges on top of it)
> Backlog: no issue yet — one should be opened under the Tier 2 Storefront milestone (see Task 9)

## Problem

A children's book that cannot be read *to* a child is only half a product. Every session
today requires a literate adult holding the device; the target reader — a 3-to-8-year-old
— cannot consume the thing we sell them without a parent narrating. Two of the AI-native
competitors in `docs/marketing-research.md` (Childbook.ai, StoryBee) already bundle
text-to-speech, and StoryBee's entire positioning is "AI bedtime stories, audio
narration". Narration is also the single highest-leverage accessibility feature the
storefront could add: it serves pre-readers, dyslexic readers, and low-vision readers
from the same code path.

The gap is not "we have no audio API". It is that nothing in the product knows how to
turn `Page.text` into a paced, followable reading experience — chunking, highlighting,
page advancement, and a control surface that works on a 360 px phone and a desktop
two-page spread alike. That coordination is the work; the speech synthesis itself is a
browser primitive we already have for free.

## Constraints

- **Phase 1 is device TTS (Web Speech API) only — user decision, not open for
  re-litigation.** No paid external API, no server-generated audio, no `COST_CENTS`
  entry, no `spendGate` mount, no new Prisma model, no new npm dependency. Nothing in
  this design requires any of them; §"What phase 1 deliberately does not add" states
  each one explicitly so a future reader knows it was considered rather than forgotten.
- **Narration is a capability of a book the user can already read.** No audiobook SKU,
  no `OrderItem` line, no entitlement check, no `CartItem` change. Anyone who can open
  `/book/:id` can press Play. That is the same gate the page text itself has today.
- **No server routes change**, so the OPS.3 wire-shape obligation **does not attach** to
  this spec. No new schema in `@storybook/shared` either — narration preferences never
  cross the network (see §"Schema / contract changes"). If any task finds itself editing
  `server/src/routes/**`, `server/prisma/schema.prisma`, or `shared/src/**`, **stop and
  hand back to the architect** — that changes the risk profile.
- **Merges on top of `agent/feat/mobile-pwa` (Tasks 1–5 done, Task 6 in flight).** That
  work is a hard input, not a parallel concern:
  - `BookSpread.tsx` has a single-page mode below `md` gated on
    `useMediaQuery('(max-width: 767px)')`. Narration UI must work in **both** the
    two-column spread and the single-panel mobile layout, and must not introduce a
    second breakpoint.
  - `UpdateToast.tsx` is bottom-anchored (`fixed inset-x-3 bottom-3 z-50`). Collision
    is resolved by design, not by z-index tuning — see §"Where the controls live".
  - A service worker now precaches the app shell. Any offline claim must be honest
    about what device TTS does and does not do offline.
  - `e2e/tests/mobile/_helpers.ts` (`expectNoHorizontalOverflow`, `expectTapTargets`,
    `forEachTheme`, `PRIMARY_TAP_MIN` = 44) and the `chromium` / `mobile-pixel` /
    `mobile-small` / `pwa` projects exist. This spec **uses** that harness as the
    mechanical discharge of CLAUDE.md done-criterion #2.
- **Dark-mode parity** on every new surface and every state (default, hover,
  focus-visible, disabled, open/closed disclosure, highlighted text).
- **Cart/auth session model is untouched.** Narration adds one new, separately-named
  localStorage key and never reads, writes, or reinterprets `storybook-session` or
  `storybook-auth`.
- **TypeScript strict, no `any`.** `SpeechSynthesis`, `SpeechSynthesisUtterance`,
  `SpeechSynthesisVoice` and `SpeechSynthesisEvent` are all in `lib.dom.d.ts` — no
  `@types` package is needed.

## Proposed shape

### The one-sentence version

A page's text is split into sentence-sized chunks; the whole current page is queued into
`speechSynthesis` in a single user-gesture-initiated burst; per-utterance `start`/`end`
events drive a sentence highlight and, at the end of the last chunk, a request to turn
the page. A `NarrationPlayer` bar sits in flow beneath the book frame at every
breakpoint. All of it talks to one narrow `NarrationProvider` interface with exactly one
implementation.

### Playback model — the page index is the master, audio is the follower

The most consequential decision here is directional. **Page turns drive audio; audio
never owns the page index.** Narration may *request* a page turn (`onRequestNext()`), and
the host decides whether to honour it. This is one-directional, so there is no
reconciliation logic and no state that can disagree with itself.

Concretely:

- **Playback is continuous with auto-advance**, defaulting on. A bedtime story is a
  continuous experience; per-page-only playback would require an adult to tap Next
  every twenty seconds, which defeats the purpose of the feature.
- **When the last chunk of a page ends**, if playback is still `playing` *and* the page
  index has not changed since that chunk started, the hook calls `onRequestNext()`. The
  host advances, which re-arms narration on the new page from chunk 0.
- **When the reader manually navigates mid-sentence**, `speechSynthesis.cancel()` fires
  immediately — before the new page paints. Leaving the previous page's audio running
  under a new illustration is the worst available outcome and the one we design hardest
  against. If playback was `playing`, narration restarts at chunk 0 of the new page. If
  it was `paused` or `idle`, it stays stopped and the highlight simply clears.
- **The stale-callback guard is the load-bearing correctness detail.** `cancel()` still
  fires `end` (or `error` with `error: 'canceled'`) on the in-flight utterance,
  asynchronously, after the new page has already mounted. Every handler therefore
  captures a monotonically increasing `runId` and returns immediately if
  `runId !== currentRunIdRef.current`. Without it, a fast double-tap on Next produces a
  spurious auto-advance and a highlight on the wrong page. This is unit-testable with
  the fake synth and is explicitly asserted.
- **Cover and end spreads participate.** Pressing Play on the cover reads
  `"{title}. By {author}."` then advances. The end spread reads `"The End."` and stops
  (never requests a further advance). A book therefore reads front-to-back from a single
  Play press.

### Chunking — required for correctness, and it pays for the highlight

Desktop Chrome silently truncates a single utterance at roughly 15 seconds / 200–250
characters and can wedge the whole synthesis queue doing it
([chromium#41346274](https://issues.chromium.org/issues/41346274)). Chunking is not an
optimisation, it is the fix. `splitIntoUtterances()` splits page text on sentence
terminators and hard-splits any remaining run over `MAX_CHUNK_CHARS` (200) at the last
word boundary, returning offsets into the original string:

```ts
interface NarrationChunk { text: string; start: number; end: number }  // [start, end)
```

Those offsets are what let the renderer highlight a sentence without re-deriving
anything, and they are why the chunker is a pure function with its own test file rather
than logic buried in a hook.

**All chunks for the current page are queued in one `speak()` burst**, inside the user's
Play gesture. `speechSynthesis` maintains its own FIFO queue, so this is a single
gesture-initiated session rather than N scheduled calls. That matters most on iOS Safari,
which rejects `speak()` outside a user gesture — queueing up front removes the gesture
problem entirely *within* a page. (Cross-page advancement still calls `speak()` from an
`end` handler; see §"iOS Safari, honestly".)

### Highlighting — sentence-level, and why not word-level

**Phase 1 highlights the sentence currently being spoken.** Word-level "karaoke"
highlighting is built as a progressive enhancement that self-activates only where the
platform actually supports it, and is off everywhere else.

The reasoning is platform reality, not effort:

- Sentence highlighting is driven by *which queued utterance is speaking* — the `start`
  and `end` events, which are universally supported. It is deterministic and it works on
  every engine, including ones that emit no `boundary` events at all.
- Word highlighting requires `boundary` events with `name === 'word'`. Those are **not
  Baseline**: Safari emits `boundary` at *sentence* granularity, and Android Chrome does
  not fire it at all
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/onboundary)).
  Building the flagship early-reader feature on `boundary` means it works on the desktop
  browsers we develop in and silently does nothing on the iPad and Android tablet that
  children actually hold.

So the state shape carries both from day one and the renderer degrades cleanly:

```ts
interface NarrationPosition { chunkIndex: number; wordRange: { start: number; end: number } | null }
```

`wordRange` is `null` unless a `boundary` event with word granularity has actually been
observed for the current voice. That makes word highlighting a data addition rather than
a rewrite, and it makes "did it activate?" an observable fact rather than a browser-chart
guess.

### Where the controls live

One component, `<NarrationPlayer>`, **in normal document flow at every breakpoint**,
rendered immediately below the book frame and above the existing footer strip (dots /
position / theater toggle). It reuses `BookSpread`'s existing `NARROW_QUERY` media query
for its internal layout — no second breakpoint is introduced.

| | Desktop (≥ md) | Mobile (< md) |
|---|---|---|
| Position | Below the two-column frame, above the footer strip | Below the 48 px page-turn chevron row |
| Transport row | Previous sentence · Play/Pause · Next sentence · Stop | Same four, `min-h-11 min-w-11`, evenly spaced |
| Settings | `<details>` disclosure: voice, speed, auto-advance | Same `<details>`, stacked |

**Why in flow rather than sticky, and how the `UpdateToast` collision is resolved.**
`UpdateToast` is `fixed inset-x-3 bottom-3 z-50` and is the app's only bottom-fixed
surface. A sticky narration bar would sit in the same 60 px of screen and the two would
overlap on exactly the phone viewport where both matter. Rather than tune z-indices, the
player is in flow and the invariant is stated: **`UpdateToast` remains the only
bottom-fixed surface in the app.** Task 7 pins this with a computed-style assertion
(`position !== 'fixed'` on the player) so a later "let's make it sticky" change fails
loudly and has to re-open the question instead of shipping an occlusion bug. If a sticky
variant is ever wanted, the required change is recorded in §Alternatives.

**One DOM shape at all breakpoints.** The mobile reader spec
(`e2e/tests/mobile/reader.spec.ts`) exists partly because duplicating page-turn controls
across breakpoints created ambiguous accessible names. The player does not repeat that
mistake: the same nodes render everywhere, with Tailwind variants changing only spacing
and stacking. The `<details>` panel is closed by default on desktop too — costing desktop
one extra click to change voice — specifically to avoid a second DOM shape.

### Controls, and the honest answer to "scrub"

**There is no scrub bar, because there is nothing to scrub.** The Web Speech API exposes
no seek and no playback position; `pause()`/`resume()` plus utterance boundaries are the
entire granularity available. Pretending otherwise would mean a progress bar that cannot
be dragged.

The equivalent affordance is **sentence stepping**: Previous sentence / Next sentence
buttons cancel and re-queue from `chunkIndex ∓ 1`. This is the accessible, keyboard-
native, 44 px-tappable path. **Additionally**, each rendered sentence span responds to
click/tap to start from there — a redundant pointer convenience layered on top of an
existing accessible control, which is why the spans stay plain `<span>` elements with no
`role="button"` and no `tabIndex`. Turning a paragraph of story text into eight tab stops
that VoiceOver announces as "button" would wreck the primary reading experience to
duplicate a control the player already offers.

Other control decisions:

- **Speed** is a native `<select>` (0.75× / 1× / 1.25× / 1.5×), not a slider. A slider is
  a poor tap target, and `rate` below ~0.75 sounds slurred on most engines rather than
  slower. A native select gets the system picker on mobile and correct semantics for free.
- **Voice** is a native `<select>`, sorted `localService` first then by name.
- **Auto-advance** is a labelled checkbox inside the settings disclosure, default on.
- **No progress bar.** The highlight *is* the progress indicator. A second one is noise.
- **No global keyboard shortcuts in phase 1.** `BookSpread` has no keydown handling
  today, Space would fight page scroll, and a shortcut layer raises focus-scope questions
  the feature does not need. If keyboard page-turning is added later, narration shortcuts
  belong in that same handler — not bolted on here.

### Voice selection — the messiest part of the API

`speechSynthesis.getVoices()` returns `[]` on first call in Chrome and populates
asynchronously; Safari populates lazily on first `speak()`; some Linux and headless
environments never populate at all. `useVoices()` therefore resolves to one of three
states rather than assuming success:

```ts
type VoiceStatus = 'loading' | 'ready' | 'unavailable';
```

It reads `getVoices()` immediately, subscribes to `voiceschanged`, and falls to
`'unavailable'` after a 2000 ms timeout rather than spinning forever. Default selection is
ordered, and the order is the design:

1. The persisted `voiceURI` from `localStorage['storybook-narration']`, **if still present
   in the current list** (voices disappear across OS updates and devices).
2. A voice matching `navigator.language` with `localService === true`. Local voices need
   no network, work offline in the PWA, and are the higher-quality option on Apple
   platforms.
3. Any voice whose `lang` starts with the document language prefix (`en`).
4. The voice flagged `default: true`.
5. `voices[0]`.
6. None → `'unavailable'`.

**No hand-maintained allow/deny list of voice names.** That is a maintenance trap across
OS versions and locales.

**When no usable voice exists** — or `'speechSynthesis' in window` is false — the player
renders an inert, explained state: the transport controls are `disabled` with an
`aria-disabled` and a single line of text, "Read-aloud isn't available in this browser."
It is not an error toast and not a hidden component. A play button that silently does
nothing is worse than an honest disabled one, and hiding the feature entirely leaves the
user unable to tell whether the product has it.

### iOS Safari, honestly

Three real limitations, stated here rather than discovered in QA:

1. **`speak()` requires a user gesture.** Mitigated structurally: the whole page is queued
   inside the Play gesture, so within a page there is no non-gesture `speak()` at all.
2. **Cross-page auto-advance calls `speak()` from an `end` handler**, which is not a
   gesture. In practice an already-warm synthesis session usually continues, but this is
   the fragile seam. Mitigation is a **watchdog**: if no `start` event arrives within
   1500 ms of the auto-advance `speak()`, narration drops to `paused` and surfaces
   "Tap play to continue" rather than appearing frozen. Degraded, but never mysterious.
3. **Audio stops when the tab backgrounds or the screen locks.** This is exactly the
   bedtime-story case — a child sets the phone down, the screen locks, the story stops.
   There is no fix within Web Speech: it produces no `<audio>` element and no
   `MediaStream`, so Media Session API and background audio are simply unreachable.
   `docs/mobile-strategy-research.md:93` already flagged background audio for read-aloud
   as a native-only capability; that constraint is now live.

**Is degraded-but-honest acceptable for phase 1?** Yes — with a `visibilitychange`
handler that pauses cleanly and preserves `chunkIndex`, so returning to the tab shows a
Play button that resumes where it stopped rather than a dead player. What is *not*
acceptable is claiming lock-screen playback we cannot deliver.

**This is trigger #1 for the deferred generated-audio path.** If lock-screen playback
becomes a requirement rather than a nice-to-have, the answer is not a Web Speech
workaround — there isn't one — it is real audio files.

### "Standalone or paired" — our interpretation, stated explicitly

The request was narration "as a standalone or with pdf/book & illustrations". Audio
cannot be embedded in the PDF we generate, so a literal reading is not buildable. Our
interpretation, three parts:

1. **Paired with the book and illustrations — this is phase 1's core.** The player lives
   inside the reader; audio, the highlighted sentence, and the page illustration advance
   together. This is what "read to me" means to a parent.
2. **Standalone listening — delivered as a behaviour, not a separate mode.** Continuous
   auto-advance already produces hands-free playback: one Play press reads the book
   front-to-back while illustrations turn themselves. Combined with the existing theater
   mode (ADR-004) that is a lights-down listening experience today. A dedicated "Listen"
   preset (chrome hidden, illustration full-bleed) is **named but out of scope** — it is
   presentation, and it should be designed after we see whether anyone uses auto-advance.
3. **Paired with the PDF — reinterpreted, and the reinterpretation matters.** Audio
   cannot go inside a PDF, and more fundamentally **device TTS cannot produce a file at
   all**: the Web Speech API has no capture path, so there is no artifact to bundle,
   download, email, or put on a car stereo. What phase 1 delivers is "one book you own,
   two delivery modes — download it as a PDF, or have it read to you in the app." A real
   audio *artifact* — an "audiobook" bundled with the PDF export — is **only** reachable
   via the deferred generated-audio path. That is trigger #2, and it is the one most
   likely to come from a customer rather than an engineer.

### Accessibility

This is an accessibility feature, so the accessibility of the feature itself has to be
better than average.

- **Do not double-speak.** A screen reader may already be reading the page. The
  highlighted sentence is **never** placed in an `aria-live` region — that would produce
  two voices reading the same words. The only live region is a visually-hidden
  `role="status" aria-live="polite"` that announces terse state transitions only:
  "Reading page 3", "Paused", "Finished".
- **Highlight with `<span>`, never `<mark>`.** VoiceOver announces `<mark>` as
  "highlighted", injecting a word into the middle of every sentence. A styled `<span>`
  carries the same visual meaning with no semantic noise. Inline spans inside the
  existing `<p>` do not fragment the accessible text computation.
- **Focus is never moved programmatically.** Not on Play, not on auto page-advance, not
  on stop. Content changes under the user in this component; stealing focus on top of
  that is disorienting.
- **Every control is a real `<button>` or native form control**, so Tab / Enter / Space
  work without a key handler. Icon-only buttons get `aria-label` per client conventions
  (the e2e suite selects by role + name). Play/Pause uses a single button with
  `aria-pressed` and a name that changes between "Play" and "Pause".
- **Both `<select>`s get real labels** (visually hidden), and the disclosure `<summary>`
  is a real summary, not a div with a click handler.
- **`prefers-reduced-motion`** — the highlight uses `motion-safe:transition-colors` so it
  snaps rather than fades for users who asked for that.
- **Tap targets** — every interactive element in the player clears
  `PRIMARY_TAP_MIN` (44) under both mobile projects, asserted by `expectTapTargets`.

### Schema / contract changes

**Server:** none. No route added, changed, or removed. No Prisma migration. No
`COST_CENTS` entry. No `spendGate` mount. **No new/changed route response ⇒ the OPS.3
wire-shape obligation does not attach to this spec.**

**`@storybook/shared`:** no new schemas. `Page.text` already carries everything narration
consumes, and narration preferences never cross the network — putting a client-local
preference shape in `shared/` would dilute what that package means (cross-network
contracts). The preference blob is validated with a hand-written type guard instead,
which also avoids adding `zod` as a direct `client/` dependency (it is not one today).

**New localStorage key** — one key, namespaced, additive:

```ts
// client/src/lib/narration/prefs.ts
const NARRATION_PREFS_KEY = 'storybook-narration';

interface NarrationPrefs {
  voiceURI: string | null;   // matched against the live voice list; ignored if absent
  rate: number;              // clamped to [0.75, 1.5]
  autoAdvance: boolean;
}

export function readPrefs(): NarrationPrefs;   // never throws; returns defaults on any parse failure
export function writePrefs(prefs: NarrationPrefs): void;
```

`readPrefs` returns defaults on missing, malformed, or out-of-range values — a
hand-edited or stale blob must not be able to break the reader. This module **never**
touches `storybook-session`, `storybook-auth`, `storybook-theme`, or
`storybook-cart-cache`.

**Client-internal types** (no wire exposure):

```ts
// client/src/lib/narration/types.ts
export interface NarrationChunk { text: string; start: number; end: number }
export interface NarrationVoice { uri: string; name: string; lang: string; localService: boolean }
export type NarrationState = 'idle' | 'playing' | 'paused' | 'unavailable';
export interface NarrationPosition { chunkIndex: number; wordRange: { start: number; end: number } | null }
```

### The deferred generated-audio seam

The seam is one interface in one file, with exactly one implementation. It is **not** a
provider registry, a factory, a DI container, or a feature flag. This mirrors the
optionality-preserving move at `docs/backlog.md:51` (Zod schemas forward-compatible with
OpenAPI, `zod-to-openapi` deferred until a concrete trigger): no work today, just don't
foreclose it.

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

export interface NarrationProvider {
  readonly id: 'device';                    // future: | 'generated'
  isAvailable(): boolean;
  listVoices(): NarrationVoice[];
  speak(
    chunks: NarrationChunk[],
    opts: { voiceURI: string | null; rate: number; fromChunk: number },
    events: NarrationEvents,
  ): NarrationHandle;
}

export const deviceProvider: NarrationProvider = { /* ... */ };
```

`useNarration` imports `deviceProvider` directly and talks only through
`NarrationProvider`. A future generated-audio provider returns a handle backed by an
`<audio>` element, fires `onChunkStart`/`onChunkEnd` from `timeupdate` against a
per-chunk timing map, and — critically — can register with the Media Session API for
lock-screen playback. Nothing in the hook or the player changes.

**Cost of the seam today:** one extra file and one indirection between the hook and
`window.speechSynthesis`. That is the honest price, and it is small enough that it is
worth paying even if the trigger never fires — the interface also happens to be what
makes the hook testable against a fake.

**Triggers to revisit — this list matters more than the abstraction:**

1. **Lock-screen / background playback becomes a requirement.** The bedtime case. Only
   real audio files plus Media Session can do it. Most likely trigger.
2. **Someone asks for an audio artifact** — an audiobook file, "pair it with the PDF
   download", "send it to grandma", play it in a car. Web Speech produces no file, at
   all. Hard blocker, no workaround.
3. **Voice quality becomes a complaint.** Device voices differ per OS, so the same book
   sounds like a different product on every device. Accents, character voices, and a
   consistent brand voice all require generated audio.
4. **A locale or platform we sell into has no usable local voice**, turning the
   "unavailable" state from an edge case into a support burden.
5. **A paid tier needs a differentiator.** Marketing research shows competitors already
   bundle narration; premium voices are the cheapest upsell to bolt onto this seam.
6. **Uniform offline narration.** Device TTS already works offline for `localService`
   voices, which argues *for* staying — but it is per-device luck, and cached generated
   audio would be uniform.

**If a trigger fires, the deferred design is already sketched** (build none of it now):
a `NarrationAudio` Prisma model mirroring `IllustrationVersion`
(`book_id`, `page_number`, `voice_id`, `url`, `created_at`,
`@@unique([book_id, page_number, voice_id])`), a `POST /api/books/:id/narrate` route
mounted `requireAuth → spendGate('narration') → validate → handler` with a
`COST_CENTS.narration` entry and a `recordUsage()` call, cached per page exactly like
illustrations. Note that this is the point at which every deferred cost lands at once —
spend gating, a migration, a wire shape, and an OPS.3 obligation — which is precisely why
phase 1 avoids taking on any of it speculatively.

### What phase 1 deliberately does not add

Recorded so a future reader knows each was considered, not overlooked:

- **No `COST_CENTS` entry.** `COST_CENTS` is `{ story: 6, illustration: 4, cover: 4 }` and
  stays that way. Device TTS costs zero cents and makes zero network calls; a cost-table
  entry for it would be a lie that makes the caps *less* accurate, not more.
- **No `spendGate` mount and no new route.** There is no paid operation and no endpoint
  to gate. The spend-exposure risk this project has hit before requires a route that
  calls a paid API; this feature has neither.
- **No Prisma model and no migration.** Nothing is persisted server-side. The only new
  state is a client preference blob.
- **No new npm dependency.** Web Speech API and its TypeScript types ship with the
  platform.

### Data flow

```
Play pressed (user gesture)
  → useNarration: runId++, chunks = splitIntoUtterances(page.text)
  → deviceProvider.speak(chunks, { voiceURI, rate, fromChunk: 0 }, events)
       → window.speechSynthesis.speak(u0..uN)      [one burst, inside the gesture]
  → onChunkStart(i)  → setPosition({ chunkIndex: i, wordRange: null })
                     → StoryText renders span i highlighted
  → onWordBoundary(i, c, len)  → setPosition({ chunkIndex: i, wordRange: {...} })   [if supported]
  → onChunkEnd(N)    → onDone()
  → onDone: if (runId is current && state === 'playing' && autoAdvance) onRequestNext()
       → BookSpread.turnPage('next') → spreadIndex changes → effect re-arms narration
       → watchdog: no onChunkStart within 1500ms ⇒ state = 'paused', hint = 'tap-to-continue'

Manual Next/Prev pressed
  → BookSpread.turnPage() → spreadIndex changes
  → effect: handle.cancel(); runId++;  if (state === 'playing') speak(newChunks, fromChunk: 0)
                                       else setPosition(null)

Tab hidden / screen locks
  → visibilitychange → if playing: handle.pause(); state = 'paused'   (chunkIndex preserved)

Unmount / route change
  → handle.cancel()   (an uncancelled utterance keeps talking over the next page)
```

State lives in `useNarration` (playback + position) and `readPrefs()`/`writePrefs()`
(voice, rate, auto-advance). Nothing narration-related enters `CartContext`,
`AuthContext`, or the URL. In particular, narration is **not** put in the URL the way
`?theater=1` is (ADR-004 decision 1): playback is a transient device-local activity, not a
bookmarkable view state, and ADR-004 already flags URL-param accumulation as its own
trade-off.

### Files likely touched

**client — narration library (all new)**
- `client/src/lib/narration/types.ts` — shared client-internal types.
- `client/src/lib/narration/chunk.ts` — `splitIntoUtterances`, pure.
- `client/src/lib/narration/prefs.ts` — localStorage read/write + validation.
- `client/src/lib/narration/provider.ts` — the `NarrationProvider` seam.
- `client/src/lib/narration/deviceProvider.ts` — the only implementation.
- `client/src/hooks/useVoices.ts` — async voice list + status + default pick.
- `client/src/hooks/useNarration.ts` — the playback state machine.

**client — UI**
- `client/src/components/NarrationPlayer.tsx` — new; the control bar.
- `client/src/components/BookSpread.tsx` — mount the player; pass highlight state into
  `StoryText`; wire `onRequestNext` to the existing `turnPage('next')`; cancel on
  navigation and unmount. **Additive only** — no change to desktop spread structure or
  ADR-004 theater behaviour.

**client — tests**
- `client/src/test/fakeSpeech.ts` — new; installable fake `speechSynthesis`.
- `client/src/lib/narration/__tests__/chunk.test.ts`
- `client/src/lib/narration/__tests__/prefs.test.ts`
- `client/src/lib/narration/__tests__/deviceProvider.test.ts`
- `client/src/hooks/__tests__/useVoices.test.ts`
- `client/src/hooks/__tests__/useNarration.test.tsx`
- `client/src/components/__tests__/NarrationPlayer.test.tsx`
- `client/src/components/__tests__/BookSpread.test.tsx` — extend for narration mounting.

**e2e**
- `e2e/tests/_speech.ts` — new; `installFakeSpeech` / `installNoSpeech` via `addInitScript`.
- `e2e/tests/narration.spec.ts` — new; desktop `chromium` project.
- `e2e/tests/mobile/narration.spec.ts` — new; `mobile-pixel` + `mobile-small`, both themes.

**docs**
- `.code-captain/product/roadmap.md` — reconcile line 176.
- `docs/conventions/client.md` — one short note on the fake-speech test pattern.
- `.code-captain/product/decisions.md` — ADRs from Task 9.

## Autonomy ledger

The honest per-task answer to "can `/execute-task` finish this without a human listening
to anything?" Narration has a sharper version of this problem than mobile-pwa did: the
machine can prove the *state machine* is correct, but no CI job can hear a voice.

| Task | Machine-verified | Genuinely needs a human |
|---|---|---|
| 1 — chunking + prefs | **Fully.** Pure functions, exhaustive unit tests. | No. |
| 2 — provider seam + device provider + voices | **Fully**, against the fake synth: queueing, cancel semantics, event mapping, voice-list async/timeout/default-pick ordering. | No — but note the fake is *our model* of the API, not the API. See "bottom line". |
| 3 — `useNarration` state machine | **Fully.** Every transition, the stale-`runId` guard, auto-advance request, watchdog timeout, visibilitychange pause, cancel-on-unmount. This is the highest-risk logic and it is fully deterministic under fake timers. | No. |
| 4 — `NarrationPlayer` | **Correctness, fully**: rendering, disabled/unavailable state, labels, prefs persistence, plus `dark-mode-parity-check` on the diff. | **Aesthetics only.** Whether the bar looks right under the book frame is a judgement call. Non-blocking. |
| 5 — wire into `BookSpread` | **Fully** at the behavioural level: highlight tracks the spoken chunk, auto-advance turns the page, manual nav cancels, cover/end handled, desktop spread and ADR-004 theater regression specs stay green. | **Yes, weakly.** Pacing — whether the page turns feel too eager after the last sentence — needs one real listen. Recommend before merge; do not block the task. |
| 6 — word-level highlight enhancement | **Fully** against a fake emitting word `boundary` events, and the *absence* path is asserted too (no boundary ⇒ sentence-only, no crash). | **Yes.** Whether word highlighting is actually in sync with a real voice cannot be faked. This task has a documented kill switch for exactly that reason. |
| 7 — e2e narration specs | **Fully.** Mobile × both themes via `forEachTheme`, tap targets, no overflow, not-fixed assertion, unavailable path. | No. |
| 8 — docs reconciliation | **Fully.** | No. |

**Bottom line, stated plainly.** Everything in this feature that is *logic* is fully
autonomous, and that is most of it. What CI cannot do is hear. Three things need a human
with a device and thirty seconds:

- **One real listen on desktop Chrome** — does it sound like a story, and is the
  auto-advance pacing right (Task 5)?
- **One real listen on an iPhone**, including locking the screen mid-story, to confirm the
  pause-and-resume degradation behaves as designed rather than dying silently
  (§"iOS Safari, honestly"). Note this does *not* need the deploy: Web Speech is not
  restricted to secure contexts, so a phone on the LAN pointed at the dev server is
  enough — #77 does not block it.
- **One look at word highlighting** on a platform that emits word boundaries, before
  leaving Task 6's enhancement enabled.

Everything else — including the entirety of CLAUDE.md done-criterion #2's light/dark
verification — is discharged mechanically by the `forEachTheme` harness from mobile-pwa
Task 1.

## Alternatives considered

### Playback model

#### Continuous with auto-advance, page index as master (proposed)

**Pros:** One-directional state, so no reconciliation. Delivers hands-free listening,
which is the actual use case. Manual navigation has one obvious correct behaviour.
**Cons:** Requires the stale-`runId` guard to be right, or fast navigation produces
phantom page turns.

#### Per-page playback, stops at the end of each page

**Pros:** Simplest possible state machine; no auto-advance, no watchdog, no cross-page
gesture problem on iOS.
**Cons:** An adult must tap Play once per page. For a 5-page book at bedtime that is
worse than just reading it aloud yourself — it fails the use case the feature exists for.
**Status:** rejected, but note the auto-advance toggle lets any user opt into exactly
this behaviour.

#### Audio owns the page index (audio drives, host follows)

**Pros:** Conceptually tidy for a pure listening mode.
**Cons:** Manual navigation then has to interrupt and re-seat the audio's notion of
position, and two sources of truth exist during the transition. `BookSpread` already owns
`spreadIndex`; inverting that would mean lifting page state out of `BookSpread` into
`BookDetail`, touching ADR-004-adjacent code and the desktop e2e fence for no user-visible
gain.
**Why rejected:** strictly more coupling for the same behaviour.

### Highlighting granularity

#### Sentence-level from the chunk queue, word-level as a self-activating enhancement (proposed)

**Pros:** Works on every engine because it is driven by `start`/`end`, which are
universal. Free — we chunk anyway for the Chrome cutoff. Word support becomes a data
addition, and whether it activated is observable rather than guessed.
**Cons:** On desktop Chrome, where word boundaries work well, the baseline experience is
coarser than it could be until Task 6 lands.

#### Word-level karaoke as the primary mechanism, built on `boundary`

**Pros:** The strongest early-reader experience, and the biggest visible differentiator
against Childbook.ai and StoryBee.
**Cons:** `boundary` is not Baseline. Safari fires it at sentence granularity; Android
Chrome does not fire it. The feature would work on the machines we develop on and do
nothing on the tablets children use — the worst possible failure distribution, because we
would never see it break.
**Why rejected (held as the enhancement path):** correct on some platforms is not a
foundation; it is a bonus. Task 6 delivers it *as* a bonus.

#### No highlighting at all — audio only

**Pros:** Least code; zero interaction with screen-reader semantics.
**Cons:** Discards most of the educational value. Following text while hearing it is the
mechanism by which read-aloud teaches reading.
**Why rejected:** the cheapest half of the feature's value is the half being dropped.

### Control placement

#### In-flow bar beneath the book frame at every breakpoint (proposed)

**Pros:** Zero z-index interaction with `UpdateToast`. One DOM shape, so no duplicate
accessible names. Cannot occlude the revise panel or the "The End" spread. Compatible
with ADR-004 theater mode without touching it.
**Cons:** On a short viewport the player can scroll out of view mid-story.

#### Sticky bottom bar on mobile

**Pros:** The app-like choice; Play is always reachable; matches how music apps behave.
**Cons:** Collides directly with `UpdateToast`'s `fixed bottom-3 z-50` on exactly the
viewport where both matter; permanently consumes ~64 px of a 740 px screen; can cover the
revise panel and end-spread content, none of which the overflow assertion can see.
**Status:** **held as an upgrade path.** If taken, the required change is recorded now so
it is not rediscovered: player at `z-40`, and `UpdateToast` gains a bottom offset driven
by a `--narration-bar-h` custom property. Task 7's `position !== 'fixed'` assertion is the
thing that would have to be consciously deleted, which is the point.

#### Floating overlay / modal listening mode

**Pros:** Maximum immersion for a pure listening experience.
**Cons:** Pulls in the entire modal contract — focus trap, escape-to-close, scroll lock,
`aria-modal` — which ADR-004 explicitly rejected for theater mode for the same reason.
**Why rejected:** same reasoning as ADR-004; revisit only if a dedicated Listen mode is
actually specced.

### Preference storage

#### One namespaced localStorage key with a hand-written guard (proposed)

**Pros:** No new dependency; no wire-shape obligation; no server round-trip; survives
offline. One key rather than three keeps the storage surface auditable next to
`storybook-session` / `storybook-theme` / `storybook-cart-cache`.
**Cons:** Preferences do not follow a user across devices.

#### Persist preferences on the `User` record

**Pros:** Voice and speed follow the account.
**Cons:** Requires a Prisma migration, a route, a wire shape, and an OPS.3 obligation —
every cost this spec is explicitly avoiding — to sync a setting that is inherently
device-specific. The available voice list *is* the device; a voice chosen on an iPhone
does not exist on a Windows laptop.
**Why rejected:** the data is device-scoped by nature, so device-scoped storage is not a
compromise, it is the correct model.

### Deferred-audio seam shape

#### One interface, one implementation, imported directly (proposed)

**Pros:** ~15 lines. Also the thing that makes the hook testable against a fake.
**Cons:** One indirection that buys nothing today if the trigger never fires.

#### No seam — `useNarration` calls `window.speechSynthesis` directly

**Pros:** Fewer files.
**Cons:** The hook becomes untestable without stubbing a browser global inside itself,
and a future provider means rewriting the hook rather than adding a file.
**Why rejected:** the seam pays for itself in testability before it ever pays for
optionality.

#### A provider registry with a config flag and a runtime selector

**Pros:** Ready for the second provider on day one.
**Cons:** An abstraction layer built entirely on spec, with a selector that has one
option and a flag nobody can flip. This is the failure mode the user explicitly warned
against.
**Why rejected:** when a second provider lands, that is when a selector earns its place.

## Success criteria

1. `cd client && npm test` is green, including new suites for `chunk`, `prefs`,
   `deviceProvider`, `useVoices`, `useNarration`, and `NarrationPlayer`.
2. `splitIntoUtterances` never returns a chunk longer than `MAX_CHUNK_CHARS`, never drops
   or duplicates a character (`chunks.map(c => text.slice(c.start, c.end)).join('')`
   round-trips modulo inter-chunk whitespace), and handles text with no sentence
   terminator at all.
3. With the fake synth, pressing Play on page 1 highlights chunk 0, then chunk 1 as the
   first ends, and calls `onRequestNext` exactly once after the final chunk.
4. Manual navigation mid-playback cancels the in-flight utterance and produces **no**
   `onRequestNext` call from the abandoned page — the stale-`runId` guard is asserted
   directly, not incidentally.
5. When `window.speechSynthesis` is absent, `NarrationPlayer` renders the disabled
   "Read-aloud isn't available in this browser" state and no control throws when clicked.
6. `e2e/tests/narration.spec.ts` (desktop) and `e2e/tests/mobile/narration.spec.ts`
   (`mobile-pixel` + `mobile-small`, both themes via `forEachTheme`) pass: player visible,
   `expectNoHorizontalOverflow`, `expectTapTargets(..., PRIMARY_TAP_MIN)`, highlight
   advances, page auto-turns, manual nav cancels.
7. The player's computed `position` is not `fixed` at any breakpoint — `UpdateToast`
   remains the only bottom-fixed surface.
8. Existing desktop specs stay green as the regression fence: `book-detail.spec.ts`,
   `version-history.spec.ts`, `illustration-history.spec.ts`, `dark-mode.spec.ts`, and
   `e2e/tests/mobile/reader.spec.ts` (single-panel count, one-page stepping, hidden dots).
9. `dark-mode-parity-check` reports no missing `dark:` partner on the diff.
10. `cd server && npm test` is untouched and green; `npx tsc --noEmit`, `npm run lint`,
    and `npm run build` are green in `client/`.
11. `.code-captain/product/roadmap.md:176` no longer describes read-aloud as unbuilt, and
    points at this spec for the phase-1/deferred split.

## Out of scope

- **Any generated / server-side audio**, any paid TTS provider, any audio caching, any
  `NarrationAudio` model, any `COST_CENTS` entry. Deferred by user decision; triggers are
  enumerated above.
- **Downloadable audio files or an audio-bearing PDF.** Not a scoping choice — device TTS
  has no capture path, so it is not buildable at all in phase 1.
- **Lock-screen / background playback.** Unreachable via Web Speech. Documented, not
  attempted.
- **A dedicated "Listen" presentation mode** (chrome hidden, illustration full-bleed).
  Named in §"Standalone or paired"; design it after auto-advance sees real use.
- **Narration in the legacy Reader view** (`viewMode === 'reader'` in `BookDetail.tsx`).
  The hook is host-agnostic by construction so this is a small follow-on, but two UI hosts
  double the verification surface for a view the code itself labels legacy.
- **Narration in `CreateBook.tsx`'s wizard preview**, on `BookCard`, or anywhere outside
  `/book/:id`.
- **Global keyboard shortcuts.** Deliberate; see §Controls.
- **Multi-language narration** beyond picking a voice whose `lang` matches. Story
  translation is a separate roadmap item.
- **Speech *recognition*** ("read along and I'll listen") — a different API, a different
  permission model, and a microphone.
- **WebKit e2e coverage.** Inherited from mobile-pwa: CI installs Chromium only. The iOS
  behaviour that matters here is exercised by the one manual device check in the autonomy
  ledger.

## Risks & cross-cutting concerns

| Risk | Mitigation |
|---|---|
| **Stale utterance events after navigation** — `cancel()` fires `end`/`error` asynchronously, so a fast double-tap on Next can trigger a phantom auto-advance or highlight the wrong page. This is the single most likely real bug. | Monotonic `runId` captured by every handler; any handler whose `runId` is stale returns immediately. Asserted directly in `useNarration.test.tsx` (success criterion 4), not left to incidental coverage. |
| **Chrome truncates utterances over ~15 s / ~200–250 chars** and can wedge the queue ([chromium#41346274](https://issues.chromium.org/issues/41346274)). | Chunking is mandatory, not optional: `MAX_CHUNK_CHARS = 200` with a hard word-boundary split. `chunk.test.ts` asserts the invariant on adversarial input (one 2000-character sentence with no terminator). |
| **iOS Safari requires a user gesture for `speak()`.** | The whole page is queued in one burst inside the Play gesture, eliminating non-gesture `speak()` within a page. Cross-page advancement is the residual seam, covered by the 1500 ms watchdog that degrades to "Tap play to continue". |
| **iOS stops audio on screen lock / tab background** — the bedtime case. | Documented as a known limitation rather than papered over. `visibilitychange` pauses cleanly and preserves `chunkIndex` so a tap resumes in place. Named as trigger #1 for the deferred generated-audio path. Requires one manual device check (autonomy ledger). |
| **`getVoices()` is empty on first call and inconsistent everywhere.** | `useVoices()` returns `'loading' \| 'ready' \| 'unavailable'` with a 2000 ms timeout, subscribes to `voiceschanged`, and applies an ordered default pick. No hand-maintained voice name lists. |
| **No usable voice at all** (headless, some Linux, locked-down enterprise). | An inert, explained disabled state — never a play button that silently does nothing, never a hidden feature. Asserted by e2e via `installNoSpeech`. |
| **Headless Chromium has no speech engine**, so e2e cannot exercise real narration. | `e2e/tests/_speech.ts` injects a deterministic fake via `addInitScript` before app scripts run. Stated plainly: **e2e proves the state machine and the UI, not audibility.** Audibility is one manual listen in the autonomy ledger. |
| **jsdom has no `speechSynthesis`.** | `client/src/test/fakeSpeech.ts` exports explicit `installFakeSpeech()` / `uninstallFakeSpeech()` called per test file. It is deliberately **not** installed globally in `client/src/test/setup.ts`, because the `'unavailable'` path needs the global to genuinely be absent. |
| **The fake synth is our model of the API, not the API.** Every unit and e2e assertion inherits its assumptions. | Kept deliberately dumb — a FIFO queue plus timers, no clever behaviour. `deviceProvider.test.ts` pins the mapping from real `SpeechSynthesisEvent` fields (`charIndex`, `charLength`, `name`, `error`) so drift shows up in one file rather than diffusely. The manual listen exists precisely to catch what the fake cannot. |
| **Two voices at once** — a screen reader reading the page while narration speaks it. | The highlighted sentence is never in an `aria-live` region. The only live region is a terse visually-hidden status. Highlight uses `<span>`, never `<mark>`, so VoiceOver does not inject "highlighted" mid-sentence. |
| **Splitting page text into spans could fragment the accessible text** for screen readers. | Inline `<span>`s inside the existing `<p>` do not break accessible-name computation. No `role`, no `tabIndex` on the spans; the accessible seek path is the Previous/Next sentence buttons, with click-a-sentence as a redundant pointer convenience (WCAG-permissible). |
| **`UpdateToast` collision on mobile.** | Resolved by design: the player is in flow at every breakpoint and `UpdateToast` stays the only bottom-fixed surface. Pinned by a computed-style assertion so a future sticky change must consciously delete the fence. |
| **`BookSpread.tsx` is 705 lines and encodes ADR-004 theater-mode behaviour**; mobile-pwa Task 4 just reworked it. | Task 5 is strictly additive — mount a component, thread two props into `StoryText`, call the existing `turnPage('next')`. No change to the spread structure, the theater frame widths, or the chevron/dot logic. Desktop specs plus `e2e/tests/mobile/reader.spec.ts` are the regression fence. If a change would alter theater behaviour, hand back — that is an ADR-004 amendment. |
| **Merge conflict with in-flight mobile-pwa Task 6** (offline cart), which touches `CartContext`, `Cart.tsx`, and existing `useCart` mocks. | Disjoint file sets: narration touches `BookSpread.tsx` and new files only. Rebase on `agent/feat/mobile-pwa` before starting; do not branch from `master`. |
| **Offline claims.** The service worker precaches the app shell, which may imply narration works offline. | It usually does — `localService` voices need no network — but that is per-device luck, not a guarantee, and remote voices will fail offline. Phase 1 makes **no** offline narration claim in the UI. Uniform offline narration is trigger #6. |
| **Auto-advance pacing may feel abrupt** — the page turns the instant the last word ends. | A 400 ms settle delay before `onRequestNext()` is specified in Task 5, tunable in one constant. Whether it feels right is the one thing in this feature that genuinely needs a human listen. |
| **Word-highlight enhancement (Task 6) could de-sync with a real voice** even though it passes against the fake. | It self-activates only on observed word-granularity `boundary` events, so unsupported platforms are unaffected by construction. Task 6 carries an explicit kill switch: if the manual check looks wrong, disable activation and ship sentence-only — the baseline is already correct and shipped. |
| **No server route changes.** | Stated as a constraint. If a task implies one, stop and re-dispatch the architect: OPS.3 wire-shape obligations, and possibly spend gating, would then attach. |

## ADR-worthy decisions

- [ ] **Device TTS (Web Speech API) for phase 1; generated audio deferred behind a named trigger list** — sets the cost, quality, and platform-capability posture for the whole feature. The trigger list is the durable artifact.
- [ ] **Sentence-level highlighting from the chunk queue, with word-level as a self-activating enhancement** — a deliberate rejection of `boundary` as a foundation, on cross-platform-support grounds. Hard to revisit once the state shape and tests assume it.
- [ ] **Page index is the master; narration requests page turns rather than owning them** — the directional choice that keeps `BookSpread`'s state model intact and avoids lifting page state to `BookDetail`.
- [ ] **One `NarrationProvider` interface with one implementation, imported directly — no registry, no flag** — the optionality-preserving shape, following the `docs/backlog.md:51` Zod→OpenAPI precedent.
- [ ] **The narration player is in flow at every breakpoint; `UpdateToast` remains the app's only bottom-fixed surface** — an app-wide layout invariant, pinned by a test, that constrains future UI work beyond this feature.
- [ ] **Narration preferences live in one client-local localStorage key, not on the `User` record and not in `@storybook/shared`** — establishes that device-scoped settings stay device-scoped and that `shared/` means cross-network contracts.
- [ ] **A fake speech synthesiser is the test substrate at both the unit and e2e layers; audibility is verified by one documented manual listen** — a harness precedent for any future device-API feature, and an honest statement of what CI does not cover.
- [ ] **Deferred:** generated/premium audio and the `NarrationAudio` + `POST /api/books/:id/narrate` + `COST_CENTS.narration` design; downloadable audio artifacts; lock-screen/background playback; a dedicated "Listen" presentation mode; narration in the legacy Reader view; global keyboard shortcuts; multi-language narration; WebKit e2e coverage.

## Reconciling the roadmap

`.code-captain/product/roadmap.md:176` currently reads:

> **Read-aloud narration** via OpenAI TTS or ElevenLabs; cache audio per page like illustrations.

**This spec supersedes that line for phase 1.** Read-aloud ships on device TTS with no
provider, no cost, and no cached assets. The roadmap's description is not wrong — it is an
accurate sketch of the *deferred* path, and its "cache audio per page like illustrations"
instinct is preserved verbatim in §"The deferred generated-audio seam", down to mirroring
`IllustrationVersion`. Task 8 rewrites the line to say so, so a future reader does not
implement the roadmap version by mistake or assume narration is unbuilt.
