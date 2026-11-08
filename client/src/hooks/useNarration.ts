import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GENERATED_VOICE_PREFIX } from '@storybook/shared'
import { splitIntoUtterances } from '../lib/narration/chunk'
import { deviceProvider } from '../lib/narration/deviceProvider'
import { clampRate, readPrefs, writePrefs, type NarrationPrefs } from '../lib/narration/prefs'
import type {
  NarrationErrorReason,
  NarrationEvents,
  NarrationHandle,
  NarrationProvider,
  NarrationTarget,
} from '../lib/narration/provider'
import type {
  NarrationChunk,
  NarrationPosition,
  NarrationState,
  NarrationVoice,
} from '../lib/narration/types'
import { useVoices, type VoiceStatus } from './useVoices'

/**
 * The narration playback state machine.
 *
 * **The page index is the master; audio is the follower.** Narration may *request* a page
 * turn via `onRequestNext()`, and the host decides whether to honour it. That direction is
 * the whole design: state flows one way, so there is no reconciliation logic and no two
 * sources of truth that can disagree during a transition.
 *
 * The host signals a page change by changing `pageKey`. Any change cancels in-flight audio
 * immediately — the previous page's audio still talking under a new illustration is the
 * worst available outcome, and the one this hook designs hardest against.
 */

/** Settle before turning the page so the last word does not collide with the flip. */
export const AUTO_ADVANCE_DELAY_MS = 400

/** iOS may refuse a `speak()` that did not originate in a gesture; do not appear frozen. */
export const START_WATCHDOG_MS = 1500

/**
 * The generated-path failures that fall back to the device voice instead of stopping.
 * One line each, shown in the player (not a toast). Copy per spec §Design question 3.
 */
export const FALLBACK_NOTICES = {
  'generation-unavailable': "Using this device's voice — AI voices aren't available here.",
  quota: "Using this device's voice — daily limit reached.",
  'synthesis-failed': "Using this device's voice — the AI voice couldn't load this page.",
} as const satisfies Partial<Record<NarrationErrorReason, string>>

type FallbackReason = keyof typeof FALLBACK_NOTICES

function isFallbackReason(reason: NarrationErrorReason): reason is FallbackReason {
  return reason in FALLBACK_NOTICES
}

function isGeneratedURI(uri: string | null): uri is string {
  return uri !== null && uri.startsWith(GENERATED_VOICE_PREFIX)
}

export interface UseNarrationArgs {
  /** The text of the page currently on screen, or null on spreads with nothing to read. */
  text: string | null
  /** Changes whenever the visible page changes. Any change cancels in-flight audio. */
  pageKey: string | number
  /** Called after the last chunk when auto-advance is on. The host decides whether to honour it. */
  onRequestNext: () => void
  /** False on the last spread, so narration stops instead of requesting a turn. */
  hasNext: boolean
  /**
   * Which book + slot is on screen — the generated provider's cache key. Null when there is
   * nothing generated audio could be keyed on (e.g. a preview without an id); the device
   * voice is used then.
   */
  target?: NarrationTarget | null
  /** The slot after this one, prefetched while this one plays. Null on the last spread. */
  nextTarget?: NarrationTarget | null
  /**
   * The generated provider, constructed once by the host (it owns the token getter). Null
   * or absent means device-only — exactly the pre-generated-narration hook.
   */
  generatedProvider?: NarrationProvider | null
}

export interface UseNarrationResult {
  state: NarrationState
  /** Null when nothing is being spoken. */
  position: NarrationPosition | null
  /** The renderer's spans come from here; `[]` when `text` is null. */
  chunks: NarrationChunk[]
  /** Set when the watchdog fires — the UI shows "Tap play to continue". */
  needsGesture: boolean
  play(fromChunk?: number): void
  pause(): void
  resume(): void
  stop(): void
  nextSentence(): void
  previousSentence(): void
  prefs: NarrationPrefs
  setPrefs(next: Partial<NarrationPrefs>): void
  voices: NarrationVoice[]
  voiceStatus: VoiceStatus
  /**
   * The voice a Play press would select: the persisted device voice, or else the ladder's
   * pick (which may be `generated:af_heart`). The player's AI disclosure keys off this.
   */
  activeVoiceURI: string | null
  /** True while generated clips are being fetched or generated, before the first clip plays. */
  preparing: boolean
  /** One line explaining a fallback to the device voice; null when there is nothing to say. */
  notice: string | null
}

