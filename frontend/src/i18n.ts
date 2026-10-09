import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ru from './locales/ru/common.json'
import en from './locales/en/common.json'
import uz from './locales/uz/common.json'

// UI translations only. Learning content (words, examples, stories) is never translated here.
export const LANGUAGES = ['ru', 'en', 'uz'] as const
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
  const nav = navigator.language?.toLowerCase() ?? ''
  if (nav.startsWith('uz')) return 'uz'
  return nav.startsWith('ru') ? 'ru' : 'en'
}

void i18n.use(initReactI18next).init({
  resources: { ru: { common: ru }, en: { common: en }, uz: { common: uz } },
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
  switch (i18n.language) {
    case 'en': return 'en-GB'
    case 'uz': return 'uz-Latn-UZ'
    default: return 'ru-RU'
  }
}

export default i18n
