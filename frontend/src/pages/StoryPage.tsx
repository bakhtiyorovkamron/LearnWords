import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { storiesApi, type DailyStory } from '../api/endpoints'
import { errorMessage, isRateLimited, rateLimitMessage } from "../api/client";
import { dateLocale } from '../i18n'

// story.date is YYYY-MM-DD; parse as a local date so it doesn't shift by timezone.
function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(dateLocale())
}

// Renders **word** as highlighted text.
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <mark key={i} className="rounded bg-lime-300/20 px-1 font-semibold text-lime-300">{p.slice(2, -2)}</mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

// The story itself (DE text + RU translation) is learning content and is shown as is.
function StoryView({ story }: { story: DailyStory }) {
  const { t } = useTranslation()
  const [showRu, setShowRu] = useState(false)
  return (
    <article className="glass space-y-4 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="display text-2xl font-bold">{story.title || 'Geschichte des Tages'}</h2>
        <span className="text-xs text-emerald-100/60">
          {formatDate(story.date)} · {t(`story.genres.${story.genre}`, { defaultValue: story.genre })}
        </span>
      </div>
      <p className="whitespace-pre-line leading-relaxed"><Highlighted text={story.story_de} /></p>
      <button className="btn-ghost" onClick={() => setShowRu((v) => !v)}>
        {showRu ? t('story.hideTranslation') : t('story.showTranslation')}
      </button>
      {showRu && <p className="whitespace-pre-line text-emerald-100/80"><Highlighted text={story.story_ru} /></p>}
      <div className="flex flex-wrap gap-2 pt-2">
        {story.words_used.map((w) => (
          <span key={w.word} className="rounded-full bg-white/5 px-3 py-1 text-sm">
            {w.word} <span className="text-emerald-100/60">— {w.translation}</span>
          </span>
        ))}
      </div>
    </article>
  )
}

export function StoryPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const today = useQuery({ queryKey: ['stories', 'today'], queryFn: storiesApi.today })
  const archive = useQuery({ queryKey: ['stories', 'list'], queryFn: storiesApi.list })
  const [genre, setGenre] = useState('')
  const [selected, setSelected] = useState<string>('')

  const gen = useMutation({
    mutationFn: () => storiesApi.generate(genre),
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

  const todayStr = new Date().toISOString().slice(0, 10)
  const past = useMemo(() => (archive.data ?? []).filter((s) => s.date !== todayStr), [archive.data, todayStr])
  useEffect(() => {
    if (!selected && past.length) setSelected(past[0].date)
  }, [past, selected])
  const selectedStory = past.find((s) => s.date === selected)

  const words = today.data?.words_today ?? []
  const story = today.data?.story

  return (
    <div className="space-y-8">
      <div className="animate-rise">
        <h1 className="display text-3xl font-extrabold md:text-4xl">
          {t('story.titleA')}<span className="text-lime-300">{t('story.titleB')}</span> 📖
        </h1>
        <p className="mt-2 text-emerald-100/70">{t('story.subtitle')}</p>
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
        {today.error && <p className="text-red-300">{errorMessage(today.error)}</p>}
      </section>

      {story && <StoryView story={story} />}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="display text-xl font-bold">{t('story.archive')}</h2>
          {past.length > 0 && (
            <input
              type="date"
              className="field max-w-xs"
              value={selected}
              min={past[past.length - 1].date}
              max={past[0].date}
              onChange={(e) => setSelected(e.target.value)}
            />
          )}
        </div>
        {past.length === 0 ? (
          <p className="text-emerald-100/60">{t('story.noArchive')}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {past.map((s) => (
                <button key={s.id} onClick={() => setSelected(s.date)} className={s.date === selected ? 'btn-primary' : 'btn-ghost'}>
                  {formatDate(s.date)}
                </button>
              ))}
            </div>
            {selectedStory ? <StoryView story={selectedStory} /> : <p className="text-emerald-100/60">{t('story.noStoryForDate')}</p>}
          </>
        )}
      </section>
    </div>
  )
}
