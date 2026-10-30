import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import axios, { AxiosError, type AxiosResponse } from 'axios'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { refreshSession, REFRESH_BACKOFF_MS, tokenStore } from '../api/client'
import { AuthProvider } from './AuthContext'
import { ProtectedRoute } from './ProtectedRoute'

const respond = (status: number) =>
  new AxiosError('x', String(status), undefined, undefined, { status, data: {}, headers: {}, statusText: '', config: {} as never } as AxiosResponse)
const networkError = () => new AxiosError('Network Error', 'ERR_NETWORK')
const ok = (token = 'tok') => ({ data: { access_token: token } })

let post: ReturnType<typeof vi.fn>
const realBackoff = [...REFRESH_BACKOFF_MS]

beforeEach(async () => {
  await i18n.changeLanguage('en')
  tokenStore.set(null)
  REFRESH_BACKOFF_MS.fill(0) // no real waiting in tests (the real delays are 0.5 s, 1.5 s, 4 s)
  post = vi.spyOn(axios, 'post') as unknown as ReturnType<typeof vi.fn>
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  REFRESH_BACKOFF_MS.splice(0, REFRESH_BACKOFF_MS.length, ...realBackoff)
})

describe('refreshSession', () => {
  it('the real backoff is 0.5 s, 1.5 s, 4 s', () => {
    expect(realBackoff).toEqual([500, 1500, 4000])
  })

  it.each([401, 403])('a %i means logged out: anonymous, the token is cleared, no retry', async (status) => {
    tokenStore.set('old')
    post.mockRejectedValue(respond(status))
    expect(await refreshSession()).toEqual({ status: 'anonymous' })
    expect(tokenStore.get()).toBeNull()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('a network error and then a 200 is retried and ends authenticated', async () => {
    post.mockRejectedValueOnce(networkError()).mockResolvedValueOnce(ok('fresh'))
    expect(await refreshSession()).toEqual({ status: 'authenticated', token: 'fresh' })
    expect(post).toHaveBeenCalledTimes(2)
    expect(tokenStore.get()).toBe('fresh')
  })

  it.each([['a 500', respond(500)], ['a 503', respond(503)], ['a 429', respond(429)], ['a timeout', new AxiosError('timeout', 'ECONNABORTED')]])(
    '%s is transient: retried, not a logout', async (_n, err) => {
      post.mockRejectedValueOnce(err).mockResolvedValueOnce(ok())
      expect((await refreshSession()).status).toBe('authenticated')
      expect(post).toHaveBeenCalledTimes(2)
    })

  it('three retries, then offline — and the login is NOT thrown away', async () => {
    tokenStore.set('still-valid')
    post.mockRejectedValue(networkError())
    expect(await refreshSession()).toEqual({ status: 'offline' })
    expect(post).toHaveBeenCalledTimes(4) // the first try + 3 retries
    expect(tokenStore.get()).toBe('still-valid')
  })

  it('a 401 after some network errors is still a logout', async () => {
    post.mockRejectedValueOnce(networkError()).mockRejectedValueOnce(respond(401))
    expect(await refreshSession()).toEqual({ status: 'anonymous' })
  })

  it('concurrent callers share one refresh', async () => {
    post.mockResolvedValue(ok())
    await Promise.all([refreshSession(), refreshSession(), refreshSession()])
    expect(post).toHaveBeenCalledTimes(1)
  })
})

const Where = () => <div data-testid="where">{useLocation().pathname}</div>
function renderApp() {
  render(
    <MemoryRouter initialEntries={['/cards']}>
      <AuthProvider>
        <Where />
        <Routes>
          <Route element={<ProtectedRoute />}><Route path="/cards" element={<div>PRIVATE PAGE</div>} /></Route>
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('ProtectedRoute and the session restore', () => {
  it('refresh 401 → the login page', async () => {
    post.mockRejectedValue(respond(401))
    renderApp()
    expect(await screen.findByText('LOGIN PAGE')).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/login')
  })

  it('a network error and then a 200 → the private page, never the login', async () => {
    post.mockRejectedValueOnce(networkError()).mockResolvedValueOnce(ok())
    renderApp()
    expect(await screen.findByText('PRIVATE PAGE')).toBeTruthy()
    expect(screen.queryByText('LOGIN PAGE')).toBeNull()
  })

  it('the server stays unreachable → the "no connection" screen, NOT /login; Retry asks again', async () => {
    post.mockRejectedValue(networkError())
    renderApp()
    expect(await screen.findByText("Can't reach the server. Check your connection.")).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/cards') // not redirected
    expect(screen.queryByText('LOGIN PAGE')).toBeNull()

    post.mockReset()
    post.mockResolvedValue(ok())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('PRIVATE PAGE')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText("Can't reach the server. Check your connection.")).toBeNull())
  })
})
