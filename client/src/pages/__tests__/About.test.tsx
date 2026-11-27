import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import About from '../About'

/**
 * The About page describes what StoryBook does. These tests pin the claims a tester
 * would act on and the two links out, so a wording edit that drops one is a visible diff.
 */
function renderPage() {
  return render(
    <MemoryRouter>
      <About />
    </MemoryRouter>,
  )
}

describe('About', () => {
  it('renders a single page heading', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Stories your family makes together')
  })

  it('walks through how it works in three steps', () => {
    renderPage()
    const steps = screen.getByRole('heading', { name: 'How it works' }).nextElementSibling as HTMLElement
    expect(steps.tagName).toBe('OL')
    expect(steps.querySelectorAll('li')).toHaveLength(3)
  })

  it('frames the family as the author, with AI helping', () => {
    renderPage()
    expect(screen.getByText(/StoryBook's AI helps you write it/i)).toBeInTheDocument()
    expect(screen.getByText(/help them imagine bigger, not to imagine for them/i)).toBeInTheDocument()
  })

  it('says books start private and links to the privacy page', () => {
    renderPage()
    expect(screen.getByText(/Every book you make starts private/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Read the privacy page' })).toHaveAttribute('href', '/privacy')
  })

  it('ends with a link to start a story', () => {
    renderPage()
    expect(screen.getByRole('link', { name: 'Start your story' })).toHaveAttribute('href', '/create')
  })
})
