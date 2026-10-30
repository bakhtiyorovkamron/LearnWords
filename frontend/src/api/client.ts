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

// What the refresh cookie says about the session. Only a 401/403 from /auth/refresh means "logged
// out"; a network error, a timeout, a 5xx or a 429 means we simply don't know yet ("offline").
export type SessionResult = { status: 'authenticated'; token: string } | { status: 'anonymous' } | { status: 'offline' }

/** Waits before retry 1, 2 and 3 of a refresh that failed for a transient reason. */
export const REFRESH_BACKOFF_MS = [500, 1500, 4000]

const isLoggedOutResponse = (err: unknown) => {
  const status = axios.isAxiosError(err) ? err.response?.status : undefined
  return status === 401 || status === 403
}

async function restoreSession(backoff: readonly number[]): Promise<SessionResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await axios.post<AuthResponse>(`${api.defaults.baseURL}/auth/refresh`, null, { withCredentials: true })
      tokenStore.set(r.data.access_token)
      return { status: 'authenticated', token: r.data.access_token }
    } catch (err) {
      if (isLoggedOutResponse(err)) {
        tokenStore.set(null)
        return { status: 'anonymous' }
      }
      if (attempt >= backoff.length) return { status: 'offline' } // keep what we have; do not log out
      await new Promise((resolve) => setTimeout(resolve, backoff[attempt]))
    }
  }
}

// Single in-flight refresh shared by concurrent 401s and the restore on page load.
let refreshing: Promise<SessionResult> | null = null

export function refreshSession(backoff: readonly number[] = REFRESH_BACKOFF_MS): Promise<SessionResult> {
  refreshing ??= restoreSession(backoff).finally(() => {
    refreshing = null
  })
  return refreshing
}

/** The new access token, or null (logged out, or the server could not be reached). */
export async function refreshAccessToken(): Promise<string | null> {
  const r = await refreshSession()
  return r.status === 'authenticated' ? r.token : null
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
