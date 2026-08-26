import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import NotFound from '../NotFound'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

/**
 * The catch-all route. Before it existed, an unmatched path rendered the app chrome
 * around an empty <main> — no explanation and no way onward — so the behaviour worth
 * pinning is "an unknown path lands here, and here has an exit".
 */
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>home</p>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('NotFound', () => {
  it('renders for a path no route claims', () => {
    renderAt('/definitely-not-a-route')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('This page wandered off')
  })

  it('names the path that missed, so the user can see the typo', () => {
    renderAt('/boks/123')
    expect(screen.getByText('/boks/123')).toBeInTheDocument()
  })

  it('does not hijack a path that does have a route', () => {
    renderAt('/')
    expect(screen.getByText('home')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })

  it('offers a forward exit to the catalog', () => {
    renderAt('/nope')
    expect(screen.getByRole('link', { name: /browse the collection/i })).toHaveAttribute('href', '/')
  })

  it('offers a backward exit through history', async () => {
    mockNavigate.mockClear()
    renderAt('/nope')
    await userEvent.click(screen.getByRole('button', { name: /go back/i }))
    expect(mockNavigate).toHaveBeenCalledWith(-1)
  })
})
