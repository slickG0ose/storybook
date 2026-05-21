import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import BookCard from '../BookCard'
import type { Book } from '../../types'

// Mock the CartContext module
const mockAddToCart = vi.fn().mockResolvedValue(undefined)

vi.mock('../../context/CartContext', () => ({
  useCart: () => ({
    items: [],
    total: 0,
    sessionId: 'test-session',
    addToCart: mockAddToCart,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    fetchCart: vi.fn(),
  }),
}))

const mockBook: Book = {
  id: 'book-1',
  title: 'The Brave Little Fox',
  author: 'AI Author',
  description: 'A story about a courageous fox who explores the forest.',
  theme: 'adventure',
  age_range: '3-5',
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
