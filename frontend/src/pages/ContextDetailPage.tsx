import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { contextsApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { WordCardView } from '../components/WordCard'

export function ContextDetailPage() {
  const { id = '' } = useParams()
  // No GET /contexts/:id yet — take the context from the cached list.
  const contexts = useQuery({ queryKey: ['contexts'], queryFn: contextsApi.list })
  const words = useQuery({ queryKey: ['context-words', id], queryFn: () => contextsApi.words(id) })
  const ctx = contexts.data?.find((c) => c.id === id)

  if (words.error) return <p className="text-red-600">{errorMessage(words.error)}</p>

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="space-y-3">
        <h1 className="text-2xl font-bold">Контекст</h1>
        {ctx?.image_url && /^https?:/.test(ctx.image_url) && (
          <img src={ctx.image_url} alt="" className="rounded-lg border" />
        )}
        <blockquote className="rounded-lg border-l-4 border-indigo-400 bg-white p-4 text-lg shadow-sm">
          {ctx?.source_text ?? '…'}
        </blockquote>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Слова</h2>
        {words.isLoading && <p className="text-slate-500">Загрузка…</p>}
        {words.data?.map((w) => <WordCardView key={w.id} card={w} />)}
      </section>
    </div>
  )
}
