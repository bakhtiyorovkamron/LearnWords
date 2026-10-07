import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { searchApi, type WordInfo } from '../api/endpoints'
import { errorMessage, isRateLimited, rateLimitMessage } from '../api/client'
import { FolderSelect } from '../components/Folders'
import { toast } from '../components/Toaster'

const PERSONS: [string, string][] = [
  ['ich', 'ich'], ['du', 'du'], ['er_sie_es', 'er/sie/es'],
  ['wir', 'wir'], ['ihr', 'ihr'], ['sie_Sie', 'sie/Sie'],
]

function status(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status
}

function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'de-DE'
  window.speechSynthesis.speak(u)
}

export function SearchPage() {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const search = useMutation({ mutationFn: (q: string) => searchApi.search(q) })

  function submit(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (q && !search.isPending) search.mutate(q)
  }

  const err = search.error
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="animate-rise text-center">
        <h1 className="display text-3xl font-extrabold md:text-4xl">
          {t('search.titleA')}<span className="text-lime-300">{t('search.titleB')}</span> 🔍
        </h1>
        <p className="mt-2 text-emerald-100/70">{t('search.subtitle')}</p>
      </div>

      <form onSubmit={submit} className="glass flex flex-col gap-3 p-4 sm:flex-row">
        <input value={query} onChange={(e) => setQuery(e.target.value.slice(0, 100))} autoFocus
          placeholder={t('search.placeholder')} className="field flex-1 text-lg" aria-label={t('search.placeholder')} />
        <button type="submit" disabled={!query.trim() || search.isPending} className="btn-primary shrink-0">
          {search.isPending ? (
            <>
              <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-emerald-950 border-t-transparent" />
              {t('search.searching')}
            </>
          ) : t('search.find')}
        </button>
      </form>

      {err && (
        <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {status(err) === 503
            ? t('search.notConfigured')
            : isRateLimited(err)
              ? rateLimitMessage(err)
              : t('search.failed', { error: errorMessage(err) })}
        </p>
      )}
      {search.isPending && <div className="h-64 animate-pulse rounded-3xl bg-emerald-800/30" />}
      {search.data && !search.isPending && <WordResult key={search.data.word} info={search.data} />}
    </div>
  )
}

