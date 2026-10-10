import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { cardsApi, reviewApi, SESSION_SIZES, type SessionSize } from '../api/endpoints'
import { errorMessage, isRateLimited, rateLimitMessage } from '../api/client'
import { buildQueue, type Direction, type QuizItem } from '../lib/quiz'
import { useReviewSessionSize } from '../lib/reviewSessionSize'
import { QuizQuestion } from './QuizQuestion'
import { ReviewResult } from './ReviewResult'
import { DirectionToggle, useStoredChoice } from './DirectionToggle'
import { FolderSelect } from './Folders'

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

// Daily training: Leitner "due" words, multiple-choice questions, progress saved after every answer.
export function ReviewSession() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  // '' = all words (default). Only narrows which words are asked; progress is per word.
  const [folder, setFolder] = useState(() => localStorage.getItem('review-folder') ?? '')
  const [sessionSize, setSessionSize] = useReviewSessionSize()
  const due = useQuery({
    queryKey: ['review-due', folder, sessionSize],
    queryFn: () => reviewApi.due(folder, sessionSize),
    staleTime: 0, refetchOnWindowFocus: false,
  })
  // Whole dictionary: source of wrong answer options.
  const pool = useQuery({ queryKey: ['cards'], queryFn: cardsApi.list })

  const [deck, setDeck] = useState<QuizItem[] | null>(null) // null = not started
  const [index, setIndex] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [moreLoading, setMoreLoading] = useState(false)
  // Only changes how words are asked; progress (box_level) is shared by all directions.
  const [direction, setDirection] = useStoredChoice<Direction>('review-direction', DIRECTIONS, 'mixed')

  const answer = useMutation({
    mutationFn: ({ id, ok }: { id: string; ok: boolean }) => reviewApi.answer(id, ok),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stats'] }),
  })

  function start() {
    // Random suitable format per word (gap only with an example, typing only for box 3+).
    setDeck(buildQueue(due.data?.cards ?? [], direction))
    setIndex(0)
    setCorrect(0)
    answer.reset()
  }

  function restart() {
    setDeck(null)
    qc.invalidateQueries({ queryKey: ['review-due'] })
  }

  // "Ещё N": words just answered are no longer due (their next review is tomorrow at the
  // earliest), so a plain refetch with the same filters naturally returns the next portion.
  async function more() {
    setMoreLoading(true)
    try {
      const result = await due.refetch()
      setDeck(buildQueue(result.data?.cards ?? [], direction))
      setIndex(0)
      setCorrect(0)
      answer.reset()
    } finally {
      setMoreLoading(false)
    }
  }

  if (due.isLoading || pool.isLoading) return <div className="h-64 animate-pulse rounded-3xl bg-emerald-800/30" />
  if (due.error) return <p className="text-red-300">{errorMessage(due.error)}</p>

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

  // Start screen / nothing to review.
  if (!deck) {
    const total = due.data?.total ?? 0
    if (!total) {
      return (
        <div className="glass p-6 text-center sm:p-10">
          <div className="text-5xl">🎉</div>
          <p className="mt-3 text-lg font-semibold">{t('review.nothingToday')}</p>
          <p className="mt-1 text-sm text-emerald-100/70">{t('review.comeBack')}</p>
          {folderPicker}
        </div>
      )
    }
    const sessionCount = due.data?.cards.length ?? 0
    return (
      <div className="glass p-6 text-center sm:p-10">
        <div className="text-5xl">🃏</div>
        <p className="mt-3 text-lg font-semibold">{t('review.dueCount', { count: total })}</p>
        <p className="mt-1 text-xs text-emerald-100/60">{t('review.sessionLine', { count: sessionCount })}</p>
        {folderPicker}
        <div className="mt-5 flex flex-col items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-emerald-100/50">{t('review.sessionSize')}</span>
          <SessionSizeToggle value={sessionSize} onChange={setSessionSize} />
        </div>
        <div className="mt-5 flex flex-col items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-emerald-100/50">{t('direction.label')}</span>
          <DirectionToggle value={direction} onChange={setDirection} options={DIRECTIONS} />
        </div>
        <button type="button" onClick={start} className="btn-primary mt-6 text-lg">{t('review.start')}</button>
      </div>
    )
  }

  if (index >= deck.length) {
    const remaining = Math.max((due.data?.total ?? 0) - deck.length, 0)
    const moreCount = remaining > 0 ? Number(sessionSize) || 0 : 0
    return (
      <ReviewResult correct={correct} total={deck.length} onRestart={restart}
        moreCount={moreCount} onMore={more} moreLoading={moreLoading} />
    )
  }

  const item = deck[index]
  return (
    <QuizQuestion
      key={item.card.id}
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
        if (ok) setCorrect((c) => c + 1)
        answer.mutate({ id: item.card.id, ok }) // saved immediately, not at the end
      }}
      onNext={() => {
        answer.reset()
        setIndex((i) => i + 1)
      }}
    />
  )
}
