import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CartItem } from '@storybook/shared'
import { CartProvider, useCart } from '../CartContext'
import { readCartSnapshot } from '../../lib/cartCache'

const CART_CACHE_KEY = 'storybook-cart-cache'
const SESSION_KEY = 'storybook-session'
const SESSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

const CACHED_ITEM: CartItem = {
  id: 1,
  book_id: 'book-1',
  quantity: 2,
  title: 'The Brave Little Fox',
  price: 12.99,
  cover_emoji: '🦊',
  cover_color: '#ff6600',
  author: 'AI Author',
}

function seedSnapshot(cachedAt = '2026-08-16T09:00:00.000Z'): void {
  localStorage.setItem(
    CART_CACHE_KEY,
    JSON.stringify({ sessionId: SESSION_ID, items: [CACHED_ITEM], total: 25.98, cachedAt }),
  )
}

/** Surfaces the bits of CartContextValue the offline behaviour is defined in terms of. */
function CartConsumer() {
  const { items, total, offline, lastSyncedAt, updateQuantity, clearCart, addToCart } = useCart()
  const [addResult, setAddResult] = useState<string>('none')
  return (
    <div>
      <span data-testid="offline">{offline ? 'offline' : 'online'}</span>
      <span data-testid="add-result">{addResult}</span>
      <button onClick={() => void addToCart('book-1').then(ok => setAddResult(String(ok)))}>Add</button>
      <span data-testid="total">{total.toFixed(2)}</span>
      <span data-testid="last-synced">{lastSyncedAt ?? 'never'}</span>
      <ul>
        {items.map(i => (
          <li key={i.book_id} data-testid="item">{i.title} x{i.quantity}</li>
        ))}
      </ul>
      <button onClick={() => void updateQuantity('book-1', 3)}>Bump</button>
      <button onClick={() => void clearCart()}>Clear</button>
    </div>
  )
}

function renderCart() {
  return render(
    <CartProvider>
      <CartConsumer />
    </CartProvider>,
  )
}

function okResponse(body: { items: CartItem[]; total: number }) {
  return { ok: true, json: () => Promise.resolve(body) }
}

describe('CartContext offline behaviour', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(SESSION_KEY, SESSION_ID)
    // The context logs failures on purpose (the console.error in fetchCart predates this
    // work and is deliberately preserved); silence it so a passing run stays readable.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the cached cart and reports offline when the fetch rejects', async () => {
    seedSnapshot()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    renderCart()

    // Hydrated synchronously from the snapshot, before any fetch resolves.
    expect(screen.getByTestId('item')).toHaveTextContent('The Brave Little Fox x2')
    expect(screen.getByTestId('total')).toHaveTextContent('25.98')

    await waitFor(() => expect(screen.getByTestId('offline')).toHaveTextContent('offline'))

    // The failed fetch must not wipe what the user can see.
    expect(screen.getByTestId('item')).toHaveTextContent('The Brave Little Fox x2')
    expect(screen.getByTestId('last-synced')).toHaveTextContent('2026-08-16T09:00:00.000Z')
    // The failure is still reported, not swallowed.
    expect(console.error).toHaveBeenCalledWith('Failed to fetch cart', expect.any(TypeError))
    // Guardrail: nothing here reissues or rotates the session UUID.
    expect(localStorage.getItem(SESSION_KEY)).toBe(SESSION_ID)
  })

  it('ignores a snapshot belonging to a different session', async () => {
    localStorage.setItem(
      CART_CACHE_KEY,
      JSON.stringify({ sessionId: 'someone-elses-session', items: [CACHED_ITEM], total: 25.98, cachedAt: '2026-08-16T09:00:00.000Z' }),
    )
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    renderCart()

    await waitFor(() => expect(screen.getByTestId('offline')).toHaveTextContent('offline'))
    expect(screen.queryAllByTestId('item')).toHaveLength(0)
    expect(localStorage.getItem(SESSION_KEY)).toBe(SESSION_ID)
  })

  it('writes a snapshot and clears offline on a successful fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ items: [CACHED_ITEM], total: 25.98 })))

    renderCart()

    await waitFor(() => expect(screen.getByTestId('item')).toHaveTextContent('The Brave Little Fox x2'))
    expect(screen.getByTestId('offline')).toHaveTextContent('online')
    expect(screen.getByTestId('last-synced')).not.toHaveTextContent('never')

    const stored = readCartSnapshot(SESSION_ID)
    expect(stored).toMatchObject({
      sessionId: SESSION_ID,
      total: 25.98,
      cachedAt: expect.any(String),
    })
    expect(stored?.items[0]).toMatchObject({ book_id: 'book-1', quantity: 2, price: 12.99 })
    expect(localStorage.getItem(SESSION_KEY)).toBe(SESSION_ID)
  })

  it('leaves local state untouched when a mutation hits the network offline', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ items: [CACHED_ITEM], total: 25.98 }))
      .mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    renderCart()
    await waitFor(() => expect(screen.getByTestId('item')).toHaveTextContent('x2'))

    fireEvent.click(screen.getByText('Bump'))

    await waitFor(() => expect(screen.getByTestId('offline')).toHaveTextContent('offline'))
    // No optimistic update: the quantity is still what the server last confirmed.
    expect(screen.getByTestId('item')).toHaveTextContent('The Brave Little Fox x2')
    expect(screen.getByTestId('total')).toHaveTextContent('25.98')
    // And no follow-up refetch was attempted after the mutation failed.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('drops the snapshot after a successful clearCart', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ items: [CACHED_ITEM], total: 25.98 }))
      .mockResolvedValue(okResponse({ items: [], total: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    renderCart()
    await waitFor(() => expect(screen.getByTestId('item')).toHaveTextContent('x2'))
    expect(localStorage.getItem(CART_CACHE_KEY)).not.toBeNull()

    fireEvent.click(screen.getByText('Clear'))

    await waitFor(() => expect(screen.queryAllByTestId('item')).toHaveLength(0))
    // A completed checkout must not leave a cart behind for the next cold launch.
    expect(localStorage.getItem(CART_CACHE_KEY)).toBeNull()
    expect(localStorage.getItem(SESSION_KEY)).toBe(SESSION_ID)
  })

  // Regression fence. Before this, `mutate` swallowed the network throw and
  // `addToCart` resolved normally, so BookDetail's `await addToCart(...)` fell
  // through to `setAdded(true)` and rendered "Added!" for a cart that gained
  // nothing. The resolved value is what callers key their confirmation off.
  it('resolves false from addToCart when the add is refused offline', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ items: [CACHED_ITEM], total: 25.98 }))
      .mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    renderCart()
    await waitFor(() => expect(screen.getByTestId('item')).toHaveTextContent('x2'))

    fireEvent.click(screen.getByText('Add'))

    await waitFor(() => expect(screen.getByTestId('add-result')).toHaveTextContent('false'))
    expect(screen.getByTestId('offline')).toHaveTextContent('offline')
    // Local state is untouched: no optimistic add.
    expect(screen.getByTestId('item')).toHaveTextContent('The Brave Little Fox x2')
  })

  it('resolves true from addToCart when the add succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ items: [CACHED_ITEM], total: 25.98 }))
    vi.stubGlobal('fetch', fetchMock)

    renderCart()
    await waitFor(() => expect(screen.getByTestId('item')).toHaveTextContent('x2'))

    fireEvent.click(screen.getByText('Add'))

    await waitFor(() => expect(screen.getByTestId('add-result')).toHaveTextContent('true'))
    expect(screen.getByTestId('offline')).toHaveTextContent('online')
  })
})
