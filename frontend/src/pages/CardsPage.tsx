import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cardsApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { WordCardView } from '../components/WordCard'
import { ReviewSession } from '../components/ReviewSession'

export function CardsPage() {
  const [tab, setTab] = useState<'review' | 'all'>('review')
  return (
    <div className="space-y-8">
      <div className="flex gap-2">
        {([['review', 'Повторение'], ['all', 'Коллекция']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={tab === k ? 'btn-primary' : 'btn-ghost'}>{label}</button>
        ))}
      </div>
      {tab === 'review' ? <ReviewSession /> : <Collection />}
    </div>
  )
}

function Collection() {
  const { data, isLoading, error } = useQuery({ queryKey: ['cards'], queryFn: cardsApi.list })
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return data ?? []
    return (data ?? []).filter(
      (c) => c.word.toLowerCase().includes(s) || c.translation.toLowerCase().includes(s),
    )
  }, [data, q])

  return (
    <div className="space-y-8">
      <div className="animate-rise flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="display text-3xl font-extrabold md:text-4xl">
            Моя <span className="text-lime-300">коллекция</span> 🃏
          </h1>
          <p className="mt-2 text-emerald-100/70">
            {data ? `${data.length} слов в копилке` : 'Все ваши слова в одном месте'}
          </p>
        </div>
        <div className="relative w-full md:w-80">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-emerald-300/60">🔍</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по слову или переводу…"
            className="field pl-11" />
        </div>
      </div>

      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-emerald-800/30" />
          ))}
        </div>
      )}
      {error && <p className="text-red-300">{errorMessage(error)}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((c, i) => <WordCardView key={c.id} card={c} index={i} />)}
      </div>

      {data && !filtered.length && (
        <div className="glass p-10 text-center">
          <div className="text-5xl">🍃</div>
          <p className="mt-3 text-emerald-100/70">{q ? 'Ничего не найдено' : 'Коллекция пока пуста'}</p>
        </div>
      )}
    </div>
  )
}
