import { useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Camera, CircleCheck, Flame, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { statsApi } from '../api/endpoints'
import { FolderList } from '../components/FolderList'
import { useFolderList } from '../components/Folders'
import { Hero } from '../components/Hero'
import { Logo } from '../components/Logo'
import { useFeatures } from '../lib/features'
import { stageFromApi } from '../lib/heroStages'
import { useLearningLang } from '../lib/learningLang'
import { HOME_SESSION } from '../lib/reviewSessionSize'
import { handOffPhoto } from '../lib/photoHandoff'
import { useHero } from '../lib/useHero'

// How long one review takes, to say "about N minutes" under the due count.
const SECONDS_PER_WORD = 15

const action = 'glass flex h-16 items-center gap-3 px-4 text-left transition hover:bg-surface-2'

/** Home: what to do today (the review), quick actions, and the folders. */
export function ContextsPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const learning = useLearningLang()
  const { isOn, remaining } = useFeatures()
  const folders = useFolderList()
  const week = useQuery({ queryKey: ['stats', 'week'], queryFn: () => statsApi.get('week') })
  const { data: hero } = useHero()
  const fileInput = useRef<HTMLInputElement>(null)

  const all = folders.data?.all
  const words = all?.total ?? 0
  const due = all?.due_today ?? 0
  const streak = week.data?.totals.current_streak_days
  // Home always starts a short session; the rest of the due words wait for the next one.
  const inSession = Math.min(due, HOME_SESSION)
  const minutes = Math.max(1, Math.ceil((inSession * SECONDS_PER_WORD) / 60))
  const date = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long' }).format(new Date())
  const photoOn = isOn('photo_import')

  function startReview() {
    localStorage.setItem('review-folder', '') // the count is for all words
    navigate(`/cards?start=1&size=${HOME_SESSION}`) // a short session starts at once, no second start screen
  }

  function onPhoto(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = ''
    if (file) handOffPhoto(file)
    navigate('/contexts/new')
  }

  const stage = hero ? stageFromApi(hero.stage) : null
  const title = due > 0 ? t('home.titleDue') : words > 0 ? t('home.titleDone') : t('home.titleStart')

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="flex h-11 items-center justify-between">
        <Logo className="md:invisible" />
        {streak !== undefined && (
          <div className="flex h-[34px] items-center gap-1.5 rounded-full border border-line bg-surface px-3">
            <Flame size={16} aria-hidden="true" className={streak > 0 ? 'text-streak' : 'text-faint'} />
            <span className="text-sm font-semibold text-fg">{t('stats.days', { count: streak })}</span>
          </div>
        )}
      </div>

      <div>
        <p className="text-[15px] text-muted">{t('home.today', { date })}</p>
        <h1 className="mt-1 text-[26px] font-bold tracking-[-0.02em] text-fg">{title}</h1>
      </div>

      {!all ? (
        <div className="glass h-[200px] animate-pulse" aria-busy="true" />
      ) : (
        <section className="glass rounded-[20px] p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {due > 0 ? (
                <>
                  <p className="text-[40px] font-bold leading-none tracking-[-0.03em] tabular-nums text-fg">
                    {t('folders.wordsCount', { count: inSession })}
                  </p>
                  <p className="mt-2 text-[15px] text-muted">{t('home.sessionLine', { count: minutes })}</p>
                  {due > HOME_SESSION && <p className="mt-1 text-sm text-faint">{t('home.dueTotal', { count: due })}</p>}
                </>
              ) : words > 0 ? (
                <>
                  <CircleCheck size={32} aria-hidden="true" className="text-accent-text" />
                  <p className="mt-3 text-[15px] text-muted">{t('home.doneLine')}</p>
                </>
              ) : (
                <p className="text-[15px] text-muted">{t('home.empty', learning.vars)}</p>
              )}
            </div>
            {hero && stage !== null && (
              <Hero stage={stage} mood={hero.mood} size="small" bubble={false} figureClassName="w-[84px]"
                label={t(`hero.stages.${stage}`)} />
            )}
          </div>
          {due > 0 && (
            <>
              <button type="button" onClick={startReview} className="btn-primary mt-5 h-[52px] w-full rounded-[14px]">
                {t('review.start')}<ArrowRight size={18} aria-hidden="true" />
              </button>
              <Link to="/cards" className="mt-3 block text-center text-sm text-muted hover:text-fg"
                onClick={() => localStorage.setItem('review-folder', '')}>{t('home.customize')}</Link>
            </>
          )}
          {due === 0 && words > 0 && (
            <button type="button" onClick={() => navigate('/cards?practice=1')} className="btn-ghost mt-5 h-12 w-full">
              {t('practice.start')}
            </button>
          )}
        </section>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link to="/contexts/new" className={`${action} ${photoOn ? '' : 'col-span-2'}`}>
          <Plus size={20} aria-hidden="true" className="shrink-0 text-accent-text" />
          <span className="text-[15px] font-semibold leading-tight text-fg">{t('home.addWord')}</span>
        </Link>
        {photoOn && (
          <>
            <input ref={fileInput} type="file" accept="image/*" className="hidden" data-testid="home-photo-input"
              onChange={(e) => onPhoto(e.target.files?.[0])} />
            <button type="button" className={action}
              // No photos left today: nothing to read, the Add page explains it.
              onClick={() => (remaining('photo_import') === 0 ? navigate('/contexts/new') : fileInput.current?.click())}>
              <Camera size={20} aria-hidden="true" className="shrink-0 text-accent-text" />
              <span className="text-[15px] font-semibold leading-tight text-fg">{t('home.photo')}</span>
            </button>
          </>
        )}
      </div>

      {words > 0 && <FolderList />}
    </div>
  )
}
