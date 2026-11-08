import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '../api/client'
import { useTelegramConnect } from '../lib/telegramConnect'
import { Sheet } from './Sheet'

/**
 * "Connect Telegram", shown on every app load while Telegram is not connected and the bot is
 * available. "Later" (or the X, Esc, the scrim) closes it for this page view only: it is component
 * state, nothing is stored, so the next open or reload shows it again. "Connect" opens the bot and
 * waits right here; when the profile says connected the dialog is gone and the hook's toast shows
 * the gift. Never on the profile page: its Telegram row is the connect and waiting screen already.
 * Stays mounted while closed, so a connection started here is still waited for.
 */
export function TelegramPromoDialog() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const tg = useTelegramConnect()
  const [later, setLater] = useState(false)

  const open = tg.ready && !tg.connected && !tg.unavailable && !later && pathname !== '/profile'
  if (!open) return null

  return (
    <Sheet label={t('telegramPromo.title')} onClose={() => setLater(true)}>
      <div className="space-y-4">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-accent-text">
          <Send size={22} aria-hidden="true" />
        </div>
        <h2 className="text-xl font-bold text-fg">{t('telegramPromo.title')}</h2>
        <p className="text-[15px] text-muted">
          {tg.bonusOffer > 0 ? t('telegramPromo.textBonus', { count: tg.bonusOffer }) : t('telegramPromo.text')}
        </p>
        {tg.waiting && <p role="status" data-testid="telegram-promo-waiting" className="text-sm text-muted">{t('profile.telegramWaiting')}</p>}
        {tg.error && <p role="alert" className="text-sm text-danger">{errorMessage(tg.error)}</p>}
        <div className="flex flex-col gap-2">
          <button type="button" className="btn-primary w-full" disabled={tg.pending} onClick={() => void tg.connect()}>
            {t('profile.telegramConnect')}
          </button>
          <button type="button" className="btn-ghost w-full" onClick={() => setLater(true)}>{t('telegramPromo.later')}</button>
        </div>
      </div>
    </Sheet>
  )
}
