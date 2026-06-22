import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

const AuthContext = createContext(null)

/**
 * Decode a JWT payload without verification (verification happens server-side).
 * Used only to extract role, name, expiry for client-side routing decisions.
 */
function decodeJWT(token) {
  try {
    const payload = token.split('.')[1]
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

function isTokenExpired(decoded) {
  if (!decoded?.exp) return true
  return Date.now() >= decoded.exp * 1000
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)   // { id, email, full_name, role, matric_number? }
  const [token, setToken]     = useState(null)
  const [loading, setLoading] = useState(true)

  // Rehydrate auth state from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('fa_token')
    if (stored) {
      const decoded = decodeJWT(stored)
      if (decoded && !isTokenExpired(decoded)) {
        setToken(stored)
        setUser({
          id:            decoded.sub,
          email:         decoded.email,
          full_name:     decoded.full_name,
          role:          decoded.role,
          matric_number: decoded.matric_number ?? null,
        })
      } else {
        localStorage.removeItem('fa_token')
      }
    }
    setLoading(false)
  }, [])

  /**
   * Login — POSTs credentials to /auth/login and stores the JWT.
   */
  const login = useCallback(async (email, password) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.detail ?? 'Login failed')
    }

    const data = await res.json()
    const decoded = decodeJWT(data.access_token)

    localStorage.setItem('fa_token', data.access_token)
    setToken(data.access_token)
    setUser({
      id:            decoded.sub,
      email:         decoded.email,
      full_name:     decoded.full_name,
      role:          decoded.role,
      matric_number: decoded.matric_number ?? null,
    })

    return decoded.role
  }, [])

  /**
   * Logout — clears token. Optionally clears local Dexie data for NDPR compliance.
   */
  const logout = useCallback(async (clearLocalDB = false) => {
    localStorage.removeItem('fa_token')
    setToken(null)
    setUser(null)

    if (clearLocalDB) {
      const { clearLocalData } = await import('../lib/db/queries')
      await clearLocalData()
    }
  }, [])

  /**
   * Authenticated fetch wrapper — injects Bearer token automatically.
   */
  const authFetch = useCallback(async (path, options = {}) => {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    })

    if (res.status === 401) {
      logout()
      throw new Error('Session expired. Please log in again.')
    }

    return res
  }, [token, logout])

  const isAdmin    = user?.role === 'admin'
  const isLecturer = user?.role === 'lecturer'
  const isStudent  = user?.role === 'student'

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, authFetch, isAdmin, isLecturer, isStudent }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
