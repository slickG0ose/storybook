import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useImageFallback } from '../useImageFallback'

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
