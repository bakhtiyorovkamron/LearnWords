import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { contextsApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { Photo } from '../api/types'

export function PhotoPicker({ contextId, onClose }: { contextId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')

  const photos = useQuery({
    queryKey: ['context-photos', contextId, query],
    queryFn: () => contextsApi.photos(contextId, query || undefined),
    staleTime: 5 * 60_000,
  })

  const choose = useMutation({
    mutationFn: (p: Photo) => contextsApi.setPhoto(contextId, p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contexts'] })
      onClose()
    },
  })

  function search(e: FormEvent) {
    e.preventDefault()
    setQuery(input.trim())
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-emerald-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}>
      <div className="glass max-h-[90vh] w-full max-w-4xl overflow-y-auto p-6 md:p-8" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="display text-2xl font-extrabold">Подобрать <span className="text-lime-300">фото</span> 🖼</h2>
          <button onClick={onClose} className="btn-ghost">✕</button>
        </div>

        <form onSubmit={search} className="mb-6 flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)} maxLength={100}
            placeholder="Свой запрос, например: Kaffee, Strand, Berlin…" className="field" />
          <button type="submit" className="btn-primary shrink-0">Искать</button>
        </form>

        {photos.isLoading && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-[4/3] animate-pulse rounded-2xl bg-emerald-800/40" />
            ))}
          </div>
        )}
        {photos.error && <p className="text-red-300">{errorMessage(photos.error)}</p>}
        {choose.error && <p className="mb-3 text-red-300">{errorMessage(choose.error)}</p>}
        {photos.data && !photos.data.length && (
          <p className="py-10 text-center text-emerald-100/70">Ничего не нашлось 🍃 Попробуйте другой запрос.</p>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {photos.data?.map((p) => (
            <button key={p.url} onClick={() => choose.mutate(p)} disabled={choose.isPending}
              className="group relative aspect-[4/3] overflow-hidden rounded-2xl border border-emerald-400/15 transition hover:border-lime-400 hover:shadow-xl hover:shadow-lime-400/20 disabled:opacity-60">
              <img src={p.url} alt={p.credit} loading="lazy"
                className="h-full w-full object-cover transition duration-500 group-hover:scale-110" />
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-emerald-950/90 to-transparent px-3 pb-2 pt-6 text-left text-[10px] text-emerald-100/80">
                {p.credit}
              </span>
              <span className="absolute right-2 top-2 rounded-full bg-lime-400 px-3 py-1 text-xs font-bold text-emerald-950 opacity-0 transition group-hover:opacity-100">
                Выбрать
              </span>
            </button>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-emerald-300/50">
          Фото из <a href="https://openverse.org" target="_blank" rel="noreferrer" className="underline">Openverse</a> под свободными лицензиями Creative Commons
        </p>
      </div>
    </div>
  )
}
