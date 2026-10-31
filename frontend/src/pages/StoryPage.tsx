import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Dices, Pencil, PencilLine, Plus, RotateCcw, Trash, WandSparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { storiesApi, type DailyStory, type StoryWord } from '../api/endpoints'
import { errorMessage, isFeatureError, isRateLimited, rateLimitMessage } from '../api/client'
import { dateLocale } from '../i18n'
import { useLearningLang } from '../lib/learningLang'
import { useFeatures } from '../lib/features'
import { highlightStory } from '../lib/storyHighlight'
import { Segmented } from '../components/Segmented'
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
          <mark key={i} data-testid="story-hl" className="rounded bg-surface-2 px-0.5 text-fg underline decoration-accent underline-offset-4">{s.text}</mark>
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
  const learning = useLearningLang()
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
        <h2 className="text-xl font-bold text-fg">{story.title || t('story.title')}</h2>
        <span className="flex items-center gap-2 text-xs text-muted">
          {formatDate(story.date)}
          {own
            ? <span className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5"><PencilLine size={12} aria-hidden="true" />{t('story.own.badge')}</span>
            : <span className="rounded-full bg-surface-2 px-2 py-0.5">{t(`story.genres.${story.genre}`, { defaultValue: story.genre })}</span>}
        </span>
      </div>
      <p className="whitespace-pre-line font-serif text-[19px] leading-relaxed text-fg" lang={learning.code}><Highlighted text={story.story_de} words={story.words_used} /></p>
      {story.story_translation && (
        <button className="btn-ghost" onClick={() => setShowTranslation((v) => !v)}>
          {showTranslation ? t('story.hideTranslation') : t('story.showTranslation')}
        </button>
      )}
      {showTranslation && story.story_translation && (
        <div className="space-y-1">
          <p className="whitespace-pre-line text-muted"><Highlighted text={story.story_translation} /></p>
          {own && story.translation_source && (
            <p className="text-xs text-faint">
              {story.translation_source === 'user' ? t('story.own.translationByYou') : t('story.own.translationByAi')}
            </p>
          )}
        </div>
      )}
      {own && !story.story_translation && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">{t('story.own.noTranslation')}</span>
          <button className="btn-ghost" onClick={() => setEditing('translation')}><Pencil size={16} aria-hidden="true" />{t('story.own.addTranslation')}</button>
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-2">
        {story.words_used.map((w) => (
          <span key={w.word} className="rounded-full bg-surface-2 px-3 py-1 text-sm text-fg">
            <span className="font-serif" lang={learning.code}>{w.word}</span>{w.translation && <span className="text-muted"> — {w.translation}</span>}
          </span>
        ))}
      </div>
      {own && (
        <div className="flex flex-wrap gap-2 border-t border-divider pt-4">
          <button className="btn-ghost" onClick={() => setEditing('edit')}><Pencil size={16} aria-hidden="true" />{t('story.own.edit')}</button>
          <button className="btn-ghost hover:!text-danger" disabled={remove.isPending}
            onClick={() => { if (window.confirm(t('story.own.deleteConfirm', { title: story.title }))) remove.mutate() }}>
            <Trash size={16} aria-hidden="true" />{t('story.own.delete')}
          </button>
        </div>
      )}
      {remove.error && <p className="text-sm text-danger">{errorMessage(remove.error)}</p>}
      {editing && (
        <StoryFormModal story={story} initialMode={editing === 'translation' ? 'manual' : undefined}
          onClose={() => setEditing(null)} />
      )}
    </article>
  )
}

type Filter = 'all' | 'ai' | 'own'

/** The title cut to 24 characters (emoji-safe). */
function ownChipLabel(title: string, max = 24): string {
  const chars = Array.from(title.trim())
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('')
}

export function StoryPage() {
  const { t, i18n } = useTranslation()
  const learning = useLearningLang()
  const { isOn } = useFeatures()
  const qc = useQueryClient()
  const today = useQuery({
    // No interface language in the keys: a story has ONE translation language, fixed by its first open,
    // so switching the UI language must not refetch (the language is only sent for that first open).
    queryKey: ['stories', 'today'],
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
    if (isFeatureError(err)) return errorMessage(err)
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
    queryKey: ['stories', 'by-id', selectedId],
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
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.02em] text-fg">{t('story.title')}</h1>
          <p className="mt-1 text-[15px] text-muted">{t('story.subtitle', learning.vars)}</p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" />{t('story.own.add')}</button>
      </div>

      {isOn('daily_story') && <section className="glass space-y-4 p-6">
        {today.isLoading ? (
          <p>{t('common.loading')}</p>
        ) : words.length === 0 ? (
          <p>{t('story.noWords')}</p>
        ) : (
          <>
            <p>{t('story.wordsToday')} <b className="text-accent-text">{words.length}</b> — {words.map((w) => w.word).join(', ')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <select className="field max-w-xs" value={genre} onChange={(e) => setGenre(e.target.value)}>
                <option value="">{t('story.randomGenre')}</option>
                {today.data?.genres.map((g) => (
                  <option key={g} value={g}>{t(`story.genres.${g}`, { defaultValue: g })}</option>
                ))}
              </select>
              <button className="btn-primary" disabled={gen.isPending} onClick={() => gen.mutate()}>
                {gen.isPending ? t('story.generating') : story
                  ? <><RotateCcw size={16} aria-hidden="true" />{t('story.regenerate')}</>
                  : <><WandSparkles size={16} aria-hidden="true" />{t('story.generate')}</>}
              </button>
            </div>
          </>
        )}
        {gen.error && <p className="text-danger">{genError(gen.error)}</p>}
        {today.error && <ErrorState error={today.error} />}
      </section>}

      {story && <StoryView story={story} />}

      <section ref={archiveRef} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-fg">{t('story.archive')}</h2>
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
          <Segmented value={filter} onChange={setFilter} options={[
            ['all', t('story.own.filterAll')],
            ['ai', t('story.own.filterAi')],
            ['own', t('story.own.filterOwn')],
          ] as const} />
        )}
        {past.length === 0 ? (
          <p className="text-muted">{t('story.noArchive')}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {past.map((s) => (
                <button key={s.id} onClick={() => select(s.id)} title={s.title}
                  className={s.id === selectedId && !noStoryOnDate ? 'btn-primary' : 'btn-ghost'}>
                  {s.source === 'user' && <PencilLine size={14} aria-hidden="true" />}{s.source === 'user' ? ownChipLabel(s.title) : formatDate(s.date)}
                </button>
              ))}
            </div>
            {noStoryOnDate ? (
              <p className="text-muted">{t('story.noStoryForDate')}</p>
            ) : selectedQuery.isLoading ? (
              <p>{t('common.loading')}</p>
            ) : selectedStory ? (
              <StoryView key={selectedStory.id} story={selectedStory} onDeleted={deleted} />
            ) : (
              <p className="text-muted">{t('story.noStoryForDate')}</p>
            )}
          </>
        )}
      </section>

      {adding && <StoryFormModal onClose={() => setAdding(false)} onSaved={created} />}
    </div>
  )
}
