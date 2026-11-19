import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { CloseButton } from '../Sheet'

/**
 * The top of a game: the X on the left, the title and a sub line in the middle, a pill (the clock)
 * on the right, the progress bar under them. The left and right columns are the same width, so the
 * title stays centred. `children` sit under the pill (the "+2 s" of a miss).
 */
export function GameHeader({ title, sub, pill, progress, onClose, children }: {
  title: string
  sub?: string
  pill?: { icon: LucideIcon; text: string }
  progress?: number // 0..1; no bar without it
  onClose: () => void
  children?: ReactNode
}) {
  const Icon = pill?.icon
  return (
    <div className="shrink-0">
      <div className="flex h-11 items-center">
        <div className="w-[76px]"><CloseButton onClose={onClose} className="-ml-2.5" /></div>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-[17px] font-bold leading-tight text-fg">{title}</p>
          {sub && <p data-testid="game-sub" className="text-[13px] tabular-nums text-muted">{sub}</p>}
        </div>
        <div className="relative flex w-[76px] justify-end">
          {pill && Icon && (
            <span data-testid="game-pill"
              className="flex h-[34px] items-center gap-1 rounded-full bg-surface-2 px-3 text-[14.5px] font-bold tabular-nums text-fg">
              <Icon size={15} aria-hidden="true" className="text-muted" />{pill.text}
            </span>
          )}
          {children}
        </div>
      </div>
      {progress !== undefined && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-track" role="progressbar" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}>
          <div data-testid="game-progress" className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${Math.min(Math.max(progress, 0), 1) * 100}%` }} />
        </div>
      )}
    </div>
  )
}
