// Sign in (and up) with Telegram, the browser's side:
//   on mount a login is created: the button becomes a real link to t.me/<bot>?start=<code> (iOS opens
//   Telegram only from a link tap — a window.open after a request would be blocked); a new one is
//   made shortly before it expires.
//   tap → waiting: the login is polled every 2 s, and at once when the page is visible again (the
//   user comes back from Telegram).
//   ok → signed in (the session is stored by authApi.telegramPoll) · denied → back to the form with
//   a toast · expired → a new login, back to the form with a note.
// The secret only ever lives in this hook's state.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { authApi, type TelegramLoginStart } from '../api/endpoints'
import { apiErrorInfo } from '../api/client'
import { toast } from '../components/Toaster'

export const TG_POLL_MS = 2_000
/** How long a login works (the server's TTL); used when its expires_at cannot be trusted. */
export const TG_LINK_MS = 5 * 60_000
/** A new login is made this long before the old one expires, so a tap never opens a stale link. */
export const TG_REFRESH_EARLY_MS = 15_000

export type TgLoginStatus = 'loading' | 'ready' | 'error' | 'unavailable'

/** "@yodlafun_bot" from https://t.me/yodlafun_bot?start=… */
export function botOf(url: string): string {
  try {
    return '@' + new URL(url).pathname.replace(/^\/+/, '')
  } catch {
    return 'Telegram'
  }
}

/** Milliseconds until a fresh login should replace this one. */
export function refreshIn(expiresAt: string, now = Date.now()): number {
  let left = Date.parse(expiresAt) - now
  if (!Number.isFinite(left) || left <= 0 || left > TG_LINK_MS) left = TG_LINK_MS // a clock that is off
  return Math.max(1_000, left - TG_REFRESH_EARLY_MS)
}

export function useTelegramLogin(onSignedIn: (newUser: boolean) => void) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<TgLoginStatus>('loading')
  const [login, setLogin] = useState<TelegramLoginStart | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [expired, setExpired] = useState(false)
  const generation = useRef(0) // a newer start() wins over an older one still on its way
  const signedIn = useRef(onSignedIn)
  signedIn.current = onSignedIn

  const start = useCallback(async () => {
    const gen = ++generation.current
    setStatus('loading')
    try {
      const l = await authApi.telegramStart()
      if (gen !== generation.current) return
      setLogin(l)
      setStatus('ready')
    } catch (err) {
      if (gen !== generation.current) return
      setLogin(null)
      setStatus(apiErrorInfo(err).status === 503 ? 'unavailable' : 'error')
    }
  }, [])

  useEffect(() => {
    void start()
    return () => { generation.current++ }
  }, [start])

  // On the form: replace the login before it expires (while waiting, the poll says "expired").
  const expiresAt = !waiting && status === 'ready' ? login?.expires_at : undefined
  useEffect(() => {
    if (!expiresAt) return
    const id = window.setTimeout(() => void start(), refreshIn(expiresAt))
    return () => window.clearTimeout(id)
  }, [expiresAt, start])

  const secret = waiting ? login?.secret : undefined
  useEffect(() => {
    if (!secret) return
    let stopped = false
    let busy = false
    const poll = async () => {
      if (stopped || busy) return
      busy = true
      try {
        const r = await authApi.telegramPoll(secret)
        if (stopped) return
        if (r.status === 'ok') {
          stopped = true
          signedIn.current(r.new_user)
        } else if (r.status === 'denied') {
          setWaiting(false)
          toast(t('auth.telegramDenied'), { icon: X })
          void start() // that code is used up
        } else if (r.status === 'expired') {
          setWaiting(false)
          setExpired(true)
          void start()
        }
      } catch {
        // offline or a 429: the next tick asks again
      } finally {
        busy = false
      }
    }
    const id = window.setInterval(() => void poll(), TG_POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void poll() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [secret, start, t])

  return {
    status,
    /** The deep link to open (status 'ready'). */
    url: login?.url ?? null,
    bot: login ? botOf(login.url) : '',
    waiting,
    /** The last login expired while waiting: say so next to the button. */
    expired,
    /**
     * The link was tapped: wait for the bot (the tap itself opens Telegram). The waiting card replaces
     * the link a tick later, so the link is still in the page while the browser follows it.
     */
    opened: () => { setExpired(false); window.setTimeout(() => setWaiting(true), 0) },
    /** Back to the form (the login stays usable until it expires). */
    back: () => setWaiting(false),
    retry: () => void start(),
  }
}
