import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Navbar from '../Navbar'
import type { CartContextValue } from '../../context/CartContext'
import type { useAuth } from '../../context/AuthContext'

type AuthValue = ReturnType<typeof useAuth>

// Mutable per test: signed out and resolved by default, so the pre-existing cases keep
// asserting the logged-out row.
const auth = vi.hoisted(() => ({
  current: { user: null, loading: false } as Pick<AuthValue, 'user' | 'loading'>,
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: (): AuthValue => ({
    ...auth.current,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}))

const TESTER: NonNullable<AuthValue['user']> = {
  id: 'u-1',
  email: 'tester@example.com',
  name: 'Test Er',
  token: 'tok-1',
  role: 'user',
}

const mockToggle = vi.fn()

vi.mock('../../context/CartContext', () => ({
  useCart: (): CartContextValue => ({
    items: [
      {
        id: 1,
        book_id: 'book-1',
        quantity: 2,
        title: 'Test Book',
        price: 9.99,
        cover_emoji: '📖',
        cover_color: '#ff0000',
        author: 'Author',
      },
      {
        id: 2,
        book_id: 'book-2',
        quantity: 3,
        title: 'Another Book',
        price: 14.99,
        cover_emoji: '🌟',
        cover_color: '#00ff00',
        author: 'Author 2',
      },
    ],
    total: 64.95,
    sessionId: 'test-session',
    addToCart: vi.fn(),
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    fetchCart: vi.fn(),
    // CartContextValue gained offline/lastSyncedAt in Task 6 (offline cart).
    offline: false,
    lastSyncedAt: null,
  }),
}))

vi.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({
    dark: false,
    toggle: mockToggle,
  }),
}))

function renderNavbar() {
  return render(
    <MemoryRouter>
      <Navbar />
    </MemoryRouter>
  )
}

describe('Navbar', () => {
  beforeEach(() => {
    auth.current = { user: null, loading: false }
  })

  it('renders the StoryBook brand', () => {
    renderNavbar()
    expect(screen.getByText('StoryBook')).toBeInTheDocument()
  })

  it('shows the correct cart badge count', () => {
    renderNavbar()
    // 2 + 3 = 5 total items
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('has a dark mode toggle button', () => {
    renderNavbar()
    const toggleButton = screen.getByLabelText('Toggle dark mode')
    expect(toggleButton).toBeInTheDocument()
  })

  it('renders Browse link', () => {
    renderNavbar()
    expect(screen.getByText('Browse')).toBeInTheDocument()
  })

  it('renders Create a Book link', () => {
    renderNavbar()
    expect(screen.getByText('Create a Book')).toBeInTheDocument()
  })

  // #145: below `sm` the visible label is `hidden sm:inline`, so the accessible name has
  // to come from `aria-label` alone. Asserting via `getByRole('link', { name, exact })`
  // pins that the label exists and — per WCAG 2.5.3 — matches the visible text exactly,
  // not just resembles it.
  it('every logged-out nav link has an accessible name matching its visible label', () => {
    renderNavbar()
    for (const name of ['StoryBook', 'Browse', 'Create a Book', 'Cart', 'Sign In']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument()
    }
  })

  describe('feedback trigger', () => {
    it('is absent when signed out', () => {
      renderNavbar()
      expect(screen.queryByRole('button', { name: 'Send feedback' })).not.toBeInTheDocument()
    })

    it('is absent while auth is still loading, even with a cached user', () => {
      auth.current = { user: TESTER, loading: true }
      renderNavbar()
      expect(screen.queryByRole('button', { name: 'Send feedback' })).not.toBeInTheDocument()
    })

    it('opens the feedback dialog when a signed-in user clicks it', () => {
      auth.current = { user: TESTER, loading: false }
      renderNavbar()
      expect(screen.queryByRole('dialog', { name: 'Send feedback' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
      expect(screen.getByRole('dialog', { name: 'Send feedback' })).toBeInTheDocument()
    })
  })

  describe('commerce off', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_COMMERCE_ENABLED', 'false')
    })

    afterEach(() => vi.unstubAllEnvs())

    it('renders no cart link or badge, and keeps the rest of the row', () => {
      renderNavbar()
      expect(screen.queryByRole('link', { name: 'Cart' })).not.toBeInTheDocument()
      // The mocked cart holds 5 items; the badge goes with the link.
      expect(screen.queryByText('5')).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Create a Book' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Browse' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Toggle dark mode' })).toBeInTheDocument()
    })
  })
})
