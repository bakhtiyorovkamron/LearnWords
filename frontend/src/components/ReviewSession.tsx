import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { cardsApi, reviewApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { buildQueue, type Direction, type QuizItem } from '../lib/quiz'
import { QuizQuestion } from './QuizQuestion'
import { ReviewResult } from './ReviewResult'
import { DirectionToggle, useStoredChoice } from './DirectionToggle'

const DIRECTIONS = ['de_ru', 'ru_de', 'mixed'] as const

// Daily training: Leitner "due" words, multiple-choice questions, progress saved after every answer.
export function ReviewSession() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const due = useQuery({ queryKey: ['review-due'], queryFn: reviewApi.due, staleTime: 0, refetchOnWindowFocus: false })
  // Whole dictionary: source of wrong answer options.
  const pool = useQuery({ queryKey: ['cards'], queryFn: cardsApi.list })

  const [deck, setDeck] = useState<QuizItem[] | null>(null) // null = not started
  const [index, setIndex] = useState(0)
  const [correct, setCorrect] = useState(0)
  // Only changes how words are asked; progress (box_level) is shared by all directions.
  const [direction, setDirection] = useStoredChoice<Direction>('review-direction', DIRECTIONS, 'mixed')

  const answer = useMutation({
    mutationFn: ({ id, ok }: { id: string; ok: boolean }) => reviewApi.answer(id, ok),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stats'] }),
  })

  function start() {
    // Random suitable format per word (gap only with an example, typing only for box 3+).
    setDeck(buildQueue(due.data ?? [], direction))
    setIndex(0)
    setCorrect(0)
    answer.reset()
  }

  function restart() {
    setDeck(null)
    qc.invalidateQueries({ queryKey: ['review-due'] })
  }

  if (due.isLoading || pool.isLoading) return <div className="h-64 animate-pulse rounded-3xl bg-emerald-800/30" />
  if (due.error) return <p className="text-red-300">{errorMessage(due.error)}</p>

  // Start screen / nothing to review.
  if (!deck) {
    const count = due.data?.length ?? 0
    if (!count) {
      return (
        <div className="glass p-10 text-center">
          <div className="text-5xl">🎉</div>
          <p className="mt-3 text-lg font-semibold">{t('review.nothingToday')}</p>
          <p className="mt-1 text-sm text-emerald-100/70">{t('review.comeBack')}</p>
        </div>
      )
    }
    return (
      <div className="glass p-10 text-center">
        <div className="text-5xl">🃏</div>
        <p className="mt-3 text-lg font-semibold">{t('review.dueCount', { count })}</p>
        <div className="mt-5 flex flex-col items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-emerald-100/50">{t('direction.label')}</span>
          <DirectionToggle value={direction} onChange={setDirection} options={DIRECTIONS} />
        </div>
        <button type="button" onClick={start} className="btn-primary mt-6 text-lg">{t('review.start')}</button>
      </div>
    )
  }

  if (index >= deck.length) {
    return <ReviewResult correct={correct} total={deck.length} onRestart={restart} />
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
      error={answer.error ? errorMessage(answer.error) : null}
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
