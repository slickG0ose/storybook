/**
 * Client-side narration types.
 *
 * Most of these stay client-internal: voices, playback state, and position are
 * device-local concerns with no wire shape. The exception is `NarrationChunk` — with
 * generated voices (generated-narration spec), chunks now cross the network: the server
 * synthesises one clip per chunk and returns offsets in the same space the client
 * highlights in. So `NarrationChunk` lives in `@storybook/shared` and is re-exported
 * here so existing imports don't churn.
 */
export type { NarrationChunk } from '@storybook/shared'

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
  /**
   * Which provider speaks this voice. `'generated'` voices carry a `generated:<id>` URI and
   * are played from server-synthesised clips; `'device'` voices are the Web Speech engine's.
   */
  kind: 'device' | 'generated';
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
