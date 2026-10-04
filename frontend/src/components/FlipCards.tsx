import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CollectionCard } from '../api/types'
import { knowledgeStatus, ProgressDots, STATUS_STYLE } from './ProgressDots'

function speak(card: CollectionCard) {
  if (!('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(card.word.split('/')[0].trim())
  u.lang = card.language === 'de' ? 'de-DE' : card.language
  window.speechSynthesis.speak(u)
}

// Paper-flashcard mode: one card at a time, click/Space to flip, ←/→ to move.
// Pure self-check — nothing is sent to the backend.
export function FlipCards({ cards, resetKey, onNearEnd }: {
  cards: CollectionCard[]
  resetKey: string // changes when filters change → back to the first card
  onNearEnd?: () => void // load the next page before the user reaches the last card
}) {
  const { t } = useTranslation()
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  useEffect(() => {
    setIndex(0)
    setFlipped(false)
  }, [resetKey])

  useEffect(() => {
    if (onNearEnd && index >= cards.length - 3) onNearEnd()
  }, [index, cards.length, onNearEnd])

  const go = useCallback((delta: number) => {
    setFlipped(false)
    setIndex((i) => Math.min(Math.max(i + delta, 0), cards.length - 1))
  }, [cards.length])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        setFlipped((f) => !f)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  if (!cards.length) return null
  const card = cards[Math.min(index, cards.length - 1)]
  const tone = STATUS_STYLE[knowledgeStatus(card.box_level, card.is_learned)].card
  const face = `absolute inset-0 flex flex-col items-center justify-center rounded-3xl border bg-gradient-to-br ${tone} p-8 text-center shadow-2xl [backface-visibility:hidden]`

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="flex items-center justify-between text-sm text-emerald-100/70">
        <span>{index + 1} / {cards.length}</span>
        <div className="mx-4 h-2 flex-1 overflow-hidden rounded-full bg-emerald-900/60">
          <div className="h-full bg-lime-400 transition-all" style={{ width: `${((index + 1) / cards.length) * 100}%` }} />
        </div>
      </div>

      <div className="[perspective:1200px]">
        <button
          type="button"
          onClick={() => setFlipped((f) => !f)}
          aria-label={t('collection.flipHint')}
          className={`relative h-80 w-full transition-transform duration-500 [transform-style:preserve-3d] ${flipped ? '[transform:rotateY(180deg)]' : ''}`}
        >
          {/* Front: German only */}
          <div className={face}>
            <div className="absolute left-5 top-5"><ProgressDots boxLevel={card.box_level} isLearned={card.is_learned} /></div>
            <div className="display text-4xl font-extrabold text-white">{card.word}</div>
            <div className="absolute bottom-5 text-xs text-emerald-100/50">{t('collection.flipHint')}</div>
          </div>
          {/* Back: translation, pronunciation, example */}
          <div className={`${face} [transform:rotateY(180deg)]`}>
            <div className="text-lg font-bold text-white">{card.word}</div>
            <div className="mt-1 font-mono text-sm text-lime-300/90">{card.transcription || '—'}</div>
            <div className="display mt-4 text-3xl font-extrabold text-lime-200">{card.translation || '—'}</div>
            {card.example_sentence && (
              <div className="mt-5 border-t border-white/10 pt-3 text-sm text-emerald-100/80">
                <div className="italic">{card.example_sentence}</div>
                {card.example_translation && <div className="text-emerald-100/50">{card.example_translation}</div>}
              </div>
            )}
          </div>
        </button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => go(-1)} disabled={index === 0} className="btn-ghost disabled:opacity-30">
          ← {t('collection.prev')}
        </button>
        <button type="button" onClick={() => speak(card)} className="btn-ghost" title={t('quiz.listenTitle')}>▶</button>
        <button type="button" onClick={() => go(1)} disabled={index >= cards.length - 1} className="btn-ghost disabled:opacity-30">
          {t('collection.next')} →
        </button>
      </div>
      <p className="text-center text-xs text-emerald-100/40">{t('collection.keysHint')}</p>
    </div>
  )
}
