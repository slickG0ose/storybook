import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { User, UserRole } from '../types'
import { describeFailure, readErrorMessage } from '../lib/friendlyError'
import { api } from '../lib/apiBase'
import { clearCreateDraft } from '../lib/createDraft'
import { AUTH_EXPIRED_EVENT, authFetch } from '../lib/authFetch'
import type { AuthExpiredDetail, LoginLocationState } from '../lib/authFetch'

interface AuthState {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<string | null>
  register: (email: string, name: string, password: string) => Promise<string | null>
  logout: () => void
}

const AUTH_KEY = 'storybook-auth'

// Storage can be blocked outright (site data blocked, some private modes): every access
// then throws a SecurityError. That must degrade to "signed out", never crash the app (#232).
function readStored(): string | null {
  try {
    return localStorage.getItem(AUTH_KEY)
  } catch {
    return null
  }
}
function writeStored(u: User): void {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify(u))
  } catch {
    // Signed in for this page's lifetime only.
  }
}
function clearStored(): void {
  try {
    localStorage.removeItem(AUTH_KEY)
  } catch {
    // Nothing stored to clear.
  }
}

/** Minimum gap between focus-triggered session checks (#231). */
export const REVALIDATE_MIN_INTERVAL_MS = 60_000

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  login: async () => null,
  register: async () => null,
  logout: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const navigate = useNavigate()
  const location = useLocation()
  const userRef = useRef<User | null>(null)
  const locationRef = useRef(location)
  userRef.current = user
  locationRef.current = location

  useEffect(() => {
    const stored = readStored()
    if (!stored) {
      setLoading(false)
      return
    }
    let parsed: User
    try {
      parsed = JSON.parse(stored) as User
    } catch {
      clearStored()
      setLoading(false)
      return
    }
    // Only a 401 means the session is dead. Offline, a cold server or a 5xx keep the
    // stored session; the server rejects a dead token on the next authed call.
    const keepStored = () => setUser({ ...parsed, role: parsed.role ?? 'user' })
    fetch(api('/api/auth/me'), {
      headers: { Authorization: `Bearer ${parsed.token}` },
    })
      .then(async res => {
        if (res.ok) {
          const data = (await res.json()) as { id: string; email: string; name: string; role?: UserRole }
          setUser({ ...data, token: parsed.token, role: data.role ?? 'user' })
        } else if (res.status === 401) {
          clearStored()
          setUser(null)
        } else {
          keepStored()
        }
      })
      .catch(keepStored)
      .finally(() => setLoading(false))
  }, [])

  // A 401 on a bearer request (see authFetch) ends the session: clear it and send the
  // user to /login with the path they were on. Does not call /logout and does not
  // clear the Create-a-Book draft.
  useEffect(() => {
    const onExpired = (e: Event) => {
      const current = userRef.current
      const detail = (e as CustomEvent<AuthExpiredDetail>).detail
      if (!current || !detail || detail.token !== current.token) return
      setUser(null)
      clearStored()
      const loc = locationRef.current
      if (loc.pathname === '/login') return
      const state: LoginLocationState = { from: loc.pathname + loc.search, reason: 'expired' }
      navigate('/login', { state })
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [navigate])

  // A tab left open past expiry (or signed out by a login elsewhere) otherwise looks
  // signed in until its next authed call. Re-check when the tab comes back into view,
  // throttled. authFetch turns a 401 into AUTH_EXPIRED_EVENT, handled above; any other
  // failure (offline, cold server) is ignored, matching the mount check (#231).
  const lastCheckRef = useRef(Date.now())
  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState !== 'visible') return
      const current = userRef.current
      if (!current) return
      const now = Date.now()
      if (now - lastCheckRef.current < REVALIDATE_MIN_INTERVAL_MS) return
      lastCheckRef.current = now
      authFetch(current.token, api('/api/auth/me')).catch(() => {})
    }
    document.addEventListener('visibilitychange', revalidate)
    window.addEventListener('focus', revalidate)
    return () => {
      document.removeEventListener('visibilitychange', revalidate)
      window.removeEventListener('focus', revalidate)
    }
  }, [])

  const login = async (email: string, password: string): Promise<string | null> => {
    // Never rejects: both callers show the returned string and clear their spinner.
    // A cold or unreachable server used to throw out of here (network TypeError, or a
    // SyntaxError parsing the host's HTML 502), leaving the form spinning forever.
    let res: Response
    let data: { id: string; email: string; name: string; token: string; role?: UserRole }
    try {
      res = await fetch(api('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) return await readErrorMessage(res, 'Sign-in failed. Please try again.')
      data = (await res.json()) as typeof data
    } catch (err) {
      return describeFailure(err, 'Sign-in failed. Please try again.')
    }
    const u: User = {
      id: data.id,
      email: data.email,
      name: data.name,
      token: data.token,
      role: data.role ?? 'user',
    }
    setUser(u)
    writeStored(u)
    return null
  }

  const register = async (email: string, name: string, password: string): Promise<string | null> => {
    // Never rejects: both callers show the returned string and clear their spinner.
    // A cold or unreachable server used to throw out of here (network TypeError, or a
    // SyntaxError parsing the host's HTML 502), leaving the form spinning forever.
    let res: Response
    let data: { id: string; email: string; name: string; token: string; role?: UserRole }
    try {
      res = await fetch(api('/api/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, password }),
      })
      if (!res.ok) return await readErrorMessage(res, 'Sign-up failed. Please try again.')
      data = (await res.json()) as typeof data
    } catch (err) {
      return describeFailure(err, 'Sign-up failed. Please try again.')
    }
    const u: User = {
      id: data.id,
      email: data.email,
      name: data.name,
      token: data.token,
      role: data.role ?? 'user',
    }
    setUser(u)
    writeStored(u)
    return null
  }

  const logout = () => {
    if (user) {
      void fetch(api('/api/auth/logout'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${user.token}` },
      })
    }
    setUser(null)
    clearStored()
    clearCreateDraft()
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
