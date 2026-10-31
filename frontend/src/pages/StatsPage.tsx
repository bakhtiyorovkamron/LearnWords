import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CircleCheck, Flame, Library, Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { statsApi } from '../api/endpoints'
import { HeroPanel } from '../components/HeroPanel'
import { ReviewsChart } from '../components/ReviewsChart'
import { Segmented } from '../components/Segmented'
import { ErrorState } from '../components/ErrorState'

export function StatsPage() {
  const { t } = useTranslation()
  const [period, setPeriod] = useState<'week' | 'month'>('week')
  const { data, isLoading, error } = useQuery({
    queryKey: ['stats', period],
    queryFn: () => statsApi.get(period),
  })

  const tot = data?.totals
  const cards = [
    { icon: Flame, tone: 'text-streak', value: tot ? t('stats.days', { count: tot.current_streak_days }) : '—', label: t('stats.streakLong') },
    { icon: CircleCheck, tone: 'text-accent-text', value: tot ? `${tot.accuracy_percent}%` : '—', label: t('stats.accuracy') },
    { icon: Library, tone: 'text-accent-text', value: tot ? String(tot.total_words_learned) : '—', label: t('stats.learned') },
    { icon: Trophy, tone: 'text-accent-text', value: tot ? t('stats.days', { count: tot.longest_streak_days }) : '—', label: t('stats.bestStreak') },
  ]
  const periods = [['week', t('stats.week')], ['month', t('stats.month')]] as const
  const total = data?.daily.reduce((s, d) => s + d.reviewed, 0) ?? 0
  const newWords = data?.daily.reduce((s, d) => s + d.new_words, 0) ?? 0

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-[26px] font-bold tracking-[-0.02em] text-fg">{t('stats.title')}</h1>
        <p className="mt-1 text-[15px] text-muted">{t('stats.subtitle')}</p>
      </div>

      <HeroPanel />

      <section className="grid grid-cols-2 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="glass p-4">
            <c.icon size={18} aria-hidden="true" className={c.tone} />
            <div className="mt-2 text-[28px] font-bold tabular-nums leading-tight text-fg">{c.value}</div>
            <div className="text-sm text-muted">{c.label}</div>
          </div>
        ))}
      </section>

      <section className="glass p-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-fg">{t('stats.perDay')}</h2>
          <Segmented value={period} onChange={setPeriod} options={periods} />
        </div>

        {isLoading && <div className="h-56 animate-pulse rounded-2xl bg-surface-2" />}
        {error && <ErrorState error={error} />}
        {data && (
          <>
            <ReviewsChart data={data.daily} />
            <p className="mt-4 text-center text-sm text-muted">
              {t('stats.summary', { reviews: total, words: newWords })}
            </p>
            {total === 0 && (
              <p className="mt-2 text-center text-sm text-faint">{t('stats.noData')}</p>
            )}
          </>
        )}
      </section>
    </div>
  )
}
