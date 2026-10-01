import { Link } from 'react-router-dom'

interface Props {
  correct: number
  total: number
  onRestart: () => void
}

export function ReviewResult({ correct, total, onRestart }: Props) {
  const wrong = total - correct
  return (
    <div className="glass mx-auto max-w-xl p-10 text-center">
      <div className="text-5xl">{wrong === 0 ? '🏆' : '🎉'}</div>
      <h2 className="display mt-3 text-2xl font-extrabold">Тренировка завершена</h2>
      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-lime-400/30 bg-lime-400/10 p-4">
          <div className="display text-3xl font-extrabold text-lime-300">{correct}</div>
          <div className="text-xs text-emerald-100/70">правильно</div>
        </div>
        <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4">
          <div className="display text-3xl font-extrabold text-red-300">{wrong}</div>
          <div className="text-xs text-emerald-100/70">неправильно</div>
        </div>
      </div>
      <p className="mt-4 text-sm text-emerald-100/70">Всего слов: {total}</p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <button type="button" onClick={onRestart} className="btn-primary">Пройти ещё раз</button>
        <Link to="/contexts" className="btn-ghost">Вернуться на главную</Link>
      </div>
    </div>
  )
}
