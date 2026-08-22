import { clampRate } from './prefs'
import type { NarrationChunk, NarrationVoice } from './types'
import type {
  NarrationErrorReason,
  NarrationEvents,
  NarrationHandle,
  NarrationProvider,
  NarrationSpeakOptions,
} from './provider'

/**
 * The only `NarrationProvider` implementation: the browser's Web Speech API.
 *
 * Costs nothing, makes no network call, needs no dependency — and in exchange it is the
 * messiest API in the platform. Everything unusual in this file is working around a
 * documented engine behaviour rather than being clever.
 */

/**
 * Both `SpeechSynthesis` and its utterance constructor have to be present. Some locked-down
 * environments and embedded webviews expose the synthesis object with no constructor, and
 * assuming one from the other is a `ReferenceError` at the worst possible moment.
 */
function getSynth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null
  if (!('speechSynthesis' in window)) return null
  if (typeof window.SpeechSynthesisUtterance !== 'function') return null
  return window.speechSynthesis
}

/** Maps the engine's `SpeechSynthesisErrorEvent.error` codes onto our four reasons. */
function mapError(code: string): NarrationErrorReason {
  switch (code) {
    case 'canceled':
    case 'interrupted':
      return 'canceled'
    case 'not-allowed':
      return 'not-allowed'
    case 'synthesis-failed':
    case 'synthesis-unavailable':
    case 'audio-busy':
    case 'audio-hardware':
      return 'synthesis-failed'
    default:
      return 'unknown'
  }
}

/** Local voices first, then alphabetical — the ordering the voice `<select>` renders. */
function compareVoices(a: NarrationVoice, b: NarrationVoice): number {
  if (a.localService !== b.localService) return a.localService ? -1 : 1
  return a.name.localeCompare(b.name)
}

/** A handle that does nothing, for the "there is nothing to speak" paths. */
const INERT_HANDLE: NarrationHandle = {
  cancel: () => {},
  pause: () => {},
  resume: () => {},
}

export const deviceProvider: NarrationProvider = {
  id: 'device',

  isAvailable(): boolean {
    return getSynth() !== null
  },

  listVoices(): NarrationVoice[] {
    const synth = getSynth()
    if (!synth) return []

    let raw: SpeechSynthesisVoice[]
    try {
      raw = synth.getVoices()
    } catch {
      // Engines have been known to throw here while the list is still being populated.
      return []
    }
    if (!Array.isArray(raw)) return []

    return raw
      .map((voice) => ({
        uri: voice.voiceURI,
        name: voice.name,
        lang: voice.lang,
        localService: voice.localService,
        isDefault: voice.default,
      }))
      .sort(compareVoices)
  },

  /**
   * Queues every chunk from `fromChunk` onward in a **single synchronous burst**.
   *
   * This is the load-bearing shape, not an optimisation. iOS Safari rejects `speak()`
   * outside a user gesture, so scheduling chunk N+1 from chunk N's `end` handler would
   * mean every sentence after the first is a non-gesture call. `speechSynthesis` keeps
   * its own FIFO queue, so one burst inside the Play gesture is one gesture-initiated
   * session for the whole page.
   *
   * Returns an inert handle when there is nothing to say — the caller is expected to have
   * checked `isAvailable()` (`useNarration` reports `'unavailable'` instead of calling in).
   */
  speak(
    chunks: NarrationChunk[],
    opts: NarrationSpeakOptions,
    events: NarrationEvents,
  ): NarrationHandle {
    const synth = getSynth()
    if (!synth) return INERT_HANDLE

    const from = Math.max(0, Math.floor(opts.fromChunk))
    if (from >= chunks.length) return INERT_HANDLE

    // Out-of-range rates make some engines refuse to speak at all. `writePrefs` already
    // clamps; this is the second layer, at the boundary where it actually reaches an API.
    const rate = clampRate(opts.rate)

    // Look the voice up in the *current* list. A stale voice object assigned from a
    // previous list is a common source of silent failure, so a miss leaves `voice` unset
    // and lets the engine pick rather than assigning garbage.
    const voice = opts.voiceURI
      ? (synth.getVoices().find((candidate) => candidate.voiceURI === opts.voiceURI) ?? null)
      : null

    const lastIndex = chunks.length - 1

    /**
     * `cancel()` in Chrome still fires `end` (or `error: 'canceled'`) on the in-flight
     * utterance, asynchronously, after the reader has already turned the page. If those
     * late handlers were allowed to emit, `useNarration` would see an `onDone` for a page
     * nobody is looking at and auto-advance again. The handle goes dead instead.
     */
    let dead = false

    for (let index = from; index < chunks.length; index++) {
      const chunk = chunks[index]
      if (!chunk) continue

      const utterance = new window.SpeechSynthesisUtterance(chunk.text)
      utterance.rate = rate
      if (voice) utterance.voice = voice

      utterance.onstart = () => {
        if (dead) return
        events.onChunkStart(index)
      }

      utterance.onboundary = (event: SpeechSynthesisEvent) => {
        if (dead) return
        // Safari fires `boundary` at *sentence* granularity and Android Chrome not at
        // all, so word highlighting self-activates off this check rather than any
        // user-agent sniffing.
        if (event.name !== 'word') return
        const charLength = typeof event.charLength === 'number' ? event.charLength : 0
        events.onWordBoundary(index, event.charIndex, charLength)
      }

      utterance.onend = () => {
        if (dead) return
        events.onChunkEnd(index)
        if (index === lastIndex) {
          dead = true
          events.onDone()
        }
      }

      utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
        if (dead) return
        // An error ends the session on every engine we care about; going dead stops the
        // remaining queued utterances from reporting into a state machine that has
        // already given up.
        dead = true
        events.onError(mapError(event.error))
      }

      synth.speak(utterance)
    }

    return {
      cancel() {
        dead = true
        synth.cancel()
      },
      pause() {
        synth.pause()
      },
      resume() {
        synth.resume()
      },
    }
  },
}
