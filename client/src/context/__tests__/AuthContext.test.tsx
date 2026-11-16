import { render, screen, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth, REVALIDATE_MIN_INTERVAL_MS } from '../AuthContext'
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

describe('AuthProvider with blocked storage (#232)', () => {
  it('loads signed out instead of throwing when getItem throws', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })
    try {
      mount()
      await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'))
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('still clears in-memory state when removeItem throws on session end', async () => {
    localStorage.setItem(KEY, JSON.stringify(STORED))
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'u1', email: 'a@b.c', name: 'Ann', role: 'user' }), { status: 200 }))
    mount()
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Ann:user'))
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })
    try {
      fire('tok-1')
      await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/login'))
      expect(screen.getByTestId('user')).toHaveTextContent('none')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('AuthProvider focus re-validation (#231)', () => {
  const ME_OK = () => new Response(JSON.stringify({ id: 'u1', email: 'a@b.c', name: 'Ann', role: 'user' }), { status: 200 })

  beforeEach(() => {
    localStorage.setItem(KEY, JSON.stringify(STORED))
  })
  afterEach(() => vi.useRealTimers())

  async function mountSignedIn() {
    fetchMock.mockResolvedValueOnce(ME_OK())
    mount()
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Ann:user'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  }

  function becomeVisible() {
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }

  it('does not re-check within the throttle window', async () => {
    await mountSignedIn()
    becomeVisible()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-checks /me with the bearer after the window, and a 401 ends the session', async () => {
    await mountSignedIn()
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + REVALIDATE_MIN_INTERVAL_MS + 1)
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }))
    becomeVisible()
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/login'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[1]!
    expect(String(url)).toContain('/api/auth/me')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok-1')
    expect(screen.getByTestId('state')).toHaveTextContent('"reason":"expired"')
    expect(localStorage.getItem(KEY)).toBeNull()
    vi.mocked(Date.now).mockRestore()
  })

  it('keeps the session when the re-check fails for any reason but a 401', async () => {
    await mountSignedIn()
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + REVALIDATE_MIN_INTERVAL_MS + 1)
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    becomeVisible()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('user')).toHaveTextContent('Ann:user')
    expect(screen.getByTestId('loc')).toHaveTextContent('/my-books?tab=1')
    vi.mocked(Date.now).mockRestore()
  })

  it('does nothing when signed out', async () => {
    localStorage.clear()
    mount()
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'))
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + REVALIDATE_MIN_INTERVAL_MS + 1)
    becomeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
    vi.mocked(Date.now).mockRestore()
  })
})
