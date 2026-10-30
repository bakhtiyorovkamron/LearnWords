import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { refreshSession, tokenStore } from '../api/client'

/** 'offline': the server could not be reached, so we do not know whether the user is logged in. */
export type AuthStatus = 'authenticated' | 'anonymous' | 'offline'

interface AuthState {
  status: AuthStatus
  isAuthenticated: boolean
  isLoading: boolean
  /** Ask the server again (the "no connection" screen's Retry). */
  retry: () => void
}

const AuthCtx = createContext<AuthState>({ status: 'anonymous', isAuthenticated: false, isLoading: true, retry: () => undefined })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(tokenStore.get())
  const [isLoading, setLoading] = useState(true)
  const [offline, setOffline] = useState(false)

  const restore = useCallback(() => {
    setLoading(true)
    // Restore the session from the httpOnly refresh cookie (transient failures are retried inside).
    refreshSession()
      .then((r) => setOffline(r.status === 'offline'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const unsub = tokenStore.subscribe((t) => { setToken(t); if (t) setOffline(false) })
    restore()
    return unsub
  }, [restore])

  const status: AuthStatus = token ? 'authenticated' : offline ? 'offline' : 'anonymous'
  return <AuthCtx.Provider value={{ status, isAuthenticated: !!token, isLoading, retry: restore }}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
