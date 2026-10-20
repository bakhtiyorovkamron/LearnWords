import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  cardsApi, practiceApi, reviewApi, PRACTICE_MODES, SESSION_SIZES,
  type PracticeMode, type SessionSize,
} from '../api/endpoints'
import { errorMessage, isRateLimited, rateLimitMessage } from '../api/client'
import { emitHeroEvent } from '../lib/heroBus'
import { buildQueue, type Direction, type QuizItem } from '../lib/quiz'
import { useReviewSessionSize } from '../lib/reviewSessionSize'
import { QuizQuestion } from './QuizQuestion'
import { ReviewResult } from './ReviewResult'
import { DirectionToggle, useStoredChoice } from './DirectionToggle'
import { FolderSelect } from './Folders'
import { ReviewHero, TrainingHero } from './TrainingHero'
import { SoundToggle } from './SoundToggle'
import { ErrorState } from './ErrorState'
import { playAnswer, playSound } from '../lib/sounds'
import { setTrainingOpen } from '../lib/pageSounds'

const DIRECTIONS = ['de_ru', 'ru_de', 'mixed'] as const

/** Segmented "10 | 20 | 50 | Все" toggle — same visual style as DirectionToggle. */
function SessionSizeToggle({ value, onChange }: { value: SessionSize; onChange: (v: SessionSize) => void }) {
  const { t } = useTranslation()
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-emerald-400/15 bg-emerald-950/40 p-1"
      role="radiogroup" aria-label={t('review.sessionSize')}>
      {SESSION_SIZES.map((k) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)}
          className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
            value === k ? 'bg-lime-400 text-emerald-950 shadow' : 'text-emerald-100/70 hover:bg-emerald-400/10 hover:text-white'
          }`}>
          {k === 'all' ? t('review.sessionSizeAll') : k}
        </button>
      ))}
    </div>
  )
}

/** Segmented "Сложные | Случайные | Недавно добавленные" toggle for practice word selection. */
function PracticeModeToggle({ value, onChange }: { value: PracticeMode; onChange: (v: PracticeMode) => void }) {
  const { t } = useTranslation()
  const labels: Record<PracticeMode, string> = {
    hard: t('practice.hard'), random: t('practice.random'), recent: t('practice.recent'),
  }
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-emerald-400/15 bg-emerald-950/40 p-1"
      role="radiogroup" aria-label={t('practice.pick')}>
      {PRACTICE_MODES.map((k) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)}
          className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
            value === k ? 'bg-lime-400 text-emerald-950 shadow' : 'text-emerald-100/70 hover:bg-emerald-400/10 hover:text-white'
          }`}>
          {labels[k]}
        </button>
      ))}
    </div>
  )
}

