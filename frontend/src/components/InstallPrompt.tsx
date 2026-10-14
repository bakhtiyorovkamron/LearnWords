import { useTranslation } from 'react-i18next'
import { dismissBanner, installApp, usePwa } from '../lib/pwa'

// "Install app" entry for a menu: a button on Android/desktop Chrome, the Share → Add to Home
// Screen hint on iPhone Safari, nothing when already running as an installed app.
export function InstallMenuItem({ className = 'btn-ghost' }: { className?: string }) {
  const { t } = useTranslation()
  const pwa = usePwa()
  if (pwa.canInstall) {
    return (
      <button type="button" onClick={() => void installApp()} className={className}>
        📲 {t('pwa.install')}
      </button>
    )
  }
  if (pwa.iosHint) {
    return (
      <p className="rounded-2xl border border-emerald-400/20 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-100/80">
        📲 {t('pwa.iosHint')}
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
      className="animate-rise fixed inset-x-4 bottom-[calc(var(--nav-h)+0.75rem)] z-40 mx-auto max-w-md rounded-3xl border border-lime-400/30 bg-emerald-950/95 p-4 shadow-2xl shadow-emerald-950/60 backdrop-blur-xl md:left-auto md:right-6 md:mx-0"
    >
      <div className="flex items-start gap-3">
        <span className="display grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-lime-300 to-emerald-500 font-extrabold text-emerald-950">
          W
        </span>
        <div className="text-sm">
          <p className="font-semibold text-white">{t('pwa.banner')}</p>
          {!pwa.canInstall && <p className="mt-1 text-emerald-100/70">{t('pwa.iosHint')}</p>}
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
