// Texts for the Leitner box tooltip. Dates are UTC days, like the server's review schedule.

const DAY_MS = 86_400_000
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())

/** Whole days from today to the API date ("2026-10-16" or an RFC 3339 timestamp); ≤ 0 = due. */
export function daysUntil(nextReviewAt: string, now: Date = new Date()): number {
  const [y, m, d] = nextReviewAt.slice(0, 10).split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - utcDay(now)) / DAY_MS)
}

/** «today» / «tomorrow» / «in N days» — a date for anything further than the longest interval. */
export function whenLabel(
  nextReviewAt: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
  locale: string,
  now: Date = new Date(),
): string {
  const n = daysUntil(nextReviewAt, now)
  if (n <= 0) return t('box.when.today')
  if (n === 1) return t('box.when.tomorrow')
  if (n <= 14) return t('box.when.inDays', { n })
  const [y, m, d] = nextReviewAt.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, { timeZone: 'UTC', day: 'numeric', month: 'long' })
}

export type BoxExplanation = 'learned' | 'lastBox' | 'rule'

/** Which "what happens next" sentence applies: a learned word, box 5 not yet learned, or a lower box. */
export function boxExplanation(box: number, isLearned: boolean): BoxExplanation {
  if (isLearned) return 'learned'
  return box >= 5 ? 'lastBox' : 'rule'
}
