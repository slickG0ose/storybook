import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import FallbackImage from '../FallbackImage'

describe('FallbackImage', () => {
  it('renders the image, with its passthrough attributes, while it loads', () => {
    render(<FallbackImage url="/covers/a.png" alt="Cover" loading="lazy" className="object-cover" fallback={<span>🥔</span>} />)
    const img = screen.getByRole('img', { name: 'Cover' })
    expect(img).toHaveAttribute('src', '/covers/a.png')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveClass('object-cover')
    expect(screen.queryByText('🥔')).not.toBeInTheDocument()
  })

  it('renders the fallback when there is no URL', () => {
    render(<FallbackImage url={null} alt="Cover" fallback={<span>🥔</span>} />)
    expect(screen.getByText('🥔')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('swaps to the fallback when the image fails to load', () => {
    render(<FallbackImage url="/covers/missing.png" alt="Cover" fallback={<span>🥔</span>} />)
    fireEvent.error(screen.getByRole('img', { name: 'Cover' }))
    expect(screen.getByText('🥔')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
