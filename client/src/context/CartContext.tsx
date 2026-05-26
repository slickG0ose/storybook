import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { CartItem } from '../types'
import { api } from '../lib/apiBase'

interface CartContextValue {
  items: CartItem[];
  total: number;
  sessionId: string;
  addToCart: (bookId: string) => Promise<void>;
  updateQuantity: (bookId: string, quantity: number) => Promise<void>;
  removeFromCart: (bookId: string) => Promise<void>;
  clearCart: () => Promise<void>;
  fetchCart: () => Promise<void>;
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
  const [items, setItems] = useState<CartItem[]>([])
  const [total, setTotal] = useState<number>(0)
  const sessionId = getSessionId()

  const fetchCart = useCallback(async () => {
    try {
      const res = await fetch(api(`/api/cart/${sessionId}`))
      const data = await res.json() as { items: CartItem[]; total: number }
      setItems(data.items)
      setTotal(data.total)
    } catch (err) {
      console.error('Failed to fetch cart', err)
    }
  }, [sessionId])

  useEffect(() => {
    void fetchCart()
  }, [fetchCart])

  const addToCart = async (bookId: string): Promise<void> => {
    await fetch(api(`/api/cart/${sessionId}/items`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId }),
    })
    await fetchCart()
  }

  const updateQuantity = async (bookId: string, quantity: number): Promise<void> => {
    await fetch(api(`/api/cart/${sessionId}/items/${bookId}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity }),
    })
    await fetchCart()
  }

  const removeFromCart = async (bookId: string): Promise<void> => {
    await fetch(api(`/api/cart/${sessionId}/items/${bookId}`), {
      method: 'DELETE',
    })
    await fetchCart()
  }

  const clearCart = async (): Promise<void> => {
    await fetch(api(`/api/cart/${sessionId}`), { method: 'DELETE' })
    await fetchCart()
  }

  return (
    <CartContext.Provider value={{ items, total, sessionId, addToCart, updateQuantity, removeFromCart, clearCart, fetchCart }}>
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
