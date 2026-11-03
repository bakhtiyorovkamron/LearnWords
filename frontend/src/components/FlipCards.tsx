import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
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
const VELOCITY_MS = 80 // the flick speed is that of the last moves: a fast end of a slow drag counts
const TAP_PX = 8 // a movement shorter than this is a tap
const ANIMATION_MS = 220
const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
const CARD_WIDTH = 'min(420px, calc(100% - 88px))'
const AROUND = 2 // cards kept rendered on each side: a quick second slide never meets a blank card
const BACKFACE_HIDDEN = { backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' } as const
const PRESERVE_3D = { transformStyle: 'preserve-3d', WebkitTransformStyle: 'preserve-3d' } as const
// A face hides its own back (Safari needs the -webkit- one too) and sits 1px in front of its side, so
// iPhone Safari composites it in 3D and never shows the face behind it mirrored.
const FACE_STYLE = { ...BACKFACE_HIDDEN, transform: 'translateZ(1px)' } as const

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const HINT_KEY = 'yodla.cardsHintSeen' // how many times the deck was opened
const HINT_VISITS = 3

function hintVisits(): number {
  try {
    return Number(localStorage.getItem(HINT_KEY)) || 0
  } catch {
    return 0 // storage off (private mode): the hints just keep showing
  }
}

/** The swipe and flip hints: shown on the first HINT_VISITS visits of the deck, then never again. */
function useFirstVisitsHints(): boolean {
  const [show] = useState(() => hintVisits() < HINT_VISITS)
  const counted = useRef(false) // StrictMode runs the effect twice in development: one visit is one
  useEffect(() => {
    if (counted.current) return
    counted.current = true
    try {
      localStorage.setItem(HINT_KEY, String(Math.min(hintVisits() + 1, HINT_VISITS)))
    } catch { /* nothing to remember it in */ }
  }, [])
  return show
}

type Direction = 'de_ru' | 'ru_de'
type Point = { x: number; t: number }

/** px/ms over the drag's last VELOCITY_MS (0 when the finger rested before the release). */
function velocity(points: Point[], x: number, t: number) {
  const from = points.find((p) => p.t >= t - VELOCITY_MS)
  return from && t > from.t ? (x - from.x) / (t - from.t) : 0
}

function Face({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    // py-14 keeps the word and the example centred between the chips at the top and the hint below.
    <span data-face="" style={FACE_STYLE}
      className={`absolute inset-0 flex flex-col items-center justify-center overflow-hidden rounded-[32px] px-7 py-14 text-center ${className}`}>
      {children}
    </span>
  )
}

const label = 'text-xs font-bold uppercase tracking-[0.12em] text-faint'

type DeckCardProps = {
  card: CollectionCard
  n: number // its number in the deck (the counter chip)
  total: number
  offset: number // from the current card: 0 is it, ±1 the neighbours at the edges, ±2 waiting further out
  direction: Direction
  flipped: boolean // only ever true for the current card
  showHints: boolean
  onTap: (offset: number) => void
}

/**
 * One card of the deck, at its offset from the current one. Every card is this same element keyed by
 * its id, so after a slide React only moves it to its new offset: the card that slid in is the very
 * node that was the neighbour, its word drawn all along — nothing re-mounts, no text comes late.
 * A neighbour shows its front, cannot flip, and is a «Back» / «Next» button whose content is hidden
 * from screen readers. memo: the props are the card from the list and plain values, so a flip renders
 * the current card only.
 */
const DeckCard = memo(function DeckCard({ card, n, total, offset, direction, flipped, showHints, onTap }: DeckCardProps) {
  const { t, i18n } = useTranslation()
  const learning = useLearningLang()
  const current = offset === 0
  const near = offset === -1 || offset === 1
  const ruFirst = direction === 'ru_de'
  const learningVisible = ruFirst ? flipped : !flipped // the other side is turned away (and hidden from screen readers)

  const { article, rest } = splitArticle(card.word, card.article)
  const filled = card.is_learned ? 5 : Math.min(Math.max(card.box_level, 0), 5)
  const counter = <span className="text-[13px] tabular-nums text-muted">{n} / {total}</span>
  const nativeLang = card.translation_language ?? i18n.language
  const hint = (key: string) => showHints && (
    <span className="absolute bottom-6 flex items-center gap-1.5 text-[13px] text-faint">
      <RotateCw size={14} aria-hidden="true" />{t(key)}
    </span>
  )

  const learningSide = (
    <Face className="bg-surface">
      <span className="absolute left-6 top-6 flex gap-1" data-testid="deck-box" aria-hidden="true">
        {Array.from({ length: 5 }, (_, k) => (
          <span key={k} data-filled={k < filled} className={`h-[5px] w-4 rounded-full ${k < filled ? 'bg-accent' : 'bg-dot-off'}`} />
        ))}
      </span>
      <span className="absolute right-6 top-5">{counter}</span>
      <span className={label}>{t('cards.sideLearning', learning.vars)}</span>
      <span lang={card.language} className="block">
        {article && <span className={`mt-4 block font-serif text-[26px] ${ARTICLE_COLOR[article]}`}>{article}</span>}
        <span data-testid="deck-word" className={`${article ? '' : 'mt-4 '}block break-words font-serif text-[clamp(40px,14vw,64px)] font-medium leading-none text-fg`}>{rest}</span>
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

  return (
    <button type="button" data-offset={offset} onClick={() => onTap(offset)}
      data-testid={current ? 'deck-card' : offset === -1 ? 'deck-prev' : offset === 1 ? 'deck-next' : undefined}
      aria-label={current ? t('collection.flipHint') : near ? t(offset < 0 ? 'collection.prev' : 'collection.next') : undefined}
      aria-hidden={current || near ? undefined : true} tabIndex={current || near ? undefined : -1}
      style={{ width: CARD_WIDTH, left: `calc(50% + (${CARD_WIDTH} + ${GAP}px) * ${offset})`, transform: 'translateX(-50%)', perspective: 1200 }}
      className="absolute inset-y-0 block rounded-[32px] border border-line shadow-[var(--shadow-card)]">
      {/* Nothing between the button (the perspective) and the faces may clip, fade, filter or
          will-change anything but transform: Safari would flatten the 3D and show a face mirrored.
          Only the current card animates its flip: one that stops being current is on its front at once. */}
      <span data-testid={current ? 'deck-rotor' : undefined}
        className={`absolute inset-0 block ${current ? 'transition-transform duration-500' : ''}`}
        style={{ transform: flipped ? 'rotateY(180deg)' : 'none', willChange: 'transform', ...PRESERVE_3D }}>
        <span data-side="learning" aria-hidden={!current || !learningVisible} className="absolute inset-0 block"
          style={{ transform: ruFirst ? 'rotateY(180deg)' : 'none', ...PRESERVE_3D, ...BACKFACE_HIDDEN }}>{learningSide}</span>
        <span data-side="native" aria-hidden={!current || learningVisible} className="absolute inset-0 block"
          style={{ transform: ruFirst ? 'none' : 'rotateY(180deg)', ...PRESERVE_3D, ...BACKFACE_HIDDEN }}>{nativeSide}</span>
      </span>
    </button>
  )
})

/**
 * The flashcard deck: one big card at a time, the neighbours peek in from the edges. One side is one
 * language — the learning-language side shows the word and its filled example, the other the
 * translation. A tap flips, a swipe (or ← →) moves. Pure self-check: nothing is sent to the backend.
 * It fills the rest of its parent (a flex column of a fixed height): the stage stretches, the controls
 * row stays under it.
 */
export function FlipCards({ cards, total, direction = 'de_ru', resetKey, onNearEnd }: {
  cards: CollectionCard[]
  total: number // all cards of the folder (the counter), more than are loaded so far
  direction?: Direction // which side is shown first
  resetKey: string // changes with the folder / direction → back to the first card
  onNearEnd?: () => void // load the next page before the user reaches the last card
}) {
  const { t } = useTranslation()
  const showHints = useFirstVisitsHints()
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  // The track's position lives in the DOM, not in state: a move writes it in the next animation frame
  // (no render per pointer move); React renders only when the card changes or flips.
  const stage = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const dx = useRef(0) // the offset the next frame shows
  const at = useRef(0) // where place() last put the track
  const frame = useRef(0) // the requested animation frame, 0 = none
  const busy = useRef(false) // a slide or a spring-back is running: a new drag waits for it
  // What the running animation ends with: the card to move by (0 = a spring-back) and the fallback timer.
  const pending = useRef<{ delta: -1 | 0 | 1; fallback: ReturnType<typeof setTimeout> } | null>(null)
  const drag = useRef<{ x: number; points: Point[]; moved: boolean } | null>(null)
  const endDrag = useRef<(() => void) | null>(null) // removes the window listeners of the drag in progress
  const suppressClick = useRef(false)

  const last = cards.length - 1
  const i = Math.min(index, Math.max(last, 0))
  const card = cards[i]
  const canSpeak = useCanSpeak(card?.language ?? '')
  const ruFirst = direction === 'ru_de'

  const iRef = useRef(i)
  iRef.current = i
  const lastRef = useRef(last)
  lastRef.current = last

  /** Puts the track at x px: sliding there, or at once. */
  const place = useCallback((x: number, animate: boolean) => {
    const el = track.current
    if (!el) return
    el.style.transition = animate ? `transform ${ANIMATION_MS}ms ${EASING}` : 'none'
    el.style.transform = `translate3d(${x}px,0,0)`
    at.current = x
  }, [])

  const move = useCallback((delta: number) => {
    const next = Math.min(Math.max(iRef.current + delta, 0), lastRef.current)
    if (next === iRef.current) return
    setFlipped(false)
    setIndex(next)
  }, [])

  const flip = useCallback(() => setFlipped((f) => !f), [])

  /**
   * Ends the running slide or spring-back; false if none was running. After a slide the new card is
   * rendered (flushSync) and the track is put back to 0 in one synchronous step: both land in the same
   * frame, so nothing jumps.
   */
  const finish = useCallback(() => {
    const p = pending.current
    if (!p) return false
    pending.current = null
    clearTimeout(p.fallback)
    if (p.delta) flushSync(() => move(p.delta))
    place(0, false)
    busy.current = false
    return true
  }, [move, place])

  /** Slides the track to x; the track's transitionend ends it (the timer only if that never comes). */
  const animateTo = useCallback((x: number, delta: -1 | 0 | 1) => {
    busy.current = true
    place(x, true)
    pending.current = { delta, fallback: setTimeout(finish, ANIMATION_MS + 50) }
  }, [place, finish])

  /** Slides the track by one card in the swipe's direction, then switches the card. */
  const slide = useCallback((delta: 1 | -1) => {
    // A slide still running (a quick second ← →) ends at once; the reflow lets the next one start from 0.
    if (finish()) void track.current?.offsetWidth
    const next = iRef.current + delta
    if (next < 0 || next > lastRef.current) return
    if (reducedMotion()) { place(0, false); move(delta); return }
    const width = stage.current?.clientWidth ?? 0
    const distance = Math.min(420, Math.max(width - 88, 0)) + GAP
    animateTo(-delta * distance, delta)
  }, [finish, place, move, animateTo])

  // A tap on a card: the current one flips, a neighbour is moved to. The click that ends a drag is no tap.
  const tap = useCallback((offset: number) => {
    if (suppressClick.current) {
      if (offset === 0) suppressClick.current = false
      return
    }
    if (offset === 0) flip()
    else if (offset === -1 || offset === 1) slide(offset)
  }, [flip, slide])

  useEffect(() => {
    const p = pending.current
    if (p) clearTimeout(p.fallback)
    pending.current = null
    busy.current = false
    place(0, false)
    setIndex(0); setFlipped(false)
  }, [resetKey, place])

  useEffect(() => { if (onNearEnd && cards.length > 0 && i >= cards.length - 3) onNearEnd() }, [i, cards.length, onNearEnd])
  useEffect(() => () => {
    endDrag.current?.()
    if (pending.current) clearTimeout(pending.current.fallback)
    cancelAnimationFrame(frame.current)
  }, [])

  // The track's own transitionend ends a slide; the flip inside the card bubbles one up too — not that.
  // A native listener: React has no TransitionEvent everywhere, and finish runs flushSync.
  const shown = !!card
  useEffect(() => {
    const el = track.current
    if (!el) return
    const onEnd = (e: TransitionEvent) => { if (e.target === el) finish() }
    el.addEventListener('transitionend', onEnd)
    return () => el.removeEventListener('transitionend', onEnd)
  }, [shown, finish])

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
    if (busy.current || (e.pointerType === 'mouse' && e.button !== 0)) return
    endDrag.current?.() // a drag whose pointerup never came
    drag.current = { x: e.clientX, points: [{ x: e.clientX, t: Date.now() }], moved: false }
    suppressClick.current = false
    const onMove = (ev: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const t = Date.now()
      const delta = ev.clientX - d.x
      if (Math.abs(delta) >= TAP_PX) d.moved = true
      d.points.push({ x: ev.clientX, t })
      while (d.points.length > 1 && d.points[0].t < t - VELOCITY_MS) d.points.shift() // only the recent ones count
      const blocked = (delta > 0 && iRef.current === 0) || (delta < 0 && iRef.current === lastRef.current)
      dx.current = blocked ? delta / 4 : delta // a little resistance at the ends
      // One frame writes the latest position, however many moves arrive before it.
      if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; place(dx.current, false) })
    }
    const onUp = (ev: PointerEvent) => {
      endDrag.current?.()
      cancelAnimationFrame(frame.current)
      frame.current = 0
      const d = drag.current
      drag.current = null
      if (!d) return
      const delta = ev.clientX - d.x
      if (d.moved) suppressClick.current = true // the click that follows a drag is not a tap
      const fast = Math.abs(delta) > 20 && velocity(d.points, ev.clientX, Date.now()) * Math.sign(delta) > FLICK_PX_PER_MS
      const dir = delta < 0 ? 1 : -1
      const exists = dir === 1 ? iRef.current < lastRef.current : iRef.current > 0
      if ((Math.abs(delta) > SWIPE_PX || fast) && exists) {
        // the finger already moved the track: the slide continues from there
        slide(dir)
      } else if (at.current !== 0) {
        animateTo(0, 0) // spring back (from where the last frame put the track — not the cancelled one)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    endDrag.current = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      endDrag.current = null
    }
  }

  if (!card) return null

  // The current card and AROUND on each side, in deck order: after a slide the cards that stay keep
  // their place in the DOM — one leaves at one end, one comes in at the other, nothing moves.
  const from = Math.max(i - AROUND, 0)
  const around = cards.slice(from, i + AROUND + 1)
  const circle = 'place-items-center rounded-full border border-line text-fg transition hover:bg-surface-2 disabled:opacity-40'
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The stage takes the height that is left, 320–620 px; the card width stays as it was. */}
      <div ref={stage} onPointerDown={onPointerDown} data-testid="deck-stage"
        className="relative -mx-4 max-h-[620px] min-h-[320px] flex-1 overflow-hidden md:mx-0"
        style={{ touchAction: 'pan-y' }}>
        {/* Its own GPU layer; moved only by place() — React never sets its transform, so a render leaves it be. */}
        <div ref={track} data-testid="deck-track" className="absolute inset-0" style={{ willChange: 'transform' }}>
          {around.map((c, k) => {
            const offset = from + k - i
            return <DeckCard key={c.id} card={c} n={from + k + 1} total={total} offset={offset} direction={direction}
              flipped={offset === 0 && flipped} showHints={showHints} onTap={tap} />
          })}
        </div>
      </div>

      {/* The controls: the same big, thumb-friendly row on phones and desktops — ← 🔊 ⟳ →. */}
      <div className="mt-3 flex shrink-0 flex-col items-center gap-1">
        <div className="flex h-16 items-center justify-center gap-4" data-testid="deck-controls">
          <button type="button" onClick={() => slide(-1)} disabled={i === 0} aria-label={t('collection.prev')}
            className={`grid h-13 w-13 ${circle}`}><ChevronLeft size={24} aria-hidden="true" /></button>
          {canSpeak ? (
            // In native → word, listening before the flip would give the answer away.
            <button type="button" onClick={() => speak(card.word, card.language)} disabled={ruFirst && !flipped}
              aria-label={t('quiz.listenTitle')} title={t('quiz.listenTitle')}
              className="grid h-16 w-16 place-items-center rounded-full bg-accent text-on-accent transition active:scale-95 disabled:opacity-40">
              <Volume2 size={24} aria-hidden="true" />
            </button>
          ) : <span className="h-16 w-0" />}
          <button type="button" onClick={flip} aria-label={t('cards.flip')} title={t('cards.flip')}
            className={`grid h-13 w-13 ${circle}`}><RotateCw size={22} aria-hidden="true" /></button>
          <button type="button" onClick={() => slide(1)} disabled={i >= last} aria-label={t('collection.next')}
            className={`grid h-13 w-13 ${circle}`}><ChevronRight size={24} aria-hidden="true" /></button>
        </div>
        <span data-testid="deck-counter" className="text-[13px] tabular-nums text-muted">{i + 1} / {total}</span>
        {showHints && <p className="text-[13px] text-faint md:hidden">{t('cards.swipeHint')}</p>}
        <p className="hidden text-[13px] text-faint md:block">{t('collection.keysHint')}</p>
      </div>
    </div>
  )
}
