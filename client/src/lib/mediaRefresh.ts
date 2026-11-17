import { useEffect, useRef } from 'react'
import { mediaExpiresAt } from '@storybook/shared'

/**
 * Signed media links expire (spec: signed-media-urls, decision 4). A tab left open past a
 * link's `e` would show placeholders until reload; this is the recovery path. It mirrors
 * `AUTH_EXPIRED_EVENT`: whoever notices dispatches a window event, and each page that owns
 * a `fetch` of media URLs listens and refetches.
 *
 * Bounded on purpose, so it can never loop: one event per URL for the page's lifetime, and
 * each page refetches at most once per `REFETCH_THROTTLE_MS`. A refetch that hands back the
 * same (still-expired) URL fires nothing further; a reload fixes it. Every refetch is a
 * free GET: pages only pass their existing read `fetch`, never a paid route.
 */
export const MEDIA_EXPIRED_EVENT = 'storybook:media-expired'

/** Minimum gap between two refetches from one page. */
export const REFETCH_THROTTLE_MS = 30_000

/** Full URLs already reported. Keyed by full URL: a refreshed URL is a new URL and may report. */
const reported = new Set<string>()

/** Dispatches `MEDIA_EXPIRED_EVENT` once per URL for the page's lifetime. */
export function reportExpiredMedia(url: string): void {
  if (reported.has(url)) return
  reported.add(url)
  window.dispatchEvent(new CustomEvent(MEDIA_EXPIRED_EVENT, { detail: { url } }))
}

/**
 * Subscribes the page's refetch: on `MEDIA_EXPIRED_EVENT`, and on `visibilitychange` to
 * visible when the earliest `e` among `urls` is already past. Throttled to one call per
 * 30 s (a throttled trigger is dropped, not deferred). Cleans up on unmount.
 */
export function useMediaRefresh(
  refetch: () => void,
  urls: ReadonlyArray<string | null | undefined>,
): void {
  const refetchRef = useRef(refetch)
  const urlsRef = useRef(urls)
  refetchRef.current = refetch
  urlsRef.current = urls

  useEffect(() => {
    let last = -Infinity
    const run = (): void => {
      const now = Date.now()
      if (now - last < REFETCH_THROTTLE_MS) return
      last = now
      refetchRef.current()
    }
    const onExpired = (): void => run()
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return
      const expiries = urlsRef.current
        .map(u => mediaExpiresAt(u))
        .filter((e): e is number => e !== null)
      if (expiries.length === 0) return
      if (Math.min(...expiries) < Date.now()) run()
    }
    window.addEventListener(MEDIA_EXPIRED_EVENT, onExpired)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener(MEDIA_EXPIRED_EVENT, onExpired)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
}
