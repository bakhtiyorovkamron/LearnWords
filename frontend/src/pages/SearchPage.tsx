import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Folder as FolderIcon, Plus, Search, Volume2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { searchApi, type WordInfo } from '../api/endpoints'
import { errorMessage, isFeatureError, isRateLimited, rateLimitMessage } from '../api/client'
import { FolderSelect } from '../components/Folders'
import { toast } from '../components/Toaster'
import { useLearningLang } from '../lib/learningLang'
import { useFeatures } from '../lib/features'
import { speak, useCanSpeak } from '../lib/speech'
import { ARTICLE_COLOR, type Article } from '../lib/article'

// Pronoun labels per learning language (keys are positions returned by the backend).
const PERSONS_BY_LANG: Record<string, [string, string][]> = {
  de: [['ich', 'ich'], ['du', 'du'], ['er_sie_es', 'er/sie/es'], ['wir', 'wir'], ['ihr', 'ihr'], ['sie_Sie', 'sie/Sie']],
  en: [['ich', 'I'], ['du', 'you'], ['er_sie_es', 'he/she/it'], ['wir', 'we'], ['ihr', 'you (pl.)'], ['sie_Sie', 'they']],
  fr: [['ich', 'je'], ['du', 'tu'], ['er_sie_es', 'il/elle'], ['wir', 'nous'], ['ihr', 'vous'], ['sie_Sie', 'ils/elles']],
  ko: [],
}
// Labels of the two extra verb forms (backend reuses the "perfekt"/"praeteritum" fields).
const VERB_FORMS: Record<string, [string, string]> = {
  de: ['Perfekt', 'Präteritum (er/sie/es)'],
  en: ['Past Participle', 'Past Simple'],
  fr: ['Passé composé', 'Imparfait (il/elle)'],
  ko: ['과거 (-았어요/-었어요)', '현재 (-아요/-어요)'],
}

function status(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status
}

export function SearchPage() {
  const { t, i18n } = useTranslation()
  const learning = useLearningLang()
  const { isOn } = useFeatures()
  const [query, setQuery] = useState('')
  // Translation comes back in the current UI language (ru/en/uz).
  const search = useMutation({ mutationFn: (q: string) => searchApi.search(q, i18n.language) })

  function submit(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (q && !search.isPending) search.mutate(q)
  }

  const err = search.error
  if (!isOn('word_search')) {
    return <p className="mx-auto max-w-3xl rounded-xl border border-danger bg-surface-2 px-4 py-3 text-sm text-danger">{t('errors.featureDisabled')}</p>
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-[26px] font-bold tracking-[-0.02em] text-fg">{t('search.title')}</h1>
        <p className="mt-1 text-[15px] text-muted">{t('search.subtitle', learning.vars)}</p>
      </div>

      <form onSubmit={submit} className="glass flex flex-col gap-3 p-4 sm:flex-row">
        <div className="relative flex-1">
          <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
          <input value={query} onChange={(e) => setQuery(e.target.value.slice(0, 100))} autoFocus
            placeholder={t('search.placeholder', learning.vars)} className="field pl-11" aria-label={t('search.placeholder', learning.vars)} />
        </div>
        <button type="submit" disabled={!query.trim() || search.isPending} className="btn-primary shrink-0">
          {search.isPending ? (
            <>
              <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-on-accent border-t-transparent" />
              {t('search.searching')}
            </>
          ) : t('search.find')}
        </button>
      </form>

      {err && (
        <p className="rounded-xl border border-danger bg-surface-2 px-4 py-3 text-sm text-danger">
          {status(err) === 503
            ? t('search.notConfigured')
            : isFeatureError(err)
              ? errorMessage(err)
              : isRateLimited(err)
              ? rateLimitMessage(err)
              : t('search.failed', { error: errorMessage(err) })}
        </p>
      )}
      {search.isPending && <div className="h-64 animate-pulse rounded-2xl bg-surface-2" />}
      {search.data && !search.isPending && <WordResult key={search.data.word} info={search.data} />}
    </div>
  )
}

