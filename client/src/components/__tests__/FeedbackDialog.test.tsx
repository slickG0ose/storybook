import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import FeedbackDialog from '../FeedbackDialog'
import type { CartContextValue } from '../../context/CartContext'
import type { useAuth } from '../../context/AuthContext'
import type { useTheme } from '../../context/ThemeContext'
import { recordRecentError, resetRecentErrors } from '../../lib/recentErrors'

// AuthState and ThemeContextValue are not exported, so the factories are pinned to
// the hooks' return types instead — same compile-time drift guard (testing.md).
vi.mock('../../context/AuthContext', () => ({
  useAuth: (): ReturnType<typeof useAuth> => ({
    user: { id: 'u-1', email: 'tester@example.com', name: 'Tester', token: 'tok-1', role: 'user' },
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}))

vi.mock('../../context/CartContext', () => ({
  useCart: (): CartContextValue => ({
    items: [],
    total: 0,
    sessionId: 'session-from-cart',
    addToCart: vi.fn(),
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    fetchCart: vi.fn(),
    offline: false,
    lastSyncedAt: null,
  }),
}))

vi.mock('../../context/ThemeContext', () => ({
  useTheme: (): ReturnType<typeof useTheme> => ({ dark: true, toggle: vi.fn() }),
}))

function stubFetch(status: number, json: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(json),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderDialog(onClose = vi.fn(), path = '/book/book-42?theater=1') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <FeedbackDialog open onClose={onClose} />
    </MemoryRouter>,
  )
  return onClose
}

const textarea = () => screen.getByRole('textbox', { name: 'Your feedback' })
const sendButton = () => screen.getByRole('button', { name: 'Send' })

describe('FeedbackDialog', () => {
  beforeEach(() => {
    resetRecentErrors()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders nothing when closed', () => {
    render(
      <MemoryRouter>
        <FeedbackDialog open={false} onClose={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is a labelled modal with Bug preselected and focus on the textarea', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Send feedback' })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('radio', { name: 'Bug' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Idea' })).toHaveAttribute('aria-checked', 'false')
    expect(textarea()).toHaveFocus()
  })

  it('disables Send while the message is whitespace', () => {
    renderDialog()
    expect(sendButton()).toBeDisabled()
    fireEvent.change(textarea(), { target: { value: '   \n ' } })
    expect(sendButton()).toBeDisabled()
    fireEvent.change(textarea(), { target: { value: 'hi' } })
    expect(sendButton()).toBeEnabled()
  })

  it('shows a live character counter', () => {
    renderDialog()
    fireEvent.change(textarea(), { target: { value: 'hello' } })
    expect(screen.getByText('5 / 2000')).toBeInTheDocument()
  })

  it('submits with context attached and shows the confirmation', async () => {
    recordRecentError('TypeError: boom')
    const fetchMock = stubFetch(201, { id: 'f-1', status: 'new', created_at: '2026-11-08T00:00:00.000Z' })
    renderDialog()
    fireEvent.click(screen.getByRole('radio', { name: 'Idea' }))
    fireEvent.change(textarea(), { target: { value: '  More dragons please  ' } })
    fireEvent.click(sendButton())

    expect(await screen.findByRole('status')).toHaveTextContent("Thanks — that's been sent.")
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok-1' })
    const posted: unknown = JSON.parse(init.body as string)
    expect(posted).toMatchObject({
      category: 'idea',
      message: 'More dragons please',
      route: '/book/book-42?theater=1',
      book_id: 'book-42',
      session_id: 'session-from-cart',
      theme: 'dark',
      client_build: null,
      viewport_width: expect.any(Number),
      viewport_height: expect.any(Number),
      recent_errors: ['TypeError: boom'],
    })
    expect(posted).not.toHaveProperty('user_id')
  })

  it('Send another returns to an empty form', async () => {
    stubFetch(201, { id: 'f-1', status: 'new', created_at: '2026-11-08T00:00:00.000Z' })
    renderDialog()
    fireEvent.change(textarea(), { target: { value: 'first' } })
    fireEvent.click(sendButton())
    fireEvent.click(await screen.findByRole('button', { name: 'Send another' }))
    expect(textarea()).toHaveValue('')
    expect(screen.getByRole('radio', { name: 'Bug' })).toHaveAttribute('aria-checked', 'true')
  })

  it('keeps the text and shows an alert when the submit fails', async () => {
    stubFetch(500, { error: 'boom' })
    renderDialog()
    fireEvent.change(textarea(), { target: { value: 'my precious words' } })
    fireEvent.click(sendButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't send that. Your message is still here — try again.",
    )
    expect(textarea()).toHaveValue('my precious words')
  })

  it('tells the tester to sign in again on 401', async () => {
    stubFetch(401, { error: 'Unauthorized' })
    renderDialog()
    fireEvent.change(textarea(), { target: { value: 'x' } })
    fireEvent.click(sendButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('Your session has ended — sign in again, then send.')
  })

  it('shows the server message on 429', async () => {
    stubFetch(429, { error: "You've sent a lot of feedback in a few minutes. Try again shortly." })
    renderDialog()
    fireEvent.change(textarea(), { target: { value: 'x' } })
    fireEvent.click(sendButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(/a lot of feedback/)
  })

  it('reads Sending… while the request is in flight', async () => {
    let resolve: (v: unknown) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { resolve = r })))
    renderDialog()
    fireEvent.change(textarea(), { target: { value: 'x' } })
    fireEvent.click(sendButton())
    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled()
    resolve({ ok: true, status: 201, json: () => Promise.resolve({ id: 'f', status: 'new', created_at: 'x' }) })
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
  })

  it('Escape calls onClose', () => {
    const onClose = renderDialog()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clicking the overlay calls onClose, clicking the panel does not', () => {
    const onClose = renderDialog()
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('returns focus to the trigger on close', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const { rerender } = render(
      <MemoryRouter>
        <FeedbackDialog open onClose={vi.fn()} />
      </MemoryRouter>,
    )
    expect(textarea()).toHaveFocus()
    rerender(
      <MemoryRouter>
        <FeedbackDialog open={false} onClose={vi.fn()} />
      </MemoryRouter>,
    )
    expect(trigger).toHaveFocus()
    trigger.remove()
  })
})
