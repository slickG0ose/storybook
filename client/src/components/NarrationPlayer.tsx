import { useEffect, useRef, useState, type JSX } from 'react'
import { LoaderCircle, Pause, Play, Settings2, SkipBack, SkipForward, Square } from 'lucide-react'
import { RATE_OPTIONS } from '../lib/narration/prefs'
import type { NarrationState } from '../lib/narration/types'
import type { UseNarrationResult } from '../hooks/useNarration'

/**
 * The read-aloud control bar.
 *
 * **In normal document flow at every breakpoint.** A sticky bar would sit in the same
 * ~60px of a phone screen as `UpdateToast` (`fixed inset-x-3 bottom-3 z-50`), and the two
 * would overlap on exactly the viewport where both matter. Rather than tune z-indices,
 * this stays in flow and the invariant is stated: **`UpdateToast` remains the app's only
 * bottom-fixed surface.** The e2e suite pins it with a computed-style assertion, so a
 * later "let's make it sticky" change has to consciously delete a test rather than
 * silently ship an occlusion bug.
 *
 * **One DOM shape at every breakpoint.** The same nodes render everywhere; Tailwind
 * variants change only spacing and stacking. Duplicating page-turn controls across
 * breakpoints is what gave `BookSpread` ambiguous accessible names once already — the
 * settings disclosure is therefore closed by default on desktop too, costing desktop one
 * extra click in exchange for never having two DOM shapes to verify.
 *
 * **The component holds no narration state of its own.** Everything comes from
 * `useNarration`, including preference persistence via `setPrefs` (which owns
 * `writePrefs`). Focus is never moved programmatically: content already changes under the
 * reader here, and stealing focus on top of that is disorienting.
 */

/** Shown both visibly and in the status region — one string, so the two cannot drift. */
const TAP_TO_CONTINUE = 'Tap play to continue.'

/** Task 7 asserts this copy verbatim on the `installNoSpeech` path. */
const UNAVAILABLE_COPY = "Read-aloud isn't available in this browser."

const TRANSPORT_CLASS =
  'min-h-11 min-w-11 inline-flex items-center justify-center rounded-full border-none ' +
  'bg-amber-100 dark:bg-gray-700 text-amber-700 dark:text-amber-300 ' +
  'hover:bg-amber-200 dark:hover:bg-gray-600 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 dark:focus-visible:outline-amber-400 ' +
  'disabled:opacity-40 disabled:cursor-default disabled:hover:bg-amber-100 dark:disabled:hover:bg-gray-700 ' +
  'transition-colors cursor-pointer'

const PLAY_CLASS =
  'min-h-11 min-w-11 inline-flex items-center justify-center rounded-full border-none ' +
  'bg-purple-600 dark:bg-purple-600 text-white dark:text-white ' +
  'hover:bg-purple-700 dark:hover:bg-purple-500 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:focus-visible:outline-purple-400 ' +
  'disabled:opacity-40 disabled:cursor-default disabled:hover:bg-purple-600 dark:disabled:hover:bg-purple-600 ' +
  'transition-colors cursor-pointer'

const SELECT_CLASS =
  'min-h-11 min-w-11 w-full rounded-lg px-3 text-sm ' +
  'border border-amber-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 dark:focus-visible:outline-amber-400 ' +
  'disabled:opacity-50 transition-colors cursor-pointer'

const FIELD_LABEL_CLASS = 'text-xs font-semibold text-amber-800 dark:text-amber-300'

interface NarrationPlayerProps {
  narration: UseNarrationResult
  /** Announced in the visually-hidden status region: "Reading page 3". */
  pageLabel: string
  className?: string
}

/**
 * Terse transition announcements only — never the sentence being spoken.
 *
 * A screen reader may already be reading this page, so putting the highlighted text in a
 * live region would produce two voices saying the same words. `'Finished'` is only
 * announced on a real transition out of playback: `'idle'` is also the mount state, and
 * announcing the end of a story nobody started would be nonsense.
 */
function statusFor(
  state: NarrationState,
  previousState: NarrationState,
  needsGesture: boolean,
  pageLabel: string,
): string {
  if (needsGesture) return TAP_TO_CONTINUE
  if (state === 'playing') return `Reading ${pageLabel}`
  if (state === 'paused') return 'Paused'
  if (state === 'idle' && (previousState === 'playing' || previousState === 'paused')) {
    return 'Finished'
  }
  return ''
}

