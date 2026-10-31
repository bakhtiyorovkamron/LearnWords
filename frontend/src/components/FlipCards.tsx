import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pencil, Volume2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CollectionCard } from '../api/types'
import { speak, useCanSpeak } from '../lib/speech'
import { ProgressDots } from './ProgressDots'
import { EditWordModal } from './EditWordModal'

// Paper-flashcard mode: one card at a time, click/Space to flip, ←/→ to move.
// Pure self-check — nothing is sent to the backend.
export function FlipCards({ cards, resetKey, onNearEnd, direction = 'de_ru' }: {
  cards: CollectionCard[]
  resetKey: string // changes when filters change → back to the first card
  onNearEnd?: () => void // load the next page before the user reaches the last card
  direction?: 'de_ru' | 'ru_de' // which side is shown first
}) {
  const { t } = useTranslation()
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [editing, setEditing] = useState(false)
  const current = cards[Math.min(index, cards.length - 1)]
  const canSpeak = useCanSpeak(current?.language ?? '')

  useEffect(() => {
    setIndex(0)
    setFlipped(false)
  }, [resetKey])

  // Switching direction turns the current card back to its (new) front side.
  useEffect(() => { setFlipped(false) }, [direction])

  useEffect(() => {
    if (onNearEnd && index >= cards.length - 3) onNearEnd()
  }, [index, cards.length, onNearEnd])

  // Buttons and keys share these two functions.
  const indexRef = useRef(index)
  indexRef.current = index
  const go = useCallback((delta: number) => {
    const next = Math.min(Math.max(indexRef.current + delta, 0), cards.length - 1)
    setFlipped(false)
    setIndex(next)
  }, [cards.length])
  const flip = useCallback(() => {
    setFlipped((f) => !f)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editing) return // typing in the edit form must not flip/scroll cards
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.target instanceof HTMLElement && e.target.getAttribute('role') === 'button') return // the box info dots
      if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        flip()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, flip, editing])

  if (!cards.length) return null
  const card = cards[Math.min(index, cards.length - 1)]
  const face = `absolute inset-0 flex flex-col items-center justify-center rounded-3xl border border-line bg-surface p-8 text-center shadow-[var(--shadow-card)] [backface-visibility:hidden]`
  const ruFirst = direction === 'ru_de'

  // German side: word + pronunciation + example. Russian side: translation only.
  const germanSide = (
    <>
      <div className={ruFirst ? 'font-serif text-4xl font-medium text-fg' : 'font-serif text-lg font-medium text-fg'} lang={card.language}>{card.word}</div>
      <div className="mt-1 font-mono text-sm text-muted">{card.transcription || '—'}</div>
      {!ruFirst && <div className="mt-4 text-3xl font-bold text-accent-text">{card.translation || '—'}</div>}
      {ruFirst && card.translation && <div className="mt-3 text-sm text-muted">{card.translation}</div>}
      {card.example_sentence && (
        <div className="mt-5 border-t border-divider pt-3 text-sm text-fg">
          <div className="font-serif italic" lang={card.language}>{card.example_sentence}</div>
          {card.example_translation && <div className="text-muted">{card.example_translation}</div>}
        </div>
      )}
    </>
  )

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="flex items-center justify-between text-sm text-muted">
        <span>{index + 1} / {cards.length}</span>
        <div className="mx-4 h-2 flex-1 overflow-hidden rounded-full bg-track">
          <div className="h-full bg-accent transition-all" style={{ width: `${((index + 1) / cards.length) * 100}%` }} />
        </div>
      </div>

      <div className="relative [perspective:1200px]">
        {/* Outside the flipping button, so clicking it never flips the card. */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setEditing(true) }}
          title={t('editWord.title')}
          aria-label={t('editWord.title')}
          className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-muted transition hover:bg-surface-2"
        >
          <Pencil size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={flip}
          aria-label={t('collection.flipHint')}
          className={`relative h-80 w-full transition-transform duration-500 [transform-style:preserve-3d] ${flipped ? '[transform:rotateY(180deg)]' : ''}`}
        >
          {/* Front: only the side being asked (German word or Russian translation) */}
          <div className={face}>
            <div className="absolute left-5 top-5"><ProgressDots boxLevel={card.box_level} isLearned={card.is_learned}
              schedule={{ nextReviewAt: card.next_review_at, reviewedToday: card.reviewed_today }} /></div>
            <div className={`text-4xl font-medium text-fg ${ruFirst ? 'font-bold' : 'font-serif'}`}>
              {ruFirst ? (card.translation || '—') : card.word}
            </div>
            <div className="absolute bottom-5 text-xs text-faint">{t('collection.flipHint')}</div>
          </div>
          {/* Back: the answer + pronunciation + example */}
          <div className={`${face} [transform:rotateY(180deg)]`}>
            {germanSide}
          </div>
        </button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => go(-1)} disabled={index === 0} className="btn-ghost disabled:opacity-30">
          <ChevronLeft size={18} aria-hidden="true" />{t('collection.prev')}
        </button>
        {/* In RU → DE, listening before flipping would give the answer away. */}
        {canSpeak && (!ruFirst || flipped) ? (
          <button type="button" onClick={() => speak(card.word, card.language)} className="btn-ghost" title={t('quiz.listenTitle')} aria-label={t('quiz.listenTitle')}><Volume2 size={18} aria-hidden="true" /></button>
        ) : <span />}
        <button type="button" onClick={() => go(1)} disabled={index >= cards.length - 1} className="btn-ghost disabled:opacity-30">
          {t('collection.next')}<ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <p className="text-center text-xs text-faint">{t('collection.keysHint')}</p>
      {editing && <EditWordModal card={card} onClose={() => setEditing(false)} />}
    </div>
  )
}
