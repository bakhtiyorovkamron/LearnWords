import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { contextsApi } from '../api/endpoints'
import { errorMessage } from '../api/client'

const MAX_LEN = 2000

const examples = [
  'Guten Morgen! Wie geht es dir heute?',
  'Ich hätte gern einen Kaffee mit Milch, bitte.',
  'Das Wetter ist heute wunderschön, lass uns spazieren gehen.',
  'Kannst du mir bitte helfen? Ich habe mich verlaufen.',
]

export function NewContextPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => contextsApi.create({ text: text.trim(), language: 'de' }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['contexts'] })
      qc.invalidateQueries({ queryKey: ['cards'] })
      qc.setQueryData(['context-words', res.context.id], res.cards)
      navigate(`/contexts/${res.context.id}`)
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setLocalError(null)
    if (!text.trim()) return setLocalError('Введите немецкую фразу')
    mutation.mutate()
  }

  const error = localError ?? (mutation.error ? errorMessage(mutation.error) : null)

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="animate-rise text-center">
        <h1 className="display text-3xl font-extrabold md:text-4xl">
          Новая <span className="text-lime-300">фраза</span> ✨
        </h1>
        <p className="mt-2 text-emerald-100/70">
          Вставьте текст из фильма, песни или переписки — мы разберём каждое слово.
        </p>
      </div>

      <form onSubmit={submit} className="glass animate-rise space-y-5 p-6 md:p-8">
        <div className="relative">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
            rows={7}
            autoFocus
            placeholder="z. B. „Ich freue mich schon auf das Wochenende!“"
            className="field resize-none text-lg leading-relaxed"
          />
          <span className="absolute bottom-3 right-4 text-xs text-emerald-300/50">
            {text.length}/{MAX_LEN}
          </span>
        </div>

        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-emerald-300/60">Или попробуйте пример</p>
          <div className="flex flex-wrap gap-2">
            {examples.map((ex) => (
              <button key={ex} type="button" onClick={() => setText(ex)}
                className="rounded-full border border-emerald-400/20 bg-emerald-950/40 px-4 py-1.5 text-sm text-emerald-100/80 transition hover:border-lime-400/50 hover:bg-lime-400/10 hover:text-lime-200">
                {ex}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">{error}</p>
        )}

        <button type="submit" disabled={mutation.isPending} className="btn-primary w-full text-lg">
          {mutation.isPending ? (
            <>
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-950 border-t-transparent" />
              Разбираем слова…
            </>
          ) : (
            'Разобрать фразу →'
          )}
        </button>
      </form>
    </div>
  )
}
