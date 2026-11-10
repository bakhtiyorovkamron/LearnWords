import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatUnreadApi, supportApi, buyerChatApi } from '../api/endpoints'
import { CHAT_UNREAD_POLL_MS, useAdminChatUnread, useChatUnread, useMarkRead } from './chatUnread'

let authed = true
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: authed }) }))
vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    chatUnreadApi: { mine: vi.fn(), admin: vi.fn() },
    supportApi: { read: vi.fn() },
    buyerChatApi: { read: vi.fn() },
  }
})

let visibility: DocumentVisibilityState = 'visible'
function setVisibility(v: DocumentVisibilityState) {
  visibility = v
  document.dispatchEvent(new Event('visibilitychange'))
}
const unread = { support: 1, purchases: [], total: 1 }

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { qc, wrap: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> }
}

beforeEach(() => {
  authed = true
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.mocked(chatUnreadApi.mine).mockResolvedValue(unread)
  vi.mocked(chatUnreadApi.admin).mockResolvedValue({ support: 2, purchases: 1, total: 3 })
  vi.mocked(supportApi.read).mockResolvedValue(undefined)
  vi.mocked(buyerChatApi.read).mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers() })

describe('useChatUnread', () => {
  it('reads once, then every 30 s while the page is visible', async () => {
    const { wrap } = wrapper()
    const { result } = renderHook(() => useChatUnread(), { wrapper: wrap })
    await waitFor(() => expect(result.current.data).toEqual(unread))
    expect(chatUnreadApi.mine).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(CHAT_UNREAD_POLL_MS))
    expect(chatUnreadApi.mine).toHaveBeenCalledTimes(2)
    await act(() => vi.advanceTimersByTimeAsync(CHAT_UNREAD_POLL_MS))
    expect(chatUnreadApi.mine).toHaveBeenCalledTimes(3)
  })

  it('does not poll while the page is hidden; coming back reads at once', async () => {
    const { wrap } = wrapper()
    const { result } = renderHook(() => useChatUnread(), { wrapper: wrap })
    await waitFor(() => expect(result.current.data).toBeTruthy())
    act(() => setVisibility('hidden'))
    await act(() => vi.advanceTimersByTimeAsync(CHAT_UNREAD_POLL_MS * 3))
    expect(chatUnreadApi.mine).toHaveBeenCalledTimes(1)
    act(() => setVisibility('visible'))
    await waitFor(() => expect(chatUnreadApi.mine).toHaveBeenCalledTimes(2))
  })

  it('reads when the window gets the focus back', async () => {
    const { wrap } = wrapper()
    const { result } = renderHook(() => useChatUnread(), { wrapper: wrap })
    await waitFor(() => expect(result.current.data).toBeTruthy())
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(chatUnreadApi.mine).toHaveBeenCalledTimes(2))
  })

  it('does nothing when logged out', async () => {
    authed = false
    const { wrap } = wrapper()
    renderHook(() => useChatUnread(), { wrapper: wrap })
    await act(() => vi.advanceTimersByTimeAsync(CHAT_UNREAD_POLL_MS * 2))
    expect(chatUnreadApi.mine).not.toHaveBeenCalled()
  })
})

describe('useAdminChatUnread', () => {
  it('asks only for admins', async () => {
    const { wrap } = wrapper()
    const user = renderHook(() => useAdminChatUnread(false), { wrapper: wrap })
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(chatUnreadApi.admin).not.toHaveBeenCalled()
    user.unmount()
    const admin = renderHook(() => useAdminChatUnread(true), { wrapper: wrap })
    await waitFor(() => expect(admin.result.current.data?.total).toBe(3))
  })
})

describe('useMarkRead', () => {
  it('calls the read endpoint, then re-reads the badges', async () => {
    const { wrap } = wrapper()
    const badges = renderHook(() => useChatUnread(), { wrapper: wrap })
    await waitFor(() => expect(badges.result.current.data).toBeTruthy())
    const { result } = renderHook(() => useMarkRead(), { wrapper: wrap })
    await act(() => result.current.support(5))
    expect(supportApi.read).toHaveBeenCalledWith(5)
    await waitFor(() => expect(chatUnreadApi.mine).toHaveBeenCalledTimes(2))
    await act(() => result.current.purchase('r1', 9))
    expect(buyerChatApi.read).toHaveBeenCalledWith('r1', 9)
    await waitFor(() => expect(chatUnreadApi.mine).toHaveBeenCalledTimes(3))
  })
})
