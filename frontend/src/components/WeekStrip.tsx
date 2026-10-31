import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DayStat } from '../api/types'

export type DayState = 'met' | 'half' | 'empty' | 'future'

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d, 12) // noon: immune to DST shifts
}

/**
 * Monday..Sunday of the week that contains `today` (YYYY-MM-DD, the server's day), each with its
 * state: goal met, active but not met (half), no activity (empty) or still to come (future).
 */
export function weekDays(today: string, daily: DayStat[], todayMet: boolean): { date: string; state: DayState; isToday: boolean }[] {
  const t = parse(today)
  const monday = new Date(t)
  monday.setDate(t.getDate() - ((t.getDay() + 6) % 7))
  const byDate = new Map(daily.map((d) => [d.date, d]))
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const date = iso(d)
    const isToday = date === today
    if (date > today) return { date, state: 'future' as const, isToday }
    const stat = byDate.get(date)
    const met = !!stat?.goal_met || (isToday && todayMet)
    const active = !!stat?.active || (stat?.reviewed ?? 0) > 0
    return { date, state: met ? 'met' as const : active ? 'half' as const : 'empty' as const, isToday }
  })
}

const circle: Record<DayState, string> = {
  met: 'bg-accent border-2 border-accent',
  half: 'border-2 border-accent',
  empty: 'border-2 border-dot-off',
  future: 'border-2 border-dashed border-dot-off',
}

/** The week strip: seven day circles with their short weekday names. */
export function WeekStrip({ days }: { days: { date: string; state: DayState; isToday: boolean }[] }) {
  const { i18n } = useTranslation()
  const fmt = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' })
  const label = (date: string) => {
    const s = fmt.format(parse(date))
    return s.charAt(0).toLocaleUpperCase(i18n.language) + s.slice(1)
  }
  return (
    <ul className="grid grid-cols-7 gap-1" data-testid="week-strip">
      {days.map((d) => (
        <li key={d.date} className="flex flex-col items-center gap-1.5" data-state={d.state} data-today={d.isToday}>
          <span className={`grid h-8 w-8 place-items-center rounded-full ${circle[d.state]}`}
            style={d.state === 'half' ? { background: 'linear-gradient(to top, var(--accent) 50%, transparent 50%)' } : undefined}>
            {d.state === 'met' && <Check size={16} strokeWidth={3} aria-hidden="true" className="text-on-accent" />}
          </span>
          <span className={`text-xs ${d.isToday ? 'font-bold text-accent-text' : 'text-muted'}`}>{label(d.date)}</span>
        </li>
      ))}
    </ul>
  )
}
