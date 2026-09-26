import { ClockFace } from './ClockFace'
import type { ClockTime } from '../lib/germanTime'

const pad = (n: number) => String(n).padStart(2, '0')

/** Generated "photo" for a time phrase: big digital time + analog clock. */
export function TimeImage({ time, compact = false }: { time: ClockTime; compact?: boolean }) {
  const main = `${pad(time.h)}:${pad(time.m)}`
  const alt = time.exact ? null : `${pad(time.h === 12 ? 0 : time.h + 12)}:${pad(time.m)}`

  if (compact) {
    return (
      <div className="flex h-full w-full items-center justify-center gap-4 bg-gradient-to-br from-emerald-900 via-emerald-950 to-teal-950">
        <span className="display text-5xl font-extrabold tracking-wider text-lime-300 drop-shadow-[0_0_20px_rgba(163,230,53,0.4)]">
          {main}
        </span>
      </div>
    )
  }

  return (
    <div className="relative flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 overflow-hidden bg-gradient-to-br from-emerald-900 via-emerald-950 to-teal-950">
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-lime-400/20 blur-3xl" />
      <span className="display relative text-7xl font-extrabold tracking-wider text-lime-300 drop-shadow-[0_0_30px_rgba(163,230,53,0.45)]">
        {main}
      </span>
      {alt && <span className="relative text-sm text-emerald-200/60">или {alt}</span>}
      <div className="relative mt-2 opacity-90">
        <ClockFace time={time} size={110} hideLabel />
      </div>
    </div>
  )
}
