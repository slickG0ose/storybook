/**
 * Client-internal narration types.
 *
 * These deliberately do NOT live in `@storybook/shared`: nothing here crosses the
 * network. Narration is a device-local capability (Web Speech API) with no route, no
 * Prisma model, and no wire shape, so putting these next to the cross-network contracts
 * would dilute what that package means.
 */

/**
 * A speakable unit plus its `[start, end)` offsets into the original page text.
 *
 * The offsets are what let the renderer highlight a sentence without re-deriving
 * anything — `page.text.slice(start, end)` is exactly the region to wrap in a span.
 */
export interface NarrationChunk {
  text: string;
  start: number;
  end: number;
}

export interface NarrationVoice {
  /** `SpeechSynthesisVoice.voiceURI` — the stable identifier across a voice list refresh. */
  uri: string;
  name: string;
  lang: string;
  /** Local voices work offline and are the higher-quality option on Apple platforms. */
  localService: boolean;
  /**
   * `SpeechSynthesisVoice.default` — the engine's own pick for the current language.
   *
   * Carried across the provider mapping because the default-voice selection order has a
   * rung for it (see `useVoices`); without it the hook would have to reach past the
   * provider seam to `speechSynthesis.getVoices()` to find the flag.
   */
  isDefault: boolean;
}

export type NarrationState = 'idle' | 'playing' | 'paused' | 'unavailable'

export interface NarrationPosition {
  chunkIndex: number;
  /**
   * Offsets into the *page* text, not the chunk — one coordinate system for the
   * renderer. Null unless a word-granularity `boundary` event has actually been
   * observed, which is not Baseline (Safari fires at sentence granularity, Android
   * Chrome not at all).
   */
  wordRange: { start: number; end: number } | null;
}
