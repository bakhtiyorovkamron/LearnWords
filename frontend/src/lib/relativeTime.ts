import { dateLocale } from '../i18n'

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86_400], ['hour', 3_600], ['minute', 60]]

/** "5 minutes ago" / "5 минут назад" / "5 daqiqa oldin" for a past (or future) ISO time. */
export function relativeTime(iso: string, now = Date.now(), locale = dateLocale()): string {
  const secs = Math.round((new Date(iso).getTime() - now) / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit)
  }
  return rtf.format(0, 'minute') // "this minute"
}
