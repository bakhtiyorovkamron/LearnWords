import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ru from './locales/ru/common.json'
import en from './locales/en/common.json'

// UI translations only. German learning content (words, examples, stories) is never translated here.
export const LANGUAGES = ['ru', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

const STORAGE_KEY = 'ui-language'

export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v)
}

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isLanguage(saved)) return saved
  } catch {
    /* localStorage unavailable */
  }
  return navigator.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

void i18n.use(initReactI18next).init({
  resources: { ru: { common: ru }, en: { common: en } },
  lng: initialLanguage(),
  fallbackLng: 'ru',
  supportedLngs: [...LANGUAGES],
  defaultNS: 'common',
  ns: ['common'],
  interpolation: { escapeValue: false }, // React already escapes
})

document.documentElement.lang = i18n.language

// Persist the choice so it survives page reloads.
i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng
  try {
    localStorage.setItem(STORAGE_KEY, lng)
  } catch {
    /* ignore */
  }
})

// Locale for dates/numbers (toLocaleDateString etc.).
export function dateLocale(): string {
  return i18n.language === 'en' ? 'en-GB' : 'ru-RU'
}

export default i18n