export function useNarration({
  text,
  pageKey,
  onRequestNext,
  hasNext,
  target = null,
  nextTarget = null,
  generatedProvider = null,
}: UseNarrationArgs): UseNarrationResult {
  // Availability is read once: a browser does not grow a speech engine mid-session, and
  // re-reading it per render would make every callback depend on a value that never moves.
  const [deviceAvailable] = useState(() => deviceProvider.isAvailable())
  const [generatedCapable] = useState(
    () => generatedProvider !== null && generatedProvider.isAvailable(),
  )

  const chunks = useMemo(() => (text ? splitIntoUtterances(text) : []), [text])

  const [prefs, setPrefsState] = useState<NarrationPrefs>(readPrefs)
  const {
    voices,
    status: voiceStatus,
    defaultVoiceURI,
    deviceDefaultVoiceURI,
    generatedAvailable,
  } = useVoices(prefs.voiceURI, { generated: generatedCapable })

  /**
   * Generated narration is usable only when the host wired a provider, the browser can
   * play audio, and the voices route said `available: true`. The route answers
   * asynchronously, so on a device with no speech engine the player turns from
   * unavailable to usable once it does.
   */
  const generatedUsable = generatedCapable && generatedAvailable
  const available = deviceAvailable || generatedUsable

  /**
   * A persisted device voice is honoured as-is (the device provider ignores it if it has
   * gone). Otherwise the ladder decides — which already maps a persisted `generated:*` voice
   * to the device ladder when generation is unusable, since it is then not in the list.
   */
  const activeVoiceURI =
    prefs.voiceURI !== null && !isGeneratedURI(prefs.voiceURI) ? prefs.voiceURI : defaultVoiceURI

  // Never `'unavailable'` internally: availability is applied on the way out, so a late
  // voices-route answer needs no state transition to bring the player to life.
  const [state, setState] = useState<NarrationState>('idle')
  const [position, setPosition] = useState<NarrationPosition | null>(null)
  const [needsGesture, setNeedsGesture] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  /**
   * Provider callbacks fire from timers and engine events, long after the render that
   * created them. Every value they read is therefore mirrored into a ref that is written
   * synchronously, so a callback never observes a stale snapshot of the machine.
   */
  const chunksRef = useRef(chunks)
  chunksRef.current = chunks
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const defaultVoiceURIRef = useRef(defaultVoiceURI)
  defaultVoiceURIRef.current = defaultVoiceURI
  const hasNextRef = useRef(hasNext)
  hasNextRef.current = hasNext
  const onRequestNextRef = useRef(onRequestNext)
  onRequestNextRef.current = onRequestNext
  const activeVoiceURIRef = useRef(activeVoiceURI)
  activeVoiceURIRef.current = activeVoiceURI
  const deviceDefaultVoiceURIRef = useRef(deviceDefaultVoiceURI)
  deviceDefaultVoiceURIRef.current = deviceDefaultVoiceURI
  const generatedUsableRef = useRef(generatedUsable)
  generatedUsableRef.current = generatedUsable
  const generatedProviderRef = useRef(generatedProvider)
  generatedProviderRef.current = generatedProvider
  const targetRef = useRef(target)
  targetRef.current = target
  const nextTargetRef = useRef(nextTarget)
  nextTargetRef.current = nextTarget

  /** A spend denial keeps the device voice for the rest of the session (no POST storm). */
  const quotaBlockedRef = useRef(false)
  /** Set by a generated failure; the rest of this page plays on the device. Reset per page. */
  const deviceForPageRef = useRef(false)
  /** The next slot is prefetched once per page, on its first chunk start. */
  const prefetchedForPageRef = useRef(false)
  /**
   * Fallback re-enters `startPlayback` from inside a provider callback, and `makeEvents` is
   * itself a dependency of `startPlayback` — a ref breaks the cycle.
   */
  const startPlaybackRef = useRef<(fromChunk: number, gesture: boolean) => void>(() => {})

  const stateRef = useRef(state)
  const positionRef = useRef(position)
  const needsGestureRef = useRef(needsGesture)

  /**
   * The stale-callback guard, and the single most important line in the feature.
   *
   * `cancel()` still fires `end` (or `error: 'canceled'`) on the in-flight utterance,
   * asynchronously, after the new page has already mounted. Every provider callback closes
   * over the `runId` current at `speak()` time and returns immediately once it no longer
   * matches. Without it, a fast double-tap on Next produces a phantom auto-advance and a
   * highlight on a page the reader already left.
   */
  const runIdRef = useRef(0)
  const handleRef = useRef<NarrationHandle | null>(null)
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const advanceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const applyState = useCallback((next: NarrationState) => {
    stateRef.current = next
    setState(next)
  }, [])

  const applyPosition = useCallback((next: NarrationPosition | null) => {
    positionRef.current = next
    setPosition(next)
  }, [])

  const applyNeedsGesture = useCallback((next: boolean) => {
    needsGestureRef.current = next
    setNeedsGesture(next)
  }, [])

  const noticeRef = useRef(notice)
  const applyNotice = useCallback((next: string | null) => {
    noticeRef.current = next
    setNotice(next)
  }, [])

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current === null) return
    clearTimeout(watchdogRef.current)
    watchdogRef.current = null
  }, [])

  const clearTimers = useCallback(() => {
    clearWatchdog()
    if (advanceRef.current === null) return
    clearTimeout(advanceRef.current)
    advanceRef.current = null
  }, [clearWatchdog])

  /** Cancels in-flight audio and invalidates every callback still holding the old `runId`. */
  const abort = useCallback(() => {
    clearTimers()
    runIdRef.current += 1
    handleRef.current?.cancel()
    handleRef.current = null
    setPreparing(false)
  }, [clearTimers])

  /** The end of a page: either request the turn, or stop cleanly. */
  const finish = useCallback(
    (runId: number) => {
      clearTimers()

      const shouldAdvance =
        prefsRef.current.autoAdvance && hasNextRef.current && stateRef.current === 'playing'

      if (!shouldAdvance) {
        applyState('idle')
        applyPosition(null)
        return
      }

      // Stay `'playing'` across the turn — the `pageKey` effect re-arms on exactly that
      // basis, and dropping to `'idle'` here would silently end the book at page one.
      advanceRef.current = setTimeout(() => {
        advanceRef.current = null
        if (runId !== runIdRef.current) return
        onRequestNextRef.current()
      }, AUTO_ADVANCE_DELAY_MS)
    },
    [applyPosition, applyState, clearTimers],
  )

  /**
   * A generated failure is not the end of the page: the device voice is the floor. The page
   * re-speaks from the failed chunk on `deviceProvider`, under a **fresh** `runId` (the
   * re-entry goes through `startPlayback`, which aborts first), so the generated handle's
   * stragglers are discarded by the same guard that protects page turns.
   *
   * The re-speak is not inside a gesture — it follows a network round trip — so the device
   * path's start watchdog is armed, and a refusing iOS degrades to "Tap play to continue",
   * whose tap then plays on the device (this page is pinned to it) rather than looping
   * back through the failing generated path.
   */
  const fallBack = useCallback(
    (reason: FallbackReason) => {
      if (reason === 'quota') quotaBlockedRef.current = true
      deviceForPageRef.current = true
      applyNotice(FALLBACK_NOTICES[reason])
      handleRef.current = null

      if (!deviceAvailable) {
        // Nothing to fall back to. Stop honestly; the notice says why.
        clearTimers()
        applyState('idle')
        applyPosition(null)
        return
      }

      startPlaybackRef.current(positionRef.current?.chunkIndex ?? 0, false)
    },
    [applyNotice, applyPosition, applyState, clearTimers, deviceAvailable],
  )

  const fail = useCallback(
    (reason: NarrationErrorReason) => {
      // `'canceled'` is what our own `cancel()` produces on every engine. It is expected
      // traffic, not a failure, and surfacing it would make normal navigation look broken.
      if (reason === 'canceled') return

      clearTimers()
      handleRef.current = null

      if (reason === 'not-allowed') {
        applyState('paused')
        applyNeedsGesture(true)
        return
      }

      // `'synthesis-failed'` / `'unknown'`: stop. Retrying in a loop against an engine that
      // just refused is how a page ends up stuttering forever.
      applyState('idle')
      applyPosition(null)
    },
    [applyNeedsGesture, applyPosition, applyState, clearTimers],
  )

  const makeEvents = useCallback(
    (runId: number, provider: NarrationProvider, voiceURI: string | null): NarrationEvents => {
      const stale = (): boolean => runId !== runIdRef.current

      return {
        onPreparing() {
          if (stale()) return
          setPreparing(true)
        },

        onChunkStart(chunkIndex: number) {
          if (stale()) return
          // Audio is flowing, so whatever the watchdog was worried about did not happen.
          clearWatchdog()
          setPreparing(false)
          if (needsGestureRef.current) applyNeedsGesture(false)
          applyPosition({ chunkIndex, wordRange: null })

          // Warm the next page while this one plays, so auto-advance does not stall on a
          // cold generation. Only when the page is actually going to turn by itself.
          if (
            !prefetchedForPageRef.current &&
            provider.prefetch &&
            voiceURI !== null &&
            prefsRef.current.autoAdvance &&
            hasNextRef.current &&
            nextTargetRef.current
          ) {
            prefetchedForPageRef.current = true
            provider.prefetch(nextTargetRef.current, voiceURI)
          }
        },

        /**
         * The word-level highlight, which self-activates and never announces itself.
         *
         * `wordRange` is non-null only because a real `boundary` event with word
         * granularity actually arrived — there is no capability sniffing, no user-agent
         * test, and no setting. Safari reports boundaries at sentence granularity and
         * Android Chrome reports none at all, so on those engines this handler simply
         * never runs and the sentence highlight is what the reader keeps getting.
         *
         * Offsets are translated into **page-text** space to match `NarrationChunk`, so
         * the renderer needs no second coordinate system.
         */
        onWordBoundary(chunkIndex: number, charIndex: number, charLength: number) {
          if (stale()) return
          // Some engines omit `charLength`; a zero-width range would render an empty
          // highlighted span that flickers rather than tracking anything.
          if (charLength <= 0) return
          const chunk = chunksRef.current[chunkIndex]
          if (!chunk) return
          applyPosition({
            chunkIndex,
            wordRange: {
              start: chunk.start + charIndex,
              end: chunk.start + charIndex + charLength,
            },
          })
        },

        onChunkEnd() {
          // Chunk ends are not interesting on their own: the next chunk's `start` moves the
          // highlight, and the end of the page arrives as `onDone`.
        },

        onDone() {
          if (stale()) return
          finish(runId)
        },

        onError(reason: NarrationErrorReason) {
          if (stale()) return
          setPreparing(false)
          if (provider.id === 'generated' && isFallbackReason(reason)) {
            fallBack(reason)
            return
          }
          fail(reason)
        },
      }
    },
    [applyNeedsGesture, applyPosition, clearWatchdog, fail, fallBack, finish],
  )

  /**
   * The two-branch selector (spec §Design question 3). Generated iff the voice is a
   * `generated:` URI, generation is usable, there is a target to key clips on, and neither
   * a session quota denial nor an earlier failure on this page has pinned the device.
   * A generated voice that cannot be used is spoken with the device ladder's pick — handing
   * a `generated:` URI to the device engine would only get its arbitrary default.
   */
  const route = useCallback((): { provider: NarrationProvider; voiceURI: string | null } => {
    const voiceURI = activeVoiceURIRef.current
    if (!isGeneratedURI(voiceURI)) return { provider: deviceProvider, voiceURI }

    const generated = generatedProviderRef.current
    if (
      generated !== null &&
      generatedUsableRef.current &&
      targetRef.current !== null &&
      !quotaBlockedRef.current &&
      !deviceForPageRef.current
    ) {
      return { provider: generated, voiceURI }
    }
    return { provider: deviceProvider, voiceURI: deviceDefaultVoiceURIRef.current }
  }, [])

  /**
   * @param gesture true when this call is inside a user gesture. Only non-gesture starts
   * arm the watchdog — those are the ones iOS Safari is entitled to refuse.
   */
  const startPlayback = useCallback(
    (fromChunk: number, gesture: boolean) => {
      if (!available) return

      abort()

      const list = chunksRef.current
      if (list.length === 0) {
        applyState('idle')
        applyPosition(null)
        return
      }

      const from = Math.min(Math.max(0, Math.floor(fromChunk)), list.length - 1)
      const runId = runIdRef.current
      const { provider, voiceURI } = route()

      // Generated was unusable (or failed) on a browser with no speech engine: nothing
      // can speak this page.
      if (provider === deviceProvider && !deviceAvailable) {
        applyState('idle')
        applyPosition(null)
        return
      }

      if (gesture) applyNeedsGesture(false)
      applyState('playing')
      // Optimistic: the highlight lands with the Play press rather than one event later,
      // and it is what `pause()` then `play()` resumes from if no `start` ever arrives.
      applyPosition({ chunkIndex: from, wordRange: null })

      handleRef.current = provider.speak(
        list,
        {
          voiceURI,
          rate: prefsRef.current.rate,
          fromChunk: from,
          target: provider === deviceProvider ? undefined : (targetRef.current ?? undefined),
        },
        makeEvents(runId, provider, voiceURI),
      )

      // The generated provider reports gesture refusal itself (`NotAllowedError`); a
      // watchdog there would trip on a slow cold fetch and show a false "Tap play".
      if (gesture || !provider.needsStartWatchdog) return

      watchdogRef.current = setTimeout(() => {
        watchdogRef.current = null
        if (runId !== runIdRef.current) return
        // Nothing started, so the `speak()` was refused. Degrade to an honest
        // "tap play to continue" rather than sitting there looking frozen.
        abort()
        applyState('paused')
        applyNeedsGesture(true)
      }, START_WATCHDOG_MS)
    },
    [abort, applyNeedsGesture, applyPosition, applyState, available, deviceAvailable, makeEvents, route],
  )
  startPlaybackRef.current = startPlayback

  const play = useCallback(
    (fromChunk?: number) => {
      if (!available) return

      // A live paused session resumes in place. Restarting the sentence would be a worse
      // answer to a Play press than picking up where the voice actually stopped.
      if (
        fromChunk === undefined &&
        stateRef.current === 'paused' &&
        handleRef.current !== null &&
        !needsGestureRef.current
      ) {
        handleRef.current.resume()
        applyState('playing')
        return
      }

      startPlayback(fromChunk ?? positionRef.current?.chunkIndex ?? 0, true)
    },
    [applyState, available, startPlayback],
  )

  const pause = useCallback(() => {
    if (!available) return
    if (stateRef.current !== 'playing') return
    clearTimers()
    handleRef.current?.pause()
    applyState('paused')
  }, [applyState, available, clearTimers])

  const resume = useCallback(() => {
    if (!available) return
    if (stateRef.current !== 'paused') return

    // No live handle, or the watchdog already gave up on one: re-speak from where the
    // highlight is instead of resuming a session that no longer exists.
    if (handleRef.current === null || needsGestureRef.current) {
      startPlayback(positionRef.current?.chunkIndex ?? 0, true)
      return
    }

    handleRef.current.resume()
    applyState('playing')
  }, [applyState, available, startPlayback])

  const stop = useCallback(() => {
    if (!available) return
    abort()
    applyState('idle')
    applyPosition(null)
    applyNeedsGesture(false)
  }, [abort, applyNeedsGesture, applyPosition, applyState, available])

  /**
   * Sentence stepping is the seek affordance: the Web Speech API exposes no playback
   * position and no seek, so utterance boundaries are the entire granularity available.
   */
  const nextSentence = useCallback(() => {
    if (!available) return
    const list = chunksRef.current
    if (list.length === 0) return
    const target = Math.min((positionRef.current?.chunkIndex ?? 0) + 1, list.length - 1)
    startPlayback(target, true)
  }, [available, startPlayback])

  const previousSentence = useCallback(() => {
    if (!available) return
    if (chunksRef.current.length === 0) return
    // At chunk 0 this restarts chunk 0 rather than doing nothing — which is how every
    // audio player on earth behaves, and what a parent expects from "say that again".
    const target = Math.max(0, (positionRef.current?.chunkIndex ?? 0) - 1)
    startPlayback(target, true)
  }, [available, startPlayback])

  const setPrefs = useCallback(
    (next: Partial<NarrationPrefs>) => {
      const previous = prefsRef.current
      const merged: NarrationPrefs = {
        voiceURI: next.voiceURI !== undefined ? next.voiceURI : previous.voiceURI,
        rate: next.rate !== undefined ? clampRate(next.rate) : previous.rate,
        autoAdvance: next.autoAdvance !== undefined ? next.autoAdvance : previous.autoAdvance,
      }

      prefsRef.current = merged
      setPrefsState(merged)
      writePrefs(merged)

      const voiceChanged = merged.voiceURI !== previous.voiceURI
      const rateChanged = merged.rate !== previous.rate

      if (voiceChanged) {
        // A new voice is a fresh attempt: the notice was about the old one, and a page
        // pinned to the device by a one-off failure may try generated again. A quota
        // denial stays sticky — the server would only say no again.
        deviceForPageRef.current = false
        if (!quotaBlockedRef.current) applyNotice(null)
        // The ref the selector reads is otherwise only refreshed on the next render.
        activeVoiceURIRef.current =
          merged.voiceURI !== null && !isGeneratedURI(merged.voiceURI)
            ? merged.voiceURI
            : merged.voiceURI !== null && voices.some((voice) => voice.uri === merged.voiceURI)
              ? merged.voiceURI
              : defaultVoiceURIRef.current
      }

      // A handle that can retune live (the `<audio>` provider's `playbackRate`) gets the
      // new rate without losing its place in the clip.
      if (rateChanged && !voiceChanged && handleRef.current?.setRate) {
        handleRef.current.setRate(merged.rate)
        return
      }

      // Neither rate nor voice can be changed on an utterance that is already queued, so
      // the only way to apply one now is to cancel and re-speak from the current sentence.
      // `autoAdvance` deliberately does not restart — it only changes what happens at the
      // end of the page.
      const needsRestart = rateChanged || voiceChanged
      if (!needsRestart) return
      if (stateRef.current !== 'playing') return

      startPlayback(positionRef.current?.chunkIndex ?? 0, true)
    },
    [applyNotice, startPlayback, voices],
  )

  /**
   * Page turns. The host owns the index; this only reacts to it.
   *
   * Audio is cancelled before the new page paints. If the reader was listening, narration
   * re-arms at chunk 0 of the new page; if they had paused or never started, the highlight
   * simply clears and nothing begins speaking on its own.
   */
  const pageKeyRef = useRef(pageKey)
  useEffect(() => {
    if (pageKeyRef.current === pageKey) return
    pageKeyRef.current = pageKey

    const wasPlaying = stateRef.current === 'playing'
    abort()
    applyPosition(null)
    // A one-off failure retries on the next page; a quota denial does not.
    deviceForPageRef.current = false
    prefetchedForPageRef.current = false
    if (!quotaBlockedRef.current && noticeRef.current !== null) applyNotice(null)

    if (!wasPlaying) return
    // Not a user gesture — this is the seam the watchdog exists for.
    startPlayback(0, false)
  }, [abort, applyNotice, applyPosition, pageKey, startPlayback])

  /**
   * Backgrounding the tab or locking the screen stops the audio on iOS regardless of what
   * we do, so pause deliberately and preserve `chunkIndex`. There is no auto-resume on
   * return: the session may have been torn down, and a story restarting by itself in a
   * pocket is worse than a Play button.
   */
  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (!document.hidden) return
      if (stateRef.current !== 'playing') return
      clearTimers()
      handleRef.current?.pause()
      applyState('paused')
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [applyState, clearTimers])

  /** An uncancelled utterance keeps talking over the next route. Unconditional. */
  useEffect(() => {
    return () => {
      clearTimers()
      runIdRef.current += 1
      handleRef.current?.cancel()
      handleRef.current = null
    }
  }, [clearTimers])

  return {
    state: available ? state : 'unavailable',
    position,
    chunks,
    needsGesture,
    play,
    pause,
    resume,
    stop,
    nextSentence,
    previousSentence,
    prefs,
    setPrefs,
    voices,
    voiceStatus,
    activeVoiceURI,
    preparing,
    notice,
  }
}
