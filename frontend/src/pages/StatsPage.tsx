import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { statsApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { ReviewsChart } from '../components/ReviewsChart'

function pluralDays(n: number) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'день'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня'
  return 'дней'
}

export function StatsPage() {
  const [period, setPeriod] = useState<'week' | 'month'>('week')
  const { data, isLoading, error } = useQuery({
    queryKey: ['stats', period],
    queryFn: () => statsApi.get(period),
  })

  const t = data?.totals
  const cards = [
    { icon: '🔥', value: t ? `${t.current_streak_days} ${pluralDays(t.current_streak_days)}` : '—', label: 'Подряд (streak)' },
    { icon: '✅', value: t ? `${t.accuracy_percent}%` : '—', label: 'Точность' },
    { icon: '📚', value: t ? String(t.total_words_learned) : '—', label: 'Слов выучено' },
    { icon: '🏆', value: t ? `${t.longest_streak_days} ${pluralDays(t.longest_streak_days)}` : '—', label: 'Лучший streak' },
  ]
  const total = data?.daily.reduce((s, d) => s + d.reviewed, 0) ?? 0
}
  )
    </div>
      </section>
        )}
          </>
            )}
              </p>
                Пока нет данных — пройдите тренировку в разделе «Карточки».
              <p className="mt-2 text-center text-sm text-emerald-300/60">
            {total === 0 && (
            </p>
              За период: {total} повторений, {newWords} новых слов
            <p className="mt-4 text-center text-sm text-emerald-100/70">
            <ReviewsChart data={data.daily} />
          <>
        {data && (
        {error && <p className="text-red-300">{errorMessage(error)}</p>}
        {isLoading && <div className="h-56 animate-pulse rounded-2xl bg-emerald-800/30" />}

        </div>
          </div>
            ))}
              </button>
                {label}
              <button key={k} onClick={() => setPeriod(k)} className={period === k ? 'btn-primary' : 'btn-ghost'}>
            {([['week', 'Неделя'], ['month', 'Месяц']] as const).map(([k, label]) => (
          <div className="flex gap-2">
          <h2 className="display text-xl font-bold">Повторений за день</h2>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <section className="glass p-6">

      </section>
        ))}
          </div>
            <div className="text-xs text-emerald-100/60">{c.label}</div>
            <div className="display mt-1 text-2xl font-extrabold text-lime-300">{c.value}</div>
            <div className="text-2xl">{c.icon}</div>
          <div key={c.label} className="glass p-5 text-center">
        {cards.map((c) => (
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">

      </div>
        <p className="mt-2 text-emerald-100/70">Прогресс обучения по дням.</p>
        </h1>
          Моя <span className="text-lime-300">статистика</span> 📈
        <h1 className="display text-3xl font-extrabold md:text-4xl">
      <div className="animate-rise">
    <div className="space-y-8">
  return (

  const newWords = data?.daily.reduce((s, d) => s + d.new_words, 0) ?? 0
