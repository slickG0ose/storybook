import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import ErrorBoundary from '../ErrorBoundary'
import { getRecentErrors, resetRecentErrors } from '../../lib/recentErrors'

/**
 * #209: before this boundary, any render error unmounted the whole tree and left a
 * blank white page. What's worth pinning: a throw shows the fallback (not an empty
 * container), the error reaches the feedback ring buffer, and navigating away
 * recovers without a reload.
 */
function Boom(): never {
  throw new Error('kaboom')
}

function Harness() {
  const { pathname } = useLocation()
  return (
    <>
      <nav>
        <Link to="/fine">go fine</Link>
      </nav>
      <ErrorBoundary resetKey={pathname}>
        <Routes>
          <Route path="/broken" element={<Boom />} />
          <Route path="/fine" element={<p>all good</p>} />
        </Routes>
      </ErrorBoundary>
    </>
  )
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Harness />
    </MemoryRouter>,
  )
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    resetRecentErrors()
    // React logs caught render errors to console.error; keep the run output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders its children when nothing throws', () => {
    renderAt('/fine')
    expect(screen.getByText('all good')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the fallback instead of a blank page when a child throws', () => {
    renderAt('/broken')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('This page hit a snag')
    expect(screen.getByRole('button', { name: /reload the page/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to the bookshop/i })).toHaveAttribute('href', '/')
  })

  it('keeps content outside the boundary alive', () => {
    renderAt('/broken')
    expect(screen.getByRole('link', { name: 'go fine' })).toBeInTheDocument()
  })

  it('records the error so tester feedback carries it', () => {
    renderAt('/broken')
    expect(getRecentErrors()).toContain('Render error: Error: kaboom')
  })

  it('recovers when the route changes', async () => {
    renderAt('/broken')
    await userEvent.click(screen.getByRole('link', { name: 'go fine' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('all good')).toBeInTheDocument()
  })

  it('reloads the page from the fallback button', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    renderAt('/broken')
    await userEvent.click(screen.getByRole('button', { name: /reload the page/i }))
    expect(reload).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
})
