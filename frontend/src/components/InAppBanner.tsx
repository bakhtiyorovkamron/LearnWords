import { useState } from 'react'
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
    <div role="alert" className="relative z-30 border-b border-amber-400/30 bg-amber-500/15 px-4 py-3 pr-12 text-sm text-amber-100">
      <p className="font-semibold">{t('auth.inAppTitle')}</p>
      <p className="mt-0.5 text-amber-100/80">{t('auth.inAppText')}</p>
      {app.platform === 'android' && (
        <a href={androidIntentUrl(pathname)} className="btn-primary mt-2 !py-1.5 text-sm">{t('auth.openInBrowser')}</a>
      )}
      {app.platform === 'ios' && <p className="mt-1 text-amber-100/80">{t('auth.inAppIos')}</p>}
      <button type="button" aria-label="✕" onClick={() => { dismissBanner(); setHidden(true) }}
        className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full text-lg hover:bg-white/10">✕</button>
    </div>
  )
}
