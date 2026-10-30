import { Download, Smartphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LogoMark } from './Logo'
import { dismissBanner, installApp, usePwa } from '../lib/pwa'

// "Install app" entry for a menu: a button on Android/desktop Chrome, the Share → Add to Home
// Screen hint on iPhone Safari, nothing when already running as an installed app.
export function InstallMenuItem({ className = 'btn-ghost' }: { className?: string }) {
  const { t } = useTranslation()
  const pwa = usePwa()
  if (pwa.canInstall) {
    return (
      <button type="button" onClick={() => void installApp()} className={className}>
        <Download size={18} aria-hidden="true" />{t('pwa.install')}
      </button>
    )
  }
  if (pwa.iosHint) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-muted">
        <Smartphone size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{t('pwa.iosHint')}
      </p>
    )
  }
  return null
}

// Shown once after the 2nd finished training; "Not now" hides it for 14 days (lib/pwa.ts).
export function InstallBanner() {
  const { t } = useTranslation()
  const pwa = usePwa()
  if (!pwa.showBanner) return null
  return (
    <div
      role="dialog"
      aria-label={t('pwa.install')}
      className="glass animate-rise fixed inset-x-4 bottom-[calc(var(--nav-h)+0.75rem)] z-40 mx-auto max-w-md p-4 md:left-auto md:right-6 md:mx-0"
    >
      <div className="flex items-start gap-3">
        <LogoMark className="h-10 w-10" />
        <div className="text-sm">
          <p className="font-semibold text-fg">{t('pwa.banner')}</p>
          {!pwa.canInstall && <p className="mt-1 text-muted">{t('pwa.iosHint')}</p>}
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={dismissBanner} className="btn-ghost">{t('pwa.later')}</button>
        {pwa.canInstall && (
          <button type="button" onClick={() => void installApp()} className="btn-primary px-4 py-2 text-sm">
            {t('pwa.install')}
          </button>
        )}
      </div>
    </div>
  )
}
