import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CircleCheck } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { cardsApi, reviewApi } from '../api/endpoints'
import { errorMessage, isRateLimited, rateLimitMessage } from '../api/client'
import { emitHeroEvent } from '../lib/heroBus'
import { buildQueue, DIRECTIONS, type Direction, type QuizItem } from '../lib/quiz'
import { fetchSizeFor, parseUrlSize } from '../lib/reviewSessionSize'
import { QuizQuestion } from './QuizQuestion'
import { ReviewResult } from './ReviewResult'
import { useStoredChoice } from './DirectionToggle'
import { ReviewHero, TrainingHero } from './TrainingHero'
import { ErrorState } from './ErrorState'
import { setTrainingOpen } from '../lib/trainingState'

const DEFAULT_SIZE = 20

// The training: /train?size=N&folder=<id|none>. The URL is the only input — N words (1..50, 20 without
// a valid one), optionally from one folder. The due words are asked at once, progress is saved after
// every answer. The direction (DE → native, native → DE, mixed) is set in the goal sheet on Home.
export function ReviewSession() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const size = parseUrlSize(params.get('size')) ?? DEFAULT_SIZE
  const folder = params.get('folder') ?? '' // '' = all words, 'none' = words without a folder
  const take = <T,>(cards: T[]) => cards.slice(0, size)

  // The server is asked for the smallest size that holds N words; the first N cards are used, in
  // the server's priority order.
  const due = useQuery({
    queryKey: ['review-due', folder, fetchSizeFor(size)],
    queryFn: () => reviewApi.due(folder, fetchSizeFor(size)),
    staleTime: 0, refetchOnWindowFocus: false,
  })
  // Whole dictionary: source of wrong answer options.
  const pool = useQuery({ queryKey: ['cards'], queryFn: cardsApi.list })

  const [deck, setDeck] = useState<QuizItem[] | null>(null) // null = not started
  const [index, setIndex] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [streak, setStreak] = useState(0) // consecutive correct answers; resets on a wrong one
  const [movedUp, setMovedUp] = useState(0) // words that went up a Leitner box in this session
  const [moreLoading, setMoreLoading] = useState(false)
  // Only changes how words are asked; progress (box_level) is shared by all directions.
  const [direction] = useStoredChoice<Direction>('review-direction', DIRECTIONS, 'mixed')

  // The hero widget only ever hears about training through these events — it has no other
  // hook into this component, and this component has no idea the hero exists.
  const answer = useMutation({
    mutationFn: ({ id, ok }: { id: string; ok: boolean; wasLearned: boolean; prevBox: number }) => reviewApi.answer(id, ok),
    onSuccess: (progress, variables) => {
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['folders'] }) // Home shows a fresh "due today" count
      if (progress.box_level >= 4 && !variables.wasLearned) emitHeroEvent({ type: 'word_learned' })
      if (progress.box_level > variables.prevBox) setMovedUp((n) => n + 1)
    },
  })

  // Tell the rest of the UI that questions are on screen (e.g. the feedback window waits).
  const inSession = !!deck && index < deck.length
  useEffect(() => {
    setTrainingOpen(inSession)
    return () => setTrainingOpen(false)
  }, [inSession])

  // Starts once, as soon as fresh due words are in (not a stale cache). Nothing due: the screen below.
  const started = useRef(false)
  useEffect(() => {
    if (started.current || due.isFetching || !due.data) return
    started.current = true
    if (due.data.total > 0) start(due.data.cards)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due.isFetching, due.data])

  // Reports exactly once when the deck is exhausted, not on every re-render of the result screen.
  useEffect(() => {
    if (deck && index >= deck.length) {
      emitHeroEvent({ type: 'session_finished', correctCount: correct, total: deck.length })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, index])

  function start(cards: Parameters<typeof buildQueue>[0]) {
    // Random suitable format per word (gap only with an example, typing only for box 3+).
    setDeck(buildQueue(take(cards), direction))
    setIndex(0)
    setCorrect(0)
    setStreak(0)
    setMovedUp(0)
    answer.reset()
    emitHeroEvent({ type: 'session_started' })
  }

  // "More N": words just answered are no longer due (their next review is tomorrow at the
  // earliest), so a plain refetch with the same filters naturally returns the next portion.
  async function more() {
    setMoreLoading(true)
    try {
      const result = await due.refetch()
      start(result.data?.cards ?? [])
    } finally {
      setMoreLoading(false)
    }
  }

  if (due.isLoading || pool.isLoading) return <div className="h-64 animate-pulse rounded-2xl bg-surface-2" />
  if (due.error) return <ErrorState error={due.error} />

  if (!deck) {
    if ((due.data?.total ?? 0) > 0) return <div className="h-64 animate-pulse rounded-2xl bg-surface-2" /> // starting
    return (
      <div className="glass mx-auto max-w-xl p-6 text-center sm:p-10">
        <ReviewHero icon={CircleCheck} />
        <p className="mt-3 text-lg font-semibold text-fg">{folder ? t('review.nothingInFolder') : t('review.nothingToday')}</p>
        <p className="mt-1 text-sm text-muted">{t('review.comeBack')}</p>
        <Link to="/" className="btn-primary mt-6">{t('result.home')}</Link>
      </div>
    )
  }

  if (index >= deck.length) {
    const moreCount = Math.min(size, Math.max((due.data?.total ?? 0) - deck.length, 0))
    return (
      <ReviewResult correct={correct} total={deck.length} moreCount={moreCount} onMore={more} moreLoading={moreLoading}
        movedUp={movedUp} />
    )
  }

  const item = deck[index]
  return (
    <QuizQuestion
      key={item.card.id}
      corner={<TrainingHero />}
      item={item}
      pool={pool.data ?? []}
      position={index + 1}
      total={deck.length}
      saving={answer.isPending}
      progress={answer.data ?? null}
      error={answer.error
        ? isRateLimited(answer.error)
          ? rateLimitMessage(answer.error)
          : t('quiz.saveFailed', { error: errorMessage(answer.error) })
        : null}
      onAnswer={(ok) => {
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
  )
}
