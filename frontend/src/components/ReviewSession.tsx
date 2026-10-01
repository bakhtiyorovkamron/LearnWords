import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { reviewApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { DueCard } from '../api/types'

// Leitner review: show the German word, flip to see translation + pronunciation, then self-grade.
export function ReviewSession() {
  const qc = useQueryClient()
  const due = useQuery({ queryKey: ['review-due'], queryFn: reviewApi.due, staleTime: 0, refetchOnWindowFocus: false })
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [known, setKnown] = useState(0)

  const answer = useMutation({
    mutationFn: ({ id, correct }: { id: string; correct: boolean }) => reviewApi.answer(id, correct),
    onSuccess: (_p, v) => {
      if (v.correct) setKnown((k) => k + 1)
      setFlipped(false)
      setIndex((i) => i + 1)
    },
  })

  if (due.isLoading) return <div className="h-64 animate-pulse rounded-3xl bg-emerald-800/30" />
  if (due.error) return <p className="text-red-300">{errorMessage(due.error)}</p>

  const cards: DueCard[] = due.data ?? []
  const card = cards[index]

  if (!card) {
    return (
      <div className="glass p-10 text-center">
        <div className="text-5xl">🎉</div>
        <p className="mt-3 text-lg font-semibold">
          {cards.length ? `Готово! Вспомнили: ${known} из ${cards.length}` : 'На сегодня повторять нечего'}
        </p>
        <button className="btn-primary mt-6" onClick={() => {
          setIndex(0); setKnown(0); setFlipped(false)
          qc.invalidateQueries({ queryKey: ['review-due'] })
        }}>Обновить</button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center justify-between text-sm text-emerald-100/70">
        <span>{index + 1} / {cards.length}</span>
        <span>Коробка {card.box_level} из 5</span>
      </div>

      <button type="button" onClick={() => setFlipped((f) => !f)}
        className="glass flex min-h-[16rem] w-full flex-col items-center justify-center gap-3 p-8 text-center transition hover:border-lime-400/40">
        <div className="display text-4xl font-extrabold text-white">{card.word}</div>
        {flipped ? (
          <>
            <div className="text-2xl text-lime-200">{card.translation}</div>
            <div className="font-mono text-sm text-lime-300/80">{card.transcription}</div>
          </>
}
  )
    </div>
      )}
        </div>
          </button>
            ✓ Знал
            className="btn-primary">
          <button disabled={answer.isPending} onClick={() => answer.mutate({ id: card.id, correct: true })}
          </button>
            ✗ Не знал
            className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 font-semibold text-red-200 transition hover:bg-red-500/20 disabled:opacity-50">
          <button disabled={answer.isPending} onClick={() => answer.mutate({ id: card.id, correct: false })}
        <div className="grid grid-cols-2 gap-3">
      {flipped && (

      {answer.error && <p className="text-sm text-red-300">{errorMessage(answer.error)}</p>}

      </button>
        )}
          <div className="text-sm text-emerald-300/60">Вспомните перевод и нажмите, чтобы перевернуть</div>
        ) : (
