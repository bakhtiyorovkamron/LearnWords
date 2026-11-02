import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, RotateCw, Volume2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CollectionCard } from '../api/types'
import { ARTICLE_COLOR, splitArticle } from '../lib/article'
import { useLearningLang } from '../lib/learningLang'
import { speak, useCanSpeak } from '../lib/speech'
import { GapSentence } from './GapSentence'

const GAP = 14 // px between the cards
const SWIPE_PX = 60 // a drag this long moves to the neighbour
const FLICK_PX_PER_MS = 0.5 // ... and so does a short, fast flick
const TAP_PX = 8 // a movement shorter than this is a tap
const ANIMATION_MS = 220
const CARD_WIDTH = 'min(420px, calc(100% - 88px))'
const PEEK_STYLE = { top: 28, bottom: 28 } as const

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

type Direction = 'de_ru' | 'ru_de'

function Face({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`absolute inset-0 flex flex-col items-center justify-center overflow-hidden rounded-[32px] p-7 text-center [backface-visibility:hidden] ${className}`}>
      {children}
    </span>
  )
}

const label = 'text-xs font-bold uppercase tracking-[0.12em] text-faint'

/**
 * The flashcard deck: one big card at a time, the neighbours peek in from the edges. One side is one
 * language — the learning-language side shows the word and its filled example, the other the
 * translation. A tap flips, a swipe (or ← →) moves. Pure self-check: nothing is sent to the backend.
 */
