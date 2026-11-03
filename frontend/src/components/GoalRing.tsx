import type { ReactNode } from 'react'
import { Check } from 'lucide-react'

/**
 * The daily-goal ring: an accent arc over a track, from the top, with round caps. Inside: "done/target",
 * or a check mark once the goal is met. `label` replaces "done/target" (a percent on a folder page).
 */
export function GoalRing({ done, target, met, size = 76, stroke = 8, label }: {
  done: number; target: number; met: boolean; size?: number; stroke?: number; label?: ReactNode
}) {
  const SIZE = size
  const STROKE = stroke
  const R = (SIZE - STROKE) / 2
  const LENGTH = 2 * Math.PI * R
  const share = met ? 1 : target > 0 ? Math.min(done / target, 1) : 0
  return (
    <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }} data-testid="goal-ring" data-met={met}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" className="-rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--dot-off)" strokeWidth={STROKE} />
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--accent)" strokeWidth={STROKE} strokeLinecap="round"
          strokeDasharray={LENGTH} strokeDashoffset={LENGTH * (1 - share)} data-testid="goal-arc" />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        {met ? (
          <Check size={Math.round(SIZE * 0.38)} strokeWidth={3} aria-hidden="true" className="text-accent-text" />
        ) : (
          <span className="text-base font-bold tabular-nums text-fg">{label ?? `${done}/${target}`}</span>
        )}
      </div>
    </div>
  )
}