function WordResult({ info }: { info: WordInfo }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [added, setAdded] = useState(info.already_added)
  const [folder, setFolder] = useState('')
  const full = info.word_type === 'noun' && info.article ? `${info.article} ${info.word}` : info.word

  const add = useMutation({
    mutationFn: () => searchApi.add({
      word: full,
      translation: info.translation,
      pronunciation: info.pronunciation,
      example_sentence: info.example_sentence,
      example_translation: info.example_translation,
      folder_id: folder || undefined,
    }),
    onSuccess: () => {
      setAdded(true)
      toast(t('search.added'))
      for (const k of ['contexts', 'cards', 'collection', 'review-due', 'folders', 'stories', 'stats']) {
        qc.invalidateQueries({ queryKey: [k] })
      }
    },
    onError: (e) => { if (status(e) === 409) setAdded(true) }, // added meanwhile (other tab)
  })

  const row = (label: string, value: string | null) => value && (
    <div className="flex justify-between gap-4 border-b border-emerald-400/10 py-2 last:border-0">
      <span className="text-emerald-100/60">{label}</span>
      <span className="text-right font-semibold text-white">{value}</span>
    </div>
  )

  return (
    <article className="glass animate-rise space-y-6 p-6 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="w-full min-w-0">
          <div className="text-xs uppercase tracking-widest text-lime-300/70">{t(`search.type.${info.word_type}`)}</div>
          {/* Adaptive size + wrapping: long compound words must not overflow the card. */}
          <h2 className="display font-extrabold leading-tight text-white"
            style={{ fontSize: 'clamp(1.75rem, 5vw, 3rem)', overflowWrap: 'anywhere', wordBreak: 'break-word', hyphens: 'auto' }}
            lang="de">
            {info.word_type === 'noun' && info.article && <span className="text-lime-300">{info.article} </span>}
            {info.word}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {info.pronunciation && <span className="font-mono text-lime-300/90">[{info.pronunciation}]</span>}
            <button type="button" onClick={() => speak(full)} className="btn-ghost !px-3 !py-1 text-sm" title={t('quiz.listenTitle')}>▶</button>
          </div>
          <p className="mt-3 text-xl text-emerald-100">{info.translation}</p>
        </div>
      </header>

      {info.word_type === 'noun' && info.plural && (
        <section>
          <h3 className="mb-1 text-xs uppercase tracking-widest text-emerald-100/50">{t('search.plural')}</h3>
          <p className="text-lg text-white">die {info.plural.replace(/^die\s+/i, '')}</p>
        </section>
      )}

      {info.word_type === 'verb' && (
        <section className="space-y-4">
          {info.verb_type && (
            <span className="inline-block rounded-full border border-amber-300/40 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200">
              {info.verb_type === 'strong' ? t('search.strong') : info.verb_type === 'weak' ? t('search.weak') : info.verb_type}
            </span>
          )}
          {info.conjugation_present && (
            <div>
              <h3 className="mb-2 text-xs uppercase tracking-widest text-emerald-100/50">{t('search.present')}</h3>
              <table className="w-full overflow-hidden rounded-2xl text-left">
                <tbody>
                  {PERSONS.map(([key, label]) => {
                    const form = info.conjugation_present?.[key]
                    return form && (
                      <tr key={key} className="odd:bg-emerald-900/30">
                        <td className="w-1/3 px-4 py-2 text-emerald-100/60">{label}</td>
                        <td className="px-4 py-2 font-semibold text-white">{form}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {info.perfekt && (
              <div className="rounded-2xl bg-emerald-900/30 p-4">
                <div className="text-xs uppercase tracking-widest text-emerald-100/50">Perfekt</div>
                <div className="mt-1 text-lg font-semibold text-white">{info.perfekt}</div>
              </div>
            )}
            {info.praeteritum && (
              <div className="rounded-2xl bg-emerald-900/30 p-4">
                <div className="text-xs uppercase tracking-widest text-emerald-100/50">Präteritum (er/sie/es)</div>
                <div className="mt-1 text-lg font-semibold text-white">{info.praeteritum}</div>
              </div>
            )}
          </div>
        </section>
      )}

      {info.word_type === 'adjective' && (info.comparative || info.superlative) && (
        <section>
          <h3 className="mb-1 text-xs uppercase tracking-widest text-emerald-100/50">{t('search.degrees')}</h3>
          {row('Positiv', info.word)}
          {row('Komparativ', info.comparative)}
          {row('Superlativ', info.superlative)}
        </section>
      )}

      {info.example_sentence && (
        <section className="rounded-2xl border border-emerald-400/15 bg-emerald-950/40 p-4">
          <h3 className="mb-2 text-xs uppercase tracking-widest text-emerald-100/50">{t('search.example')}</h3>
          <p className="italic text-white">{info.example_sentence}</p>
          {info.example_translation && <p className="mt-1 text-emerald-100/60">{info.example_translation}</p>}
        </section>
      )}

      <footer className="flex flex-col gap-3 border-t border-emerald-400/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
        {!added && (
          <div className="flex min-w-0 items-center gap-2 text-sm text-emerald-100/60">
            <span className="shrink-0">📁</span>
            <FolderSelect value={folder} onChange={setFolder} className="w-56 max-w-full" />
          </div>
        )}
        <button type="button" onClick={() => add.mutate()} disabled={added || add.isPending}
          className={`${added ? 'btn-ghost cursor-default opacity-70' : 'btn-primary'} sm:ml-auto`}>
          {added ? `✓ ${t('search.alreadyAdded')}` : add.isPending ? t('search.adding') : `➕ ${t('search.add')}`}
        </button>
      </footer>
      {add.error && status(add.error) !== 409 && (
        <p className="text-sm text-red-300">{isRateLimited(add.error) ? rateLimitMessage(add.error) : t('search.addFailed', { error: errorMessage(add.error) })}</p>
      )}
    </article>
  )
}
