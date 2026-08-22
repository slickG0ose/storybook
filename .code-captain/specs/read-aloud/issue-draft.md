Title: Read-aloud narration ("Read to me") — phase 1, device TTS

<!--
Draft only. Not created yet — create with:
  gh issue create --repo slickG0ose/storybook \
    --title "Read-aloud narration (\"Read to me\") — phase 1, device TTS" \
    --milestone "Tier 2 Storefront" \
    --body-file .code-captain/specs/read-aloud/issue-draft.md
(strip this comment and the Title: line from the body first, or pass --body by hand)
-->

**Milestone:** Tier 2 Storefront
**Spec:** [`.code-captain/specs/read-aloud/spec.md`](https://github.com/slickG0ose/storybook/blob/master/.code-captain/specs/read-aloud/spec.md)
**Task plan:** [`.code-captain/specs/read-aloud/tasks.md`](https://github.com/slickG0ose/storybook/blob/master/.code-captain/specs/read-aloud/tasks.md)
**ADR:** ADR-011 in [`.code-captain/product/decisions.md`](https://github.com/slickG0ose/storybook/blob/master/.code-captain/product/decisions.md)

The spec was written and executed without a tracking issue — this is the backfill, so the
work is visible on the milestone board alongside the rest of Tier 2 Storefront.

## Why

A children's book that cannot be read *to* a child is only half a product. Every session
today needs a literate adult holding the device; the target reader — a 3-to-8-year-old —
cannot consume what we sell them without a parent narrating. Two of the AI-native
competitors in [`docs/marketing-research.md`](https://github.com/slickG0ose/storybook/blob/master/docs/marketing-research.md)
(Childbook.ai, StoryBee) already bundle text-to-speech, and StoryBee's whole positioning is
"AI bedtime stories, audio narration". It is also the highest-leverage accessibility feature
the storefront could add: pre-readers, dyslexic readers, and low-vision readers are all
served from one code path.

## What ships (phase 1)

Device TTS via the Web Speech API, inside the reader at `/book/:id`:

- Page text is chunked into sentences and queued into `speechSynthesis` in one
  gesture-initiated burst (chunking is the fix for Chrome's ~15 s / ~200-char utterance
  truncation, not an optimisation).
- The spoken sentence is highlighted; word-level highlighting self-activates only where the
  platform actually emits word-granularity `boundary` events.
- Auto-advance turns the page when the last chunk of a page ends, so one Play press reads
  the book front to back — cover (`"{title}. By {author}."`) through `"The End."`.
- A `NarrationPlayer` bar in normal document flow at every breakpoint: previous sentence,
  play/pause, next sentence, stop, plus a settings disclosure for voice, speed, and
  auto-advance. Preferences persist in `localStorage['storybook-narration']`.
- An honest disabled state — "Read-aloud isn't available in this browser" — when no usable
  voice exists, rather than a Play button that silently does nothing.

**No server change:** no route, no Prisma model, no `COST_CENTS` entry, no `spendGate`
mount, no schema in `@storybook/shared`, no new npm dependency.

## What it explicitly does not do

Lock-screen / background playback, downloadable audio artifacts, an audio-bearing PDF,
generated or premium voices, a dedicated "Listen" presentation mode, narration in the legacy
Reader view, global keyboard shortcuts, multi-language narration, and WebKit e2e coverage.
The first three are not scoping choices — Web Speech has no capture path and produces no
`<audio>` element, so they are not buildable at all in phase 1. See spec §"Out of scope" and
§"The deferred generated-audio seam" for the six named triggers that would reopen the
generated-audio path.

## Tasks

Nine, all `Status: Done` in the task plan: (1) types, chunking, preference storage;
(2) provider seam, device provider, voice list; (3) the `useNarration` state machine;
(4) `NarrationPlayer`; (5) wire into `BookSpread`; (6) word-level highlight enhancement;
(7) desktop + mobile e2e specs; (8) roadmap and conventions reconciliation; (9) this ADR and
issue.

## Outstanding — needs a human, deliberately not in any task's "Done when"

CI can prove the state machine; it cannot hear. Three checks remain:

- [ ] One real listen on desktop Chrome — is the auto-advance pacing right?
      `AUTO_ADVANCE_DELAY_MS = 400` is a guess, exported as a single constant.
- [ ] One real listen on an iPhone, including a mid-story screen lock, confirming the
      pause-and-resume degradation behaves as designed rather than dying silently.
      **Not blocked on #77** — Web Speech is not restricted to secure contexts, so a phone
      on the LAN pointed at the dev server is enough.
- [ ] One look at word highlighting on a platform that emits word boundaries, before leaving
      the Task 6 enhancement enabled. It carries a one-line kill switch if it looks wrong.
