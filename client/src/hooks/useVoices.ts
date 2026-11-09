import { useEffect, useMemo, useState } from 'react'
import { GENERATED_VOICE_PREFIX, type NarrationVoicesResponse } from '@storybook/shared'
import { fetchVoices } from '../lib/narration/api'
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

/** The rung-0 default when generated voices are available and nothing is persisted. */
export const DEFAULT_GENERATED_VOICE_URI = `${GENERATED_VOICE_PREFIX}af_heart`

export interface UseVoicesOptions {
  /**
   * Whether the host wired a generated provider. When false, the voices route is never
   * called and the hook is exactly the device-only hook it always was.
   */
  generated?: boolean
}

export interface UseVoicesResult {
  /** Generated voices first (when available), then device voices. */
  voices: NarrationVoice[]
  status: VoiceStatus
  defaultVoiceURI: string | null
  /**
   * The device-only ladder's pick. This is what a generated failure falls back to, and what
   * a generated preference is spoken with when generation cannot be used here.
   */
  deviceDefaultVoiceURI: string | null
  /** The voices route answered `available: true` with at least one voice. */
  generatedAvailable: boolean
}

/**
 * Generated-voice discovery is fetched **once per session**, not once per mount: the
 * player remounts on every book, and availability is a server fact that does not move
 * between pages. A failed fetch resolves to "unavailable" and is cached too — the device
 * voice is the floor, and retrying a down route on every book would only add latency.
 */
const NO_VOICES: NarrationVoice[] = []

let generatedVoicesPromise: Promise<NarrationVoice[]> | null = null
/** The resolved value, so a remount after the first fetch starts in its final state. */
let generatedVoicesResolved: NarrationVoice[] | null = null

function toNarrationVoices(response: NarrationVoicesResponse): NarrationVoice[] {
  if (!response.available) return []
  return response.voices.map((voice) => ({
    uri: `${GENERATED_VOICE_PREFIX}${voice.id}`,
    name: `${voice.label} — ${voice.description}`,
    lang: 'en-US',
    localService: false,
    isDefault: `${GENERATED_VOICE_PREFIX}${voice.id}` === DEFAULT_GENERATED_VOICE_URI,
    kind: 'generated' as const,
  }))
}

function loadGeneratedVoices(): Promise<NarrationVoice[]> {
  generatedVoicesPromise ??= fetchVoices()
    .then(toNarrationVoices, () => [])
    .then((voices) => {
      generatedVoicesResolved = voices
      return voices
    })
  return generatedVoicesPromise
}

/** Test seam: forget the session's voices-route answer. Never called by app code. */
export function resetGeneratedVoicesCache(): void {
  generatedVoicesPromise = null
  generatedVoicesResolved = null
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
 * 0. `generated:af_heart` — when generated voices are available and **nothing is
 *    persisted** (Nick's ruling, 2026-11-08). See `pickDefaultVoiceURI`.
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
function pickDeviceVoiceURI(
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

/**
 * Rung 0, then the device ladder. Rungs 2–5 run over **device voices only**: a generated
 * voice is tagged `en-US` and would otherwise win rung 3 on any English page, silently
 * overriding a reader who persisted a device voice that has since vanished.
 *
 * A persisted `generated:*` URI while generation is unavailable is simply "not in the
 * list" — rung 1's existing rule — so it falls through to the device ladder unchanged.
 */
function pickDefaultVoiceURI(
  generated: NarrationVoice[],
  device: NarrationVoice[],
  persistedVoiceURI: string | null,
): string | null {
  const hasGeneratedDefault = generated.some((voice) => voice.uri === DEFAULT_GENERATED_VOICE_URI)
  if (persistedVoiceURI === null && hasGeneratedDefault) return DEFAULT_GENERATED_VOICE_URI
  if (persistedVoiceURI && generated.some((voice) => voice.uri === persistedVoiceURI)) {
    return persistedVoiceURI
  }
  // Last resort on a device with no speech engine at all: the generated voice beats silence.
  return pickDeviceVoiceURI(device, persistedVoiceURI) ?? generated[0]?.uri ?? null
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

export function useVoices(
  persistedVoiceURI: string | null,
  { generated: generatedEnabled = false }: UseVoicesOptions = {},
): UseVoicesResult {
  const [state, setState] = useState<VoiceListState>(initialState)
  /** `null` while the voices route is still in flight. */
  const [fetched, setFetched] = useState<NarrationVoice[] | null>(generatedVoicesResolved)
  // Derived rather than reset in an effect: a host without a generated provider sees none.
  const generated = generatedEnabled ? fetched : NO_VOICES

  useEffect(() => {
    if (!generatedEnabled || fetched !== null) return
    let live = true
    void loadGeneratedVoices().then((voices) => {
      if (live) setFetched(voices)
    })
    return () => {
      live = false
    }
  }, [generatedEnabled, fetched])

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

  const generatedVoices = generated ?? NO_VOICES

  const voices = useMemo(
    () => (generatedVoices.length > 0 ? [...generatedVoices, ...state.voices] : state.voices),
    [generatedVoices, state.voices],
  )

  // Ready if *either* list has a voice: a browser with no speech engine can still play
  // generated clips. Loading while either source might still produce one.
  const status: VoiceStatus =
    voices.length > 0
      ? 'ready'
      : state.status === 'loading' || generated === null
        ? 'loading'
        : 'unavailable'

  const defaultVoiceURI = useMemo(
    () => pickDefaultVoiceURI(generatedVoices, state.voices, persistedVoiceURI),
    [generatedVoices, state.voices, persistedVoiceURI],
  )

  const deviceDefaultVoiceURI = useMemo(
    () => pickDeviceVoiceURI(state.voices, persistedVoiceURI),
    [state.voices, persistedVoiceURI],
  )

  return {
    voices,
    status,
    defaultVoiceURI,
    deviceDefaultVoiceURI,
    generatedAvailable: generatedVoices.length > 0,
  }
}
