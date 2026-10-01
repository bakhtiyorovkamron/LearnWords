import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cardsApi, reviewApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { DueCard } from '../api/types'
import { QuizQuestion } from './QuizQuestion'
import { ReviewResult } from './ReviewResult'

// Daily training: Leitner "due" words, multiple-choice questions, progress saved after every answer.
export function ReviewSession() {
  const qc = useQueryClient()
  const due = useQuery({ queryKey: ['review-due'], queryFn: reviewApi.due, staleTime: 0, refetchOnWindowFocus: false })
  // Whole dictionary: source of wrong answer options.
  const pool = useQuery({ queryKey: ['cards'], queryFn: cardsApi.list })

  const [deck, setDeck] = useState<DueCard[] | null>(null) // null = not started
  const [index, setIndex] = useState(0)
  const [correct, setCorrect] = useState(0)

  const answer = useMutation({
    mutationFn: ({ id, ok }: { id: string; ok: boolean }) => reviewApi.answer(id, ok),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stats'] }),
  })

  function start() {
    setDeck(due.data ?? [])
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
          <p className="mt-3 text-lg font-semibold">На сегодня слов для повторения нет 🎉</p>
          <p className="mt-1 text-sm text-emerald-100/70">Загляните завтра или добавьте новые слова.</p>
        </div>
      )
    }
    return (
      <div className="glass p-10 text-center">
        <div className="text-5xl">🃏</div>
        <p className="mt-3 text-lg font-semibold">Слов для повторения сегодня: {count}</p>
        <button type="button" onClick={start} className="btn-primary mt-6 text-lg">Начать тренировку</button>
      </div>
    )
  }

  if (index >= deck.length) {
    return <ReviewResult correct={correct} total={deck.length} onRestart={restart} />
  }

  const card = deck[index]
  return (
    <QuizQuestion
      key={card.id}
      card={card}
      pool={pool.data ?? []}
      position={index + 1}
      total={deck.length}
      saving={answer.isPending}
      error={answer.error ? errorMessage(answer.error) : null}
      onAnswer={(ok) => {
        if (ok) setCorrect((c) => c + 1)
        answer.mutate({ id: card.id, ok }) // saved immediately, not at the end
      }}
      onNext={() => {
        answer.reset()
        setIndex((i) => i + 1)
      }}
    />
  )
}
