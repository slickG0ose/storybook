import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MEDIA_EXPIRED_EVENT, REFETCH_THROTTLE_MS, reportExpiredMedia, useMediaRefresh } from '../mediaRefresh'

const signed = (e: number) => `/illustrations/b/p1.png?e=${e}&s=${'x'.repeat(43)}`

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('reportExpiredMedia', () => {
  it('dispatches once per URL and carries the url', () => {
    const seen: unknown[] = []
    const h = (e: Event) => seen.push((e as CustomEvent).detail)
    window.addEventListener(MEDIA_EXPIRED_EVENT, h)
    reportExpiredMedia('/illustrations/report-once.png?e=1&s=a')
    reportExpiredMedia('/illustrations/report-once.png?e=1&s=a')
    reportExpiredMedia('/illustrations/report-once.png?e=2&s=b')
    window.removeEventListener(MEDIA_EXPIRED_EVENT, h)
    expect(seen).toEqual([
      { url: '/illustrations/report-once.png?e=1&s=a' },
      { url: '/illustrations/report-once.png?e=2&s=b' },
    ])
  })
})

describe('useMediaRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-16T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    setVisibility('visible')
  })

  const fire = () => window.dispatchEvent(new CustomEvent(MEDIA_EXPIRED_EVENT, { detail: { url: 'x' } }))
  const nowS = () => Math.floor(Date.now() / 1000)

  it('refetches on the event, at most once per 30 s', () => {
    const refetch = vi.fn()
    renderHook(() => useMediaRefresh(refetch, []))
    fire()
    fire()
    expect(refetch).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(REFETCH_THROTTLE_MS - 1)
    fire()
    expect(refetch).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    fire()
    expect(refetch).toHaveBeenCalledTimes(2)
  })

  it('refetches when the tab becomes visible and the earliest e is past', () => {
    const refetch = vi.fn()
    renderHook(() => useMediaRefresh(refetch, [signed(nowS() + 3600), signed(nowS() - 5), null]))
    setVisibility('hidden')
    expect(refetch).not.toHaveBeenCalled()
    setVisibility('visible')
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('does not refetch on visible when no link has expired, or none is signed', () => {
    const refetch = vi.fn()
    const { rerender } = renderHook(({ urls }: { urls: string[] }) => useMediaRefresh(refetch, urls), {
      initialProps: { urls: [signed(nowS() + 3600)] },
    })
    setVisibility('visible')
    rerender({ urls: ['/illustrations/unsigned.png'] })
    setVisibility('visible')
    expect(refetch).not.toHaveBeenCalled()
  })

  it('reads the latest urls and refetch without resubscribing', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ fn, urls }: { fn: () => void; urls: string[] }) => useMediaRefresh(fn, urls), {
      initialProps: { fn: first, urls: [signed(nowS() + 3600)] },
    })
    rerender({ fn: second, urls: [signed(nowS() - 1)] })
    setVisibility('visible')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('removes its listeners on unmount', () => {
    const refetch = vi.fn()
    const { unmount } = renderHook(() => useMediaRefresh(refetch, [signed(nowS() - 5)]))
    unmount()
    fire()
    setVisibility('visible')
    expect(refetch).not.toHaveBeenCalled()
  })
})
