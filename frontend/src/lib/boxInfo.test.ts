import { describe, expect, it } from 'vitest'
import { boxExplanation, daysUntil, whenLabel } from './boxInfo'

const now = new Date('2026-10-15T10:00:00Z')
const t = (key: string, o?: Record<string, unknown>) => (o?.n ? `${key}:${o.n}` : key)

describe('box tooltip helpers', () => {
  it('counts UTC days to the next review', () => {
    expect(daysUntil('2026-10-15', now)).toBe(0)
    expect(daysUntil('2026-10-16T00:00:00Z', now)).toBe(1)
    expect(daysUntil('2026-10-29', now)).toBe(14)
    expect(daysUntil('2026-10-10', now)).toBe(-5)
  })

  it('says today / tomorrow / in N days / a date', () => {
    expect(whenLabel('2026-10-15', t, 'en', now)).toBe('box.when.today')
    expect(whenLabel('2026-10-12', t, 'en', now)).toBe('box.when.today') // overdue = due today
    expect(whenLabel('2026-10-16', t, 'en', now)).toBe('box.when.tomorrow')
    expect(whenLabel('2026-10-19', t, 'en', now)).toBe('box.when.inDays:4')
    expect(whenLabel('2026-12-01', t, 'en', now)).toBe('December 1')
  })

  it('picks the sentence for the box', () => {
    expect(boxExplanation(1, false)).toBe('rule')
    expect(boxExplanation(4, false)).toBe('rule')
    expect(boxExplanation(5, false)).toBe('lastBox')
    expect(boxExplanation(5, true)).toBe('learned')
  })
})
