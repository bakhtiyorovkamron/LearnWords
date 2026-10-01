import type { DayStat } from '../api/types'

// Dependency-free bar chart: reviewed answers per day, correct part highlighted.
export function ReviewsChart({ data }: { data: DayStat[] }) {
  const max = Math.max(1, ...data.map((d) => d.reviewed))
  const dense = data.length > 14
  const label = (iso: string) => {
    const [, m, d] = iso.split('-')
    return `${d}.${m}`
  }

  return (
    <div>
      <div className="flex h-56 items-end gap-1 sm:gap-2">
        {data.map((d) => {
          const h = (d.reviewed / max) * 100
          const correctH = d.reviewed ? (d.correct / d.reviewed) * 100 : 0
          return (
            <div key={d.date} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
              title={`${label(d.date)}: ${d.reviewed} повторений, верно ${d.correct}, новых слов ${d.new_words}`}>
              <span className="mb-1 text-center text-[10px] text-emerald-100/70">{d.reviewed || ''}</span>
              <div className="relative w-full overflow-hidden rounded-t-lg bg-red-400/40 transition-all"
                style={{ height: `${h}%`, minHeight: d.reviewed ? 4 : 0 }}>
                <div className="absolute bottom-0 w-full bg-gradient-to-t from-emerald-500 to-lime-300"
                  style={{ height: `${correctH}%` }} />
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex gap-1 sm:gap-2">
        {data.map((d, i) => (
          <span key={d.date} className="min-w-0 flex-1 truncate text-center text-[10px] text-emerald-300/60">
            {dense && i % 3 !== 0 ? '' : label(d.date)}
          </span>
        ))}
      </div>
      <div className="mt-4 flex justify-center gap-5 text-xs text-emerald-100/70">
        <span className="flex items-center gap-2"><i className="h-3 w-3 rounded bg-lime-300" /> верно</span>
        <span className="flex items-center gap-2"><i className="h-3 w-3 rounded bg-red-400/60" /> неверно</span>
      </div>
    </div>
  )
}
