import {
  GENERATED_VOICE_PREFIX,
  NARRATION_VOICES,
  NarrationVoiceIdSchema,
  slotKey,
  type NarrationReady,
  type NarrationVoiceId,
} from '@storybook/shared'
import { api } from '../apiBase'
import { NarrationApiError, getNarration, postNarration } from './api'
import { clampRate } from './prefs'
import type { NarrationChunk, NarrationVoice } from './types'
import type {
  NarrationErrorReason,
  NarrationEvents,
  NarrationHandle,
  NarrationProvider,
  NarrationSpeakOptions,
  NarrationTarget,
} from './provider'

/**
 * The generated `NarrationProvider`: server-synthesised clips (Kokoro via fal, one WAV per
 * chunk) played through **one** `<audio>` element for the provider's lifetime.
 *
 * Shape, per spec §Design question 5:
 * - `speak()` primes the element with a silent WAV *synchronously*, before any `await`.
 *   iOS only lets `play()` start inside a gesture; the clips arrive after a network call,
 *   so the gesture is spent unlocking the element, and every later source — including
 *   auto-advanced pages — plays on the already-unlocked element.
 * - Then GET the cached clips; on a miss, POST to generate them (signed in only). The
 *   server's segment offsets must equal the client's chunk offsets, or highlighting would
 *   lie — a mismatch is a failure, and the hook falls back to the device voice.
 * - Clip *i* is chunk *i*: `playing` → `onChunkStart(i)`, `ended` → `onChunkEnd(i)`, next.
 * - `play()` rejecting with `NotAllowedError` reports `'not-allowed'` itself, which is why
 *   `needsStartWatchdog` is false here.
 * - Kokoro returns no word timings, so `onWordBoundary` never fires.
 *
 * Rate is never sent to the server (clips are always synthesised at speed 1, so rate is
 * not part of the cache key); it is applied with `playbackRate`.
 */

/** ~10 ms of 8 kHz mono 8-bit silence. Only ever used to unlock the element in a gesture. */
export const SILENT_WAV =
  'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA=='

const DEFAULT_GENERATED_VOICE: NarrationVoiceId = 'af_heart'

export interface GeneratedProviderDeps {
  /** Read at call time, so a sign-in after construction is picked up. */
  getToken: () => string | null
  fetchImpl?: typeof fetch
  createAudio?: () => HTMLAudioElement
}

/** `generated:af_heart` → `'af_heart'`; anything else (a device URI, an unknown id) → null. */
export function generatedVoiceId(voiceURI: string | null): NarrationVoiceId | null {
  if (!voiceURI || !voiceURI.startsWith(GENERATED_VOICE_PREFIX)) return null
  const parsed = NarrationVoiceIdSchema.safeParse(voiceURI.slice(GENERATED_VOICE_PREFIX.length))
  return parsed.success ? parsed.data : null
}

/** An error the provider maps straight onto a reason, without going through HTTP status. */
class ReasonError extends Error {
  readonly reason: NarrationErrorReason

  constructor(reason: NarrationErrorReason) {
    super(reason)
    this.reason = reason
  }
}

/**
 * HTTP → reason. 501 and 401 mean "this reader cannot generate here" (not configured, or a
 * stale token behaves like signed out); 429/503 are spend denials and stick for the
 * session; everything else — 409, other 4xx/5xx, network, malformed body — is a one-off
 * failure that the next page retries.
 */
function reasonFor(err: unknown): NarrationErrorReason {
  if (err instanceof ReasonError) return err.reason
  if (err instanceof NarrationApiError) {
    if (err.status === 501 || err.status === 401) return 'generation-unavailable'
    if (err.status === 429 || err.status === 503) return 'quota'
  }
  return 'synthesis-failed'
}