export function FlipCards({ cards, total, direction = 'de_ru', resetKey, onNearEnd }: {
  cards: CollectionCard[]
  total: number // all cards of the folder (the counter and the pager), more than are loaded so far
  direction?: Direction // which side is shown first
  resetKey: string // changes with the folder / direction → back to the first card
  onNearEnd?: () => void // load the next page before the user reaches the last card
}) {
  const { t, i18n } = useTranslation()
  const learning = useLearningLang()
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  // The whole track moves with the finger (dx); after a swipe it slides the rest of the way (anim).
  const [dx, setDx] = useState(0)
  const [anim, setAnim] = useState(false)
  const track = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; t: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  const last = cards.length - 1
  const i = Math.min(index, Math.max(last, 0))
  const card = cards[i]
  const canSpeak = useCanSpeak(card?.language ?? '')
  const ruFirst = direction === 'ru_de'

  useEffect(() => {
    clearTimeout(timer.current)
    setIndex(0); setFlipped(false); setDx(0); setAnim(false)
  }, [resetKey])

  useEffect(() => { if (onNearEnd && cards.length > 0 && i >= cards.length - 3) onNearEnd() }, [i, cards.length, onNearEnd])
  useEffect(() => () => clearTimeout(timer.current), [])

  const iRef = useRef(i)
  iRef.current = i
  const lastRef = useRef(last)
  lastRef.current = last

  const move = useCallback((delta: number) => {
    const next = Math.min(Math.max(iRef.current + delta, 0), lastRef.current)
    if (next === iRef.current) return
    setFlipped(false)
    setIndex(next)
  }, [])

  const flip = useCallback(() => setFlipped((f) => !f), [])

  /** Slides the track by one card in the swipe's direction, then switches the card. */
  const slide = useCallback((delta: 1 | -1) => {
    const next = iRef.current + delta
    if (next < 0 || next > lastRef.current) return
    const width = track.current?.clientWidth ?? 0
    const distance = Math.min(420, Math.max(width - 88, 0)) + GAP
    if (reducedMotion()) { setDx(0); move(delta); return }
    setAnim(true)
    setDx(-delta * distance)
    timer.current = setTimeout(() => {
      setAnim(false) // jump back without a transition, now on the new card
      setDx(0)
      move(delta)
    }, ANIMATION_MS)
  }, [move])

  // ← → move, Space / Enter flip (not while typing)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (e.key === 'ArrowLeft') slide(-1)
      else if (e.key === 'ArrowRight') slide(1)
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        flip()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slide, flip])

  // Dragging: pointermove / pointerup are listened to on the window, so the cards under the finger
  // keep getting their own clicks (a tap on a neighbour, a tap on the card).
  function onPointerDown(e: React.PointerEvent) {
    if (anim || (e.pointerType === 'mouse' && e.button !== 0)) return
    drag.current = { x: e.clientX, t: Date.now(), moved: false }
    suppressClick.current = false
    const onMove = (ev: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const delta = ev.clientX - d.x
      if (Math.abs(delta) >= TAP_PX) d.moved = true
      const blocked = (delta > 0 && iRef.current === 0) || (delta < 0 && iRef.current === lastRef.current)
      setDx(blocked ? delta / 4 : delta) // a little resistance at the ends
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      const d = drag.current
      drag.current = null
      if (!d) return
      const delta = ev.clientX - d.x
      if (d.moved) suppressClick.current = true // the click that follows a drag is not a tap
      const fast = Math.abs(delta) > 20 && Math.abs(delta) / Math.max(Date.now() - d.t, 1) > FLICK_PX_PER_MS
      const dir = delta < 0 ? 1 : -1
      const exists = dir === 1 ? iRef.current < lastRef.current : iRef.current > 0
      if ((Math.abs(delta) > SWIPE_PX || fast) && exists) {
        // the finger already moved the track by delta: continue from there
        slide(dir)
      } else {
        setAnim(true) // spring back
        setDx(0)
        timer.current = setTimeout(() => setAnim(false), ANIMATION_MS)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  if (!card) return null

  const { article, rest } = splitArticle(card.word, card.article)
  const dots = Math.min(5, Math.max(total, 1))
  const activeDot = dots === 1 ? 0 : i === 0 ? 0 : i >= total - 1 ? dots - 1 : Math.floor(dots / 2)
  const filled = card.is_learned ? 5 : Math.min(Math.max(card.box_level, 0), 5)
  const counter = <span className="text-[13px] tabular-nums text-muted">{i + 1} / {total}</span>
  const nativeLang = card.translation_language ?? i18n.language
  const learningVisible = ruFirst ? flipped : !flipped // the other side is turned away (and hidden from screen readers)
  const hint = (key: string) => (
    <span className="absolute bottom-6 flex items-center gap-1.5 text-[13px] text-faint">
      <RotateCw size={14} aria-hidden="true" />{t(key)}
    </span>
  )

  const learningSide = (
    <Face className="bg-surface">
      <span className="absolute left-6 top-6 flex gap-1" data-testid="deck-box" aria-hidden="true">
        {Array.from({ length: 5 }, (_, n) => (
          <span key={n} data-filled={n < filled} className={`h-[5px] w-4 rounded-full ${n < filled ? 'bg-accent' : 'bg-dot-off'}`} />
        ))}
      </span>
      <span className="absolute right-6 top-5">{counter}</span>
      <span className={label}>{t('cards.sideLearning', learning.vars)}</span>
      <span lang={card.language} className="block">
        {article && <span className={`mt-4 block font-serif text-[26px] ${ARTICLE_COLOR[article]}`}>{article}</span>}
        <span className={`${article ? '' : 'mt-4 '}block break-words font-serif text-[clamp(40px,14vw,64px)] font-medium leading-none text-fg`}>{rest}</span>
      </span>
      {card.transcription && <span className="mt-3 block font-mono text-[15px] text-muted">{card.transcription}</span>}
      {card.example_sentence && (
        <>
          <span className="my-6 block h-0.5 w-10 rounded-full bg-line" />
          <span className="block font-serif text-xl leading-snug text-fg" lang={card.language}>
            <GapSentence answered answer={card.word} sentence={card.example_sentence} />
          </span>
        </>
      )}
      {hint('cards.flipToTranslation')}
    </Face>
  )
  const nativeSide = (
    <Face className="bg-surface-2">
      <span className="absolute right-6 top-5">{counter}</span>
      <span className={label}>{t(`cards.sideNative.${nativeLang}`)}</span>
      <span className="mt-5 block break-words text-[clamp(32px,11vw,52px)] font-bold leading-tight tracking-[-0.02em] text-accent-text">{card.translation || '—'}</span>
      {card.example_translation && (
        <>
          <span className="my-6 block h-0.5 w-10 rounded-full bg-line" />
          <span className="block text-[19px] leading-snug text-fg">{card.example_translation}</span>
        </>
      )}
      {hint('cards.flipToWord')}
    </Face>
  )

  const peek = (side: -1 | 1, c: CollectionCard | undefined) => c && (
    <button type="button" key={c.id} onClick={() => { if (!suppressClick.current) slide(side) }}
      aria-label={t(side === -1 ? 'collection.prev' : 'collection.next')}
      data-testid={side === -1 ? 'deck-prev' : 'deck-next'}
      style={{ width: CARD_WIDTH, left: `calc(50% + (${CARD_WIDTH} + ${GAP}px) * ${side})`, transform: 'translateX(-50%)', ...PEEK_STYLE }}
      className="absolute rounded-[32px] border border-line bg-surface opacity-60" />
  )

  const circle = 'place-items-center rounded-full border border-line text-fg transition hover:bg-surface-2 disabled:opacity-40'
  return (
    <div className="mt-4">
      <div ref={track} onPointerDown={onPointerDown} data-testid="deck-track"
        className="relative -mx-4 overflow-hidden md:mx-0"
        style={{ height: 'clamp(380px, 60dvh, 560px)', touchAction: 'pan-y' }}>
        <div className="absolute inset-0"
          style={{ transform: `translateX(${dx}px)`, transition: anim ? `transform ${ANIMATION_MS}ms ease-out` : 'none' }}>
          {peek(-1, cards[i - 1])}
          {peek(1, cards[i + 1])}
          <button type="button" data-testid="deck-card" aria-label={t('collection.flipHint')}
            onClick={() => { if (suppressClick.current) { suppressClick.current = false; return } flip() }}
            style={{ width: CARD_WIDTH, left: '50%', transform: 'translateX(-50%)', perspective: 1200 }}
            className="absolute inset-y-0 block rounded-[32px] border border-line shadow-[var(--shadow-card)]">
            <span className="absolute inset-0 block transition-transform duration-500 [transform-style:preserve-3d]"
              style={{ transform: flipped ? 'rotateY(180deg)' : 'none' }}>
              <span data-side="learning" aria-hidden={!learningVisible} className="absolute inset-0 block [transform-style:preserve-3d]"
                style={{ transform: ruFirst ? 'rotateY(180deg)' : 'none' }}>{learningSide}</span>
              <span data-side="native" aria-hidden={learningVisible} className="absolute inset-0 block [transform-style:preserve-3d]"
                style={{ transform: ruFirst ? 'none' : 'rotateY(180deg)' }}>{nativeSide}</span>
            </span>
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-col items-center gap-3">
        <div className="flex items-center gap-1.5" aria-hidden="true" data-testid="deck-pager">
          {Array.from({ length: dots }, (_, n) => (
            <span key={n} className={`h-1.5 rounded-full ${n === activeDot ? 'w-5 bg-accent' : 'w-1.5 bg-dot-off'}`} />
          ))}
        </div>
        <div className="flex items-center gap-5">
          <button type="button" onClick={() => slide(-1)} disabled={i === 0} aria-label={t('collection.prev')}
            className={`hidden h-12 w-12 md:grid ${circle}`}><ChevronLeft size={22} aria-hidden="true" /></button>
          {canSpeak ? (
            // In native → word, listening before the flip would give the answer away.
            <button type="button" onClick={() => speak(card.word, card.language)} disabled={ruFirst && !flipped}
              aria-label={t('quiz.listenTitle')} title={t('quiz.listenTitle')}
              className="grid h-16 w-16 place-items-center rounded-full bg-accent text-on-accent transition active:scale-95 disabled:opacity-40">
              <Volume2 size={24} aria-hidden="true" />
            </button>
          ) : <span className="h-16 w-0" />}
          <button type="button" onClick={() => slide(1)} disabled={i >= last} aria-label={t('collection.next')}
            className={`hidden h-12 w-12 md:grid ${circle}`}><ChevronRight size={22} aria-hidden="true" /></button>
        </div>
        <p className="text-[13px] text-faint md:hidden">{t('cards.swipeHint')}</p>
        <p className="hidden text-[13px] text-faint md:block">{t('collection.keysHint')}</p>
      </div>
    </div>
  )
}
