import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { statsApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { ReviewsChart } from '../components/ReviewsChart'

export function StatsPage() {
  const { t } = useTranslation()
  const [period, setPeriod] = useState<'week' | 'month'>('week')
  const { data, isLoading, error } = useQuery({
    queryKey: ['stats', period],
    queryFn: () => statsApi.get(period),
  })

  const tot = data?.totals
  const cards = [
    { icon: '🔥', value: tot ? t('stats.days', { count: tot.current_streak_days }) : '—', label: t('stats.streakLong') },
    { icon: '✅', value: tot ? `${tot.accuracy_percent}%` : '—', label: t('stats.accuracy') },
    { icon: '📚', value: tot ? String(tot.total_words_learned) : '—', label: t('stats.learned') },
    { icon: '🏆', value: tot ? t('stats.days', { count: tot.longest_streak_days }) : '—', label: t('stats.bestStreak') },
  ]
  const periods = [['week', t('stats.week')], ['month', t('stats.month')]] as const
  const total = data?.daily.reduce((s, d) => s + d.reviewed, 0) ?? 0
  const newWords = data?.daily.reduce((s, d) => s + d.new_words, 0) ?? 0

  return (
    <div className="space-y-8">
      <div className="animate-rise">
        <h1 className="display text-3xl font-extrabold md:text-4xl">
          {t('stats.titleA')}<span className="text-lime-300">{t('stats.titleB')}</span> 📈
        </h1>
        <p className="mt-2 text-emerald-100/70">{t('stats.subtitle')}</p>
      </div>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.icon} className="glass p-5 text-center">
            <div className="text-2xl">{c.icon}</div>
            <div className="display mt-1 text-2xl font-extrabold text-lime-300">{c.value}</div>
            <div className="text-xs text-emerald-100/60">{c.label}</div>
          </div>
        ))}
      </section>

      <section className="glass p-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="display text-xl font-bold">{t('stats.perDay')}</h2>
          <div className="flex gap-2">
            {periods.map(([k, label]) => (
              <button key={k} onClick={() => setPeriod(k)} className={period === k ? 'btn-primary' : 'btn-ghost'}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {isLoading && <div className="h-56 animate-pulse rounded-2xl bg-emerald-800/30" />}
        {error && <p className="text-red-300">{errorMessage(error)}</p>}
        {data && (
          <>
            <ReviewsChart data={data.daily} />
            <p className="mt-4 text-center text-sm text-emerald-100/70">
              {t('stats.summary', { reviews: total, words: newWords })}
            </p>
            {total === 0 && (
              <p className="mt-2 text-center text-sm text-emerald-300/60">{t('stats.noData')}</p>
            )}
          </>
        )}
      </section>
    </div>
  )
}
