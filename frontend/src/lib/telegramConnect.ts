// The "Connect Telegram" flow, as a small state machine:
//   idle → linking (a blank tab is open; POST link) → waiting (the tab shows the bot; the profile
//   is polled) → connected
//                ↘ unavailable (503 telegram_unavailable: the button stays off)
//   waiting → idle after WAIT_MS: polling stops; pressing Connect again makes a fresh link.
// Whether Telegram IS connected comes from the profile; this only tracks the attempt.
// useTelegramConnect is the whole flow for any "Connect" button (profile page, promo dialog).
import { useEffect, useReducer, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { profileApi, telegramApi } from '../api/endpoints'
import { apiErrorInfo } from '../api/client'
import { PURCHASES_KEY } from './purchases'
import { toast } from '../components/Toaster'

export const POLL_MS = 3_000
export const WAIT_MS = 60_000

export type TgConnect =
  | { status: 'idle' }
  | { status: 'linking' }
  | { status: 'waiting'; since: number }
  | { status: 'connected' }
  | { status: 'unavailable' }

export type TgEvent =
  | { type: 'link' } // the button was pressed
  | { type: 'linked'; at: number } // the server made the deep link and the bot is open
  | { type: 'failed'; unavailable: boolean } // the link request failed
  | { type: 'tick'; at: number } // time passes while waiting
  | { type: 'connected' } // the profile says Telegram is connected

export const tgInitial: TgConnect = { status: 'idle' }

export function tgReducer(state: TgConnect, e: TgEvent): TgConnect {
  switch (e.type) {
    case 'link':
      return state.status === 'unavailable' || state.status === 'linking' ? state : { status: 'linking' }
    case 'linked':
      return state.status === 'linking' ? { status: 'waiting', since: e.at } : state
    case 'failed':
      return state.status === 'linking' ? (e.unavailable ? { status: 'unavailable' } : { status: 'idle' }) : state
    case 'tick':
      return state.status === 'waiting' && e.at - state.since >= WAIT_MS ? { status: 'idle' } : state
    case 'connected':
      return { status: 'connected' }
  }
}

/** Poll the profile only while waiting for the bot. */
export const isPolling = (s: TgConnect) => s.status === 'waiting'

/**
 * "Connect" opens the bot right away: the tab is opened inside the click (later, after the request,
 * the browser would block it) and pointed at the deep link once the server has made it. Then the
 * profile is polled every 3 s for up to a minute, until the bot has bound the account; that
 * connection is announced with a toast (with the gift, if the bot gave one).
 */
export function useTelegramConnect() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [state, dispatch] = useReducer(tgReducer, tgInitial)
  const stateRef = useRef(state)
  stateRef.current = state
  const polling = isPolling(state)
  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: profileApi.get,
    refetchInterval: polling ? POLL_MS : false,
    refetchIntervalInBackground: true, // the user is in the Telegram tab meanwhile
  })
  const tg = profile.data?.telegram
  const connected = !!tg?.connected

  const bonus = tg?.bonus ?? 0
  useEffect(() => {
    if (!connected) return
    // Connected while this attempt waited for the bot: say so, and show the gifted photo credits.
    if (stateRef.current.status === 'waiting') {
      toast(bonus > 0 ? t('telegramPromo.connectedBonus', { count: bonus }) : t('telegramPromo.connected'), { ms: 5000 })
      if (bonus > 0) {
        void qc.invalidateQueries({ queryKey: ['me'] }) // the photo credits
        void qc.invalidateQueries({ queryKey: PURCHASES_KEY })
      }
    }
    dispatch({ type: 'connected' })
  }, [connected]) // eslint-disable-line react-hooks/exhaustive-deps -- once, when it turns connected
  // The minute of waiting runs out even when the profile answers the same thing every time.
  const since = state.status === 'waiting' ? state.since : null
  useEffect(() => {
    if (since === null) return
    const id = window.setTimeout(() => dispatch({ type: 'tick', at: Date.now() }), Math.max(0, since + WAIT_MS - Date.now()))
    return () => window.clearTimeout(id)
  }, [since])

  const link = useMutation({ mutationFn: telegramApi.link })
  // No bot: known from the profile up front, or from a 503 on the link request.
  const unavailable = state.status === 'unavailable' || tg?.available === false

  const connect = async () => {
    if (unavailable || state.status === 'linking') return
    const win = window.open('', '_blank') // synchronously, before any await
    if (win) win.opener = null // t.me gets no handle on this page
    dispatch({ type: 'link' })
    try {
      const { url } = await link.mutateAsync()
      if (win && !win.closed) win.location.href = url
      else window.location.href = url // no new tab (mobile, blocked): open the bot here
      dispatch({ type: 'linked', at: Date.now() })
    } catch (err) {
      win?.close()
      dispatch({ type: 'failed', unavailable: apiErrorInfo(err).code === 'telegram_unavailable' })
    }
  }

  return {
    /** The profile has loaded: connected / unavailable are known. */
    ready: !!tg,
    connected,
    username: tg?.username ?? null,
    /** Photo credits connecting would give now (0 = none). */
    bonusOffer: tg?.bonus_offer ?? 0,
    loading: profile.isLoading,
    pending: link.isPending,
    waiting: state.status === 'waiting',
    unavailable,
    /** The link request's error, shown inline; "unavailable" has its own message instead. */
    error: link.error && apiErrorInfo(link.error).code !== 'telegram_unavailable' ? link.error : null,
    connect,
  }
}
