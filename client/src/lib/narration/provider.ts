import type { NarrationChunk, NarrationVoice } from './types'

/**
 * The narration seam: one interface, one implementation (`deviceProvider`), imported
 * directly by `useNarration`.
 *
 * There is deliberately **no registry, no factory, and no config flag** here. A selector
 * with one option and a flag nobody can flip is an abstraction built entirely on
 * speculation; when a second provider actually lands, that is when a selector earns its
 * place. What this interface buys today is testability — the hook can be driven against
 * a fake without stubbing a browser global inside itself — and it happens to also keep
 * the deferred generated-audio path open at a cost of one file.
 *
 * A future generated-audio provider would return a handle backed by an `<audio>` element,
 * fire `onChunkStart` / `onChunkEnd` from `timeupdate` against a per-chunk timing map,
 * and register with the Media Session API for lock-screen playback. Nothing in the hook
 * or the player would change.
 */

/** Normalised failure reasons. The raw engine codes are mapped by the provider. */
export type NarrationErrorReason = 'canceled' | 'not-allowed' | 'synthesis-failed' | 'unknown'

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
}

export interface NarrationHandle {
  cancel(): void
  pause(): void
  resume(): void
}

export interface NarrationSpeakOptions {
  /** Ignored when it does not match a currently-available voice. */
  voiceURI: string | null
  rate: number
  /** Absolute index into `chunks`; reported chunk indices stay absolute, never re-based. */
  fromChunk: number
}

export interface NarrationProvider {
  readonly id: 'device' // future: | 'generated'
  isAvailable(): boolean
  listVoices(): NarrationVoice[]
  speak(
    chunks: NarrationChunk[],
    opts: NarrationSpeakOptions,
    events: NarrationEvents,
  ): NarrationHandle
}