/** True when segment *i* covers exactly chunk *i* — the contract the highlight relies on. */
function offsetsMatch(ready: NarrationReady, chunks: NarrationChunk[]): boolean {
  const segments = [...ready.segments].sort((a, b) => a.index - b.index)
  if (segments.length !== chunks.length) return false
  return segments.every((segment, i) => {
    const chunk = chunks[i]
    return chunk !== undefined && segment.index === i && segment.start === chunk.start && segment.end === chunk.end
  })
}

const INERT_HANDLE: NarrationHandle = {
  cancel: () => {},
  pause: () => {},
  resume: () => {},
  setRate: () => {},
}

export function createGeneratedProvider(deps: GeneratedProviderDeps): NarrationProvider {
  const fetchImpl: typeof fetch = deps.fetchImpl ?? ((input, init) => fetch(input, init))
  const createAudio = deps.createAudio ?? (() => new Audio())

  let element: HTMLAudioElement | null = null
  let preloader: HTMLAudioElement | null = null
  /** Set by the first spend denial; every later speak/prefetch short-circuits. */
  let quotaBlocked = false
  /** Bumped on every `speak()`, so a superseded handle can never drive the shared element. */
  let activeRun = 0

  /** Resolved clips, keyed by (bookId, slot, voiceId). */
  const ready = new Map<string, NarrationReady>()
  /** In-flight loads, so a prefetch and a speak for the same slot share one POST. */
  const inflight = new Map<string, Promise<NarrationReady>>()

  const audio = (): HTMLAudioElement => (element ??= createAudio())
  const cacheKey = (target: NarrationTarget, voiceId: NarrationVoiceId): string =>
    `${target.bookId}|${slotKey(target.slot)}|${voiceId}`

  /** GET, then POST on a miss when signed in. Deduped; a failure is never cached. */
  function load(target: NarrationTarget, voiceId: NarrationVoiceId): Promise<NarrationReady> {
    const key = cacheKey(target, voiceId)
    const existing = inflight.get(key)
    if (existing) return existing

    const run = (async (): Promise<NarrationReady> => {
      const cached = await getNarration(target.bookId, target.slot, voiceId, fetchImpl)
      if (cached.status === 'ready') return cached
      const token = deps.getToken()
      if (!token) throw new ReasonError('generation-unavailable')
      return postNarration(target.bookId, { voiceId, slot: target.slot }, token, fetchImpl)
    })()

    const tracked = run.then(
      (result) => {
        ready.set(key, result)
        inflight.delete(key)
        return result
      },
      (err: unknown) => {
        inflight.delete(key)
        if (reasonFor(err) === 'quota') quotaBlocked = true
        throw err
      },
    )
    inflight.set(key, tracked)
    return tracked
  }

  return {
    id: 'generated',
    needsStartWatchdog: false,

    isAvailable(): boolean {
      return deps.createAudio !== undefined || (typeof window !== 'undefined' && typeof window.Audio === 'function')
    },

    /** The static catalog. Whether generation is *available* is the voices route's call (the hook's). */
    listVoices(): NarrationVoice[] {
      return NARRATION_VOICES.map((voice) => ({
        uri: `${GENERATED_VOICE_PREFIX}${voice.id}`,
        name: `${voice.label} — ${voice.description}`,
        lang: 'en-US',
        localService: false,
        isDefault: voice.id === DEFAULT_GENERATED_VOICE,
      }))
    },

    prefetch(target: NarrationTarget, voiceURI: string): void {
      const voiceId = generatedVoiceId(voiceURI)
      if (!voiceId || quotaBlocked) return
      if (ready.has(cacheKey(target, voiceId))) return
      // Fire-and-forget: the failure (and a quota denial's stickiness) is recorded in `load`.
      load(target, voiceId).catch(() => {})
    },

    speak(
      chunks: NarrationChunk[],
      opts: NarrationSpeakOptions,
      events: NarrationEvents,
    ): NarrationHandle {
      const from = Math.max(0, Math.floor(opts.fromChunk))
      if (from >= chunks.length) return INERT_HANDLE

      const run = ++activeRun
      const el = audio()
      let dead = false
      let paused = false
      let rate = clampRate(opts.rate)
      /** The clip currently loaded on the element, or null while preparing. */
      let current: number | null = null
      let startedCurrent = false

      const silent = (): boolean => dead || run !== activeRun

      const detach = (): void => {
        el.onplaying = null
        el.onended = null
        el.onerror = null
      }

      const failWith = (reason: NarrationErrorReason): void => {
        if (silent()) return
        dead = true
        detach()
        events.onError(reason)
      }

      // --- Prime: synchronous, before any await — this is the gesture-bound call. -------
      detach()
      el.src = SILENT_WAV
      // A rejected prime is not reported: the clip's own `play()` will reject the same way
      // and that is the call whose refusal means something. An `AbortError` from the
      // source swap that follows is expected.
      el.play().catch(() => {})

      const applyRate = (): void => {
        el.defaultPlaybackRate = rate
        el.playbackRate = rate
      }

      const doPlay = (): void => {
        el.play().catch((err: unknown) => {
          if (silent()) return
          const name = err instanceof DOMException ? err.name : ''
          if (name === 'AbortError') return
          failWith(name === 'NotAllowedError' ? 'not-allowed' : 'synthesis-failed')
        })
      }

      const playClip = (clips: NarrationReady, index: number): void => {
        if (silent()) return
        const segment = clips.segments.find((s) => s.index === index)
        if (!segment) return failWith('synthesis-failed')

        current = index
        startedCurrent = false
        el.onplaying = () => {
          // `playing` fires again after every resume; the chunk started once.
          if (silent() || startedCurrent) return
          startedCurrent = true
          events.onChunkStart(index)
        }
        el.onended = () => {
          if (silent()) return
          events.onChunkEnd(index)
          if (index === chunks.length - 1) {
            dead = true
            detach()
            events.onDone()
            return
          }
          playClip(clips, index + 1)
        }
        el.onerror = () => failWith('synthesis-failed')

        el.src = api(segment.url)
        // Loading a new source resets `playbackRate` to `defaultPlaybackRate`; set both.
        applyRate()

        // Warm the next clip on a separate, never-played element to keep the gap short.
        const next = clips.segments.find((s) => s.index === index + 1)
        if (next) {
          preloader ??= createAudio()
          preloader.preload = 'auto'
          preloader.src = api(next.url)
        }

        if (!paused) doPlay()
      }

      const target = opts.target ?? null
      const voiceId = generatedVoiceId(opts.voiceURI)
      const key = target && voiceId ? cacheKey(target, voiceId) : null
      const needsFetch = key !== null && !quotaBlocked && !ready.has(key)

      const begin = async (): Promise<void> => {
        if (!target || !voiceId || !key) return failWith('generation-unavailable')
        if (quotaBlocked) return failWith('quota')

        let clips = ready.get(key)
        if (!clips) {
          try {
            clips = await load(target, voiceId)
          } catch (err) {
            return failWith(reasonFor(err))
          }
        }
        if (silent()) return
        if (!offsetsMatch(clips, chunks)) return failWith('synthesis-failed')
        playClip(clips, from)
      }

      // Preparing is reported synchronously, inside the gesture, so the UI can show the
      // spinner on the same frame as the tap. A cached slot plays at once and skips it.
      if (needsFetch) events.onPreparing?.()

      // Everything else is delivered asynchronously — even the paths that could fail
      // immediately (no target, quota already blocked) — so the hook has stored this
      // handle before it hears an error, the same ordering `deviceProvider`'s engine
      // events give it.
      void Promise.resolve().then(begin)

      return {
        cancel() {
          if (dead) return
          dead = true
          if (run === activeRun) {
            detach()
            el.pause()
          }
        },
        pause() {
          if (silent()) return
          paused = true
          el.pause()
        },
        resume() {
          if (silent()) return
          paused = false
          if (current !== null) doPlay()
        },
        setRate(next: number) {
          rate = clampRate(next)
          if (!silent()) applyRate()
        },
      }
    },
  }
}
