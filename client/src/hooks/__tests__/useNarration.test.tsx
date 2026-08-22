import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  useNarration,
  AUTO_ADVANCE_DELAY_MS,
  START_WATCHDOG_MS,
  type UseNarrationArgs,
} from '../useNarration'
import { deviceProvider } from '../../lib/narration/deviceProvider'
import type { NarrationEvents } from '../../lib/narration/provider'
import {
  installFakeSpeech,
  uninstallFakeSpeech,
  type FakeSpeechControl,
} from '../../test/fakeSpeech'

/**
 * The highest-risk logic in the feature, and the only place a subtle bug can produce audio
 * playing over the wrong page — so it is tested harder than anything else here. Every
 * transition is deterministic under fake timers; nothing in this file is timing-dependent
 * on a real engine.
 */

const PAGE_ONE = 'Luna woke up. The garden was glowing. She ran outside.'
const PAGE_ONE_CHUNKS = ['Luna woke up.', 'The garden was glowing.', 'She ran outside.']

const PAGE_TWO = 'The stars were dancing. Luna laughed.'
const PAGE_TWO_CHUNKS = ['The stars were dancing.', 'Luna laughed.']

/** The fake's default: one utterance takes this long under fake timers. */
const CHUNK_MS = 100

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
}

function renderNarration(overrides: Partial<UseNarrationArgs> = {}) {
  const onRequestNext = vi.fn()
  const props: UseNarrationArgs = {
    text: PAGE_ONE,
    pageKey: 0,
    hasNext: true,
    onRequestNext,
    ...overrides,
  }

  const view = renderHook((current: UseNarrationArgs) => useNarration(current), {
    initialProps: props,
  })

  /** Simulates the host turning the page: a new `pageKey` and the new page's text. */
  const turnPage = (next: Partial<UseNarrationArgs>): void => {
    act(() => view.rerender({ ...props, ...next }))
  }

  return { ...view, onRequestNext, props, turnPage }
}

/**
 * Advances fake timers inside `act` so React flushes the resulting state updates, then
 * drains the queue.
 *
 * The trailing single-millisecond advances are not superstition. The fake starts the next
 * utterance from the previous one's `end` handler, and vitest's clock only picks up a
 * zero-delay timer scheduled *during* a tick on a subsequent advance — so without draining,
 * a page stalls one utterance short. Where an exact boundary is the thing under test
 * (`AUTO_ADVANCE_DELAY_MS`, `START_WATCHDOG_MS`) the tests advance the clock directly
 * instead, since draining costs a few milliseconds of fake time.
 */
function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
    for (let step = 0; step < 4; step += 1) vi.advanceTimersByTime(1)
  })
}

/** Reads back the `NarrationEvents` the hook handed to the provider on its Nth `speak()`. */
function eventsFromSpeak(speak: ReturnType<typeof vi.spyOn>, call = 0): NarrationEvents {
  const args = speak.mock.calls[call]
  expect(args).toBeDefined()
  return args?.[2] as NarrationEvents
}