function WordResult({ info }: { info: WordInfo }) {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const learning = useLearningLang()
  const canSpeak = useCanSpeak(learning.code)
  const persons = PERSONS_BY_LANG[learning.code] ?? PERSONS_BY_LANG.de
  const [perfektLabel, praetLabel] = VERB_FORMS[learning.code] ?? VERB_FORMS.de
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
      translation_language: info.translation_language,
      folder_id: folder || undefined,
      // The search result is already a checked dictionary form (German only: der/die/das).
      ...(learning.code === 'de' && {
        lemma: info.word,
        article: info.word_type === 'noun' ? info.article : null,
        plural: info.word_type === 'noun' ? info.plural : null,
        part_of_speech: info.word_type,
      }),
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
    <div className="flex justify-between gap-4 border-b border-divider py-2 last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right font-semibold text-fg">{value}</span>
    </div>
  )

  return (
    <article className="glass space-y-6 p-5 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="w-full min-w-0">
          {/* Label comes from the UI locale (never from the AI); no CSS uppercase — Uzbek Latin
              "ot" turned into "OT" looked like Cyrillic "ОТ". */}
          <div className="text-xs font-semibold tracking-wide text-faint" lang={i18n.language}>
            {t(`search.type.${info.word_type}`, { defaultValue: t('search.type.other') })}
          </div>
          {/* Adaptive size + wrapping: long compound words must not overflow the card. */}
          <h2 className="font-serif font-medium leading-tight text-fg"
            style={{ fontSize: 'clamp(1.75rem, 5vw, 2.5rem)', overflowWrap: 'anywhere', wordBreak: 'break-word', hyphens: 'auto' }}
            lang={learning.code}>
            {info.word_type === 'noun' && info.article && <span className={ARTICLE_COLOR[info.article.toLowerCase() as Article] ?? 'text-fg'}>{info.article} </span>}
            {info.word}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {info.pronunciation && <span className="font-mono text-muted">[{info.pronunciation}]</span>}
            {canSpeak && (
              <button type="button" onClick={() => speak(full, learning.code)} className="grid h-10 w-10 place-items-center rounded-full border border-line text-muted transition hover:bg-surface-2" title={t('quiz.listenTitle')} aria-label={t('quiz.listenTitle')}><Volume2 size={18} aria-hidden="true" /></button>
            )}
          </div>
          <p className="mt-3 text-xl text-fg">{info.translation}</p>
          {!!info.alternatives?.length && (
            <p className="mt-2 text-sm text-muted">
              {t('search.alternatives')}{' '}
              <span className="font-serif text-fg" lang={learning.code}>{info.alternatives.join(', ')}</span>
            </p>
          )}
        </div>
      </header>

      {info.word_type === 'noun' && info.plural && (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-faint">{t('search.plural')}</h3>
          <p className="font-serif text-lg text-fg">{learning.code === 'de' ? `die ${info.plural.replace(/^die\s+/i, '')}` : info.plural}</p>
        </section>
      )}

      {(info.word_type === 'verb' || (learning.code === 'ko' && info.word_type === 'adjective')) && (
        <section className="space-y-4">
          {info.verb_type && (
            <span className="inline-block rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-streak">
              {info.verb_type === 'strong' ? t('search.strong') : info.verb_type === 'weak' ? t('search.weak') : info.verb_type}
            </span>
          )}
          {info.conjugation_present && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-faint">{t('search.present')}</h3>
              <table className="w-full overflow-hidden rounded-2xl text-left">
                <tbody>
                  {persons.map(([key, label]) => {
                    const form = info.conjugation_present?.[key]
                    return form && (
                      <tr key={key} className="odd:bg-surface-2">
                        <td className="w-1/3 px-4 py-2 text-muted">{label}</td>
                        <td className="px-4 py-2 font-semibold text-fg">{form}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {info.perfekt && (
              <div className="rounded-2xl bg-surface-2 p-4">
                <div className="text-xs font-semibold uppercase tracking-widest text-faint">{perfektLabel}</div>
                <div className="mt-1 text-lg font-semibold text-fg">{info.perfekt}</div>
              </div>
            )}
            {info.praeteritum && (
              <div className="rounded-2xl bg-surface-2 p-4">
                <div className="text-xs font-semibold uppercase tracking-widest text-faint">{praetLabel}</div>
                <div className="mt-1 text-lg font-semibold text-fg">{info.praeteritum}</div>
              </div>
            )}
          </div>
        </section>
      )}

      {info.word_type === 'adjective' && (info.comparative || info.superlative) && (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-faint">{t('search.degrees')}</h3>
          {row(t('search.positive'), info.word)}
          {row(t('search.comparative'), info.comparative)}
          {row(t('search.superlative'), info.superlative)}
        </section>
      )}

      {info.example_sentence && (
        <section className="rounded-2xl border border-line bg-surface-2 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-faint">{t('search.example')}</h3>
          <p className="font-serif italic text-fg">{info.example_sentence}</p>
          {info.example_translation && <p className="mt-1 text-muted">{info.example_translation}</p>}
        </section>
      )}

      <footer className="flex flex-col gap-3 border-t border-divider pt-5 sm:flex-row sm:items-center sm:justify-between">
        {!added && (
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted">
            <FolderIcon size={18} aria-hidden="true" className="shrink-0" />
            <FolderSelect value={folder} onChange={setFolder} className="w-56 max-w-full" />
          </div>
        )}
        <button type="button" onClick={() => add.mutate()} disabled={added || add.isPending}
          className={`${added ? 'btn-ghost cursor-default opacity-70' : 'btn-primary'} sm:ml-auto`}>
          {added ? <><Check size={18} aria-hidden="true" className="text-accent-text" />{t('search.alreadyAdded')}</>
            : add.isPending ? t('search.adding') : <><Plus size={18} aria-hidden="true" />{t('search.add')}</>}
        </button>
      </footer>
      {add.error && status(add.error) !== 409 && (
        <p className="text-sm text-danger">{isRateLimited(add.error) ? rateLimitMessage(add.error) : t('search.addFailed', { error: errorMessage(add.error) })}</p>
      )}
    </article>
  )
}
