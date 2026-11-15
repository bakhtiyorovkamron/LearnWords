import { useQuery } from '@tanstack/react-query'
import { Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { profileApi, type Profile } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { useTelegramConnect } from '../lib/telegramConnect'

/** From this many words before the limit on, the add page says how many are left. */
export const NEAR_WITHIN = 10

export interface WordLimit {
  /** null: no limit for this user (Telegram linked, an admin, the rule is off, or an older server). */
  limit: number | null
  count: number
  /** Words that can still be added (0 at or over the limit). */
  left: number
  near: boolean
  reached: boolean
}

/** The word limit without Telegram, from the profile (GET /me/profile → words). */
export function wordLimitOf(p: Profile | undefined): WordLimit {
  const count = p?.words?.count ?? 0
  // Connected wins even if the limit was still in an older answer: linked users have none.
  const limit = p && !p.telegram.connected ? p.words?.limit ?? null : null
  if (limit === null) return { limit: null, count, left: 0, near: false, reached: false }
  return { limit, count, left: Math.max(0, limit - count), near: count >= limit - NEAR_WITHIN, reached: count >= limit }
}

/** The same ['profile'] query the Telegram connect flow polls: it updates when Telegram is linked. */
export function useWordLimit(): WordLimit {
  const profile = useQuery({ queryKey: ['profile'], queryFn: profileApi.get })
  return wordLimitOf(profile.data)
}

/**
 * "Link Telegram to add more": the text and a primary button that opens the bot directly (the same
 * flow as the promo dialog and the profile page), then waits for it. Gone once Telegram is connected.
 * announce: it replaces an error the user just caused (role="alert").
 */
export function TelegramRequiredPrompt({ text, announce = false }: { text: string; announce?: boolean }) {
  const { t } = useTranslation()
  const tg = useTelegramConnect()
  if (tg.connected) return null
  return (
    <div data-testid="telegram-required" className="space-y-3 rounded-2xl border border-line bg-surface-2 p-4">
      <p role={announce ? 'alert' : undefined} className="flex items-start gap-2 text-[15px] text-fg">
        <Send size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-accent-text" />
        <span>{text}</span>
      </p>
      {tg.waiting && <p role="status" className="text-sm text-muted">{t('profile.telegramWaiting')}</p>}
      {tg.unavailable && <p role="status" className="text-sm text-muted">{t('profile.telegramUnavailable')}</p>}
      {tg.error && <p className="text-sm text-danger">{errorMessage(tg.error)}</p>}
      <button type="button" className="btn-primary w-full sm:w-auto" disabled={tg.pending || tg.unavailable}
        onClick={() => void tg.connect()}>
        <Send size={18} aria-hidden="true" />{t('words.connect')}
      </button>
    </div>
  )
}

/** The quiet line a few words before the limit, with a link that starts the same connect flow. */
function LimitNear({ limit, left }: { limit: number; left: number }) {
  const { t } = useTranslation()
  const tg = useTelegramConnect()
  return (
    <p data-testid="word-limit-near" className="text-sm text-muted">
      {t('words.limitNear', { limit, left })}{' '}
      <button type="button" className="font-semibold text-accent-text hover:underline disabled:opacity-60"
        disabled={tg.pending || tg.unavailable} onClick={() => void tg.connect()}>
        {t('words.connect')}
      </button>
      {tg.waiting && <span role="status"> {t('profile.telegramWaiting')}</span>}
    </p>
  )
}

/**
 * Above the add-word form: nothing without a limit; a quiet line with the words left from
 * NEAR_WITHIN before it; at the limit a card with the connect button (the page disables its form).
 * It goes away by itself when the profile says Telegram is connected.
 */
export function WordLimitNotice() {
  const { t } = useTranslation()
  const words = useWordLimit()
  if (words.limit === null) return null
  if (words.reached) return <TelegramRequiredPrompt text={t('words.limitReached', { limit: words.limit })} />
  if (words.near) return <LimitNear limit={words.limit} left={words.left} />
  return null
}
