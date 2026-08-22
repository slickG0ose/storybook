import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { deviceProvider } from '../deviceProvider'
import type { NarrationChunk } from '../types'
import type { NarrationErrorReason, NarrationEvents, NarrationSpeakOptions } from '../provider'
import {
  installFakeSpeech,
  uninstallFakeSpeech,
  type FakeSpeechControl,
} from '../../../test/fakeSpeech'

/**
 * This file is where our *model* of the Web Speech API is pinned: the event field names,
 * the error codes, and the cancel semantics. Everything else in the feature is tested
 * against `fakeSpeech.ts`, so if the fake drifts from the real API, this is the one file
 * that should notice.
 */

const CHUNKS: NarrationChunk[] = [
  { text: 'Luna woke up.', start: 0, end: 14 },
  { text: 'The garden was glowing.', start: 14, end: 38 },
  { text: 'She ran outside.', start: 38, end: 54 },
]

const OPTS: NarrationSpeakOptions = { voiceURI: null, rate: 1, fromChunk: 0 }

/** Records both the individual calls and their interleaving, which order matters for. */
function recorder() {
  const log: string[] = []
  const onChunkStart = vi.fn((index: number) => void log.push(`start:${index}`))
  const onWordBoundary = vi.fn(
    (index: number, charIndex: number, charLength: number) =>
      void log.push(`word:${index}:${charIndex}:${charLength}`),
  )
  const onChunkEnd = vi.fn((index: number) => void log.push(`end:${index}`))
  const onDone = vi.fn(() => void log.push('done'))
  const onError = vi.fn((reason: NarrationErrorReason) => void log.push(`error:${reason}`))
  const events: NarrationEvents = { onChunkStart, onWordBoundary, onChunkEnd, onDone, onError }

  return { events, log, onChunkStart, onWordBoundary, onChunkEnd, onDone, onError }
}

/** A hand-built boundary event — jsdom has no `SpeechSynthesisEvent` constructor. */
function boundaryEvent(fields: {
  name: string
  charIndex: number
  charLength?: number
}): SpeechSynthesisEvent {
  return fields as unknown as SpeechSynthesisEvent
}