// Daily training: Leitner "due" words, multiple-choice questions, progress saved after every
// answer — PLUS extra "practice" (hard/random/recent words from the whole collection) for when
// there's nothing due, or just to drill more. Practice answers go to a completely separate
// backend endpoint that never touches the Leitner schedule (see api/endpoints.ts practiceApi;
// the server enforces this, not this component).
export function ReviewSession() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  // '' = all words (default). Only narrows which words are asked; progress is per word.
  const [folder, setFolder] = useState(() => localStorage.getItem('review-folder') ?? '')
  const [sessionSize, setSessionSize] = useReviewSessionSize()
  const [practiceMode, setPracticeMode] = useStoredChoice<PracticeMode>('practice-mode', PRACTICE_MODES, 'hard')
  const due = useQuery({
    queryKey: ['review-due', folder, sessionSize],
    queryFn: () => reviewApi.due(folder, sessionSize),
    staleTime: 0, refetchOnWindowFocus: false,
  })
  // Whole dictionary: source of wrong answer options.
  const pool = useQuery({ queryKey: ['cards'], queryFn: cardsApi.list })

  const [mode, setMode] = useState<'review' | 'practice'>('review')
  const [practiceSetup, setPracticeSetup] = useState(false) // showing the word-selection screen
  const [practiceLoading, setPracticeLoading] = useState(false)
  const [deck, setDeck] = useState<QuizItem[] | null>(null) // null = not started
  const [index, setIndex] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [streak, setStreak] = useState(0) // consecutive correct answers; resets on a wrong one
  const [movedUp, setMovedUp] = useState(0) // words that went up a Leitner box in this session
  const [moreLoading, setMoreLoading] = useState(false)
  // Only changes how words are asked; progress (box_level) is shared by all directions.
  const [direction, setDirection] = useStoredChoice<Direction>('review-direction', DIRECTIONS, 'mixed')

  // The hero widget only ever hears about training through these events — it has no other
  // hook into this component, and this component has no idea the hero exists.
  const answer = useMutation({
    mutationFn: async ({ id, ok }: { id: string; ok: boolean; wasLearned: boolean; prevBox: number }) => {
      if (mode === 'practice') {
        await practiceApi.answer(id, ok)
        return null
      }
      return reviewApi.answer(id, ok)
    },
    onSuccess: (progress, variables) => {
      qc.invalidateQueries({ queryKey: ['stats'] })
      // null in practice mode — nothing was mutated, so there is nothing to detect here.
      if (progress && progress.box_level >= 4 && !variables.wasLearned) emitHeroEvent({ type: 'word_learned' })
      if (progress && progress.box_level > variables.prevBox) setMovedUp((n) => n + 1)
    },
  })

  // No page-turn rustle while questions are on screen.
  const inSession = !!deck && index < deck.length
  useEffect(() => {
    setTrainingOpen(inSession)
    return () => setTrainingOpen(false)
  }, [inSession])

  // Reports exactly once when the deck is exhausted, not on every re-render of the result screen.
  useEffect(() => {
    if (deck && index >= deck.length) {
      emitHeroEvent({ type: 'session_finished', correctCount: correct, total: deck.length })
      playSound('sessionDone')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, index])

  function start() {
    // Random suitable format per word (gap only with an example, typing only for box 3+).
    setMode('review')
    setDeck(buildQueue(due.data?.cards ?? [], direction))
    setIndex(0)
    setCorrect(0)
    setStreak(0)
    setMovedUp(0)
    answer.reset()
    emitHeroEvent({ type: 'session_started' })
  }

  // "Пройти ещё раз" / "Тренироваться ещё": always leads into the practice word-selection
  // screen — the words just reviewed are no longer due, so a literal restart has nothing to do.
  function restart() {
    setDeck(null)
    setPracticeSetup(true)
    qc.invalidateQueries({ queryKey: ['review-due'] })
  }

  async function startPractice() {
    setPracticeLoading(true)
    try {
      const cards = await practiceApi.words(practiceMode, sessionSize, folder)
      setMode('practice')
      setDeck(buildQueue(cards, direction))
      setIndex(0)
      setCorrect(0)
      setStreak(0)
      setMovedUp(0)
      setPracticeSetup(false)
      answer.reset()
      emitHeroEvent({ type: 'session_started' })
    } finally {
      setPracticeLoading(false)
    }
  }

  // "Ещё N": words just answered are no longer due (their next review is tomorrow at the
  // earliest), so a plain refetch with the same filters naturally returns the next portion.
  async function more() {
    setMoreLoading(true)
    try {
      const result = await due.refetch()
      setMode('review')
      setDeck(buildQueue(result.data?.cards ?? [], direction))
      setIndex(0)
      setCorrect(0)
      setStreak(0)
      setMovedUp(0)
      answer.reset()
      emitHeroEvent({ type: 'session_started' })
    } finally {
      setMoreLoading(false)
    }
  }

  if (due.isLoading || pool.isLoading) return <div className="h-64 animate-pulse rounded-3xl bg-emerald-800/30" />
  if (due.error) return <ErrorState error={due.error} />

  const chooseFolder = (v: string) => {
    setFolder(v)
    localStorage.setItem('review-folder', v)
  }
  const folderPicker = (
    <div className="mx-auto mt-5 flex w-full max-w-xs flex-col items-center gap-2">
      <span className="text-xs uppercase tracking-widest text-emerald-100/50">{t('folders.trainOn')}</span>
      {/* Fixed width (up to 20rem, full width on narrow screens) so the select doesn't jump with the folder name. */}
      <FolderSelect value={folder} onChange={chooseFolder} includeAll className="w-full" />
    </div>
  )
  const directionPicker = (
    <div className="mt-5 flex flex-col items-center gap-2">
      <span className="text-xs uppercase tracking-widest text-emerald-100/50">{t('direction.label')}</span>
      <DirectionToggle value={direction} onChange={setDirection} options={DIRECTIONS} />
    </div>
  )

  // Practice word-selection screen — reached from "Тренироваться ещё" (nothing due) or
  // "Пройти ещё раз" (after finishing a session); same folder/size/direction pickers as review.
  if (practiceSetup && !deck) {
    return (
      <div className="glass p-6 text-center sm:p-10">
        <div className="text-5xl">🧠</div>
        <p className="mt-3 text-lg font-semibold">{t('practice.pick')}</p>
        {folderPicker}
        <div className="mt-5 flex flex-col items-center gap-2">
          <PracticeModeToggle value={practiceMode} onChange={setPracticeMode} />
        </div>
        <div className="mt-5 flex flex-col items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-emerald-100/50">{t('review.sessionSize')}</span>
          <SessionSizeToggle value={sessionSize} onChange={setSessionSize} />
        </div>
        {directionPicker}
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" onClick={() => setPracticeSetup(false)} className="btn-ghost">
            {t('editWord.cancel')}
          </button>
          <button type="button" onClick={startPractice} disabled={practiceLoading} className="btn-primary text-lg disabled:opacity-60">
            {practiceLoading ? t('common.loading') : t('practice.start')}
          </button>
        </div>
      </div>
    )
  }

  // Start screen / nothing to review.
  if (!deck) {
    const total = due.data?.total ?? 0
    if (!total) {
      return (
        <div className="glass p-6 text-center sm:p-10">
          <ReviewHero fallback="🎉" />
          <p className="mt-3 text-lg font-semibold">{t('review.nothingToday')}</p>
          <p className="mt-1 text-sm text-emerald-100/70">{t('review.comeBack')}</p>
          {folderPicker}
          <button type="button" onClick={() => setPracticeSetup(true)} className="btn-primary mt-6 text-lg">
            {t('practice.start')}
          </button>
        </div>
      )
    }
    const sessionCount = due.data?.cards.length ?? 0
    return (
      <div className="glass p-6 text-center sm:p-10">
        <ReviewHero fallback="🃏" />
        <p className="mt-3 text-lg font-semibold">{t('review.dueCount', { count: total })}</p>
        <p className="mt-1 text-xs text-emerald-100/60">{t('review.sessionLine', { count: sessionCount })}</p>
        {folderPicker}
        <div className="mt-5 flex flex-col items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-emerald-100/50">{t('review.sessionSize')}</span>
          <SessionSizeToggle value={sessionSize} onChange={setSessionSize} />
        </div>
        {directionPicker}
        <button type="button" onClick={start} className="btn-primary mt-6 text-lg">{t('review.start')}</button>
      </div>
    )
  }

  if (index >= deck.length) {
    const remaining = mode === 'review' ? Math.max((due.data?.total ?? 0) - deck.length, 0) : 0
    const moreCount = remaining > 0 ? Number(sessionSize) || 0 : 0
    return (
      <ReviewResult correct={correct} total={deck.length} onRestart={restart} restartLabel={t('practice.again')}
        moreCount={moreCount} onMore={more} moreLoading={moreLoading}
        boxes={mode === 'practice' ? 'practice' : { movedUp }} />
    )
  }

  const item = deck[index]
  return (
    <div className="space-y-3">
      <div className="mx-auto flex max-w-xl justify-end"><SoundToggle /></div>
      {mode === 'practice' && (
        <p className="mx-auto max-w-xl text-center text-xs text-emerald-100/50">🔒 {t('practice.note')}</p>
      )}
      <QuizQuestion
        key={item.card.id}
        corner={<TrainingHero />}
        item={item}
        pool={pool.data ?? []}
        position={index + 1}
        total={deck.length}
        saving={answer.isPending}
        error={answer.error
          ? isRateLimited(answer.error)
            ? rateLimitMessage(answer.error)
            : t('quiz.saveFailed', { error: errorMessage(answer.error) })
          : null}
        onAnswer={(ok) => {
          playAnswer(ok) // every mode: review and practice
          if (ok) setCorrect((c) => c + 1)
          const newStreak = ok ? streak + 1 : 0
          setStreak(newStreak)
          emitHeroEvent({ type: 'answer', correct: ok, streak: newStreak })
          answer.mutate({ id: item.card.id, ok, wasLearned: item.card.box_level >= 4, prevBox: item.card.box_level }) // saved immediately, not at the end
        }}
        onNext={() => {
          answer.reset()
          setIndex((i) => i + 1)
        }}
      />
    </div>
  )
}
