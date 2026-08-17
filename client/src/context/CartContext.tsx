import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { CartItem } from '../types'
import { api } from '../lib/apiBase'
import { readCartSnapshot, writeCartSnapshot, clearCartSnapshot, type CartSnapshot } from '../lib/cartCache'

/**
 * Exported so the hand-written `vi.mock('../../context/CartContext')` factories across
 * the client test suite can annotate their return type. Without that annotation a
 * mock's object literal is inferred structurally and `npx tsc --noEmit` stays green when
 * a field is added here — which is precisely the drift this export exists to catch.
 */
export interface CartContextValue {
  items: CartItem[];
  total: number;
  sessionId: string;
  addToCart: (bookId: string) => Promise<void>;
  updateQuantity: (bookId: string, quantity: number) => Promise<void>;
  removeFromCart: (bookId: string) => Promise<void>;
  clearCart: () => Promise<void>;
  fetchCart: () => Promise<void>;
  /** The last fetch or mutation failed at the network layer. Offline is read-only. */
  offline: boolean;
  /** ISO timestamp of the last successful fetch (or of the snapshot hydrated on mount). */
  lastSyncedAt: string | null;
}

const CartContext = createContext<CartContextValue | undefined>(undefined)

function getSessionId(): string {
  let id = localStorage.getItem('storybook-session')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('storybook-session', id)
  }
  return id
}

interface CartProviderProps {
  children: ReactNode;
}

export function CartProvider({ children }: CartProviderProps) {
  const sessionId = getSessionId()

  // Read once, lazily, on first render — before the first fetch resolves — so a cold
  // launch with no network still paints the cart the user last saw. A snapshot from a
  // different session is discarded by readCartSnapshot, so this cannot leak a cart
  // across sessions.
  const [hydrated] = useState<CartSnapshot | null>(() => readCartSnapshot(sessionId))
  const [items, setItems] = useState<CartItem[]>(() => hydrated?.items ?? [])
  const [total, setTotal] = useState<number>(() => hydrated?.total ?? 0)
  // Deliberately starts false even when a snapshot was hydrated: `true` until proven
  // otherwise would flash the offline banner on every normal cart visit. The flag is
  // raised by an actual network failure, not by an assumption.
  const [offline, setOffline] = useState<boolean>(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(hydrated?.cachedAt ?? null)

  const fetchCart = useCallback(async () => {
    try {
      const res = await fetch(api(`/api/cart/${sessionId}`))
      const data = await res.json() as { items: CartItem[]; total: number }
      setItems(data.items)
      setTotal(data.total)
      const cachedAt = new Date().toISOString()
      writeCartSnapshot({ sessionId, items: data.items, total: data.total, cachedAt })
      setOffline(false)
      setLastSyncedAt(cachedAt)
    } catch (err) {
      // Keep whatever is on screen (live values or the hydrated snapshot) and say so.
      console.error('Failed to fetch cart', err)
      setOffline(true)
    }
  }, [sessionId])

  useEffect(() => {
    void fetchCart()
  }, [fetchCart])

  /**
   * Mutations are refused offline: the request is attempted, and a network-layer throw
   * raises `offline` and leaves local state exactly as it was. No optimistic update and
   * no replay queue — replaying "increase quantity" against a server-authoritative cart
   * with no idempotency key produces a wrong total on a money path (spec §Alternatives →
   * "Queued offline mutations"). `Cart.tsx` disables the controls above an offline
   * banner so the user is never shown a change that did not stick.
   */
  const mutate = useCallback(async (run: () => Promise<unknown>): Promise<boolean> => {
    try {
      await run()
      return true
    } catch (err) {
      console.error('Cart mutation failed', err)
      setOffline(true)
      return false
    }
  }, [])

  const addToCart = async (bookId: string): Promise<void> => {
    const ok = await mutate(() => fetch(api(`/api/cart/${sessionId}/items`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId }),
    }))
    if (!ok) return
    await fetchCart()
  }

  const updateQuantity = async (bookId: string, quantity: number): Promise<void> => {
    const ok = await mutate(() => fetch(api(`/api/cart/${sessionId}/items/${bookId}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity }),
    }))
    if (!ok) return
    await fetchCart()
  }

  const removeFromCart = async (bookId: string): Promise<void> => {
    const ok = await mutate(() => fetch(api(`/api/cart/${sessionId}/items/${bookId}`), {
      method: 'DELETE',
    }))
    if (!ok) return
    await fetchCart()
  }

  const clearCart = async (): Promise<void> => {
    const ok = await mutate(() => fetch(api(`/api/cart/${sessionId}`), { method: 'DELETE' }))
    if (!ok) return
    await fetchCart()
    // fetchCart has just written a snapshot of the now-empty cart; drop the key entirely
    // so a completed checkout leaves nothing behind to hydrate from.
    clearCartSnapshot()
  }

  return (
    <CartContext.Provider value={{ items, total, sessionId, addToCart, updateQuantity, removeFromCart, clearCart, fetchCart, offline, lastSyncedAt }}>
      {children}
    </CartContext.Provider>
  )
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext)
  if (!context) {
    throw new Error('useCart must be used within a CartProvider')
  }
  return context
}
