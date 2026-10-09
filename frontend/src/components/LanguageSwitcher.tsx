import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { settingsApi } from '../api/endpoints'
import { isLanguage, LANGUAGES, type Language } from '../i18n'

const FLAGS: Record<Language, string> = { ru: '🇷🇺', en: '🇬🇧', uz: '🇺🇿' }

// Header language switcher. The choice is stored in localStorage (see i18n.ts)
// and, when logged in, in the user's profile so it follows the user across devices.
export function LanguageSwitcher({ sync = true }: { sync?: boolean }) {
  const { t, i18n } = useTranslation()
  const synced = useRef(false)

  // First mount while logged in: adopt the language saved in the profile.
  useEffect(() => {
    if (!sync || synced.current) return
    synced.current = true
    settingsApi
      .get()
      .then((s) => {
        if (isLanguage(s.interface_language)) {
          if (s.interface_language !== i18n.language) void i18n.changeLanguage(s.interface_language)
        } else {
          // Nothing saved in the profile yet — store the current choice there.
          settingsApi.setLanguage(i18n.language).catch(() => undefined)
        }
      })
      .catch(() => undefined) // the localStorage value stays in effect
  }, [i18n, sync])

  function change(lng: Language) {
    if (lng === i18n.language) return
    void i18n.changeLanguage(lng)
    if (sync) settingsApi.setLanguage(lng).catch(() => undefined)
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label={t('lang.label')}>
      {LANGUAGES.map((lng) => (
        <button
          key={lng}
          type="button"
          onClick={() => change(lng)}
          title={t(`lang.${lng}`)}
          aria-pressed={i18n.language === lng}
          className={`grid h-9 w-9 place-items-center rounded-xl text-lg transition ${
            i18n.language === lng
              ? 'bg-lime-400/25 ring-1 ring-lime-300/60'
              : 'opacity-60 hover:bg-emerald-400/10 hover:opacity-100'
          }`}
        >
          {FLAGS[lng]}
        </button>
      ))}
    </div>
  )
}
