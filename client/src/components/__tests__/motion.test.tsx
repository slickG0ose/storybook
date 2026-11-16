import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import FallbackImage from '../FallbackImage'
import BookReadyMoment, { prefersReducedMotion } from '../BookReadyMoment'

afterEach(() => vi.unstubAllGlobals())

describe('FallbackImage fade-in', () => {
  it('starts transparent and becomes opaque once the image has loaded', () => {
    render(<FallbackImage url="/illustrations/b/cover.png" alt="Cover" fallback={<span>fb</span>} className="h-full" />)
    const img = screen.getByAltText('Cover')
    expect(img.className).toContain('opacity-0')
    expect(img.className).toContain('h-full')

    fireEvent.load(img)
    expect(img.className).toContain('opacity-100')
    expect(img.className).not.toContain('opacity-0')
  })

  it('still swaps to the fallback when the image fails', () => {
    render(<FallbackImage url="/illustrations/b/gone.png" alt="Cover" fallback={<span>fb</span>} />)
    fireEvent.error(screen.getByAltText('Cover'))
    expect(screen.getByText('fb')).toBeInTheDocument()
    expect(screen.queryByAltText('Cover')).toBeNull()
  })
})

describe('BookReadyMoment', () => {
  it('announces politely and hides the decoration from assistive tech', () => {
    const { container } = render(<BookReadyMoment name="Luna" />)
    expect(screen.getByRole('status')).toHaveTextContent('Your book is ready!')
    expect(screen.getByText("Opening Luna's story…")).toBeInTheDocument()
    for (const svg of container.querySelectorAll('svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true')
    }
  })
})

describe('prefersReducedMotion', () => {
  it('follows the media query', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q }))
    expect(prefersReducedMotion()).toBe(true)
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q }))
    expect(prefersReducedMotion()).toBe(false)
  })

  it('treats a browser that cannot answer as reduced', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(prefersReducedMotion()).toBe(true)
  })
})

describe('index.css motion contract', () => {
  const css = readFileSync(join(import.meta.dirname, '../../index.css'), 'utf8')

  it('collapses every animation and transition under prefers-reduced-motion', () => {
    const block = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    expect(block).toContain('animation-duration: 0.01ms !important')
    expect(block).toContain('transition-duration: 0.01ms !important')
    // The block must come after the motion rules it overrides.
    expect(css.lastIndexOf('@media (prefers-reduced-motion: reduce)')).toBeGreaterThan(css.indexOf('@keyframes sparkle-out'))
  })

  it('keeps every animation this file declares at 300ms or under', () => {
    const durations = [...css.matchAll(/animation:\s*[\w-]+\s+(\d+)ms/g)].map(m => Number(m[1]))
    expect(durations.length).toBeGreaterThan(0)
    for (const ms of durations) expect(ms).toBeLessThanOrEqual(300)
  })
})
