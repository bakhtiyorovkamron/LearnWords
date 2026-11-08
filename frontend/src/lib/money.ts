import i18n from '../i18n'

const NUMBER_LOCALE: Record<string, string> = { ru: 'ru-RU', en: 'en-US', uz: 'uz-Latn-UZ' }

/**
 * A price in sum: 25000 → "25 000 сум" (ru), "25,000 UZS" (en), "25 000 so‘m" (uz). The spaces are
 * no-break ones, so a price never wraps in the middle.
 */
export function formatUZS(n: number, lang: string = i18n.language): string {
  const num = new Intl.NumberFormat(NUMBER_LOCALE[lang] ?? 'ru-RU', { maximumFractionDigits: 0 }).format(n)
  return `${num} ${i18n.t('buy.currency', { lng: lang })}`
}
