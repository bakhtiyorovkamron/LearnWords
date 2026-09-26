import { useMutation, useQueryClient } from '@tanstack/react-query'
import { cardsApi } from '../api/endpoints'
import type { WordCard } from '../api/types'

// Mock storage returns mock:// URLs which browsers can't play — fall back to Web Speech API.
function play(card: WordCard) {
  if (card.audio_url && /^https?:/.test(card.audio_url)) {
    new Audio(card.audio_url).play().catch(() => speak(card))
  } else {
    speak(card)
  }
}

function speak(card: WordCard) {
  if (!('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(card.word)
  u.lang = card.language === 'de' ? 'de-DE' : card.language
  window.speechSynthesis.speak(u)
}

export function WordCardView({ card, index = 0 }: { card: WordCard; index?: number }) {
  const qc = useQueryClient()
  const regen = useMutation({
    mutationFn: () => cardsApi.regenerateAudio(card.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cards'] }),
  })
  const remove = useMutation({
    mutationFn: () => cardsApi.remove(card.id),
    onSuccess: () => {
      // Drop the card from every cached list immediately.
      qc.setQueriesData<WordCard[]>({ queryKey: ['cards'] }, (old) => old?.filter((c) => c.id !== card.id))
      qc.setQueriesData<WordCard[]>({ queryKey: ['context-words'] }, (old) => old?.filter((c) => c.id !== card.id))
    },
  })

  function onDelete() {
    if (window.confirm(`Удалить слово «${card.word}»?`)) remove.mutate()
  }

  return (
    <div
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
      className={`animate-rise group relative overflow-hidden rounded-2xl border border-emerald-400/15 bg-gradient-to-br from-emerald-800/60 to-emerald-900/40 p-4 transition hover:-translate-y-1 hover:border-lime-400/40 hover:shadow-xl hover:shadow-emerald-500/20 ${remove.isPending ? 'pointer-events-none opacity-40' : ''}`}
    >
      <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-lime-400/10 blur-2xl transition group-hover:bg-lime-400/25" />
      <div className="relative flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-bold text-white">{card.word}</div>
          <div className="font-mono text-xs text-lime-300/80">{card.transcription}</div>
          <div className="mt-1 text-sm text-emerald-100/80">{card.translation}</div>
        </div>
        <button
          onClick={() => play(card)}
          title="Прослушать"
          className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-lime-300 to-emerald-500 text-emerald-950 shadow-lg shadow-emerald-500/40 transition hover:scale-110 active:scale-95"
        >
          ▶
        </button>
        <button
          onClick={() => regen.mutate()}
          disabled={regen.isPending}
          title="Перегенерировать аудио"
          className={`grid h-9 w-9 place-items-center rounded-full text-emerald-300/60 transition hover:bg-emerald-400/10 hover:text-lime-300 disabled:opacity-50 ${regen.isPending ? 'animate-spin' : ''}`}
        >
          ↻
        </button>
        <button
          onClick={onDelete}
          disabled={remove.isPending}
          title="Удалить слово"
          className="grid h-9 w-9 place-items-center rounded-full text-emerald-300/60 transition hover:bg-red-500/15 hover:text-red-300 disabled:opacity-50"
        >
          🗑
        </button>
      </div>
      {remove.error && <p className="relative mt-2 text-xs text-red-300">Не удалось удалить</p>}
    </div>
  )
}
