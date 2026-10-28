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
  // The interface language: new translations (a word you add or edit) are written in it.
  config.headers['X-Native-Language'] = i18n.language
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
  code?: string // stable reason: own_folder, lang_mismatch
  folder_id?: string
  message?: string
  retry_after_seconds?: number
  limit?: number // with daily_limit
}

/** True when the backend rejected the request with 429 (rate limit). */
export function isRateLimited(err: unknown): boolean {
  if (!axios.isAxiosError(err) || err.response?.status !== 429) return false
  // A used-up daily quota is also a 429, but it is not "too many requests, wait a minute".
  return (err.response.data as ApiErrorBody | undefined)?.code !== 'daily_limit'
}

/** User-facing text for a 429: localized with the server's retry_after_seconds, else the API message. */
export function rateLimitMessage(err: unknown): string {
  const body = (axios.isAxiosError(err) ? err.response?.data : undefined) as ApiErrorBody | undefined
  const seconds = body?.retry_after_seconds ?? Number(axios.isAxiosError(err) ? err.response?.headers?.['retry-after'] : NaN)
  if (Number.isFinite(seconds) && seconds > 0) return i18n.t('common.rateLimited', { seconds })
  return body?.message ?? i18n.t('common.rateLimited', { seconds: 60 })
}

/** True for the two per-user feature errors (403 feature_disabled, 429 daily_limit). */
export function isFeatureError(err: unknown): boolean {
  const code = apiErrorInfo(err).code
  return code === 'feature_disabled' || code === 'daily_limit'
}

export function errorMessage(err: unknown): string {
  const code = apiErrorInfo(err).code
  if (code === 'feature_disabled') return i18n.t('errors.featureDisabled')
  if (code === 'daily_limit') {
    const limit = (axios.isAxiosError(err) ? (err.response?.data as ApiErrorBody | undefined)?.limit : undefined) ?? ''
    return i18n.t('errors.dailyLimit', { limit })
  }
  if (isRateLimited(err)) return rateLimitMessage(err)
  if (axios.isAxiosError(err)) {
    return (err.response?.data as ApiErrorBody | undefined)?.error ?? err.message
  }
  return err instanceof Error ? err.message : i18n.t('common.unknownError')
}

/** HTTP status, machine-readable code and (own_folder) folder id of an API error. */
export function apiErrorInfo(err: unknown): { status?: number; code?: string; folderId?: string } {
  if (!axios.isAxiosError(err)) return {}
  const body = err.response?.data as ApiErrorBody | undefined
  return { status: err.response?.status, code: body?.code, folderId: body?.folder_id }
}
