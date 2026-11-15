import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { User, UserRole } from '../types'
import { api } from '../lib/apiBase'
import { clearCreateDraft } from '../lib/createDraft'
import { AUTH_EXPIRED_EVENT } from '../lib/authFetch'
import type { AuthExpiredDetail, LoginLocationState } from '../lib/authFetch'

interface AuthState {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<string | null>
  register: (email: string, name: string, password: string) => Promise<string | null>
  logout: () => void
}

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
    const stored = localStorage.getItem('storybook-auth')
    if (!stored) {
      setLoading(false)
      return
    }
    let parsed: User
    try {
      parsed = JSON.parse(stored) as User
    } catch {
      localStorage.removeItem('storybook-auth')
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
          localStorage.removeItem('storybook-auth')
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
      localStorage.removeItem('storybook-auth')
      const loc = locationRef.current
      if (loc.pathname === '/login') return
      const state: LoginLocationState = { from: loc.pathname + loc.search, reason: 'expired' }
      navigate('/login', { state })
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [navigate])

  const login = async (email: string, password: string): Promise<string | null> => {
    const res = await fetch(api('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await res.json()
    if (!res.ok) return data.error as string
    const u: User = {
      id: data.id,
      email: data.email,
      name: data.name,
      token: data.token,
      role: (data.role as UserRole | undefined) ?? 'user',
    }
    setUser(u)
    localStorage.setItem('storybook-auth', JSON.stringify(u))
    return null
  }

  const register = async (email: string, name: string, password: string): Promise<string | null> => {
    const res = await fetch(api('/api/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, password }),
    })
    const data = await res.json()
    if (!res.ok) return data.error as string
    const u: User = {
      id: data.id,
      email: data.email,
      name: data.name,
      token: data.token,
      role: (data.role as UserRole | undefined) ?? 'user',
    }
    setUser(u)
    localStorage.setItem('storybook-auth', JSON.stringify(u))
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
    localStorage.removeItem('storybook-auth')
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
