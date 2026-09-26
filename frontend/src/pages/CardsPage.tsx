import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cardsApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { WordCardView } from '../components/WordCard'

export function CardsPage() {
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
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Все карточки</h1>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по слову или переводу…"
        className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-indigo-500 focus:outline-none" />
      {isLoading && <p className="text-slate-500">Загрузка…</p>}
      {error && <p className="text-red-600">{errorMessage(error)}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((c) => <WordCardView key={c.id} card={c} />)}
      </div>
      {data && !filtered.length && <p className="text-slate-500">Ничего не найдено</p>}
    </div>
  )
}
