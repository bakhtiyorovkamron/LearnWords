import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

interface Props {
  correct: number
  total: number
  onRestart: () => void
}

export function ReviewResult({ correct, total, onRestart }: Props) {
  const { t } = useTranslation()
  const wrong = total - correct
  return (
    <div className="glass mx-auto max-w-xl p-10 text-center">
      <div className="text-5xl">{wrong === 0 ? '🏆' : '🎉'}</div>
      <h2 className="display mt-3 text-2xl font-extrabold">{t('result.done')}</h2>
      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-lime-400/30 bg-lime-400/10 p-4">
          <div className="display text-3xl font-extrabold text-lime-300">{correct}</div>
          <div className="text-xs text-emerald-100/70">{t('result.correct')}</div>
        </div>
        <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4">
          <div className="display text-3xl font-extrabold text-red-300">{wrong}</div>
          <div className="text-xs text-emerald-100/70">{t('result.wrong')}</div>
        </div>
      </div>
      <p className="mt-4 text-sm text-emerald-100/70">{t('result.total', { count: total })}</p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <button type="button" onClick={onRestart} className="btn-primary">{t('result.restart')}</button>
        <Link to="/contexts" className="btn-ghost">{t('result.home')}</Link>
      </div>
    </div>
  )
}
