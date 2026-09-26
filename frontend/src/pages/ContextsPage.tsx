import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { cardsApi, contextsApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { TimeImage } from '../components/TimeImage'
import { parseGermanTime } from '../lib/germanTime'

export function ContextsPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['contexts'], queryFn: contextsApi.list })
  const cards = useQuery({ queryKey: ['cards'], queryFn: cardsApi.list })

  const stats = [
    { label: 'Контекстов', value: data?.length ?? 0, icon: '📚' },
    { label: 'Слов изучено', value: cards.data?.length ?? 0, icon: '🌱' },
    { label: 'Язык', value: 'DE', icon: '🇩🇪' },
  ]

  return (
    <div className="space-y-10">
      <section className="glass animate-rise relative overflow-hidden p-8 md:p-12">
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-lime-400/20 blur-3xl" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="display text-3xl font-extrabold md:text-4xl">
              Hallo! <span className="text-lime-300">Was lernen wir heute?</span>
            </h1>
            <p className="mt-2 text-emerald-100/70">Каждая фраза — это набор новых слов в живом контексте.</p>
          </div>
          <Link to="/contexts/new" className="btn-primary shrink-0">✨ Новая фраза</Link>
        </div>
        <div className="relative mt-8 grid grid-cols-3 gap-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl border border-emerald-400/15 bg-emerald-950/40 p-4 text-center">
              <div className="text-2xl">{s.icon}</div>
              <div className="display mt-1 text-2xl font-extrabold text-lime-300">{s.value}</div>
              <div className="text-xs text-emerald-100/60">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="display mb-4 text-xl font-bold">Мои контексты</h2>
        {isLoading && <SkeletonGrid />}
        {error && <p className="text-red-300">{errorMessage(error)}</p>}
        {data && !data.length && (
          <div className="glass p-10 text-center">
            <div className="text-5xl">🌿</div>
            <p className="mt-3 text-emerald-100/70">Пока пусто. Добавьте первую немецкую фразу!</p>
            <Link to="/contexts/new" className="btn-primary mt-6">Начать</Link>
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
              <div className="mt-4 flex items-center justify-between text-xs text-emerald-300/60">
                <span>{new Date(c.created_at).toLocaleDateString()}</span>
                <span className="font-semibold text-lime-300 opacity-0 transition group-hover:opacity-100">Открыть →</span>
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
