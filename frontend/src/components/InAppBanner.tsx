import { useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { androidIntentUrl, detectInAppBrowser, dismissBanner, isBannerDismissed } from '../lib/inAppBrowser'

/** Top banner inside Instagram / Facebook / TikTok / Telegram-Android browsers: the login would not be kept. */
export function InAppBanner() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const [hidden, setHidden] = useState(isBannerDismissed)
  const app = detectInAppBrowser()
  if (!app || hidden) return null

  return (
    <div role="alert" className="relative z-30 border-b border-line bg-surface-2 px-4 py-3 pr-12 text-sm text-fg">
      <p className="font-semibold text-streak">{t('auth.inAppTitle')}</p>
      <p className="mt-0.5 text-muted">{t('auth.inAppText')}</p>
      {app.platform === 'android' && (
        <a href={androidIntentUrl(pathname)} className="btn-primary mt-2 !py-1.5 text-sm">{t('auth.openInBrowser')}</a>
      )}
      {app.platform === 'ios' && <p className="mt-1 text-muted">{t('auth.inAppIos')}</p>}
      <button type="button" aria-label="✕" onClick={() => { dismissBanner(); setHidden(true) }}
        className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-surface hover:text-fg">
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  )
}
