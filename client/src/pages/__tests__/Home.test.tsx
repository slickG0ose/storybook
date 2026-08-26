import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Home from '../Home'
import type { Book } from '../../types'
import type { CartContextValue } from '../../context/CartContext'

const mockBooks: Book[] = [
  {
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
  },
  {
    id: 'book-2',
    title: 'Kindness Kingdom',
    author: 'AI Author',
    description: 'A tale about kindness and friendship.',
    theme: 'kindness',
    age_range: '4-7',
    cover_emoji: '👑',
    cover_color: '#ffcc00',
    cover_url: null,
    price: 14.99,
    is_featured: false,
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
  },
]

const mockThemes = ['adventure', 'kindness']
const mockAgeRanges = ['3-5', '4-7']

// Mock CartContext since BookCard uses it
vi.mock('../../context/CartContext', () => ({
  useCart: (): CartContextValue => ({
    items: [],
    total: 0,
    sessionId: 'test-session',
    addToCart: vi.fn().mockResolvedValue(undefined),
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    fetchCart: vi.fn(),
    // CartContextValue gained offline/lastSyncedAt in Task 6 (offline cart).
    offline: false,
    lastSyncedAt: null,
  }),
}))

function renderHome() {
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>
  )
}

describe('Home', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the hero section with "Stories Made with Magic"', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } }))
    )

    renderHome()
    expect(screen.getByText(/Stories Made with/)).toBeInTheDocument()
    expect(screen.getByText('Magic')).toBeInTheDocument()
  })

  it('renders book cards after fetching', async () => {
    let callCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify(mockBooks), { headers: { 'Content-Type': 'application/json' } })
        )
      }
      if (callCount === 2) {
        return Promise.resolve(
          new Response(JSON.stringify(mockThemes), { headers: { 'Content-Type': 'application/json' } })
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify(mockAgeRanges), { headers: { 'Content-Type': 'application/json' } })
      )
    })

    renderHome()

    // The featured book appears in both "Featured Stories" and "All Books" sections,
    // so use getAllByText for the featured title.
    await waitFor(() => {
      expect(screen.getAllByText('The Brave Little Fox').length).toBeGreaterThanOrEqual(1)
    })
    expect(screen.getByText('Kindness Kingdom')).toBeInTheDocument()
  })

  it('renders theme filter buttons and filters books when clicked', async () => {
    let callCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify(mockBooks), { headers: { 'Content-Type': 'application/json' } })
        )
      }
      if (callCount === 2) {
        return Promise.resolve(
          new Response(JSON.stringify(mockThemes), { headers: { 'Content-Type': 'application/json' } })
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify(mockAgeRanges), { headers: { 'Content-Type': 'application/json' } })
      )
    })

    renderHome()

    await waitFor(() => {
      expect(screen.getAllByText('The Brave Little Fox').length).toBeGreaterThanOrEqual(1)
    })

    // Both theme and age "All" buttons present
    const allButtons = screen.getAllByRole('button', { name: 'All' })
    expect(allButtons.length).toBe(2)
    expect(screen.getByRole('button', { name: 'adventure' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'kindness' })).toBeInTheDocument()

    // Click the "adventure" theme filter
    fireEvent.click(screen.getByRole('button', { name: 'adventure' }))

    expect(screen.getAllByText('The Brave Little Fox').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Kindness Kingdom')).not.toBeInTheDocument()

    // Click theme "All" to reset (first All button is the theme one)
    const themeAllButton = screen.getAllByRole('button', { name: 'All' })[0]!
    fireEvent.click(themeAllButton)
    expect(screen.getAllByText('The Brave Little Fox').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Kindness Kingdom')).toBeInTheDocument()
  })
})

// The hero art (#125) is the LCP candidate on `/`, so the attributes that keep it fast
// and non-shifting are pinned here rather than left to a human to notice regressing.
// The `Magic` assertions above stay verbatim — the H1 is pinned in three places.
describe('Home hero art', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } }))
    )
  })

  // Same selector shape the e2e spec uses: the accessible name comes from `alt`.
  function heroImg() {
    return screen.getByRole('img', { name: /bench/i })
  }

  it('renders the hero illustration with an accessible name', () => {
    renderHome()
    expect(heroImg()).toBeInTheDocument()
  })

  it('describes the artwork rather than the product in its alt text', () => {
    renderHome()
    const alt = heroImg().getAttribute('alt') ?? ''

    // Mechanical form of the spec's "alt describes the art, not the product" constraint.
    // Word boundaries matter: "backpack" is part of the description and must not trip
    // the `book` case.
    expect(alt).not.toMatch(/\b(AI|book|storybook|create)\b/i)
    expect(alt).toMatch(/bench/i)
  })

  it('reserves its box with intrinsic dimensions', () => {
    renderHome()
    const art = heroImg()

    // Paired with `aspect-square` in the class list, these stop the image landing from
    // shifting the fold on a slow connection.
    expect(art).toHaveAttribute('width', '960')
    expect(art).toHaveAttribute('height', '960')
  })

  it('is eagerly loaded and high priority', () => {
    renderHome()
    const art = heroImg()

    // Above the fold: lazy-loading would defer the LCP candidate.
    expect(art.getAttribute('loading')).not.toBe('lazy')
    // React 19 lowercases `fetchPriority` on the way into the DOM.
    expect(art.getAttribute('fetchpriority')).toBe('high')
  })

  it('offers two responsive candidates with a sizes hint', () => {
    renderHome()
    const art = heroImg()

    const srcset = art.getAttribute('srcset') ?? ''
    expect(srcset.split(',')).toHaveLength(2)

    // Pinned as shipped. The desktop value deliberately overstates the 420 CSS px the
    // image actually lays out at on a 1440 viewport — it only biases toward the larger
    // candidate, which a 2x display picks anyway. Retune this line if the grid changes.
    expect(art).toHaveAttribute('sizes', '(min-width: 1024px) 440px, 300px')
  })
})
