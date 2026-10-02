import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { cardsApi, contextsApi, statsApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { Context } from '../api/types'
import { TimeImage } from '../components/TimeImage'
import { parseGermanTime } from '../lib/germanTime'
import { dateLocale } from '../i18n'

export function ContextsPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['contexts'], queryFn: contextsApi.list })
  const cards = useQuery({ queryKey: ['cards'], queryFn: cardsApi.list })
  const stats7 = useQuery({ queryKey: ['stats', 'week'], queryFn: () => statsApi.get('week') })
  const streak = stats7.data?.totals.current_streak_days ?? 0

  const remove = useMutation({
    mutationFn: (id: string) => contextsApi.remove(id),
    onSuccess: (_r, id) => {
      // Drop the context from the cached list right away.
      qc.setQueryData<Context[]>(['contexts'], (old) => old?.filter((c) => c.id !== id))
      qc.removeQueries({ queryKey: ['context-words', id] })
      qc.invalidateQueries({ queryKey: ['cards'] })
      qc.invalidateQueries({ queryKey: ['review-due'] })
    },
  })

  function onDelete(e: { preventDefault(): void; stopPropagation(): void }, id: string) {
    e.preventDefault() // the card is wrapped in a <Link>
    e.stopPropagation()
    if (window.confirm(t('home.deleteConfirm'))) remove.mutate(id)
  }

  const stats = [
    { label: t('stats.wordsAdded'), value: cards.data?.length ?? 0, icon: '📝' },
    { label: t('stats.streak'), value: streak, icon: '🔥' },
    { label: t('stats.language'), value: 'DE', icon: '🇩🇪' },
  ]

  return (
    <div className="space-y-10">
      <section className="glass animate-rise relative overflow-hidden p-8 md:p-12">
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-lime-400/20 blur-3xl" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="display text-3xl font-extrabold md:text-4xl">
              {t('home.greeting')} <span className="text-lime-300">{t('home.greetingAccent')}</span>
            </h1>
            <p className="mt-2 text-emerald-100/70">{t('home.subtitle')}</p>
          </div>
          <Link to="/contexts/new" className="btn-primary shrink-0">{t('home.newPhrase')}</Link>
        </div>
        <div className="relative mt-8 grid grid-cols-3 gap-4">
          {stats.map((s) => (
            <div key={s.icon} className="rounded-2xl border border-emerald-400/15 bg-emerald-950/40 p-4 text-center">
              <div className="text-2xl">{s.icon}</div>
              <div className="display mt-1 text-2xl font-extrabold text-lime-300">{s.value}</div>
              <div className="text-xs text-emerald-100/60">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="display mb-4 text-xl font-bold">{t('home.myContexts')}</h2>
        {isLoading && <SkeletonGrid />}
        {error && <p className="text-red-300">{errorMessage(error)}</p>}
        {remove.error && <p className="mb-3 text-red-300">{t('home.deleteFailed', { error: errorMessage(remove.error) })}</p>}
        {data && !data.length && (
          <div className="glass p-10 text-center">
            <div className="text-5xl">🌿</div>
            <p className="mt-3 text-emerald-100/70">{t('home.empty')}</p>
            <Link to="/contexts/new" className="btn-primary mt-6">{t('home.start')}</Link>
          </div>
        )}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {data?.map((c, i) => {
            const time = parseGermanTime(c.source_text)
            return (
            <Link key={c.id} to={`/contexts/${c.id}`}
              style={{ animationDelay: `${Math.min(i, 12) * 50}ms` }}
              className="animate-rise group relative overflow-hidden rounded-3xl border border-emerald-400/15 bg-gradient-to-br from-emerald-800/50 via-emerald-900/40 to-teal-900/40 p-6 transition hover:-translate-y-1 hover:border-lime-400/40 hover:shadow-2xl hover:shadow-emerald-500/20">
              <div className="absolute left-0 top-0 z-10 h-full w-1 bg-gradient-to-b from-lime-300 to-emerald-500 opacity-60 transition group-hover:opacity-100" />
              <button type="button" onClick={(e) => onDelete(e, c.id)}
                disabled={remove.isPending && remove.variables === c.id}
                title={t('home.deleteTitle')} aria-label={t('home.deleteTitle')}
                className="absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-full bg-emerald-950/70 text-emerald-200/80 backdrop-blur transition hover:bg-red-500/30 hover:text-red-200 disabled:opacity-50">
                🗑
              </button>
              {time ? (
                <div className="-mx-6 -mt-6 mb-4 h-40 overflow-hidden">
                  <TimeImage time={time} compact />
                </div>
              ) : c.image_url && (
                <div className="-mx-6 -mt-6 mb-4 h-40 overflow-hidden">
                  <img src={c.image_url} alt="" loading="lazy"
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                </div>
              )}
              <p className="line-clamp-4 text-lg leading-relaxed text-white">„{c.source_text}“</p>
              {c.meaning && <p className="mt-2 line-clamp-2 text-sm text-lime-200">— {c.meaning}</p>}
              <div className="mt-4 flex items-center justify-between text-xs text-emerald-300/60">
                <span>{new Date(c.created_at).toLocaleDateString(dateLocale())}</span>
                <span className="font-semibold text-lime-300 opacity-0 transition group-hover:opacity-100">{t('home.open')}</span>
              </div>
            </Link>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-36 animate-pulse rounded-3xl bg-emerald-800/30" />
      ))}
    </div>
  )
}
