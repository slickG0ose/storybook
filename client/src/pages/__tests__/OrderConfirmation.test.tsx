import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import OrderConfirmation from '../OrderConfirmation'
import type { Order } from '../../types'

const sampleOrder: Order = {
  id: 'order-uuid-12345678',
  session_id: 'session-uuid',
  user_id: null,
  customer_name: 'Test User',
  customer_email: 'test@example.com',
  total: 19.98,
  status: 'pending',
  created_at: '2026-05-18T00:00:00.000Z',
  items: [
    {
      id: 1,
      order_id: 'o1',
      book_id: 'b1',
      title: 'Test Book',
      quantity: 2,
      price: 9.99,
    },
  ],
}

function setupFetchMock(order: Order = sampleOrder) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(order), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ),
  )
}

function renderOrderConfirmation() {
  return render(
    <MemoryRouter initialEntries={['/order/order-uuid-12345678']}>
      <Routes>
        <Route path="/order/:id" element={<OrderConfirmation />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('OrderConfirmation page', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the order summary including the book title from the server', async () => {
    setupFetchMock()
    renderOrderConfirmation()

    // Wait for the loading state to clear and the confirmation to render.
    await screen.findByText(/Order Confirmed/i)

    // Critical assertion — proves the OrderItem.title rename works end-to-end.
    expect(screen.getByText(/Test Book/)).toBeInTheDocument()

    // Bonus assertions — customer name and total render correctly.
    expect(screen.getByText(/Test User/)).toBeInTheDocument()
    // $19.98 appears twice — once on the item row (2 x $9.99) and once as the order total.
    expect(screen.getAllByText('$19.98')).toHaveLength(2)
  })
})
