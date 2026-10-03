import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WordCard } from '../api/types'

export interface QuizResult {
  correct: boolean
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Builds 3 translation options: the right one + 2 translations of other random words.
function buildOptions(card: WordCard, pool: WordCard[]) {
  const seen = new Set([card.translation.trim().toLowerCase()])
  const wrong: string[] = []
  for (const w of shuffle(pool)) {
    const t = w.translation.trim()
    if (!t || w.id === card.id || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    wrong.push(t)
    if (wrong.length === 2) break
  }
  const lacking = wrong.length < 2
  while (wrong.length < 2) wrong.push('—')
  return {
    lacking,
    options: shuffle([
      { text: card.translation, correct: true },
      ...wrong.map((text) => ({ text, correct: false })),
    ]),
  }
}

function speak(card: WordCard) {
  if (!('speechSynthesis' in window)) return
  // "der Samstag / der Sonnabend" → pronounce only the first variant.
  const u = new SpeechSynthesisUtterance(card.word.split('/')[0].trim())
  u.lang = card.language === 'de' ? 'de-DE' : card.language
  window.speechSynthesis.speak(u)
}

interface Props {
  card: WordCard
  pool: WordCard[]
  position: number
  total: number
  saving: boolean
  error?: string | null
  onAnswer: (correct: boolean) => void // sent to the backend right after the choice
  onNext: () => void
}

// One multiple-choice question: German word -> pick the right Russian translation.
export function QuizQuestion({ card, pool, position, total, saving, error, onAnswer, onNext }: Props) {
  const { t } = useTranslation()
  const { options, lacking } = useMemo(() => buildOptions(card, pool), [card, pool])
  const [picked, setPicked] = useState<number | null>(null)
  const answered = picked !== null

  function choose(i: number) {
    if (answered) return
    setPicked(i)
    onAnswer(options[i].correct)
  }

  function style(i: number) {
    const base = 'w-full rounded-2xl border px-5 py-4 text-left text-lg font-semibold transition '
    if (!answered) return base + 'border-emerald-400/20 bg-emerald-900/40 text-white hover:border-lime-400/60 hover:bg-lime-400/10'
    if (options[i].correct) return base + 'border-lime-400 bg-lime-400/20 text-lime-100'
    if (i === picked) return base + 'border-red-400 bg-red-500/20 text-red-100'
    return base + 'border-emerald-400/10 bg-emerald-900/20 text-emerald-100/40'
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="flex items-center justify-between text-sm text-emerald-100/70">
        <span>{position} / {total}</span>
        <div className="mx-4 h-2 flex-1 overflow-hidden rounded-full bg-emerald-900/60">
          <div className="h-full bg-lime-400 transition-all" style={{ width: `${((position - (answered ? 0 : 1)) / total) * 100}%` }} />
        </div>
      </div>

      <div className="glass p-8 text-center">
        <p className="text-xs uppercase tracking-widest text-lime-300/80">{t('quiz.choose')}</p>
        <div className="display mt-3 text-4xl font-extrabold text-white">{card.word}</div>
        <button type="button" onClick={() => speak(card)} className="btn-ghost mt-2" title={t('quiz.listenTitle')}>{t('quiz.listen')}</button>

        {answered && (
          <div className="mt-4 space-y-1">
            <div className="font-mono text-sm text-lime-300/90">{card.transcription || '—'}</div>
            <div className="text-sm text-emerald-100/70">
              {options[picked!].correct ? t('quiz.correct') : t('quiz.correctAnswer', { answer: card.translation })}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {options.map((o, i) => (
          <button key={i} type="button" disabled={answered} onClick={() => choose(i)} className={style(i)}>
            {o.text}
          </button>
        ))}
      </div>

      {lacking && (
        <p className="text-center text-xs text-amber-200/80">{t('quiz.lacking')}</p>
      )}
      {error && <p className="text-center text-sm text-red-300">{t('quiz.saveFailed', { error })}</p>}

      {answered && (
        <button type="button" onClick={onNext} disabled={saving} className="btn-primary w-full text-lg">
          {position === total ? t('quiz.finish') : t('quiz.next')}
        </button>
      )}
    </div>
  )
}
