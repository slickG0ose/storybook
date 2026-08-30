import { AlertTriangle, X } from 'lucide-react'
import { useToast } from '../context/ToastContext'

/**
 * Renders the toast queue held by `ToastProvider`. Presentation only — it owns no state.
 *
 * POSITIONING IS LOAD-BEARING, AND IT IS DELIBERATELY NOT BOTTOM-ANCHORED.
 * ADR-011 decision 5 makes "`UpdateToast` is the app's only bottom-fixed surface" a layout
 * invariant, and `e2e/tests/mobile/narration.spec.ts` and `e2e/tests/mobile/edit-published.spec.ts`
 * pin it with `position !== 'fixed'` assertions. Two independently-authored fixed surfaces
 * fighting over the same ~60px of a phone screen is the bug that invariant prevents, and
 * z-index tuning between them is worse. Anchoring here at `top-20` means the collision
 * cannot happen: a failure at the top, a "new version is ready" offer at the bottom,
 * neither obscuring the other. `top-20` clears the `sticky top-0 z-50` `h-16` navbar, and
 * `z-40` keeps the host under both the navbar and the `focus:z-[60]` skip link.
 *
 * Sizing mirrors `UpdateToast`: full-bleed compact card at mobile width, desktop card
 * restored at `sm:`, `min-h-11` on the dismiss control for the 44px HIG tap-target floor.
 * Tone is error red rather than amber, with a `dark:` partner on every colour class.
 *
 * Renders nothing at all when the queue is empty, same posture as `UpdateToast`.
 */
export default function ErrorToastHost() {
  const { toasts, dismiss } = useToast()

  if (toasts.length === 0) return null

  return (
    <div
      /* No `aria-live` on this wrapper, on purpose — do not "tidy" one in. Each card below
         carries `role="alert"`, which already implies `aria-live="assertive"`; a live region
         wrapping live children double-announces in several screen readers. */
      data-testid="error-toast-host"
      className="fixed inset-x-3 top-20 z-40 sm:inset-x-auto sm:right-6 sm:top-20 sm:w-96 flex flex-col gap-2"
    >
      {toasts.map(t => (
        <div
          key={t.id}
          /* `role="alert"` (implicitly assertive), not UpdateToast's `role="status"` /
             `aria-live="polite"`. This is the answer to something the user just did, not an
             offer they may ignore, so it must interrupt. */
          role="alert"
          data-testid="error-toast"
          className="flex items-start gap-3 rounded-2xl border border-red-200 dark:border-red-800 bg-white dark:bg-gray-800 p-4 shadow-lg shadow-red-900/10 dark:shadow-black/40 transition-colors"
        >
          <AlertTriangle
            size={16}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-red-500 dark:text-red-400"
          />
          <p className="min-w-0 flex-1 text-sm text-gray-700 dark:text-gray-200">{t.message}</p>
          <button
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss error"
            /* 44px in BOTH dimensions, not just height: `min-h-11` alone measured 34px wide,
               under the PRIMARY_TAP_MIN floor `mobile/error-toast.spec.ts` asserts. */
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-red-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>
      ))}
    </div>
  )
}
