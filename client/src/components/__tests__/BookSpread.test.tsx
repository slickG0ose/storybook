import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

/**
 * Forces `window.matchMedia` to report a match for the given query and a miss for every
 * other one, so a component driven by `useMediaQuery` takes its narrow branch.
 *
 * The jsdom stub in client/src/test/setup.ts always answers `matches: false`, which is
 * how every other test in this file gets the desktop layout without asking for it.
 */
function matchOnly(query: string): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (q: string) => ({
      matches: q === query,
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

const NARROW_QUERY = '(max-width: 767px)'

describe('BookSpread — single-page mode below md', () => {
  const realMatchMedia = window.matchMedia

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: realMatchMedia })
  })

  it('renders two page panels at desktop width', () => {
    renderSpread()
    expect(screen.getAllByTestId('book-page-panel')).toHaveLength(2)
  })

  it('renders exactly one page panel below md', () => {
    matchOnly(NARROW_QUERY)
    renderSpread()
    expect(screen.getAllByTestId('book-page-panel')).toHaveLength(1)
  })

  it('advances one page per tap of Next below md, not two', async () => {
    matchOnly(NARROW_QUERY)
    renderSpread()

    // The reader opens on the cover.
    expect(screen.getByText('Cover')).toBeInTheDocument()

    const next = screen.getByRole('button', { name: 'Next spread' })
    fireEvent.click(next)
    await waitFor(() => expect(screen.getByText('Page 1 of 2')).toBeInTheDocument())
    expect(screen.getByText('Page 1 text')).toBeInTheDocument()
    expect(screen.queryByText('Page 2 text')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next spread' }))
    await waitFor(() => expect(screen.getByText('Page 2 of 2')).toBeInTheDocument())
    expect(screen.getByText('Page 2 text')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Previous spread' }))
    await waitFor(() => expect(screen.getByText('Page 1 of 2')).toBeInTheDocument())
  })

  it('renders exactly one Next/Previous control below md — never both layouts at once', () => {
    matchOnly(NARROW_QUERY)
    renderSpread()
    expect(screen.getAllByRole('button', { name: 'Next spread' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Previous spread' })).toHaveLength(1)
  })

  it('drops the pl-14 / pr-14 chevron gutter from the single panel', () => {
    matchOnly(NARROW_QUERY)
    renderSpread()
    const panel = screen.getByTestId('book-page-panel')
    expect(panel.className).not.toContain('pl-14')
    expect(panel.className).not.toContain('pr-14')
    expect(panel.className).toContain('dark:bg-gray-800')
  })
})