describe('deviceProvider', () => {
  let control: FakeSpeechControl

  beforeEach(() => {
    vi.useFakeTimers()
    control = installFakeSpeech()
  })

  afterEach(() => {
    uninstallFakeSpeech()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('availability', () => {
    it('is available once the API is installed', () => {
      expect(deviceProvider.isAvailable()).toBe(true)
    })

    it('is unavailable when the browser has no speech synthesis', () => {
      uninstallFakeSpeech()

      expect(deviceProvider.isAvailable()).toBe(false)
      expect(deviceProvider.listVoices()).toEqual([])
    })

    // Some locked-down webviews expose the synthesis object with no constructor; assuming
    // one from the other is a ReferenceError at the worst possible moment.
    it('is unavailable when the utterance constructor is missing', () => {
      Reflect.deleteProperty(window, 'SpeechSynthesisUtterance')

      expect(deviceProvider.isAvailable()).toBe(false)
    })
  })

  describe('listVoices', () => {
    it('maps the engine list and sorts local voices first, then by name', () => {
      uninstallFakeSpeech()
      installFakeSpeech({
        voices: [
          { voiceURI: 'r-zoe', name: 'Zoe', lang: 'en-US', localService: false },
          { voiceURI: 'l-wren', name: 'Wren', lang: 'en-GB', localService: true, default: true },
          { voiceURI: 'l-alba', name: 'Alba', lang: 'es-ES', localService: true },
        ],
      })

      expect(deviceProvider.listVoices()).toEqual([
        { uri: 'l-alba', name: 'Alba', lang: 'es-ES', localService: true, isDefault: false },
        { uri: 'l-wren', name: 'Wren', lang: 'en-GB', localService: true, isDefault: true },
        { uri: 'r-zoe', name: 'Zoe', lang: 'en-US', localService: false, isDefault: false },
      ])
    })
  })

  describe('speak', () => {
    // The whole page goes into the queue inside the Play gesture. Scheduling chunk N+1
    // from chunk N's `end` handler would make every sentence after the first a
    // non-gesture speak(), which iOS Safari refuses.
    it('queues every chunk in one synchronous burst', () => {
      const { events } = recorder()

      deviceProvider.speak(CHUNKS, OPTS, events)

      expect(control.spoken()).toEqual([
        'Luna woke up.',
        'The garden was glowing.',
        'She ran outside.',
      ])
    })

    it('starts from fromChunk and reports absolute chunk indices', () => {
      const { events, onChunkStart, onChunkEnd } = recorder()

      deviceProvider.speak(CHUNKS, { ...OPTS, fromChunk: 1 }, events)
      expect(control.spoken()).toEqual(['The garden was glowing.', 'She ran outside.'])

      vi.advanceTimersByTime(1000)
      expect(onChunkStart.mock.calls.map((call) => call[0])).toEqual([1, 2])
      expect(onChunkEnd.mock.calls.map((call) => call[0])).toEqual([1, 2])
    })

    it('fires start/end per chunk in order, then onDone exactly once', () => {
      const { events, log, onDone } = recorder()

      deviceProvider.speak(CHUNKS, OPTS, events)
      vi.advanceTimersByTime(1000)

      expect(log).toEqual([
        'start:0',
        'end:0',
        'start:1',
        'end:1',
        'start:2',
        'end:2',
        'done',
      ])
      expect(onDone).toHaveBeenCalledTimes(1)
    })

    it('does nothing when fromChunk is past the end of the list', () => {
      const { events } = recorder()

      deviceProvider.speak(CHUNKS, { ...OPTS, fromChunk: 3 }, events)
      vi.advanceTimersByTime(1000)

      expect(control.spoken()).toEqual([])
    })

    // The regression fence for auto-advance: cancel() still fires `end` on the in-flight
    // utterance, asynchronously, after the reader has already turned the page. If that
    // late event reached onDone, narration would advance a page nobody is looking at.
    it('cancel() suppresses the late onDone from the in-flight utterance', () => {
      const { events, onChunkStart, onChunkEnd, onDone } = recorder()

      const handle = deviceProvider.speak(CHUNKS.slice(0, 1), OPTS, events)
      vi.advanceTimersByTime(1)
      expect(onChunkStart).toHaveBeenCalledWith(0)

      handle.cancel()
      expect(control.cancelCount()).toBe(1)

      vi.advanceTimersByTime(1000)
      expect(onChunkEnd).not.toHaveBeenCalled()
      expect(onDone).not.toHaveBeenCalled()
    })

    it('delegates pause and resume to the engine', () => {
      const { events } = recorder()

      const handle = deviceProvider.speak(CHUNKS, OPTS, events)
      vi.advanceTimersByTime(1)

      handle.pause()
      expect(window.speechSynthesis.paused).toBe(true)

      handle.resume()
      expect(window.speechSynthesis.paused).toBe(false)
    })
  })

  describe('boundary events', () => {
    it('reports word-granularity boundaries and ignores sentence-granularity ones', () => {
      const { events, onWordBoundary } = recorder()

      deviceProvider.speak(CHUNKS.slice(0, 1), OPTS, events)
      const utterance = control.utterances()[0]
      expect(utterance).toBeDefined()

      // Safari fires `boundary` at sentence granularity; treating that as a word would
      // highlight the whole sentence as one "word".
      utterance?.onboundary?.(boundaryEvent({ name: 'sentence', charIndex: 0, charLength: 13 }))
      expect(onWordBoundary).not.toHaveBeenCalled()

      utterance?.onboundary?.(boundaryEvent({ name: 'word', charIndex: 5, charLength: 4 }))
      expect(onWordBoundary).toHaveBeenCalledWith(0, 5, 4)

      // Some engines omit charLength entirely.
      utterance?.onboundary?.(boundaryEvent({ name: 'word', charIndex: 10 }))
      expect(onWordBoundary).toHaveBeenLastCalledWith(0, 10, 0)
    })
  })

  describe('error mapping', () => {
    const CASES: [string, NarrationErrorReason][] = [
      ['canceled', 'canceled'],
      ['interrupted', 'canceled'],
      ['not-allowed', 'not-allowed'],
      ['synthesis-failed', 'synthesis-failed'],
      ['synthesis-unavailable', 'synthesis-failed'],
      ['audio-busy', 'synthesis-failed'],
      ['audio-hardware', 'synthesis-failed'],
      ['language-unavailable', 'unknown'],
      ['something-new-in-chrome-2030', 'unknown'],
    ]

    it.each(CASES)('maps engine error %s to %s', (code, reason) => {
      const { events, onError, onDone } = recorder()

      deviceProvider.speak(CHUNKS, OPTS, events)
      vi.advanceTimersByTime(1)
      control.failCurrent(code)

      expect(onError).toHaveBeenCalledWith(reason)
      expect(onDone).not.toHaveBeenCalled()
    })
  })

  describe('utterance configuration', () => {
    // Assigning a stale or missing voice object is a common source of silent failure:
    // the engine speaks nothing at all rather than falling back.
    it('leaves voice unset when the voiceURI is not in the current list', () => {
      const { events } = recorder()

      deviceProvider.speak(CHUNKS.slice(0, 1), { ...OPTS, voiceURI: 'urn:voice:gone' }, events)

      expect(control.utterances()[0]?.voice).toBeNull()
    })

    it('assigns the matching voice when the voiceURI is present', () => {
      const { events } = recorder()

      deviceProvider.speak(
        CHUNKS.slice(0, 1),
        { ...OPTS, voiceURI: 'urn:voice:samantha' },
        events,
      )

      expect(control.utterances()[0]?.voice?.voiceURI).toBe('urn:voice:samantha')
    })

    // Defence in depth — prefs clamps too, but an out-of-range rate makes some engines
    // refuse to speak at all, and this is the boundary where it reaches a real API.
    it('clamps the rate onto the utterance', () => {
      const { events } = recorder()

      deviceProvider.speak(CHUNKS.slice(0, 1), { ...OPTS, rate: 4 }, events)
      deviceProvider.speak(CHUNKS.slice(1, 2), { ...OPTS, rate: 0.1 }, events)

      expect(control.utterances()[0]?.rate).toBe(1.5)
      expect(control.utterances()[1]?.rate).toBe(0.75)
    })
  })
})