export default function NarrationPlayer({
  narration,
  pageLabel,
  className,
}: NarrationPlayerProps): JSX.Element {
  const { state, needsGesture, prefs, setPrefs, voices, voiceStatus } = narration

  const playing = state === 'playing'
  const unavailable = state === 'unavailable' || voiceStatus === 'unavailable'
  const loading = !unavailable && voiceStatus === 'loading'
  const disabled = unavailable || loading

  const [statusMessage, setStatusMessage] = useState('')
  const previousStateRef = useRef<NarrationState>(state)

  useEffect(() => {
    const previousState = previousStateRef.current
    previousStateRef.current = state
    const next = statusFor(state, previousState, needsGesture, pageLabel)
    // Never re-announce the same string twice in a row — React bails out on an identical
    // value, so the live region's text node does not change and nothing is re-read.
    setStatusMessage((current) => (current === next ? current : next))
  }, [state, needsGesture, pageLabel])

  return (
    <div
      role="group"
      aria-label="Read aloud"
      data-testid="narration-player"
      className={`flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-amber-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 transition-colors${className ? ` ${className}` : ''}`}
    >
      <span className="sr-only" role="status" aria-live="polite">
        {statusMessage}
      </span>

      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => narration.previousSentence()}
          disabled={disabled}
          aria-disabled={disabled || undefined}
          aria-label="Previous sentence"
          className={TRANSPORT_CLASS}
        >
          <SkipBack size={18} aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => (playing ? narration.pause() : narration.play())}
          disabled={disabled}
          aria-disabled={disabled || undefined}
          aria-label={playing ? 'Pause' : 'Play'}
          aria-pressed={playing}
          className={PLAY_CLASS}
        >
          {playing ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
        </button>

        <button
          type="button"
          onClick={() => narration.nextSentence()}
          disabled={disabled}
          aria-disabled={disabled || undefined}
          aria-label="Next sentence"
          className={TRANSPORT_CLASS}
        >
          <SkipForward size={18} aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => narration.stop()}
          disabled={disabled}
          aria-disabled={disabled || undefined}
          aria-label="Stop reading"
          className={TRANSPORT_CLASS}
        >
          <Square size={16} aria-hidden="true" />
        </button>
      </div>

      {loading && (
        <span
          data-testid="narration-loading"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400"
        >
          <LoaderCircle size={16} aria-hidden="true" className="motion-safe:animate-spin" />
          Loading voices
        </span>
      )}

      {/*
        * An inert, explained state — not a toast and not a hidden component. A play button
        * that silently does nothing is worse than an honest disabled one, and hiding the
        * feature entirely leaves the reader unable to tell whether the product has it.
        */}
      {unavailable && (
        <p
          data-testid="narration-unavailable"
          className="w-full text-center text-sm text-gray-600 dark:text-gray-300"
        >
          {UNAVAILABLE_COPY}
        </p>
      )}

      {/* The watchdog fired: iOS refused a `speak()` that did not come from a gesture. */}
      {needsGesture && !unavailable && (
        <p
          data-testid="narration-hint"
          className="w-full text-center text-sm text-amber-700 dark:text-amber-300"
        >
          {TAP_TO_CONTINUE}
        </p>
      )}

      {!unavailable && (
        <details
          data-testid="narration-settings"
          className="w-full md:w-auto rounded-xl border border-amber-200 dark:border-gray-700 bg-white dark:bg-gray-800 transition-colors"
        >
          <summary className="min-h-11 flex items-center justify-center gap-1.5 px-4 rounded-xl text-sm font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 dark:focus-visible:outline-amber-400 transition-colors cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <Settings2 size={16} aria-hidden="true" />
            Voice settings
          </summary>

          <div className="flex flex-col gap-3 border-t border-amber-200 dark:border-gray-700 p-3">
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL_CLASS}>Voice</span>
              <select
                value={prefs.voiceURI ?? ''}
                onChange={(event) =>
                  setPrefs({ voiceURI: event.target.value === '' ? null : event.target.value })
                }
                className={SELECT_CLASS}
              >
                {/* Null means "let the device decide" — the hook falls back to its own
                    default-voice ladder, which is the better answer on a device whose
                    voice list we have never seen. */}
                <option value="">Device default</option>
                {voices.map((voice) => (
                  <option key={voice.uri} value={voice.uri}>
                    {voice.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL_CLASS}>Speed</span>
              <select
                value={String(prefs.rate)}
                onChange={(event) => setPrefs({ rate: Number(event.target.value) })}
                className={SELECT_CLASS}
              >
                {RATE_OPTIONS.map((rate) => (
                  <option key={rate} value={String(rate)}>
                    {rate}x
                  </option>
                ))}
              </select>
            </label>

            <label className="min-h-11 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.autoAdvance}
                onChange={(event) => setPrefs({ autoAdvance: event.target.checked })}
                className="w-5 h-5 accent-amber-500 dark:accent-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 dark:focus-visible:outline-amber-400 cursor-pointer"
              />
              Turn pages automatically
            </label>
          </div>
        </details>
      )}
    </div>
  )
}
