import { Link } from 'react-router-dom'
import { CircleCheck, Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface Props {
  correct: number
  total: number
  // moreCount > 0 → there are still due words left: show "More N" (same folder, same direction).
  moreCount?: number
  onMore?: () => void
  moreLoading?: boolean
  // How many words moved up a Leitner box in this session.
  movedUp: number
}

export function ReviewResult({ correct, total, moreCount = 0, onMore, moreLoading, movedUp }: Props) {
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
      <p className="mt-2 text-sm font-semibold text-muted">{t('summary.moved', { n: movedUp })}</p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
        {hasMore && (
          <button type="button" onClick={onMore} disabled={moreLoading} className="btn-primary disabled:opacity-60">
            {moreLoading ? t('common.loading') : t('result.more', { count: moreCount })}
          </button>
        )}
        <Link to="/" className={hasMore ? 'btn-ghost' : 'btn-primary'}>{t('result.home')}</Link>
      </div>
    </div>
  )
}
