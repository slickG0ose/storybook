import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { BookDetailSkeleton, MyBooksSkeleton } from '../Skeletons'

describe.each([
  ['MyBooksSkeleton', MyBooksSkeleton, 'Loading your books'],
  ['BookDetailSkeleton', BookDetailSkeleton, 'Loading the book'],
])('%s', (_name, Skeleton, label) => {
  it('is one polite, busy live region that names what is loading', () => {
    render(<Skeleton />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(status).toHaveTextContent(label)
  })

  it('hides the placeholder blocks from assistive tech', () => {
    const { container } = render(<Skeleton />)
    const pulses = container.querySelectorAll('.animate-pulse')
    expect(pulses.length).toBeGreaterThan(5)
    for (const el of pulses) expect(el.closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('gives every surface a dark-mode partner', () => {
    const { container } = render(<Skeleton />)
    for (const el of container.querySelectorAll('[class*="bg-"]')) {
      expect(el.className, el.className).toMatch(/dark:bg-/)
    }
  })
})
