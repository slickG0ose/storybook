import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import BookCard from '../BookCard'
import type { Book } from '../../types'
import type { CartContextValue } from '../../context/CartContext'

// Mock the CartContext module
const mockAddToCart = vi.fn().mockResolvedValue(undefined)

vi.mock('../../context/CartContext', () => ({
  useCart: (): CartContextValue => ({
    items: [],
    total: 0,
    sessionId: 'test-session',
    addToCart: mockAddToCart,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    fetchCart: vi.fn(),
    // CartContextValue gained offline/lastSyncedAt in Task 6 (offline cart).
    offline: false,
    lastSyncedAt: null,
  }),
}))

const mockBook: Book = {
  id: 'book-1',
  title: 'The Brave Little Fox',
  author: 'AI Author',
  description: 'A story about a courageous fox who explores the forest.',
  theme: 'adventure',
  age_range: '3-5',
  font_family: 'fredoka',
  text_size: 'standard',
  cover_emoji: '🦊',
  cover_color: '#ff6600',
  cover_url: null,
  price: 12.99,
  is_featured: true,
  is_user_created: false,
  status: 'published',
  version: 1,
  characters: [],
  characters_json: null,
  style_descriptor: null,
  style_reference_url: null,
  image_provider: null,
  image_model: null,
  created_by: null,
  created_at: new Date().toISOString(),
  deleted_at: null,
}

function renderBookCard(book: Book = mockBook) {
  return render(
    <MemoryRouter>
      <BookCard book={book} />
    </MemoryRouter>
  )
}

describe('BookCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the book title', () => {
    renderBookCard()
    expect(screen.getByText('The Brave Little Fox')).toBeInTheDocument()
  })

  it('renders the book description', () => {
    renderBookCard()
    expect(screen.getByText('A story about a courageous fox who explores the forest.')).toBeInTheDocument()
  })

  it('renders the book price', () => {
    renderBookCard()
    expect(screen.getByText('$12.99')).toBeInTheDocument()
  })

  it('renders the book theme', () => {
    renderBookCard()
    expect(screen.getByText('adventure')).toBeInTheDocument()
  })

  it('renders the book age range', () => {
    renderBookCard()
    expect(screen.getByText('Ages 3-5')).toBeInTheDocument()
  })

  it('calls addToCart when "Add to Cart" button is clicked', () => {
    renderBookCard()
    fireEvent.click(screen.getByText('Add to Cart'))
    expect(mockAddToCart).toHaveBeenCalledWith('book-1')
  })

  it('has a link pointing to /book/:id', () => {
    renderBookCard()
    const links = screen.getAllByRole('link')
    const bookLinks = links.filter(link => link.getAttribute('href') === '/book/book-1')
    expect(bookLinks.length).toBeGreaterThan(0)
  })
})

describe('BookCard — commerce off', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VITE_COMMERCE_ENABLED', 'false')
  })

  afterEach(() => vi.unstubAllEnvs())

  it('hides the price and the Add to Cart button', () => {
    renderBookCard()
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to Cart' })).not.toBeInTheDocument()
    // The chips the price used to sit beside are still there.
    expect(screen.getByText('Ages 3-5')).toBeInTheDocument()
  })

  it('offers a "Read <title>" link to the book in place of the button', () => {
    renderBookCard()
    const read = screen.getByRole('link', { name: 'Read The Brave Little Fox' })
    expect(read).toHaveAttribute('href', '/book/book-1')
    expect(read).toHaveTextContent('Read')

    fireEvent.click(read)
    expect(mockAddToCart).not.toHaveBeenCalled()
  })

  it('offers the same link on the wide variant', () => {
    render(
      <MemoryRouter>
        <BookCard book={mockBook} variant="wide" />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: 'Read The Brave Little Fox' })).toHaveAttribute('href', '/book/book-1')
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument()
    expect(mockAddToCart).not.toHaveBeenCalled()
  })
})

// A stored cover_url can outlive its file (404 from storage). The card must then look
// exactly like a book that never had a cover, not paint the browser's broken image.
describe('BookCard — cover image fails to load', () => {
  const withCover: Book = { ...mockBook, cover_url: '/illustrations/book-1/cover.png' }

  it.each(['default', 'wide'] as const)('falls back to the cover emoji (%s variant)', variant => {
    const { container } = render(
      <MemoryRouter>
        <BookCard book={withCover} variant={variant} />
      </MemoryRouter>
    )
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', '/illustrations/book-1/cover.png')
    expect(screen.queryByText('🦊')).not.toBeInTheDocument()

    fireEvent.error(img!)

    expect(container.querySelector('img')).not.toBeInTheDocument()
    // Same node a cover-less book renders, dark-mode-neutral (an emoji on cover_color).
    expect(screen.getByText('🦊')).toHaveClass('drop-shadow-lg')
  })
})
