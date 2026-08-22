import { useEffect, useMemo, useState } from 'react'
import { deviceProvider } from '../lib/narration/deviceProvider'
import type { NarrationVoice } from '../lib/narration/types'

/**
 * Voice discovery, which is the messiest corner of the Web Speech API.
 *
 * `getVoices()` returns `[]` on the first call in Chrome and populates asynchronously;
 * Safari populates lazily on the first `speak()`; some Linux, headless, and locked-down
 * environments never populate at all. So this resolves to one of three states rather than
 * assuming success — and it must never leave the UI spinning on `'loading'` forever,
 * because a play button that silently does nothing is worse than an honest disabled one.
 */

/** After this, an empty list is treated as "there are no voices", not "still loading". */
export const VOICE_LOAD_TIMEOUT_MS = 2000

export type VoiceStatus = 'loading' | 'ready' | 'unavailable'

export interface UseVoicesResult {
  voices: NarrationVoice[]
  status: VoiceStatus
  defaultVoiceURI: string | null
}

/** `en_US` / `EN-us` / `en-US` all normalise to the same thing. */
function normaliseLang(lang: string): string {
  return lang.replace('_', '-').toLowerCase()
}

function langPrefix(lang: string): string {
  const [prefix = ''] = normaliseLang(lang).split('-')
  return prefix
}

function navigatorLanguage(): string {
  return typeof navigator !== 'undefined' ? navigator.language : ''
}

function documentLanguage(): string {
  if (typeof document === 'undefined') return ''
  return document.documentElement.lang
}

/**
 * The default-voice ladder, in order. Every rung exists for a reason:
 *
 * 1. The persisted choice — **only if it is still in the list.** Voices disappear across
 *    OS updates and do not exist at all on a different device.
 * 2. A local voice matching `navigator.language`. Local voices need no network, so they
 *    work offline in the PWA, and they are the higher-quality option on Apple platforms.
 * 3. Any voice whose language prefix matches the document language.
 * 4. Whatever the engine itself flags as default.
 * 5. The first voice in the list (already sorted local-first, then by name).
 * 6. Nothing.
 *
 * There is deliberately **no hand-maintained allow/deny list of voice names** — that is a
 * maintenance trap across OS versions and locales.
 */
function pickDefaultVoiceURI(
  voices: NarrationVoice[],
  persistedVoiceURI: string | null,
): string | null {
  if (voices.length === 0) return null

  if (persistedVoiceURI && voices.some((voice) => voice.uri === persistedVoiceURI)) {
    return persistedVoiceURI
  }

  const navLang = normaliseLang(navigatorLanguage())
  if (navLang) {
    const local = voices.find(
      (voice) => voice.localService && normaliseLang(voice.lang) === navLang,
    )
    if (local) return local.uri
  }

  const prefix = langPrefix(documentLanguage() || navigatorLanguage())
  if (prefix) {
    const byPrefix = voices.find((voice) => langPrefix(voice.lang) === prefix)
    if (byPrefix) return byPrefix.uri
  }

  const flagged = voices.find((voice) => voice.isDefault)
  if (flagged) return flagged.uri

  return voices[0]?.uri ?? null
}

interface VoiceListState {
  voices: NarrationVoice[]
  status: VoiceStatus
}

function initialState(): VoiceListState {
  if (!deviceProvider.isAvailable()) return { voices: [], status: 'unavailable' }
  const voices = deviceProvider.listVoices()
  return voices.length > 0 ? { voices, status: 'ready' } : { voices: [], status: 'loading' }
}

export function useVoices(persistedVoiceURI: string | null): UseVoicesResult {
  const [state, setState] = useState<VoiceListState>(initialState)

  useEffect(() => {
    if (!deviceProvider.isAvailable()) return
    // Already resolved synchronously on mount; nothing to wait for.
    if (deviceProvider.listVoices().length > 0) return

    const synth = window.speechSynthesis
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const settle = (voices: NarrationVoice[]): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      synth.removeEventListener('voiceschanged', onVoicesChanged)
      setState(
        voices.length > 0 ? { voices, status: 'ready' } : { voices: [], status: 'unavailable' },
      )
    }

    // `voiceschanged` fires repeatedly on some engines, and sometimes with a still-empty
    // list, so an empty payload is not treated as a resolution.
    function onVoicesChanged(): void {
      const voices = deviceProvider.listVoices()
      if (voices.length > 0) settle(voices)
    }

    synth.addEventListener('voiceschanged', onVoicesChanged)
    timer = setTimeout(() => settle(deviceProvider.listVoices()), VOICE_LOAD_TIMEOUT_MS)

    return () => {
      if (timer !== undefined) clearTimeout(timer)
      synth.removeEventListener('voiceschanged', onVoicesChanged)
    }
  }, [])

  const defaultVoiceURI = useMemo(
    () => pickDefaultVoiceURI(state.voices, persistedVoiceURI),
    [state.voices, persistedVoiceURI],
  )

  return { voices: state.voices, status: state.status, defaultVoiceURI }
}
