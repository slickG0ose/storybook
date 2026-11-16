import { Loader2, WifiOff, CloudOff } from 'lucide-react'
import { useServerStatus } from '../lib/serverStatus'

/**
 * A slim notice under the navbar while the API is asleep, unreachable, or the browser
 * is offline. Renders nothing in the normal case. See lib/serverStatus.ts for why.
 *
 * `role="status"` (polite), not an alert: nothing has failed, and the pages underneath
 * keep their own loading and error states. In the document flow rather than fixed, so
 * it cannot cover the navbar or a page's controls at phone widths.
 */
export default function ServerStatusBanner() {
  const { status, retry } = useServerStatus()
  if (status === 'ok') return null

  return (
    <div
      role="status"
      data-testid="server-status"
      className="bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-100 transition-colors"
    >
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-center gap-2.5 text-sm font-semibold text-center">
        {status === 'waking' && (
          <>
            <Loader2 size={16} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <span>Waking up the story server. After a quiet spell this takes up to a minute.</span>
          </>
        )}
        {status === 'offline' && (
          <>
            <WifiOff size={16} className="shrink-0" aria-hidden="true" />
            <span>You're offline. Books you have open still work; saving and creating need a connection.</span>
          </>
        )}
        {status === 'down' && (
          <>
            <CloudOff size={16} className="shrink-0" aria-hidden="true" />
            <span>We can't reach the story server right now.</span>
            <button
              onClick={retry}
              className="min-h-11 -my-2 px-3 rounded-full underline underline-offset-2 hover:bg-amber-100 dark:hover:bg-amber-800/40 cursor-pointer transition-colors"
            >
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  )
}
