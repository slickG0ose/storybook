import { render, screen, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider, useAuth } from '../AuthContext'
import { UNREACHABLE_MESSAGE } from '../../lib/friendlyError'

/**
 * login() and register() must resolve to a message, never reject. Both forms await
 * them with a spinner up; a rejection (the server asleep or unreachable) left that
 * spinner on forever with no message.
 */
const fetchMock = vi.fn()
let api: ReturnType<typeof useAuth>

function Probe() {
  api = useAuth()
  return <span data-testid="user">{api.user ? api.user.name : 'none'}</span>
}

beforeEach(() => {
  localStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  render(
    <MemoryRouter>
      <AuthProvider><Probe /></AuthProvider>
    </MemoryRouter>,
  )
})
afterEach(() => vi.unstubAllGlobals())

describe.each([
  ['login', () => api.login('a@b.c', 'pw')],
  ['register', () => api.register('a@b.c', 'Ann', 'password1')],
])('%s when the server cannot answer', (_name, call) => {
  it('resolves to the unreachable message when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    let result: string | null = null
    await act(async () => { result = await call() })
    expect(result).toBe(UNREACHABLE_MESSAGE)
    expect(screen.getByTestId('user')).toHaveTextContent('none')
  })

  it('resolves to the unreachable message on an HTML 502', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }))
    let result: string | null = null
    await act(async () => { result = await call() })
    expect(result).toBe(UNREACHABLE_MESSAGE)
  })

  it("still returns the server's own message for a JSON error", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid email or password' }), { status: 401 }))
    let result: string | null = null
    await act(async () => { result = await call() })
    expect(result).toBe('Invalid email or password')
  })

  it('signs in on a 200', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'u1', email: 'a@b.c', name: 'Ann', token: 't', role: 'user' }), { status: 200 }),
    )
    let result: string | null = 'unset'
    await act(async () => { result = await call() })
    expect(result).toBeNull()
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Ann'))
  })
})
