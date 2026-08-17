import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw, X } from 'lucide-react'

/**
 * Service-worker update prompt.
 *
 * `pwa.config.ts` registers with `registerType: 'prompt'` rather than `autoUpdate`
 * precisely so this component exists: autoUpdate reloads the page the moment a new
 * worker takes control, which on /checkout with a filled form silently discards user
 * input. Nothing reloads here without a tap.
 *
 * Mobile sizing follows the Task 2-4 convention: the compact treatment lives in the base
 * utilities (full-bleed above the bottom edge) and the desktop card is restored at `sm:`.
 * Both action controls clear the 44px HIG tap-target floor via `min-h-11`.
 *
 * Renders nothing at all until the worker reports a waiting update, so it costs an empty
 * render on every route for the other 99.9% of sessions.
 */
export default function UpdateToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="update-toast"
      className="fixed inset-x-3 bottom-3 z-50 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96 flex items-start gap-3 rounded-2xl border border-amber-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-lg shadow-amber-900/10 dark:shadow-black/40 transition-colors"
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-amber-900 dark:text-amber-300 font-display">
          A new version is ready
        </p>
        <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">
          Reload to pick up the latest StoryBook. Anything you are part-way through will be lost.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => { void updateServiceWorker(true) }}
            className="min-h-11 inline-flex items-center gap-1.5 rounded-full bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500 px-4 text-sm font-semibold text-white transition-colors cursor-pointer"
          >
            <RefreshCw size={16} />
            Reload
          </button>
          <button
            onClick={() => setNeedRefresh(false)}
            className="min-h-11 rounded-full px-4 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-amber-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
          >
            Later
          </button>
        </div>
      </div>
      <button
        onClick={() => setNeedRefresh(false)}
        aria-label="Dismiss update notice"
        className="shrink-0 rounded-full p-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-amber-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
      >
        <X size={18} />
      </button>
    </div>
  )
}
