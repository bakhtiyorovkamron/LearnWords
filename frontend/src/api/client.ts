import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type { AuthResponse } from './types'
import i18n from '../i18n'

// Access token lives only in memory (not localStorage) to limit XSS exposure.
// The refresh token is an httpOnly cookie set by the backend.
let accessToken: string | null = null
const listeners = new Set<(token: string | null) => void>()

export const tokenStore = {
  get: () => accessToken,
  set(token: string | null) {
    accessToken = token
    listeners.forEach((l) => l(token))
  },
  subscribe(l: (token: string | null) => void) {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  withCredentials: true,
})

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
  return config
})

// Single in-flight refresh shared by concurrent 401s.
let refreshing: Promise<string | null> | null = null

export function refreshAccessToken(): Promise<string | null> {
  refreshing ??= axios
    .post<AuthResponse>(`${api.defaults.baseURL}/auth/refresh`, null, { withCredentials: true })
    .then((r) => {
      tokenStore.set(r.data.access_token)
      return r.data.access_token
    })
    .catch(() => {
      tokenStore.set(null)
      return null
    })
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined
  const isAuthCall = original?.url?.startsWith('/auth/')
  if (error.response?.status === 401 && original && !original._retry && !isAuthCall) {
    original._retry = true
    const token = await refreshAccessToken()
    if (token) return api(original)
  }
  return Promise.reject(error)
})

interface ApiErrorBody {
  error?: string
  message?: string
  retry_after_seconds?: number
}

/** True when the backend rejected the request with 429 (rate limit). */
export function isRateLimited(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 429
}

/** User-facing text for a 429: localized with the server's retry_after_seconds, else the API message. */
export function rateLimitMessage(err: unknown): string {
  const body = (axios.isAxiosError(err) ? err.response?.data : undefined) as ApiErrorBody | undefined
  const seconds = body?.retry_after_seconds ?? Number(axios.isAxiosError(err) ? err.response?.headers?.['retry-after'] : NaN)
  if (Number.isFinite(seconds) && seconds > 0) return i18n.t('common.rateLimited', { seconds })
  return body?.message ?? i18n.t('common.rateLimited', { seconds: 60 })
}

export function errorMessage(err: unknown): string {
  if (isRateLimited(err)) return rateLimitMessage(err)
  if (axios.isAxiosError(err)) {
    return (err.response?.data as ApiErrorBody | undefined)?.error ?? err.message
  }
  return err instanceof Error ? err.message : i18n.t('common.unknownError')
}
