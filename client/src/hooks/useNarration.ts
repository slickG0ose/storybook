import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { splitIntoUtterances } from '../lib/narration/chunk'
import { deviceProvider } from '../lib/narration/deviceProvider'
import { clampRate, readPrefs, writePrefs, type NarrationPrefs } from '../lib/narration/prefs'
import type {
  NarrationErrorReason,
  NarrationEvents,
  NarrationHandle,
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

export interface UseNarrationArgs {
  /** The text of the page currently on screen, or null on spreads with nothing to read. */
  text: string | null
  /** Changes whenever the visible page changes. Any change cancels in-flight audio. */
  pageKey: string | number
  /** Called after the last chunk when auto-advance is on. The host decides whether to honour it. */
  onRequestNext: () => void
  /** False on the last spread, so narration stops instead of requesting a turn. */
  hasNext: boolean
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
}

export function useNarration({
  text,
  pageKey,
  onRequestNext,
  hasNext,
}: UseNarrationArgs): UseNarrationResult {
  // Availability is read once: a browser does not grow a speech engine mid-session, and
  // re-reading it per render would make every callback depend on a value that never moves.
  const [available] = useState(() => deviceProvider.isAvailable())

  const chunks = useMemo(() => (text ? splitIntoUtterances(text) : []), [text])

  const [prefs, setPrefsState] = useState<NarrationPrefs>(readPrefs)
  const { voices, status: voiceStatus, defaultVoiceURI } = useVoices(prefs.voiceURI)

  const [state, setState] = useState<NarrationState>(available ? 'idle' : 'unavailable')
  const [position, setPosition] = useState<NarrationPosition | null>(null)
  const [needsGesture, setNeedsGesture] = useState(false)

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
    (runId: number): NarrationEvents => {
      const stale = (): boolean => runId !== runIdRef.current

      return {
        onChunkStart(chunkIndex: number) {
          if (stale()) return
          // Audio is flowing, so whatever the watchdog was worried about did not happen.
          clearWatchdog()
          if (needsGestureRef.current) applyNeedsGesture(false)
          applyPosition({ chunkIndex, wordRange: null })
        },

        onWordBoundary() {
          // Task 6 populates `position.wordRange` from here. Sentence-level highlighting is
          // the shipped baseline and needs nothing from this event.
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
          fail(reason)
        },
      }
    },
    [applyNeedsGesture, applyPosition, clearWatchdog, fail, finish],
  )

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

      if (gesture) applyNeedsGesture(false)
      applyState('playing')
      // Optimistic: the highlight lands with the Play press rather than one event later,
      // and it is what `pause()` then `play()` resumes from if no `start` ever arrives.
      applyPosition({ chunkIndex: from, wordRange: null })

      handleRef.current = deviceProvider.speak(
        list,
        {
          voiceURI: prefsRef.current.voiceURI ?? defaultVoiceURIRef.current,
          rate: prefsRef.current.rate,
          fromChunk: from,
        },
        makeEvents(runId),
      )

      if (gesture) return

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
    [abort, applyNeedsGesture, applyPosition, applyState, available, makeEvents],
  )

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

      // Neither rate nor voice can be changed on an utterance that is already queued, so
      // the only way to apply one now is to cancel and re-speak from the current sentence.
      // `autoAdvance` deliberately does not restart — it only changes what happens at the
      // end of the page.
      const needsRestart = merged.rate !== previous.rate || merged.voiceURI !== previous.voiceURI
      if (!needsRestart) return
      if (stateRef.current !== 'playing') return

      startPlayback(positionRef.current?.chunkIndex ?? 0, true)
    },
    [startPlayback],
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

    if (!wasPlaying) return
    // Not a user gesture — this is the seam the watchdog exists for.
    startPlayback(0, false)
  }, [abort, applyPosition, pageKey, startPlayback])

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
    state,
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
  }
}
