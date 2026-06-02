import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import BookSpread from '../BookSpread'
import type { BookWithPages } from '../../types'

const mockBook: BookWithPages = {
  id: 'book-1',
  title: 'The Brave Little Fox',
  author: 'AI Author',
  description: 'A story about a courageous fox.',
  theme: 'adventure',
  age_range: '3-5',
  cover_emoji: '🦊',
  cover_color: '#ff6600',
  cover_url: null,
  price: 12.99,
  is_featured: false,
  is_user_created: true,
  status: 'draft',
  version: 1,
  characters: [],
  characters_json: null,
  style_descriptor: null,
  style_reference_url: null,
  created_by: 'user-1',
  created_at: new Date().toISOString(),
  deleted_at: null,
  pages: [
    {
      id: 1,
      book_id: 'book-1',
      page_number: 1,
      text: 'Page 1 text',
      illustration_description: 'desc 1',
      illustration_url: null,
    },
    {
      id: 2,
      book_id: 'book-1',
      page_number: 2,
      text: 'Page 2 text',
      illustration_description: 'desc 2',
      illustration_url: null,
    },
  ],
}

type BookSpreadProps = React.ComponentProps<typeof BookSpread>

function renderSpread(props: Partial<BookSpreadProps> = {}) {
  return render(
    <BookSpread
      book={mockBook}
      isOwner
      isDraft
      illustrating={false}
      onIllustratePage={vi.fn()}
      onRevise={vi.fn()}
      revising={false}
      theater={false}
      onToggleTheater={vi.fn()}
      {...props}
    />
  )
}

describe('BookSpread — theater toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the toggle with aria-label "Expand to theater mode" and aria-pressed="false" when theater is off', () => {
    renderSpread({ theater: false })
    const toggle = screen.getByRole('button', { name: /expand to theater mode/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('renders the toggle with aria-label "Exit theater mode" and aria-pressed="true" when theater is on', () => {
    renderSpread({ theater: true })
    const toggle = screen.getByRole('button', { name: /exit theater mode/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })

  it('calls onToggleTheater when the toggle is clicked', () => {
    const onToggleTheater = vi.fn()
    renderSpread({ theater: false, onToggleTheater })
    fireEvent.click(screen.getByRole('button', { name: /expand to theater mode/i }))
    expect(onToggleTheater).toHaveBeenCalledTimes(1)
  })

  it('applies the wide frame width class when theater is on', () => {
    renderSpread({ theater: true })
    const frame = screen.getByTestId('book-spread-frame')
    expect(frame.className).toContain('max-w-[min(90vw,1600px)]')
  })

  it('applies the narrow frame width class when theater is off', () => {
    renderSpread({ theater: false })
    const frame = screen.getByTestId('book-spread-frame')
    expect(frame.className).toContain('max-w-[900px]')
  })

  it('hides the toggle on viewports below md via hidden md:inline-flex', () => {
    renderSpread({ theater: false })
    const toggle = screen.getByRole('button', { name: /expand to theater mode/i })
    expect(toggle.className).toContain('hidden')
    expect(toggle.className).toContain('md:inline-flex')
  })

  it('includes dark-mode classes on the toggle button', () => {
    renderSpread({ theater: false })
    const toggle = screen.getByRole('button', { name: /expand to theater mode/i })
    expect(toggle.className).toContain('dark:')
  })
})
