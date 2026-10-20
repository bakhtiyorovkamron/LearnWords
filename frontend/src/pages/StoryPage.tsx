import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { storiesApi, type DailyStory, type StoryWord } from '../api/endpoints'
import { errorMessage, isRateLimited, rateLimitMessage } from "../api/client";
import { dateLocale } from '../i18n'
import { useLearningLang } from '../lib/learningLang'
import { highlightStory } from '../lib/storyHighlight'
import { ErrorState } from '../components/ErrorState'
import { StoryFormModal } from '../components/StoryFormModal'
import { toast } from '../components/Toaster'

// story.date is YYYY-MM-DD; parse as a local date so it doesn't shift by timezone.
function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(dateLocale())
}

// Highlights the day's words: **bold** from the AI plus every form of each word found by its
// lemma ("kommt" for "kommen") — see lib/storyHighlight.ts. Without `words` only **bold** counts.
function Highlighted({ text, words = [] }: { text: string; words?: StoryWord[] }) {
  const segments = useMemo(() => highlightStory(text, words), [text, words])
  return (
    <>
      {segments.map((s, i) =>
        s.hl ? (
          <mark key={i} className="rounded bg-lime-300/20 px-1 font-semibold text-lime-300">{s.text}</mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  )
}

// The story itself (learning-language text + its translation) is shown as is. The translation
// is resolved server-side for the current interface language — never assumed to be Russian.
// An own story (source 'user') also has edit / delete, a note on who wrote the translation, and
// a way to add one when it is missing.
function StoryView({ story, onDeleted }: { story: DailyStory; onDeleted?: (id: string) => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [showTranslation, setShowTranslation] = useState(false)
  const [editing, setEditing] = useState<'edit' | 'translation' | null>(null)
  const own = story.source === 'user'

  const remove = useMutation({
    mutationFn: () => storiesApi.deleteOwn(story.id),
    onSuccess: () => {
      onDeleted?.(story.id)
      void qc.invalidateQueries({ queryKey: ['stories'] })
      toast(t('story.own.deleted'))
    },
  })

  return (
    <article className="glass space-y-4 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="display text-2xl font-bold">{story.title || `${t('story.titleA')}${t('story.titleB')}`}</h2>
        <span className="text-xs text-emerald-100/60">
          {formatDate(story.date)} · {own ? t('story.own.badge') : t(`story.genres.${story.genre}`, { defaultValue: story.genre })}
        </span>
      </div>
      <p className="whitespace-pre-line leading-relaxed"><Highlighted text={story.story_de} words={story.words_used} /></p>
      {story.story_translation && (
        <button className="btn-ghost" onClick={() => setShowTranslation((v) => !v)}>
          {showTranslation ? t('story.hideTranslation') : t('story.showTranslation')}
        </button>
      )}
      {showTranslation && story.story_translation && (
        <div className="space-y-1">
          <p className="whitespace-pre-line text-emerald-100/80"><Highlighted text={story.story_translation} /></p>
          {own && story.translation_source && (
            <p className="text-xs text-emerald-100/50">
              {story.translation_source === 'user' ? t('story.own.translationByYou') : t('story.own.translationByAi')}
            </p>
          )}
        </div>
      )}
      {own && !story.story_translation && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-emerald-100/60">{t('story.own.noTranslation')}</span>
          <button className="btn-ghost" onClick={() => setEditing('translation')}>{t('story.own.addTranslation')}</button>
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-2">
        {story.words_used.map((w) => (
          <span key={w.word} className="rounded-full bg-white/5 px-3 py-1 text-sm">
            {w.word}{w.translation && <span className="text-emerald-100/60"> — {w.translation}</span>}
          </span>
        ))}
      </div>
      {own && (
        <div className="flex flex-wrap gap-2 border-t border-emerald-400/10 pt-4">
          <button className="btn-ghost" onClick={() => setEditing('edit')}>{t('story.own.edit')}</button>
          <button className="btn-ghost hover:!text-red-300" disabled={remove.isPending}
            onClick={() => { if (window.confirm(t('story.own.deleteConfirm', { title: story.title }))) remove.mutate() }}>
            {t('story.own.delete')}
          </button>
        </div>
      )}
      {remove.error && <p className="text-sm text-red-300">{errorMessage(remove.error)}</p>}
      {editing && (
        <StoryFormModal story={story} initialMode={editing === 'translation' ? 'manual' : undefined}
          onClose={() => setEditing(null)} />
      )}
    </article>
  )
}

type Filter = 'all' | 'ai' | 'own'

/** "✍️ " + the title cut to 24 characters (emoji-safe). */
function ownChipLabel(title: string, max = 24): string {
  const chars = Array.from(title.trim())
  return '✍️ ' + (chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join(''))
}

export function StoryPage() {
  const { t, i18n } = useTranslation()
  const learning = useLearningLang()
  const qc = useQueryClient()
  const today = useQuery({
    queryKey: ['stories', 'today', i18n.language],
    queryFn: () => storiesApi.today(i18n.language),
  })
  const archive = useQuery({ queryKey: ['stories', 'list'], queryFn: storiesApi.list })
  const [genre, setGenre] = useState('')
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState('')
  const [noStoryOnDate, setNoStoryOnDate] = useState(false)
  const archiveRef = useRef<HTMLElement>(null)
  const scrollToArchive = useRef(false)

  const gen = useMutation({
    mutationFn: () => storiesApi.generate(genre, i18n.language),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stories'] }),
  })

  // Server error texts aren't localized — map known statuses to UI strings.
  function genError(err: unknown) {
    const status = (err as { response?: { status?: number } }).response?.status
    if (status === 503) return t('story.notConfigured')
    if (status === 422) return t('story.noWordsError')
    if (isRateLimited(err)) return rateLimitMessage(err)
    return t('story.generateFailed', { error: errorMessage(err) })
  }

  // The archive: every story except TODAY'S AI story (it is shown above); today's own stories stay.
  const todayStr = new Date().toISOString().slice(0, 10)
  const all = useMemo(
    () => (archive.data ?? []).filter((s) => !(s.source !== 'user' && s.date === todayStr)),
    [archive.data, todayStr],
  )
  const hasOwn = all.some((s) => s.source === 'user')
  const past = useMemo(
    () => all.filter((s) => filter === 'all' || (filter === 'own') === (s.source === 'user')),
    [all, filter],
  )
  // Keep the selection valid when the list or the filter changes (default: the newest).
  useEffect(() => {
    if (!past.length) { if (selectedId) setSelectedId(''); return }
    if (!past.some((s) => s.id === selectedId)) setSelectedId(past[0].id)
  }, [past, selectedId])
  // The archive list has no text or translation — the selected story is fetched by id, resolved
  // for the current interface language, same as today's story.
  const selectedQuery = useQuery({
    queryKey: ['stories', 'by-id', selectedId, i18n.language],
    queryFn: () => storiesApi.byId(selectedId),
    enabled: !!selectedId,
  })
  const selectedStory = selectedQuery.data
  const selectedDate = past.find((s) => s.id === selectedId)?.date ?? ''

  useEffect(() => {
    if (scrollToArchive.current && selectedStory?.id === selectedId) {
      scrollToArchive.current = false
      archiveRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    }
  }, [selectedStory, selectedId])

  function select(id: string) {
    setNoStoryOnDate(false)
    setSelectedId(id)
  }
  function selectDate(date: string) {
    const first = past.find((s) => s.date === date)
    if (first) select(first.id)
    else setNoStoryOnDate(true)
  }
  function created(story: DailyStory) {
    // The new story is in the list at once (the refetch only confirms it) and gets selected.
    qc.setQueryData<DailyStory[]>(['stories', 'list'], (old) =>
      old ? [{ ...story, story_de: '' }, ...old.filter((s) => s.id !== story.id)] : old)
    setFilter('all')
    select(story.id)
    scrollToArchive.current = true
  }
  function deleted(id: string) {
    const i = past.findIndex((s) => s.id === id)
    const next = past[i + 1] ?? past[i - 1]
    qc.setQueryData<DailyStory[]>(['stories', 'list'], (old) => old?.filter((s) => s.id !== id))
    select(next?.id ?? '')
  }

  const words = today.data?.words_today ?? []
  const story = today.data?.story

  return (
    <div className="space-y-8">
      <div className="animate-rise flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="display text-3xl font-extrabold md:text-4xl">
            {t('story.titleA')}<span className="text-lime-300">{t('story.titleB')}</span> 📖
          </h1>
          <p className="mt-2 text-emerald-100/70">{t('story.subtitle', learning.vars)}</p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => setAdding(true)}>{t('story.own.add')}</button>
      </div>

      <section className="glass space-y-4 p-6">
        {today.isLoading ? (
          <p>{t('common.loading')}</p>
        ) : words.length === 0 ? (
          <p>{t('story.noWords')}</p>
        ) : (
          <>
            <p>{t('story.wordsToday')} <b className="text-lime-300">{words.length}</b> — {words.map((w) => w.word).join(', ')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <select className="field max-w-xs" value={genre} onChange={(e) => setGenre(e.target.value)}>
                <option value="">{t('story.randomGenre')}</option>
                {today.data?.genres.map((g) => (
                  <option key={g} value={g}>{t(`story.genres.${g}`, { defaultValue: g })}</option>
                ))}
              </select>
              <button className="btn-primary" disabled={gen.isPending} onClick={() => gen.mutate()}>
                {gen.isPending ? t('story.generating') : story ? t('story.regenerate') : t('story.generate')}
              </button>
            </div>
          </>
        )}
        {gen.error && <p className="text-red-300">{genError(gen.error)}</p>}
        {today.error && <ErrorState error={today.error} />}
      </section>

      {story && <StoryView story={story} />}

      <section ref={archiveRef} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="display text-xl font-bold">{t('story.archive')}</h2>
          {past.length > 0 && (
            <input
              type="date"
              className="field max-w-xs"
              value={selectedDate}
              min={past.reduce((m, s) => (s.date < m ? s.date : m), past[0].date)}
              max={past.reduce((m, s) => (s.date > m ? s.date : m), past[0].date)}
              onChange={(e) => selectDate(e.target.value)}
            />
          )}
        </div>
        {hasOwn && (
          <div role="group" className="flex flex-wrap gap-2">
            {(['all', 'ai', 'own'] as const).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f}
                onClick={() => setFilter(f)} className={filter === f ? 'btn-primary' : 'btn-ghost'}>
                {t(`story.own.filter${f === 'all' ? 'All' : f === 'ai' ? 'Ai' : 'Own'}`)}
              </button>
            ))}
          </div>
        )}
        {past.length === 0 ? (
          <p className="text-emerald-100/60">{t('story.noArchive')}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {past.map((s) => (
                <button key={s.id} onClick={() => select(s.id)} title={s.title}
                  className={s.id === selectedId && !noStoryOnDate ? 'btn-primary' : 'btn-ghost'}>
                  {s.source === 'user' ? ownChipLabel(s.title) : formatDate(s.date)}
                </button>
              ))}
            </div>
            {noStoryOnDate ? (
              <p className="text-emerald-100/60">{t('story.noStoryForDate')}</p>
            ) : selectedQuery.isLoading ? (
              <p>{t('common.loading')}</p>
            ) : selectedStory ? (
              <StoryView key={selectedStory.id} story={selectedStory} onDeleted={deleted} />
            ) : (
              <p className="text-emerald-100/60">{t('story.noStoryForDate')}</p>
            )}
          </>
        )}
      </section>

      {adding && <StoryFormModal onClose={() => setAdding(false)} onSaved={created} />}
    </div>
  )
}
