import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { refreshAccessToken, tokenStore } from '../api/client'

interface AuthState {
  isAuthenticated: boolean
  isLoading: boolean
}

const AuthCtx = createContext<AuthState>({ isAuthenticated: false, isLoading: true })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(tokenStore.get())
  const [isLoading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = tokenStore.subscribe(setToken)
    // Restore session from the httpOnly refresh cookie on page load.
    refreshAccessToken().finally(() => setLoading(false))
    return unsub
  }, [])

  return <AuthCtx.Provider value={{ isAuthenticated: !!token, isLoading }}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)


