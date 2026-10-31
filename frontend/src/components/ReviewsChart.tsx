import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DayStat } from '../api/types'

// Dependency-free bar chart: reviewed answers per day, one series in the accent colour.
export function ReviewsChart({ data }: { data: DayStat[] }) {
  const { t } = useTranslation()
  const [active, setActive] = useState<string | null>(null)
  const max = Math.max(1, ...data.map((d) => d.reviewed))
  const dense = data.length > 14
  const label = (iso: string) => {
    const [, m, d] = iso.split('-')
    return `${d}.${m}`
  }
  const tip = data.find((d) => d.date === active)

  return (
    <div>
      <div className="relative">
        {/* Grid lines at 0 / 50 / 100 %. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-5 bottom-0 flex flex-col justify-between">
          {[0, 1, 2].map((i) => <div key={i} className="border-t border-divider" />)}
        </div>
        <div className="relative flex h-56 items-end gap-1 sm:gap-2" onMouseLeave={() => setActive(null)}>
          {data.map((d) => {
            const h = (d.reviewed / max) * 100
            return (
              <div key={d.date} data-testid="chart-col" tabIndex={0}
                onMouseEnter={() => setActive(d.date)} onFocus={() => setActive(d.date)} onBlur={() => setActive(null)}
                onClick={() => setActive((a) => (a === d.date ? null : d.date))}
                aria-label={t('chart.tooltip', { date: label(d.date), reviewed: d.reviewed, correct: d.correct, newWords: d.new_words })}
                className="relative flex h-full min-w-0 flex-1 cursor-default flex-col justify-end">
                <span className="mb-1 text-center text-[11px] text-faint">{d.reviewed || ''}</span>
                <div className="w-full rounded-t-[4px] transition-all"
                  style={{ height: `${h}%`, minHeight: d.reviewed ? 4 : 0, background: 'var(--accent)' }} />
              </div>
            )
          })}
        </div>
        {tip && (
          <div role="status" className="glass pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 px-3 py-1.5 text-xs text-fg">
            {t('chart.tooltip', { date: label(tip.date), reviewed: tip.reviewed, correct: tip.correct, newWords: tip.new_words })}
          </div>
        )}
      </div>
      <div className="mt-2 flex gap-1 sm:gap-2">
        {data.map((d, i) => (
          <span key={d.date} className="min-w-0 flex-1 truncate text-center text-[11px] text-faint">
            {dense && i % 3 !== 0 ? '' : label(d.date)}
          </span>
        ))}
      </div>
    </div>
  )
}
