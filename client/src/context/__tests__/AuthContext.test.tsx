import { render, screen, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from '../AuthContext'
import { AUTH_EXPIRED_EVENT } from '../../lib/authFetch'
import { CREATE_DRAFT_KEY } from '../../lib/createDraft'

const KEY = 'storybook-auth'
const STORED = { id: 'u1', email: 'a@b.c', name: 'Ann', token: 'tok-1' }
const fetchMock = vi.fn()

function Probe() {
  const { user, loading } = useAuth()
  const loc = useLocation()
  return (
    <div>
      <span data-testid="user">{loading ? 'loading' : (user ? `${user.name}:${user.role}` : 'none')}</span>
      <span data-testid="loc">{loc.pathname + loc.search}</span>
      <span data-testid="state">{JSON.stringify(loc.state)}</span>
    </div>
  )
}

function mount(path = '/my-books?tab=1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><Probe /></AuthProvider>
    </MemoryRouter>,
  )
}

function fire(token: string) {
  act(() => {
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { token } }))
  })
}

beforeEach(() => {
  localStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('AuthProvider mount check', () => {
  beforeEach(() => localStorage.setItem(KEY, JSON.stringify(STORED)))

  it('hydrates from a 200', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'u1', email: 'a@b.c', name: 'Ann', role: 'admin' }), { status: 200 }))
    mount()
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Ann:admin'))
  })

  it('clears storage on 401 and stays on the same route', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }))
    mount()
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'))
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(screen.getByTestId('loc')).toHaveTextContent('/my-books?tab=1')
  })

  it('keeps the stored user when fetch rejects, role defaulting to user', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'))
    mount()
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Ann:user'))
    expect(localStorage.getItem(KEY)).not.toBeNull()
  })

  it('keeps the stored user on a 500', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }))
    mount()
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Ann:user'))
    expect(localStorage.getItem(KEY)).not.toBeNull()
  })
})

describe('AuthProvider malformed stored blob', () => {
  it('drops it, finishes loading signed out, and does not call the API', async () => {
    localStorage.setItem(KEY, '{not json')
    mount()
    await waitFor(() => expect(screen.getByTestId('user')).not.toHaveTextContent('Ann'))
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('AuthProvider session-end event', () => {
  beforeEach(() => {
    localStorage.setItem(KEY, JSON.stringify(STORED))
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'u1', email: 'a@b.c', name: 'Ann', role: 'user' }), { status: 200 }))
  })

  it('clears the session and routes to /login with from + reason, without calling logout', async () => {
    mount()
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Ann:user'))
    fire('tok-1')
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/login'))
    expect(screen.getByTestId('user')).toHaveTextContent('none')
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '')).toEqual({ from: '/my-books?tab=1', reason: 'expired' })
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/api/auth/logout'))).toBe(false)
  })

  it('keeps the create draft on session end', async () => {
    sessionStorage.setItem(CREATE_DRAFT_KEY, '{"v":1}')
    mount()
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Ann:user'))
    fire('tok-1')
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/login'))
    expect(sessionStorage.getItem(CREATE_DRAFT_KEY)).toBe('{"v":1}')
    sessionStorage.clear()
  })

  it('ignores an event for a different token', async () => {
    mount()
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Ann:user'))
    fire('some-other-token')
    expect(screen.getByTestId('user')).toHaveTextContent('Ann:user')
    expect(screen.getByTestId('loc')).toHaveTextContent('/my-books?tab=1')
    expect(localStorage.getItem(KEY)).not.toBeNull()
  })
})

describe('AuthProvider explicit logout', () => {
  it('clears the create draft', async () => {
    localStorage.setItem(KEY, JSON.stringify(STORED))
    sessionStorage.setItem(CREATE_DRAFT_KEY, '{"v":1}')
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'u1', email: 'a@b.c', name: 'Ann', role: 'user' }), { status: 200 }))
    let doLogout: () => void = () => {}
    function Grab() {
      doLogout = useAuth().logout
      return null
    }
    render(<MemoryRouter><AuthProvider><Grab /></AuthProvider></MemoryRouter>)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    act(() => doLogout())
    expect(sessionStorage.getItem(CREATE_DRAFT_KEY)).toBeNull()
  })
})
