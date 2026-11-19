import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, CircleCheck } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { cardsApi, practiceApi, reviewApi } from '../api/endpoints'
import { errorMessage, isRateLimited, rateLimitMessage } from '../api/client'
import { emitHeroEvent } from '../lib/heroBus'
import type { DueCard } from '../api/types'
import { buildQueue, DIRECTIONS, type Direction, type QuizItem } from '../lib/quiz'
import { fetchSizeFor, parseUrlSize } from '../lib/reviewSessionSize'
import { QuizQuestion } from './QuizQuestion'
import { ReviewResult } from './ReviewResult'
import { useStoredChoice } from './DirectionToggle'
import { ReviewHero, TrainingHero } from './TrainingHero'
import { ErrorState } from './ErrorState'
import { useTodayGoal } from '../lib/todayGoal'
import { setTrainingOpen } from '../lib/trainingState'
import { batchMode, MIN_PRACTICE_WORDS, nextBatch, PRACTICE_BATCH, PREFETCH_AT, RECENT_WINDOW, replayOffset } from '../lib/practiceQueue'
import { useFolderList } from './Folders'

const DEFAULT_SIZE = 20
const ASKED_KEPT = 50 // the practice ids kept on the client (the exclude list is cut from it)

// The training: /train?size=N&folder=<id|none>. The URL is the only input — N words (1..50, 20 without
// a valid one), optionally from one folder. The due words are asked at once, progress is saved after
// every answer. The direction (DE → native, native → DE, mixed) is set in the goal sheet on Home.
//
// After the due words (or with nothing due) comes free practice: review → result → practice → result.
// It is endless, asks words from /practice/words in batches and its answers never move a Leitner box
// (POST /practice/:id/answer). /train?mode=practice[&folder=] opens it directly.
export function ReviewSession() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const size = parseUrlSize(params.get('size')) ?? DEFAULT_SIZE
  const folder = params.get('folder') ?? '' // '' = all words, 'none' = words without a folder
  const practiceUrl = params.get('mode') === 'practice'
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
  // Words in the collection / the folder: practice needs at least MIN_PRACTICE_WORDS.
  const folders = useFolderList()
  const wordCount = folders.data
    ? folder === '' ? folders.data.all.total
      : folder === 'none' ? folders.data.all.total - folders.data.folders.reduce((n, f) => n + f.total, 0)
        : folders.data.folders.find((f) => f.id === folder)?.total ?? 0
    : folders.isError ? pool.data?.length ?? 0 : undefined
  const canPractice = wordCount !== undefined && wordCount >= MIN_PRACTICE_WORDS

  const [deck, setDeck] = useState<QuizItem[] | null>(null) // null = not started
  const [index, setIndex] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [streak, setStreak] = useState(0) // consecutive correct answers; resets on a wrong one
  // For the result screen — all reset when a deck starts.
  const [answeredCount, setAnsweredCount] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [mistakes, setMistakes] = useState<DueCard[]>([])
  const [startedAt, setStartedAt] = useState(() => Date.now())
  // Today's goal as it was when the deck started: the numbers must not jump when the stats refetch.
  const today = useTodayGoal()
  const [goalAtStart, setGoalAtStart] = useState({ reviewed: 0, target: 1 })
  const [moreLoading, setMoreLoading] = useState(false)
  // Only changes how words are asked; progress (box_level) is shared by all directions.
  const [direction] = useStoredChoice<Direction>('review-direction', DIRECTIONS, 'mixed')

  // Free practice. The queue lives in refs (batches arrive asynchronously); `current` is the question
  // on screen. The counters above (correct, streak, answeredCount, …) are reset for it.
  const [practicing, setPracticing] = useState(false)
  const [practiceEnded, setPracticeEnded] = useState(false)
  const [current, setCurrent] = useState<{ item: QuizItem; n: number } | null>(null)
  const [practiceGoal, setPracticeGoal] = useState({ done: 0, target: 1 })
  const [batchError, setBatchError] = useState<unknown>(null)
  const queue = useRef<QuizItem[]>([])
  const asked = useRef<string[]>([]) // practice word ids, oldest first, the last ASKED_KEPT
  const replays = useRef<{ item: QuizItem; at: number }[]>([]) // at: the question number it comes back as
  const replayed = useRef(new WeakSet<QuizItem>()) // a replay answered wrong does not come back again
  const batches = useRef(0)
  const fetching = useRef<Promise<boolean> | null>(null)
  const practiceRun = useRef(0) // a batch of an earlier run is dropped

  // The hero widget only ever hears about training through these events — it has no other
  // hook into this component, and this component has no idea the hero exists.
  const answer = useMutation({
    mutationFn: ({ id, ok }: { id: string; ok: boolean; wasLearned: boolean }) => reviewApi.answer(id, ok),
    onSuccess: (progress, variables) => {
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['folders'] }) // Home shows a fresh "due today" count
      if (progress.box_level >= 4 && !variables.wasLearned) emitHeroEvent({ type: 'word_learned' })
    },
  })

  // Tell the rest of the UI that a session is on screen — the questions and the result — so the shell
  // (header, bottom menu) stays out of the way and the feedback window waits.
  const practiceAnswer = useMutation({
    mutationFn: ({ id, ok }: { id: string; ok: boolean }) => practiceApi.answer(id, ok),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stats'] }), // the activity streak
  })

  const inSession = !!deck || practicing
  useEffect(() => {
    setTrainingOpen(inSession)
    return () => setTrainingOpen(false)
  }, [inSession])

  // Starts once, as soon as fresh due words are in (not a stale cache) and today's numbers are known
  // (they are snapshotted). Nothing due: the screen below.
  const started = useRef(false)
  useEffect(() => {
    if (started.current || !today.settled) return
    if (practiceUrl) {
      if (wordCount === undefined || pool.isLoading) return
      started.current = true
      if (canPractice) startPractice({ done: today.reviewed, target: Math.max(today.target, 1) })
      return
    }
    if (due.isFetching || !due.data) return
    started.current = true
    if (due.data.total > 0) start(due.data.cards)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due.isFetching, due.data, today.settled, wordCount, pool.isLoading])

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
    setAnsweredCount(0)
    setBestStreak(0)
    setMistakes([])
    setStartedAt(Date.now())
    setGoalAtStart({ reviewed: today.reviewed, target: Math.max(today.target, 1) })
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

  // --- free practice ---------------------------------------------------------------------------

  // goal: today's goal as it stands now — practice does not add to it.
  function startPractice(goal: { done: number; target: number }) {
    practiceRun.current++
    queue.current = []
    replays.current = []
    batches.current = 0
    fetching.current = null
    // The due words just answered count as asked: the first batch does not bring them straight back.
    asked.current = deck ? deck.slice(0, index).map((i) => i.card.id).slice(-RECENT_WINDOW) : []
    setPracticing(true)
    setPracticeEnded(false)
    setCurrent(null)
    setBatchError(null)
    setCorrect(0)
    setStreak(0)
    setAnsweredCount(0)
    setBestStreak(0)
    setMistakes([])
    setStartedAt(Date.now())
    setPracticeGoal(goal)
    practiceAnswer.reset()
    void fetchBatch().then((ok) => { if (ok) showNext(0) })
  }

  // Adds the next batch to the queue (one request at a time). The words asked recently and the ones
  // already queued are excluded on the server; a small collection may have nothing else, then the
  // batch is asked again without the exclusion and nextBatch allows repeats.
  function fetchBatch(): Promise<boolean> {
    if (fetching.current) return fetching.current
    const run = practiceRun.current
    const mode = batchMode(batches.current++)
    const recent = asked.current.slice(-RECENT_WINDOW)
    const queued = [...queue.current, ...replays.current.map((r) => r.item)].map((i) => i.card.id)
    const exclude = [...new Set([...recent, ...queued])]
    const p = (async () => {
      try {
        let cards = await practiceApi.words(mode, folder, PRACTICE_BATCH, exclude)
        if (!cards.length && exclude.length) cards = await practiceApi.words(mode, folder, PRACTICE_BATCH)
        if (run !== practiceRun.current) return false
        const last = queue.current.at(-1)?.card.id ?? asked.current.at(-1) ?? null
        queue.current.push(...buildQueue(nextBatch(cards, recent, queue.current.map((i) => i.card.id), last), direction))
        setBatchError(null)
        return true
      } catch (e) {
        if (run === practiceRun.current) setBatchError(e)
        return false
      } finally {
        if (run === practiceRun.current) fetching.current = null
      }
    })()
    fetching.current = p
    return p
  }

  // Puts the next question on screen: a wrong answer due to come back, else the next queued word
  // that is not the one just asked. Asks for the next batch while PREFETCH_AT questions are left.
  function showNext(answered: number) {
    const n = answered + 1 // the number of the question about to be shown
    const prev = asked.current.at(-1)
    let next: QuizItem | undefined
    const r = replays.current.findIndex((x) => x.at <= n && x.item.card.id !== prev)
    if (r >= 0) next = replays.current.splice(r, 1)[0].item
    else {
      const q = queue.current.findIndex((i) => i.card.id !== prev)
      if (q >= 0) next = queue.current.splice(q, 1)[0]
    }
    // Counted as asked before the next batch is requested, so that batch leaves it out too.
    if (next) asked.current = [...asked.current, next.card.id].slice(-ASKED_KEPT)
    if (queue.current.length <= PREFETCH_AT) {
      const run = practiceRun.current
      const p = fetchBatch()
      // Nothing to show yet: wait for the batch (only on a slow network or a tiny collection).
      if (!next) {
        void p.then((ok) => {
          if (run !== practiceRun.current || !ok) return // an error stays on screen
          if (queue.current.length || replays.current.length) showNext(answered)
          else endPractice() // nothing that can be asked
        })
      }
    }
    setCurrent(next ? { item: next, n } : null)
  }

  function endPractice() {
    practiceRun.current++
    fetching.current = null
    setPracticeEnded(true)
  }

  const minutes = Math.max(1, Math.round((Date.now() - startedAt) / 60000))

  if (practicing) {
    if (practiceEnded) {
      return (
        <ReviewResult correct={correct} total={answeredCount} mistakes={mistakes} bestStreak={bestStreak}
          minutes={minutes} goal={practiceGoal} practice />
      )
    }
    if (!current) {
      if (batchError) return <ErrorState error={batchError} />
      return <div className="h-64 animate-pulse rounded-2xl bg-surface-2" />
    }
    const { item, n } = current
    return (
      <QuizQuestion
        key={`${n}-${item.card.id}`}
        corner={<TrainingHero />}
        item={item}
        pool={pool.data ?? []}
        position={n}
        total={n}
        practice={{ answered: answeredCount, correct }}
        onExit={endPractice}
        saving={practiceAnswer.isPending}
        error={practiceAnswer.error
          ? isRateLimited(practiceAnswer.error)
            ? rateLimitMessage(practiceAnswer.error)
            : t('quiz.saveFailed', { error: errorMessage(practiceAnswer.error) })
          : null}
        onAnswer={(ok) => {
          if (ok) setCorrect((c) => c + 1)
          const newStreak = ok ? streak + 1 : 0
          setStreak(newStreak)
          setBestStreak((b) => Math.max(b, newStreak))
          setAnsweredCount((c) => c + 1)
          if (!ok) {
            setMistakes((m) => (m.some((c) => c.id === item.card.id) ? m : [...m, item.card]))
            // Comes back a few questions later, once — in a fresh format.
            if (!replayed.current.has(item)) {
              const again = buildQueue([item.card], direction)[0] ?? item
              replayed.current.add(again)
              replays.current.push({ item: again, at: n + replayOffset() })
            }
          }
          emitHeroEvent({ type: 'answer', correct: ok, streak: newStreak })
          practiceAnswer.mutate({ id: item.card.id, ok }) // never moves a box
        }}
        onNext={() => {
          practiceAnswer.reset()
          showNext(n)
        }}
      />
    )
  }

  // --- review of the due words -------------------------------------------------------------------

  if (due.isLoading || pool.isLoading) return <div className="h-64 animate-pulse rounded-2xl bg-surface-2" />
  if (due.error && !practiceUrl) return <ErrorState error={due.error} />

  if (!deck) {
    if (practiceUrl ? wordCount === undefined || !today.settled : (due.data?.total ?? 0) > 0) {
      return <div className="h-64 animate-pulse rounded-2xl bg-surface-2" /> // starting
    }
    return (
      <div className="glass mx-auto max-w-xl p-6 text-center sm:p-10">
        <ReviewHero icon={CircleCheck} />
        <p className="mt-3 text-lg font-semibold text-fg">{folder ? t('review.nothingInFolder') : t('review.nothingToday')}</p>
        {canPractice ? (
          <>
            <button type="button" onClick={() => startPractice({ done: today.reviewed, target: Math.max(today.target, 1) })}
              className="btn-primary mt-6 h-[52px] w-full rounded-[14px]">
              {t('practice.start')}<ArrowRight size={18} aria-hidden="true" />
            </button>
            <p className="mt-3 text-[13px] text-muted">{t('review.comeBack')}</p>
            <Link to="/" className="btn-ghost mt-3 h-[52px] w-full rounded-[14px]">{t('result.home')}</Link>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">{t('review.comeBack')}</p>
            {wordCount !== undefined && <p className="mt-2 text-xs text-faint">{t('quiz.lacking')}</p>}
            <Link to="/" className="btn-primary mt-6">{t('result.home')}</Link>
          </>
        )}
      </div>
    )
  }

  if (index >= deck.length) {
    const moreCount = Math.min(size, Math.max((due.data?.total ?? 0) - deck.length, 0))
    const goal = { done: goalAtStart.reviewed + answeredCount, target: goalAtStart.target }
    return (
      <ReviewResult correct={correct} total={deck.length} mistakes={mistakes} bestStreak={bestStreak}
        minutes={minutes} goal={goal}
        moreCount={moreCount} onMore={more} moreLoading={moreLoading}
        onPractice={canPractice ? () => startPractice(goal) : undefined} />
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
        setBestStreak((b) => Math.max(b, newStreak))
        setAnsweredCount((n) => n + 1)
        if (!ok) setMistakes((m) => [...m, item.card])
        emitHeroEvent({ type: 'answer', correct: ok, streak: newStreak })
        answer.mutate({ id: item.card.id, ok, wasLearned: item.card.box_level >= 4 }) // saved immediately, not at the end
      }}
      onNext={() => {
        answer.reset()
        setIndex((i) => i + 1)
      }}
    />
  )
}
