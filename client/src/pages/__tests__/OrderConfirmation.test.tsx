import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import OrderConfirmation from '../OrderConfirmation'
import type { Order } from '../../types'

// Mutable per test: null is a guest, an object is a signed-in buyer.
let mockUser: { id: string; token: string; email: string; name: string; role: string } | null = null
let mockAuthLoading = false

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    loading: mockAuthLoading,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}))

const signedInUser = { id: 'u1', token: 'test-token', email: 'buyer@example.com', name: 'Buyer', role: 'user' }
const FAKE_PDF_BODY = '%PDF-1.7 fake'

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

interface FetchCall { url: string; init?: RequestInit }

function setupFetchMock(order: Order = sampleOrder, pdfStatus = 200) {
  const calls: FetchCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({ url, init })
      if (url.endsWith('/pdf')) {
        return Promise.resolve(
          pdfStatus === 200
            ? new Response(FAKE_PDF_BODY, { status: 200, headers: { 'Content-Type': 'application/pdf' } })
            : new Response(JSON.stringify({ error: 'Book not found' }), {
                status: pdfStatus,
                headers: { 'Content-Type': 'application/json' },
              }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify(order), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
  return { calls }
}

// Renders the router state the login page would receive, so the guest link's
// return path is observable without mounting the real Login page.
function LoginProbe() {
  const location = useLocation()
  return <div data-testid="login-probe">{JSON.stringify(location.state)}</div>
}

function renderOrderConfirmation() {
  return render(
    <MemoryRouter initialEntries={['/order/order-uuid-12345678']}>
      <Routes>
        <Route path="/order/:id" element={<OrderConfirmation />} />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('OrderConfirmation page', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    mockUser = null
    mockAuthLoading = false
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

  describe('keep-a-copy PDF prompt (#87)', () => {
    let clickSpy: ReturnType<typeof vi.spyOn>
    let originalCreate: typeof URL.createObjectURL | undefined
    let originalRevoke: typeof URL.revokeObjectURL | undefined
    let downloadedBlobs: Blob[]

    beforeEach(() => {
      originalCreate = URL.createObjectURL
      originalRevoke = URL.revokeObjectURL
      downloadedBlobs = []
      URL.createObjectURL = vi.fn((blob: Blob) => {
        downloadedBlobs.push(blob)
        return 'blob:mock-pdf-url'
      }) as unknown as typeof URL.createObjectURL
      URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
      clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    })

    afterEach(() => {
      URL.createObjectURL = originalCreate as typeof URL.createObjectURL
      URL.revokeObjectURL = originalRevoke as typeof URL.revokeObjectURL
      vi.restoreAllMocks()
    })

    it('tells the buyer why the copy is worth keeping', async () => {
      setupFetchMock()
      renderOrderConfirmation()
      await screen.findByText(/Order Confirmed/i)
      expect(screen.getByText(/Your PDF stays yours even if the author updates the book later/)).toBeInTheDocument()
    })

    it('gives a guest a sign-in link that returns to this order, and no download button', async () => {
      setupFetchMock()
      renderOrderConfirmation()
      await screen.findByText(/Order Confirmed/i)

      expect(screen.queryByRole('button', { name: /Download PDF/ })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('link', { name: /Sign in to download your PDF/ }))

      const probe = await screen.findByTestId('login-probe')
      expect(JSON.parse(probe.textContent ?? 'null')).toEqual({ from: '/order/order-uuid-12345678' })
    })

    it('renders nothing for the prompt while auth is still resolving', async () => {
      mockAuthLoading = true
      setupFetchMock()
      renderOrderConfirmation()
      await screen.findByText(/Order Confirmed/i)
      expect(screen.queryByTestId('keep-a-copy')).not.toBeInTheDocument()
    })

    it('POSTs each book to the existing pdf route with the bearer token and downloads it', async () => {
      mockUser = signedInUser
      const { calls } = setupFetchMock()
      renderOrderConfirmation()

      fireEvent.click(await screen.findByRole('button', { name: 'Download PDF of Test Book' }))

      await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1))
      const pdfCall = calls.find(c => c.url.endsWith('/api/books/b1/pdf'))
      expect(pdfCall?.init?.method).toBe('POST')
      expect(new Headers(pdfCall?.init?.headers).get('Authorization')).toBe('Bearer test-token')
      expect(downloadedBlobs).toHaveLength(1)
      await expect(downloadedBlobs[0]!.text()).resolves.toBe(FAKE_PDF_BODY)
      expect(screen.queryByText(/didn't work/)).not.toBeInTheDocument()
    })

    it('shows a calm unavailable note when the book was withdrawn since checkout', async () => {
      mockUser = signedInUser
      setupFetchMock(sampleOrder, 404)
      renderOrderConfirmation()

      fireEvent.click(await screen.findByRole('button', { name: 'Download PDF of Test Book' }))

      expect(await screen.findByText(/isn't available to download right now/)).toBeInTheDocument()
      expect(screen.queryByText(/didn't work/)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Download PDF of Test Book' })).toBeDisabled()
    })

    it('offers a retry on any other failure', async () => {
      mockUser = signedInUser
      setupFetchMock(sampleOrder, 500)
      renderOrderConfirmation()

      fireEvent.click(await screen.findByRole('button', { name: 'Download PDF of Test Book' }))

      expect(await screen.findByText(/Download didn't work. Please try again./)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Download PDF of Test Book' })).toBeEnabled()
    })

    it('carries a dark: partner on every themed surface of the prompt', async () => {
      mockUser = signedInUser
      setupFetchMock()
      renderOrderConfirmation()

      const button = await screen.findByRole('button', { name: 'Download PDF of Test Book' })
      const panel = screen.getByTestId('keep-a-copy')
      for (const prefix of ['bg-', 'border-', 'text-']) {
        expect(button.className).toMatch(new RegExp(`dark:${prefix}`))
      }
      expect(panel.className).toMatch(/dark:bg-/)
    })
  })
})