describe('useNarration', () => {
  let control: FakeSpeechControl

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.removeItem('storybook-narration')
    setDocumentHidden(false)
    control = installFakeSpeech()
  })

  afterEach(() => {
    uninstallFakeSpeech()
    vi.useRealTimers()
    vi.restoreAllMocks()
    Reflect.deleteProperty(document, 'hidden')
    localStorage.removeItem('storybook-narration')
  })

  describe('playback', () => {
    it('queues the whole page and walks the highlight through every chunk', () => {
      const { result } = renderNarration()

      expect(result.current.chunks.map((chunk) => chunk.text)).toEqual(PAGE_ONE_CHUNKS)

      act(() => result.current.play())

      // One synchronous burst inside the Play gesture — the iOS requirement.
      expect(control.spoken()).toEqual(PAGE_ONE_CHUNKS)
      expect(result.current.state).toBe('playing')
      expect(result.current.position).toEqual({ chunkIndex: 0, wordRange: null })

      tick(1)
      expect(result.current.position).toEqual({ chunkIndex: 0, wordRange: null })

      tick(CHUNK_MS)
      expect(result.current.position?.chunkIndex).toBe(1)

      tick(CHUNK_MS)
      expect(result.current.position?.chunkIndex).toBe(2)
    })

    it('pauses and resumes without restarting the sentence', () => {
      const { result } = renderNarration()

      act(() => result.current.play())
      tick(CHUNK_MS + 1)
      expect(result.current.position?.chunkIndex).toBe(1)

      const spokenBefore = control.spoken().length
      act(() => result.current.pause())
      expect(result.current.state).toBe('paused')

      act(() => result.current.resume())
      expect(result.current.state).toBe('playing')
      // Resumed the live session rather than re-queueing anything.
      expect(control.spoken()).toHaveLength(spokenBefore)
      expect(result.current.position?.chunkIndex).toBe(1)
    })

    it('stop() clears the highlight and returns to idle', () => {
      const { result } = renderNarration()

      act(() => result.current.play())
      tick(1)
      act(() => result.current.stop())

      expect(result.current.state).toBe('idle')
      expect(result.current.position).toBeNull()
      expect(control.cancelCount()).toBe(1)
    })
  })

  describe('auto-advance', () => {
    it('requests the next page exactly once when the page finishes', () => {
      const { result, onRequestNext } = renderNarration()

      act(() => result.current.play())
      tick(CHUNK_MS * PAGE_ONE_CHUNKS.length)

      // The page has finished, but the turn is deliberately not instantaneous.
      expect(onRequestNext).not.toHaveBeenCalled()

      tick(AUTO_ADVANCE_DELAY_MS)
      expect(onRequestNext).toHaveBeenCalledTimes(1)

      // Nothing re-fires while the host decides what to do with the request.
      tick(5000)
      expect(onRequestNext).toHaveBeenCalledTimes(1)
    })

    // The delay is pinned off an injected `onDone` rather than off the audio, so the
    // assertion is on the hook's timer and not on the fake's chunk pacing.
    it('waits AUTO_ADVANCE_DELAY_MS before requesting the turn', () => {
      const speak = vi.spyOn(deviceProvider, 'speak')
      // The engine is inert here so the injected `onDone` is the only event in play.
      vi.spyOn(window.speechSynthesis, 'speak').mockImplementation(() => undefined)
      const { result, onRequestNext } = renderNarration()

      act(() => result.current.play())
      act(() => eventsFromSpeak(speak).onDone())

      expect(onRequestNext).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(AUTO_ADVANCE_DELAY_MS - 1)
      })
      expect(onRequestNext).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(onRequestNext).toHaveBeenCalledTimes(1)
    })

    it('never requests a turn when auto-advance is off', () => {
      const { result, onRequestNext } = renderNarration()

      act(() => result.current.setPrefs({ autoAdvance: false }))
      act(() => result.current.play())
      tick(CHUNK_MS * PAGE_ONE_CHUNKS.length + AUTO_ADVANCE_DELAY_MS + 100)

      expect(onRequestNext).not.toHaveBeenCalled()
      expect(result.current.state).toBe('idle')
      expect(result.current.position).toBeNull()
    })

    // The end spread reads "The End." and stops; it never asks for a page that isn't there.
    it('stops instead of requesting a turn on the last spread', () => {
      const { result, onRequestNext } = renderNarration({ hasNext: false })

      act(() => result.current.play())
      tick(CHUNK_MS * PAGE_ONE_CHUNKS.length + AUTO_ADVANCE_DELAY_MS + 100)

      expect(onRequestNext).not.toHaveBeenCalled()
      expect(result.current.state).toBe('idle')
    })
  })

  describe('page changes', () => {
    it('cancels and restarts at chunk 0 of the new page while playing', () => {
      const { result, turnPage } = renderNarration()

      act(() => result.current.play())
      tick(CHUNK_MS + 1)
      const cancelsBefore = control.cancelCount()

      turnPage({ pageKey: 1, text: PAGE_TWO })

      expect(control.cancelCount()).toBe(cancelsBefore + 1)
      expect(control.spoken().slice(PAGE_ONE_CHUNKS.length)).toEqual(PAGE_TWO_CHUNKS)
      expect(result.current.state).toBe('playing')
      expect(result.current.position).toEqual({ chunkIndex: 0, wordRange: null })
    })

    it('cancels and stays stopped when the reader had paused', () => {
      const { result, turnPage } = renderNarration()

      act(() => result.current.play())
      tick(CHUNK_MS + 1)
      act(() => result.current.pause())

      const spokenBefore = control.spoken().length
      turnPage({ pageKey: 1, text: PAGE_TWO })

      // Nothing new was queued, and the highlight cleared with the old page.
      expect(control.spoken()).toHaveLength(spokenBefore)
      expect(result.current.state).toBe('paused')
      expect(result.current.position).toBeNull()
    })

    /**
     * Success criterion 4, asserted directly rather than incidentally.
     *
     * `deviceProvider` already goes dead on `cancel()`, so this drives the abandoned page's
     * callbacks by hand — the hook's own `runId` guard has to hold even if a provider ever
     * lets a late event through.
     */
    it('ignores the abandoned page callbacks after a page turn', () => {
      const speak = vi.spyOn(deviceProvider, 'speak')
      const { result, turnPage, onRequestNext } = renderNarration()

      act(() => result.current.play())
      tick(CHUNK_MS + 1)
      expect(result.current.position?.chunkIndex).toBe(1)

      const abandoned = eventsFromSpeak(speak)

      turnPage({ pageKey: 1, text: PAGE_TWO })

      // The old page's utterances report in after the new page has already mounted.
      act(() => {
        abandoned.onChunkStart(2)
        abandoned.onChunkEnd(2)
        abandoned.onDone()
      })

      // Chunk 2 does not even exist on the new page — the highlight stayed where the new
      // page put it rather than following a ghost.
      expect(result.current.chunks.map((chunk) => chunk.text)).toEqual(PAGE_TWO_CHUNKS)
      expect(result.current.position?.chunkIndex).toBe(0)

      // Long enough for the abandoned page's phantom turn to land, comfortably short of
      // the new page's own legitimate one.
      tick(AUTO_ADVANCE_DELAY_MS + 50)
      expect(onRequestNext).not.toHaveBeenCalled()
    })
  })

  describe('start watchdog', () => {
    // iOS may refuse a speak() that did not originate in a gesture. The re-arm after an
    // auto-advance is exactly that call, and a silent refusal must not look like a freeze.
    it('degrades to tap-to-continue when the re-armed speak never starts', () => {
      const { result, turnPage, onRequestNext } = renderNarration()

      act(() => result.current.play())
      tick(CHUNK_MS * PAGE_ONE_CHUNKS.length)
      tick(AUTO_ADVANCE_DELAY_MS)
      expect(onRequestNext).toHaveBeenCalledTimes(1)

      // The engine accepts the utterances and then does nothing with them.
      const speak = vi
        .spyOn(window.speechSynthesis, 'speak')
        .mockImplementation(() => undefined)

      turnPage({ pageKey: 1, text: PAGE_TWO })
      expect(result.current.state).toBe('playing')

      // Nothing is speaking, so the clock can be advanced exactly.
      act(() => {
        vi.advanceTimersByTime(START_WATCHDOG_MS - 1)
      })
      expect(result.current.state).toBe('playing')
      expect(result.current.needsGesture).toBe(false)

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(result.current.state).toBe('paused')
      expect(result.current.needsGesture).toBe(true)

      // A real tap is a real gesture: it clears the hint and speaks again.
      speak.mockRestore()
      act(() => result.current.play())
      expect(result.current.needsGesture).toBe(false)
      expect(result.current.state).toBe('playing')
      expect(control.spoken().slice(-PAGE_TWO_CHUNKS.length)).toEqual(PAGE_TWO_CHUNKS)
    })

    it('does not arm the watchdog for a user-initiated play', () => {
      const { result } = renderNarration()

      vi.spyOn(window.speechSynthesis, 'speak').mockImplementation(() => undefined)
      act(() => result.current.play())

      tick(START_WATCHDOG_MS + 100)

      expect(result.current.state).toBe('playing')
      expect(result.current.needsGesture).toBe(false)
    })
  })

  describe('tab visibility', () => {
    it('pauses when the tab hides and does not resume itself when it returns', () => {
      const { result } = renderNarration()

      act(() => result.current.play())
      tick(CHUNK_MS + 1)
      expect(result.current.position?.chunkIndex).toBe(1)

      act(() => {
        setDocumentHidden(true)
        document.dispatchEvent(new Event('visibilitychange'))
      })

      expect(result.current.state).toBe('paused')
      // The sentence is preserved, so a tap picks up where the screen lock interrupted.
      expect(result.current.position?.chunkIndex).toBe(1)

      act(() => {
        setDocumentHidden(false)
        document.dispatchEvent(new Event('visibilitychange'))
      })

      // A story restarting by itself in a pocket is worse than a Play button.
      expect(result.current.state).toBe('paused')
    })
  })

  describe('preferences', () => {
    it('re-speaks from the current sentence when the rate changes mid-playback', () => {
      const { result } = renderNarration()

      act(() => result.current.play())
      tick(CHUNK_MS + 1)
      expect(result.current.position?.chunkIndex).toBe(1)

      const cancelsBefore = control.cancelCount()
      const spokenBefore = control.spoken().length

      act(() => result.current.setPrefs({ rate: 1.5 }))

      expect(control.cancelCount()).toBe(cancelsBefore + 1)
      // From chunk 1, not from the top of the page.
      expect(control.spoken().slice(spokenBefore)).toEqual(PAGE_ONE_CHUNKS.slice(1))
      expect(control.utterances()[spokenBefore]?.rate).toBe(1.5)
      expect(result.current.position?.chunkIndex).toBe(1)
      expect(result.current.prefs.rate).toBe(1.5)
    })

    it('persists preferences and does not restart for an auto-advance toggle', () => {
      const { result } = renderNarration()

      act(() => result.current.play())
      tick(CHUNK_MS + 1)
      const spokenBefore = control.spoken().length

      act(() => result.current.setPrefs({ autoAdvance: false }))

      expect(control.spoken()).toHaveLength(spokenBefore)
      expect(result.current.state).toBe('playing')
      expect(localStorage.getItem('storybook-narration')).toContain('"autoAdvance":false')
    })
  })

  describe('sentence stepping', () => {
    it('previousSentence() at chunk 0 restarts chunk 0', () => {
      const { result } = renderNarration()

      act(() => result.current.play())
      tick(1)
      const spokenBefore = control.spoken().length

      act(() => result.current.previousSentence())

      expect(control.spoken().slice(spokenBefore)).toEqual(PAGE_ONE_CHUNKS)
      expect(result.current.position?.chunkIndex).toBe(0)
    })

    it('nextSentence() steps forward and clamps at the last chunk', () => {
      const { result } = renderNarration()

      act(() => result.current.play())
      tick(1)

      act(() => result.current.nextSentence())
      expect(result.current.position?.chunkIndex).toBe(1)

      act(() => result.current.nextSentence())
      act(() => result.current.nextSentence())
      expect(result.current.position?.chunkIndex).toBe(PAGE_ONE_CHUNKS.length - 1)
    })
  })

  /**
   * The word-level enhancement (Task 6). It is self-activating by construction: `wordRange`
   * is non-null only because a real word-granularity `boundary` event actually arrived, so
   * the degradation case below is not an edge case — it is the *normal* path on Safari
   * (sentence-granularity boundaries) and Android Chrome (no boundary events at all).
   */
  describe('word-level highlight', () => {
    /** Absolute page-text offsets, written the way the renderer consumes them. */
    const at = (word: string): { start: number; end: number } => {
      const start = PAGE_ONE.indexOf(word)
      expect(start).toBeGreaterThanOrEqual(0)
      return { start, end: start + word.length }
    }

    it('tracks successive words in page-text coordinates', () => {
      control = installFakeSpeech({ emitWordBoundary: true })
      const { result } = renderNarration()

      act(() => result.current.play())
      // The optimistic sentence highlight lands first: no boundary has been observed yet.
      expect(result.current.position).toEqual({ chunkIndex: 0, wordRange: null })

      tick(1)
      expect(result.current.position).toEqual({ chunkIndex: 0, wordRange: at('Luna') })

      tick(40)
      expect(result.current.position).toEqual({ chunkIndex: 0, wordRange: at('woke') })

      tick(40)
      expect(result.current.position).toEqual({ chunkIndex: 0, wordRange: at('up.') })

      // The load-bearing assertion: on the second sentence the offsets keep counting from
      // the top of the *page*. Chunk-relative coordinates would put 'The' back at 0 and
      // the renderer would highlight the wrong word of the wrong sentence.
      tick(20)
      // 'The' opens the second sentence, 14 characters into the page.
      expect(result.current.position).toEqual({ chunkIndex: 1, wordRange: at('The') })
      expect(result.current.position?.wordRange?.start).toBe(PAGE_ONE.indexOf('The garden'))
    })

    /**
     * The degradation path, asserted rather than assumed. This is what every Android Chrome
     * and every Safari reader gets, and it must be the shipped sentence-level behaviour with
     * nothing missing and nothing thrown.
     */
    it('keeps wordRange null through a whole page when no boundary events arrive', () => {
      // The default fake emits no boundary events at all.
      const { result } = renderNarration()

      act(() => result.current.play())
      expect(result.current.position).toEqual({ chunkIndex: 0, wordRange: null })

      tick(CHUNK_MS)
      expect(result.current.position).toEqual({ chunkIndex: 1, wordRange: null })

      tick(CHUNK_MS)
      expect(result.current.position).toEqual({ chunkIndex: 2, wordRange: null })

      // The page still finishes normally — the sentence-level machine is untouched.
      tick(CHUNK_MS)
      tick(AUTO_ADVANCE_DELAY_MS)
      expect(result.current.state).toBe('playing')
    })

    it('ignores a boundary that arrives after the page turned', () => {
      const speak = vi.spyOn(deviceProvider, 'speak')
      const { result, turnPage } = renderNarration()

      act(() => result.current.play())
      tick(1)
      const abandoned = eventsFromSpeak(speak)

      turnPage({ pageKey: 1, text: PAGE_TWO })

      // The abandoned page's engine reports a word after the new page has already mounted.
      act(() => abandoned.onWordBoundary(0, 0, 4))

      expect(result.current.position).toEqual({ chunkIndex: 0, wordRange: null })
    })

    it('ignores a zero-length boundary rather than producing a zero-width span', () => {
      const speak = vi.spyOn(deviceProvider, 'speak')
      const { result } = renderNarration()

      act(() => result.current.play())
      const events = eventsFromSpeak(speak)

      // Some engines omit `charLength` entirely; the provider maps that to 0.
      act(() => events.onWordBoundary(0, 5, 0))

      expect(result.current.position).toEqual({ chunkIndex: 0, wordRange: null })
    })
  })

  describe('errors', () => {
    it("swallows 'canceled', which is what our own cancel() produces", () => {
      const speak = vi.spyOn(deviceProvider, 'speak')
      const { result } = renderNarration()

      act(() => result.current.play())
      tick(1)

      act(() => eventsFromSpeak(speak).onError('canceled'))

      expect(result.current.state).toBe('playing')
      expect(result.current.position?.chunkIndex).toBe(0)
    })

    it("stops on 'synthesis-failed' rather than retrying", () => {
      const speak = vi.spyOn(deviceProvider, 'speak')
      const { result } = renderNarration()

      act(() => result.current.play())
      tick(1)
      const spokenBefore = control.spoken().length

      act(() => eventsFromSpeak(speak).onError('synthesis-failed'))

      expect(result.current.state).toBe('idle')
      expect(result.current.position).toBeNull()
      expect(control.spoken()).toHaveLength(spokenBefore)
    })

    it("asks for a gesture on 'not-allowed'", () => {
      const speak = vi.spyOn(deviceProvider, 'speak')
      const { result } = renderNarration()

      act(() => result.current.play())
      tick(1)

      act(() => eventsFromSpeak(speak).onError('not-allowed'))

      expect(result.current.state).toBe('paused')
      expect(result.current.needsGesture).toBe(true)
    })
  })

  describe('teardown', () => {
    it('cancels in-flight audio on unmount', () => {
      const { result, unmount } = renderNarration()

      act(() => result.current.play())
      tick(1)
      expect(control.cancelCount()).toBe(0)

      unmount()

      // An uncancelled utterance keeps talking over the next route.
      expect(control.cancelCount()).toBe(1)
    })
  })

  describe('when the browser has no speech synthesis', () => {
    it('reports unavailable and every control is a safe no-op', () => {
      uninstallFakeSpeech()

      const { result, onRequestNext } = renderNarration()

      expect(result.current.state).toBe('unavailable')
      expect(result.current.voiceStatus).toBe('unavailable')
      // The chunks still exist: the text renders normally, it just cannot be spoken.
      expect(result.current.chunks.map((chunk) => chunk.text)).toEqual(PAGE_ONE_CHUNKS)

      expect(() => {
        act(() => {
          result.current.play()
          result.current.pause()
          result.current.resume()
          result.current.nextSentence()
          result.current.previousSentence()
          result.current.stop()
        })
      }).not.toThrow()

      tick(START_WATCHDOG_MS + AUTO_ADVANCE_DELAY_MS + 1000)

      expect(result.current.state).toBe('unavailable')
      expect(result.current.position).toBeNull()
      expect(result.current.needsGesture).toBe(false)
      expect(onRequestNext).not.toHaveBeenCalled()
    })
  })
})
