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

export function WordCardView({ card }: { card: WordCard }) {
  const qc = useQueryClient()
  const regen = useMutation({
    mutationFn: () => cardsApi.regenerateAudio(card.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cards'] }),
  })

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-white p-3 shadow-sm">
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{card.word}</div>
        <div className="text-xs text-slate-400">{card.transcription}</div>
        <div className="text-sm text-slate-600">{card.translation}</div>
      </div>
      <button
        onClick={() => play(card)}
        title="Прослушать"
        className="rounded-full bg-indigo-50 p-2 text-indigo-600 hover:bg-indigo-100"
      >
        ▶
      </button>
      <button
        onClick={() => regen.mutate()}
        disabled={regen.isPending}
        title="Перегенерировать аудио"
        className="rounded-full p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
      >
        ↻
      </button>
    </div>
  )
}
