import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useVoices, VOICE_LOAD_TIMEOUT_MS } from '../useVoices'
import {
  installFakeSpeech,
  uninstallFakeSpeech,
  type FakeVoiceSpec,
} from '../../test/fakeSpeech'

/**
 * `getVoices()` is empty on the first call in Chrome, lazy in Safari, and never populated
 * at all in some headless and locked-down environments. These tests are mostly about the
 * three-state resolution and the default-pick ladder, one test per rung.
 */

/** Local voices sort first by name, so `voices[0]` here is Amelie, not the en-US voice. */
const MIXED_VOICES: FakeVoiceSpec[] = [
  { voiceURI: 'zoe-local', name: 'Zoe', lang: 'en-US', localService: true },
  { voiceURI: 'amelie-local', name: 'Amelie', lang: 'fr-FR', localService: true },
  { voiceURI: 'daniel-remote', name: 'Daniel', lang: 'en-GB', localService: false },
]

/** No local voice for any English locale — forces the ladder past rung 2. */
const NO_LOCAL_ENGLISH: FakeVoiceSpec[] = [
  { voiceURI: 'amelie-local', name: 'Amelie', lang: 'fr-FR', localService: true },
  { voiceURI: 'daniel-remote', name: 'Daniel', lang: 'en-GB', localService: false },
]

function setNavigatorLanguage(lang: string): void {
  Object.defineProperty(window.navigator, 'language', { value: lang, configurable: true })
}

describe('useVoices', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    uninstallFakeSpeech()
    vi.useRealTimers()
    vi.restoreAllMocks()
    // Drop the own-property override so the jsdom prototype getter is back in charge.
    Reflect.deleteProperty(window.navigator, 'language')
    document.documentElement.lang = ''
  })

  describe('status resolution', () => {
    it('is ready synchronously when the engine already has voices', () => {
      installFakeSpeech({ voices: MIXED_VOICES })

      const { result } = renderHook(() => useVoices(null))

      expect(result.current.status).toBe('ready')
      expect(result.current.voices.map((voice) => voice.uri)).toEqual([
        'amelie-local',
        'zoe-local',
        'daniel-remote',
      ])
    })

    // Chrome's first getVoices() call returns [] and the list arrives on `voiceschanged`.
    it('reports loading until voiceschanged populates the list', () => {
      installFakeSpeech({ voices: MIXED_VOICES, voicesReadyAfterMs: 50 })

      const { result } = renderHook(() => useVoices(null))
      expect(result.current.status).toBe('loading')
      expect(result.current.voices).toEqual([])

      act(() => {
        vi.advanceTimersByTime(50)
      })

      expect(result.current.status).toBe('ready')
      expect(result.current.voices).toHaveLength(3)
    })

    // Never leave the UI spinning: an honest disabled player beats an eternal spinner.
    it('falls to unavailable after the timeout rather than staying on loading', () => {
      installFakeSpeech({ voices: [] })

      const { result } = renderHook(() => useVoices(null))
      expect(result.current.status).toBe('loading')

      act(() => {
        vi.advanceTimersByTime(VOICE_LOAD_TIMEOUT_MS - 1)
      })
      expect(result.current.status).toBe('loading')

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(result.current.status).toBe('unavailable')
      expect(result.current.defaultVoiceURI).toBeNull()
    })

    it('reports unavailable immediately when the browser has no speech synthesis', () => {
      const { result } = renderHook(() => useVoices(null))

      expect(result.current.status).toBe('unavailable')
      expect(result.current.voices).toEqual([])
      expect(result.current.defaultVoiceURI).toBeNull()
    })

    // `voiceschanged` fires repeatedly on some engines, so the listener must come off.
    it('removes the voiceschanged listener on unmount', () => {
      installFakeSpeech({ voices: [] })
      const removeEventListener = vi.spyOn(window.speechSynthesis, 'removeEventListener')

      const { unmount } = renderHook(() => useVoices(null))
      unmount()

      expect(removeEventListener).toHaveBeenCalledWith('voiceschanged', expect.any(Function))
    })
  })

  describe('default voice ladder', () => {
    it('rung 1 — keeps the persisted voice when it is still in the list', () => {
      setNavigatorLanguage('en-US')
      installFakeSpeech({ voices: MIXED_VOICES })

      const { result } = renderHook(() => useVoices('daniel-remote'))

      expect(result.current.defaultVoiceURI).toBe('daniel-remote')
    })

    // The cross-device case: voices disappear across OS updates and do not exist at all
    // on a different machine, so a persisted URI is a hint, never a guarantee.
    it('rung 1 → 2 — falls through when the persisted voice is gone', () => {
      setNavigatorLanguage('en-US')
      installFakeSpeech({ voices: MIXED_VOICES })

      const { result } = renderHook(() => useVoices('urn:voice:from-an-old-phone'))

      expect(result.current.defaultVoiceURI).toBe('zoe-local')
    })

    it('rung 2 — prefers a local voice matching navigator.language', () => {
      setNavigatorLanguage('en-US')
      installFakeSpeech({ voices: MIXED_VOICES })

      const { result } = renderHook(() => useVoices(null))

      // Not `voices[0]` (Amelie) and not the engine default — the local en-US voice.
      expect(result.current.defaultVoiceURI).toBe('zoe-local')
    })

    it('rung 3 — falls back to a language-prefix match on the document language', () => {
      setNavigatorLanguage('en-AU')
      document.documentElement.lang = 'en'
      installFakeSpeech({ voices: NO_LOCAL_ENGLISH })

      const { result } = renderHook(() => useVoices(null))

      expect(result.current.defaultVoiceURI).toBe('daniel-remote')
    })

    it('rung 4 — falls back to the voice the engine flags as default', () => {
      setNavigatorLanguage('ja-JP')
      document.documentElement.lang = 'ja'
      installFakeSpeech({
        voices: [
          { voiceURI: 'amelie-local', name: 'Amelie', lang: 'fr-FR', localService: true },
          {
            voiceURI: 'daniel-remote',
            name: 'Daniel',
            lang: 'en-GB',
            localService: false,
            default: true,
          },
        ],
      })

      const { result } = renderHook(() => useVoices(null))

      expect(result.current.defaultVoiceURI).toBe('daniel-remote')
    })

    it('rung 5 — falls back to the first voice in the sorted list', () => {
      setNavigatorLanguage('ja-JP')
      document.documentElement.lang = 'ja'
      installFakeSpeech({ voices: NO_LOCAL_ENGLISH })

      const { result } = renderHook(() => useVoices(null))

      expect(result.current.defaultVoiceURI).toBe('amelie-local')
    })
  })
})
