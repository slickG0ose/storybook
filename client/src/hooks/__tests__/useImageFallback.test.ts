import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useImageFallback } from '../useImageFallback'
import { MEDIA_EXPIRED_EVENT } from '../../lib/mediaRefresh'

describe('useImageFallback', () => {
  it('passes a URL through until it fails, then reports none', () => {
    const { result } = renderHook(() => useImageFallback('/illustrations/a.png'))
    expect(result.current.src).toBe('/illustrations/a.png')

    act(() => result.current.onError())
    expect(result.current.src).toBeNull()
  })

  it('reports none for a missing URL', () => {
    expect(renderHook(() => useImageFallback(null)).result.current.src).toBeNull()
    expect(renderHook(() => useImageFallback(undefined)).result.current.src).toBeNull()
  })

  it('gives a different URL a fresh attempt, and keeps the dead one suppressed', () => {
    // A re-roll or a page turn swaps the URL. The failure is remembered by URL, so the
    // new picture is tried without a reset, and going back does not flash the broken one.
    const { result, rerender } = renderHook(({ url }: { url: string }) => useImageFallback(url), {
      initialProps: { url: '/illustrations/dead.png' },
    })
    act(() => result.current.onError())
    expect(result.current.src).toBeNull()

    rerender({ url: '/illustrations/fresh.png' })
    expect(result.current.src).toBe('/illustrations/fresh.png')

    rerender({ url: '/illustrations/dead.png' })
    expect(result.current.src).toBeNull()
  })
})

describe('useImageFallback — expired signed links', () => {
  const signed = (name: string, e: number) => `/illustrations/${name}.png?e=${e}&s=${'x'.repeat(43)}`
  const nowS = () => Math.floor(Date.now() / 1000)

  function listen() {
    const events: string[] = []
    const handler = (ev: Event) => events.push((ev as CustomEvent<{ url: string }>).detail.url)
    window.addEventListener(MEDIA_EXPIRED_EVENT, handler)
    return { events, stop: () => window.removeEventListener(MEDIA_EXPIRED_EVENT, handler) }
  }

  it('dispatches once for an expired signed URL, however often it errors', () => {
    const url = signed('expired-once', nowS() - 60)
    const { events, stop } = listen()
    const { result } = renderHook(() => useImageFallback(url))
    act(() => result.current.onError())
    act(() => result.current.onError())
    stop()
    expect(events).toEqual([url])
    expect(result.current.src).toBeNull()
  })

  it('also dispatches for a link inside the 30 s slop', () => {
    const url = signed('near-expiry', nowS() + 10)
    const { events, stop } = listen()
    const { result } = renderHook(() => useImageFallback(url))
    act(() => result.current.onError())
    stop()
    expect(events).toEqual([url])
  })

  it('does not dispatch for a future-e URL or an unsigned URL, but still falls back', () => {
    const future = signed('future', nowS() + 3600)
    const { events, stop } = listen()
    const a = renderHook(() => useImageFallback(future))
    act(() => a.result.current.onError())
    const b = renderHook(() => useImageFallback('/illustrations/unsigned.png'))
    act(() => b.result.current.onError())
    stop()
    expect(events).toEqual([])
    expect(a.result.current.src).toBeNull()
    expect(b.result.current.src).toBeNull()
  })

  it('keeps failure memory keyed on the full URL, so a refreshed link is retried', () => {
    const dead = signed('refresh', nowS() - 60)
    const fresh = signed('refresh', nowS() + 3600)
    const { result, rerender } = renderHook(({ url }: { url: string }) => useImageFallback(url), {
      initialProps: { url: dead },
    })
    act(() => result.current.onError())
    expect(result.current.src).toBeNull()
    rerender({ url: fresh })
    expect(result.current.src).toBe(fresh)
  })
})
