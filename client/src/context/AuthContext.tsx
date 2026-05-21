import { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import type { User, UserRole } from '../types'

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

  useEffect(() => {
    const stored = localStorage.getItem('storybook-auth')
    if (stored) {
      const parsed = JSON.parse(stored) as User
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${parsed.token}` },
      })
        .then(res => {
          if (res.ok) return res.json()
          throw new Error('expired')
        })
        .then((data: { id: string; email: string; name: string; role?: UserRole }) => {
          setUser({ ...data, token: parsed.token, role: data.role ?? 'user' })
        })
        .catch(() => {
          localStorage.removeItem('storybook-auth')
          setUser(null)
        })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const login = async (email: string, password: string): Promise<string | null> => {
    const res = await fetch('/api/auth/login', {
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
    const res = await fetch('/api/auth/register', {
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
      void fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${user.token}` },
      })
    }
    setUser(null)
    localStorage.removeItem('storybook-auth')
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
