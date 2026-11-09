import type { NarrationSlot } from '@storybook/shared'
import type { NarrationChunk, NarrationVoice } from './types'

/**
 * The narration seam: one interface, two implementations, selected in `useNarration`.
 *
 * - `deviceProvider` — the browser's Web Speech API. Free, offline, sounds different on
 *   every device. Always the floor.
 * - `createGeneratedProvider()` — server-generated clips (Kokoro via fal, one WAV per
 *   chunk) played through a single `<audio>` element. See `generatedProvider.ts`.
 *
 * There is deliberately **no registry and no config flag**. The hook picks with a
 * two-branch conditional on the voice URI (`generated:<id>`) — ADR-011 decision 4 said a
 * selector earns its place when a second provider lands, and a conditional is all two
 * providers need.
 *
 * The optional members (`target`, `onPreparing`, `prefetch`, `setRate`) exist for the
 * generated path; `deviceProvider` ignores or omits them.
 */

/** Normalised failure reasons. The raw engine codes are mapped by the provider. */
export type NarrationErrorReason =
  | 'canceled'
  | 'not-allowed'
  | 'synthesis-failed'
  | 'unknown'
  /** Generated path only: 501, voices unavailable, or a signed-out reader on a cache miss. */
  | 'generation-unavailable'
  /** Generated path only: the server denied the spend (429/503). Sticky for the session. */
  | 'quota'

/** Which piece of which book is being read — the generated provider's cache key. */
export interface NarrationTarget {
  bookId: string
  slot: NarrationSlot
}

/**
 * Callbacks are fired for as long as the handle is live. After `cancel()`, a provider
 * must stay silent even though the underlying engine keeps delivering late events.
 */
export interface NarrationEvents {
  onChunkStart(chunkIndex: number): void
  /** Offsets are relative to the *chunk* text; the hook translates them into page space. */
  onWordBoundary(chunkIndex: number, charIndex: number, charLength: number): void
  onChunkEnd(chunkIndex: number): void
  /** Fired once, after the final chunk's `onChunkEnd`. Never after `cancel()`. */
  onDone(): void
  onError(reason: NarrationErrorReason): void
  /**
   * Generated path only: fired inside `speak()` when the clips have to be fetched (or
   * generated) before anything can play. The first `onChunkStart` ends the preparing state.
   */
  onPreparing?(): void
}

export interface NarrationHandle {
  cancel(): void
  pause(): void
  resume(): void
  /** Applies a rate change live. Absent means the caller must restart to change rate. */
  setRate?(rate: number): void
}

export interface NarrationSpeakOptions {
  /** Ignored when it does not match a currently-available voice. */
  voiceURI: string | null
  rate: number
  /** Absolute index into `chunks`; reported chunk indices stay absolute, never re-based. */
  fromChunk: number
  /** Required by the generated provider (it fetches clips per book + slot); ignored by device. */
  target?: NarrationTarget
}

export interface NarrationProvider {
  readonly id: 'device' | 'generated'
  isAvailable(): boolean
  listVoices(): NarrationVoice[]
  speak(
    chunks: NarrationChunk[],
    opts: NarrationSpeakOptions,
    events: NarrationEvents,
  ): NarrationHandle
  /** Warm the next slot so auto-advance does not stall. Fire-and-forget; never throws. */
  prefetch?(target: NarrationTarget, voiceURI: string): void
  /**
   * True when the provider can fail silently on a missing user gesture, so the hook must
   * arm its start watchdog. False for providers that report gesture refusal themselves
   * (`play()` rejecting with `NotAllowedError`) — a watchdog there would trip on a slow
   * cold fetch and show a false "Tap play to continue".
   */
  readonly needsStartWatchdog: boolean
}
