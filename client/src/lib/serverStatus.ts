import { useEffect, useState } from 'react'
import { api } from './apiBase'

/**
 * Is the API answering? Drives ServerStatusBanner.
 *
 * The API runs on a host that puts an idle instance to sleep; the first request after a
 * quiet spell takes around 50 seconds while it starts. Without a signal, that minute is
 * skeletons and spinners with no explanation, and a tester concludes the app is broken.
 * (A keep-warm ping exists, `.github/workflows/keep-warm.yml`, but it is best-effort:
 * GitHub delays and skips scheduled runs.)
 *
 *   ok       the health check answered. The banner renders nothing.
 *   waking   no answer yet after SLOW_AFTER_MS, or a gateway error. Still retrying.
 *   down     gave up after GIVE_UP_AFTER_MS. Says so, and offers a retry.
 *   offline  the browser reports no network. Checked by event, no polling.
 *
 * One check per page load, not a heartbeat: once the API has answered, pages handle
 * their own failures. The check restarts when the browser comes back online.
 */
export type ServerStatus = 'ok' | 'waking' | 'down' | 'offline'

export const SLOW_AFTER_MS = 4_000
export const RETRY_EVERY_MS = 5_000
export const GIVE_UP_AFTER_MS = 90_000
/** Fired on window when the API answers after having been slow. Pages may refetch. */
export const SERVER_READY_EVENT = 'storybook:server-ready'

function browserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

export function useServerStatus(): { status: ServerStatus; retry: () => void } {
  const [status, setStatus] = useState<ServerStatus>(() => (browserOffline() ? 'offline' : 'ok'))
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const goOffline = () => setStatus('offline')
    const goOnline = () => {
      setStatus('ok')
      setAttempt(n => n + 1)
    }
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  useEffect(() => {
    if (browserOffline()) return
    let cancelled = false
    let wasSlow = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const startedAt = Date.now()

    const slowTimer = setTimeout(() => {
      if (cancelled) return
      wasSlow = true
      setStatus(s => (s === 'offline' ? s : 'waking'))
    }, SLOW_AFTER_MS)

    const check = async (): Promise<void> => {
      let ok = false
      try {
        const res = await fetch(api('/api/health'), { cache: 'no-store' })
        ok = res.ok
      } catch {
        ok = false
      }
      if (cancelled) return
      if (ok) {
        clearTimeout(slowTimer)
        setStatus(s => (s === 'offline' ? s : 'ok'))
        if (wasSlow) window.dispatchEvent(new Event(SERVER_READY_EVENT))
        return
      }
      if (browserOffline()) return
      wasSlow = true
      if (Date.now() - startedAt >= GIVE_UP_AFTER_MS) {
        clearTimeout(slowTimer)
        setStatus('down')
        return
      }
      setStatus('waking')
      retryTimer = setTimeout(() => void check(), RETRY_EVERY_MS)
    }
    void check()

    return () => {
      cancelled = true
      clearTimeout(slowTimer)
      clearTimeout(retryTimer)
    }
  }, [attempt])

  return {
    status,
    retry: () => {
      setStatus('ok')
      setAttempt(n => n + 1)
    },
  }
}
