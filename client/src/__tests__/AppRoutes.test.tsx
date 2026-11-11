import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'

// The shell under test is the route table. Navbar and the pages are stubbed so this file
// needs no cart/auth/theme providers and no network.
vi.mock('../components/Navbar', () => ({ default: () => <div>Navbar stub</div> }))
vi.mock('../pages/Home', () => ({ default: () => <div>Home stub</div> }))
vi.mock('../pages/Cart', () => ({ default: () => <div>Cart stub</div> }))
vi.mock('../pages/Checkout', () => ({ default: () => <div>Checkout stub</div> }))
vi.mock('../pages/OrderConfirmation', () => ({ default: () => <div>Order stub</div> }))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('App routes', () => {
  afterEach(() => vi.unstubAllEnvs())

  describe('commerce on (default)', () => {
    it('renders the cart page at /cart', () => {
      renderAt('/cart')
      expect(screen.getByText('Cart stub')).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'This page wandered off' })).not.toBeInTheDocument()
    })

    it('renders checkout and order confirmation', () => {
      renderAt('/checkout').unmount()
      renderAt('/order/abc')
      expect(screen.getByText('Order stub')).toBeInTheDocument()
    })
  })

  describe('commerce off', () => {
    it.each(['/cart', '/checkout', '/order/abc'])('%s falls through to NotFound', path => {
      vi.stubEnv('VITE_COMMERCE_ENABLED', 'false')
      renderAt(path)
      expect(screen.getByRole('heading', { name: 'This page wandered off' })).toBeInTheDocument()
      expect(screen.queryByText(/(Cart|Checkout|Order) stub/)).not.toBeInTheDocument()
    })

    it('still serves the non-commerce routes', () => {
      vi.stubEnv('VITE_COMMERCE_ENABLED', 'false')
      renderAt('/')
      expect(screen.getByText('Home stub')).toBeInTheDocument()
    })
  })
})
