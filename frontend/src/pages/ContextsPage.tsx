import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { contextsApi } from '../api/endpoints'
import { errorMessage } from '../api/client'

export function ContextsPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['contexts'], queryFn: contextsApi.list })

  if (isLoading) return <p className="text-slate-500">Загрузка…</p>
  if (error) return <p className="text-red-600">{errorMessage(error)}</p>

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Мои контексты</h1>
        <Link to="/contexts/new" className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700">
          + Новый
        </Link>
      </div>
      {!data?.length ? (
        <p className="text-slate-500">Пока пусто. Загрузите скриншот или текст с немецкой фразой.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((c) => (
            <Link key={c.id} to={`/contexts/${c.id}`}
              className="rounded-lg border bg-white p-4 shadow-sm transition hover:shadow-md">
              <p className="line-clamp-3 text-slate-800">{c.source_text}</p>
              <p className="mt-2 text-xs text-slate-400">
                {c.image_url ? '🖼 ' : '📝 '}
                {new Date(c.created_at).toLocaleString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
