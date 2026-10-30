import { Link } from 'react-router-dom'
import { CircleCheck, Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface Props {
  correct: number
  total: number
  onRestart: () => void
  // Lets callers repurpose the restart button — e.g. "Пройти ещё раз" (practice.again) leads
  // into the practice setup screen rather than literally restarting the same session.
  restartLabel?: string
  // moreCount > 0 → there are still due words left: show "Ещё N" (same filters + direction).
  moreCount?: number
  onMore?: () => void
  moreLoading?: boolean
  // What happened to the Leitner boxes: review → how many words moved up; practice → they don't change.
  boxes?: 'practice' | { movedUp: number }
}

export function ReviewResult({ correct, total, onRestart, restartLabel, moreCount = 0, onMore, moreLoading, boxes }: Props) {
  const { t } = useTranslation()
  const wrong = total - correct
  const hasMore = moreCount > 0
  return (
    <div className="glass mx-auto max-w-xl p-10 text-center">
      {wrong === 0
        ? <Trophy size={48} aria-hidden="true" className="mx-auto text-accent-text" />
        : <CircleCheck size={48} aria-hidden="true" className="mx-auto text-accent-text" />}
      <h2 className="mt-3 text-2xl font-bold text-fg">{t('result.done')}</h2>
      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="rounded-2xl bg-surface-2 p-4">
          <div className="text-3xl font-bold tabular-nums text-accent-text">{correct}</div>
          <div className="text-xs text-muted">{t('result.correct')}</div>
        </div>
        <div className="rounded-2xl bg-surface-2 p-4">
          <div className="text-3xl font-bold tabular-nums text-danger">{wrong}</div>
          <div className="text-xs text-muted">{t('result.wrong')}</div>
        </div>
      </div>
      <p className="mt-4 text-sm text-muted">{t('result.total', { count: total })}</p>
      {boxes && (
        <p className="mt-2 text-sm font-semibold text-muted">
          {boxes === 'practice' ? t('summary.practice') : t('summary.moved', { n: boxes.movedUp })}
        </p>
      )}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
        {hasMore && (
          <button type="button" onClick={onMore} disabled={moreLoading} className="btn-primary disabled:opacity-60">
            {moreLoading ? t('common.loading') : t('result.more', { count: moreCount })}
          </button>
        )}
        <button type="button" onClick={onRestart} className={hasMore ? 'btn-ghost' : 'btn-primary'}>{restartLabel ?? t('result.restart')}</button>
        <Link to="/" className="btn-ghost">{t('result.home')}</Link>
      </div>
    </div>
  )
}
