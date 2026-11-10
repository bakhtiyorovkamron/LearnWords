import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { chatUnreadApi, adminSupportApi, buyerChatApi, supportApi, type ChatUnread } from '../api/endpoints'
import { toast } from '../components/Toaster'
import { useAuth } from '../auth/AuthContext'
import { usePageVisible } from './pageVisible'

export const CHAT_UNREAD_KEY = ['chat-unread'] as const
export const ADMIN_CHAT_UNREAD_KEY = ['chat-unread', 'admin'] as const

/** The badges are re-read every 30 s while the page is visible, and when the window gets the focus. */
export const CHAT_UNREAD_POLL_MS = 30_000

const pageVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'

function useUnreadQuery<T>(key: readonly unknown[], fn: () => Promise<T>, enabled: boolean) {
  const visible = usePageVisible()
  const q = useQuery({
    queryKey: key,
    queryFn: fn,
    enabled,
    staleTime: 0,
    refetchInterval: visible ? CHAT_UNREAD_POLL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false, // the focus and visibility handlers below read it instead
    retry: false,
  })
  // Coming back to the page: read at once rather than at the next tick.
  const was = useRef(visible)
  const refetch = q.refetch
  useEffect(() => {
    if (!enabled) return
    const onFocus = () => { if (pageVisible()) void refetch() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [enabled, refetch])
  useEffect(() => {
    if (visible && !was.current && enabled) void refetch()
    was.current = visible
  }, [visible, enabled, refetch])
  return q
}

/** The user's unread chat messages ({support, purchases: [{id, code, unread}], total}); off when logged out. */
export function useChatUnread() {
  const { isAuthenticated } = useAuth()
  return useUnreadQuery(CHAT_UNREAD_KEY, chatUnreadApi.mine, isAuthenticated)
}

/** The admins' unread count ({support, purchases, total}); for admins only (the server checks the role too). */
export function useAdminChatUnread(isAdmin: boolean) {
  const { isAuthenticated } = useAuth()
  return useUnreadQuery(ADMIN_CHAT_UNREAD_KEY, chatUnreadApi.admin, isAuthenticated && isAdmin)
}

/** Marks a chat read on the server, then re-reads the badges. */
export function useMarkRead() {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: CHAT_UNREAD_KEY })
  return {
    support: (upTo: number) => supportApi.read(upTo).then(done),
    purchase: (id: string, upTo: number) => buyerChatApi.read(id, upTo).then(done),
    /** An admin's support thread read: the admin totals follow. */
    adminSupport: (id: number, upTo: number) => adminSupportApi.read(id, upTo).then(done),
  }
}

/** How long the new-message toast stays (it has a button, so longer than a plain one). */
export const CHAT_TOAST_MS = 6000

/**
 * One toast when the unread count grows while the user is not on that chat's screen: support →
 * "Support wrote to you", an order chat → "New message about order {code}"; its button opens the
 * chat. Never on the first load (only a number that grows from a known one counts).
 */
export function useChatUnreadToasts(data: ChatUnread | undefined) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const prev = useRef<ChatUnread>()
  useEffect(() => {
    if (!data) return
    const before = prev.current
    prev.current = data
    if (!before) return
    const open = t('chat.open')
    if (data.support > before.support && pathname !== '/support') {
      toast(t('chat.toastSupport'), { ms: CHAT_TOAST_MS, action: { label: open, onClick: () => navigate('/support') } })
      return
    }
    const grown = data.purchases.find((p) => p.unread > (before.purchases.find((b) => b.id === p.id)?.unread ?? 0)
      && pathname !== `/purchases/${p.id}`)
    if (grown) {
      toast(t('chat.toastPurchase', { code: grown.code }), { ms: CHAT_TOAST_MS, action: { label: open, onClick: () => navigate(`/purchases/${grown.id}`) } })
    }
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps -- reacts to new data only; the route is read as it is then
}
