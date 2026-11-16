import { render, screen, within } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Privacy from '../Privacy'

/**
 * The privacy note makes claims about what the app does with data. These tests pin
 * the claims a tester would act on, so a wording edit that drops one is a visible diff.
 */
function renderPage() {
  return render(
    <MemoryRouter>
      <Privacy />
    </MemoryRouter>,
  )
}

describe('Privacy', () => {
  it('renders a single page heading', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Privacy')
  })

  it('says books start private, and public ones are readable without signing in', () => {
    renderPage()
    expect(screen.getByText(/Every book starts/i)).toHaveTextContent('Every book starts private: only you can see it.')
    expect(screen.getByText(/anyone who visits the site can read that book/i)).toHaveTextContent(/without signing in/)
  })

  it('links to Your library, where a book can be made private again', () => {
    renderPage()
    expect(screen.getByRole('link', { name: 'Your library' })).toHaveAttribute('href', '/my-books')
  })

  it('names the outside services that receive book content', () => {
    renderPage()
    const services = screen.getByRole('heading', { name: 'Services that help run StoryBook' })
      .nextElementSibling as HTMLElement
    for (const name of ['Anthropic (Claude)', 'fal.ai', 'Cloudflare', 'Neon', 'Render', 'GitHub Pages']) {
      expect(within(services).getByText(name)).toBeInTheDocument()
    }
  })

  it('tells a tester how to have their data removed', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Removing your data' })).toBeInTheDocument()
    expect(screen.getByText(/send a request with the Feedback button/i)).toBeInTheDocument()
  })
})
