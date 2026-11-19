import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ArrowDown, History, Maximize2, RotateCw, Volume2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CollectionCard } from '../api/types'
import { ARTICLE_COLOR, splitArticle } from '../lib/article'
import { gapForm } from '../lib/gap'
import { useLearningLang } from '../lib/learningLang'
import { speak, useCanSpeak } from '../lib/speech'
import { GapSentence } from './GapSentence'

const GAP = 14 // px between the cards
const TAP_PX = 8 // a movement shorter than this is a tap
// The slide is a spring, like UIScrollView paging: a = k·(target − x) − c·v, mass 1.
const STIFFNESS = 300
const DAMPING = 30
const MAX_DT = 0.032 // s: a long frame (a stall, a background tab) must not blow the integration up
const SUBSTEP = 0.008 // s: the integration step, small enough to stay stable and smooth
const REST = 0.5 // px and px/s: closer to the target and slower than this, the spring stops
const VELOCITY_WINDOW_MS = 100 // the release velocity is that of the finger's last moves
const COAST_S = 0.2 // where the card would coast in this long decides the page
const FAST_PX_PER_S = 2500 // faster than this a flick may skip a card
const RUBBER = 0.55 // iOS's rubber band constant
const HAPTIC_MS = 8
const CARD_WIDTH = 'min(420px, calc(100% - 88px))'
// Focus mode: the card is the whole stage but a margin of FOCUS_INSET px all round; the neighbours wait
// just off-screen, the same GAP away.
const FOCUS_INSET = 8
const FOCUS_CARD_WIDTH = `calc(100% - ${FOCUS_INSET * 2}px)`
const FOCUS_RESIZE_MS = 340
const FOCUS_EXIT_PX = 90 // a downward drag longer than this leaves focus mode
const FOCUS_FOLLOW = 0.7 // the card follows a downward drag at this share of the finger
const FOCUS_SPRING_BACK_MS = 220
const FOCUS_SOUND_BOTTOM_PX = FOCUS_INSET + 34 // the in-card sound button, from the stage's bottom
const FOCUS_CHIP_MS = 2600
const FOCUS_CHIP_KEY = 'yodla.focusExitShown' // how many times the exit chip was shown
const FOCUS_CHIP_TIMES = 2
const JUMP_FADE_MS = 130
// The "review later" mark: a 44 px button in the back's top-right corner, MARK_EDGE_PX from the edges.
const MARK_EDGE_PX = 12
const MARK_TIP_MS = 1500
const MARK_ERROR_MS = 2500
const MARK_HINT_MS = 2800
const MARK_HINT_KEY = 'yodla.repeatHintShown' // the first-flip hint was shown, or the user has marked a word
const HAPTIC_TAP_MS = 8
const AROUND = 2 // cards kept rendered on each side: a quick second slide never meets a blank card
const BACKFACE_HIDDEN = { backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' } as const
const PRESERVE_3D = { transformStyle: 'preserve-3d', WebkitTransformStyle: 'preserve-3d' } as const
// A face hides its own back (Safari needs the -webkit- one too) and sits 1px in front of its side, so
// iPhone Safari composites it in 3D and never shows the face behind it mirrored.
const FACE_STYLE = { ...BACKFACE_HIDDEN, transform: 'translateZ(1px)' } as const

// Glyph width of a WIDE word, in em. Not the average (0.53 serif, 0.59 bold Cyrillic): every word
// wider than the factor would break mid-word, and measured on real words that is 1 in 4 or more.
const GLYPH_EM = 0.68
const DEFAULT_TEXT_WIDTH = 300 // px of a face without its padding, until the stage is measured
const FACE_PADDING_X = 56 // px: a face's px-7 on both sides (see Face)
const MIN_FONT_PX = 26
const WORD_MAX_PX = 64
const TRANSLATION_MAX_PX = 52
const FOCUS_WORD_MAX_PX = 80
const FOCUS_TRANSLATION_MAX_PX = 60
const EXAMPLE_FIT = 'line-clamp-3 wrap-anywhere hyphens-auto'

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

/** Shows the "swipe down to exit" chip the first FOCUS_CHIP_TIMES times focus mode opens. */
function takeFocusChip(): boolean {
  try {
    const n = Number(localStorage.getItem(FOCUS_CHIP_KEY)) || 0
    if (n >= FOCUS_CHIP_TIMES) return false
    localStorage.setItem(FOCUS_CHIP_KEY, String(n + 1))
    return true
  } catch {
    return false // nothing to count in: better no chip than one every time
  }
}

/** The first flip shows the mark's hint, once — and never to someone who has marked a word already. */
function markHintDue(): boolean {
  try {
    return !localStorage.getItem(MARK_HINT_KEY)
  } catch {
    return false // nothing to remember it in: no hint rather than one on every flip
  }
}
function markHintDone() {
  try {
    localStorage.setItem(MARK_HINT_KEY, '1')
  } catch { /* nothing to remember it in */ }
}

type Direction = 'de_ru' | 'ru_de'
type Point = { x: number; t: number }

const clock = () => performance.now()

/** px/s over the drag's last VELOCITY_WINDOW_MS (0 when the finger rested before the release). */
function velocity(points: Point[], x: number, t: number) {
  const from = points.find((p) => p.t >= t - VELOCITY_WINDOW_MS)
  return from && t > from.t ? ((x - from.x) / (t - from.t)) * 1000 : 0
}

/** The iOS rubber band: how far a view follows a finger that is d px beyond its end (w = the view's width). */
const rubberBand = (d: number, w: number) => (1 - 1 / ((d * RUBBER) / w + 1)) * w
/** The finger's distance beyond the end for a view that is o px beyond it: rubberBand's inverse. */
const unRubberBand = (o: number, w: number) => { const c = Math.min(o, w * 0.999); return (c * w) / ((w - c) * RUBBER) }

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

/** A card's width in px for a stage of stageWidth px: the whole stage in focus mode, else 420 px at most. One formula for the paging and the text. */
function cardWidthPx(stageWidth: number, focus: boolean) {
  return focus ? Math.max(stageWidth - FOCUS_INSET * 2, 0) : Math.min(420, Math.max(stageWidth - 88, 0))
}
/** The text width of a face in px: the card less its horizontal padding. */
function textWidthPx(stageWidth: number, focus: boolean) {
  const width = cardWidthPx(stageWidth, focus) - FACE_PADDING_X
  return width > 0 ? width : DEFAULT_TEXT_WIDTH
}

/**
 * Where a card sits at `offset` from the current one: normal (420 px at most) or focus (the whole stage).
 * Only while `resizing` (a switch to or from focus mode) does it carry a transition; otherwise none.
 */
function cardBox(focus: boolean, offset: number, resizing: boolean): React.CSSProperties {
  const width = focus ? FOCUS_CARD_WIDTH : CARD_WIDTH
  const inset = focus ? FOCUS_INSET : 0
  return {
    width, left: `calc(50% + (${width} + ${GAP}px) * ${offset})`, top: inset, height: `calc(100% - ${inset * 2}px)`,
    ...(resizing ? { transition: `left ${FOCUS_RESIZE_MS}ms ease, width ${FOCUS_RESIZE_MS}ms ease, height ${FOCUS_RESIZE_MS}ms ease, top ${FOCUS_RESIZE_MS}ms ease` } : {}),
  }
}

/** The font that keeps the longest single word of `text` on one line of a face: phrases still wrap
 * between their words. Only a word too long even at MIN_FONT_PX may hyphenate — `hyphens: auto` is
 * off otherwise, or it would split words that could simply wrap whole to the next line.
 */
function fitted(text: string, width: number, max: number) {
  const longest = Math.max(...text.split(/\s+/).map((w) => w.length))
  const wanted = width / (longest * GLYPH_EM)
  const hyphens = wanted < MIN_FONT_PX ? 'auto' : 'manual'
  return { fontSize: `${Math.floor(Math.min(Math.max(wanted, MIN_FONT_PX), max))}px`, hyphens, WebkitHyphens: hyphens } as const
}

type DeckCardProps = {
  card: CollectionCard
  offset: number // from the current card: 0 is it, ±1 the neighbours at the edges, ±2 waiting further out
  direction: Direction
  flipped: boolean // only ever true for the current card
  showHints: boolean
  textWidth: number // px of a face without its padding
  focus: boolean // focus mode: the card fills the stage, only the word and the sound
  resizing: boolean // a focus switch is animating the card's size
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
const DeckCard = memo(function DeckCard({ card, offset, direction, flipped, showHints, textWidth, focus, resizing, onTap }: DeckCardProps) {
  const { t, i18n } = useTranslation()
  const learning = useLearningLang()
  const current = offset === 0
  const near = offset === -1 || offset === 1
  const ruFirst = direction === 'ru_de'
  const learningVisible = ruFirst ? flipped : !flipped // the other side is turned away (and hidden from screen readers)

  const { article, rest } = splitArticle(card.word, card.article)
  const filled = card.is_learned ? 5 : Math.min(Math.max(card.box_level, 0), 5)
  const translation = card.translation || '—'
  // A marked card says so on its front: a small dot in the corner (the button itself is on the back).
  const dot = card.repeat_marked && (
    <span data-testid="deck-mark-dot" aria-hidden="true" className="absolute right-6 top-6 h-[9px] w-[9px] rounded-full bg-mark" />
  )
  const nativeLang = card.translation_language ?? i18n.language
  // Only the current card carries small UI (box bars, hints): a neighbour shows just its word and example.
  const hint = (key: string) => current && showHints && !focus && (
    <span className="absolute bottom-6 flex items-center gap-1.5 text-[13px] text-faint">
      <RotateCw size={14} aria-hidden="true" />{t(key)}
    </span>
  )

  const learningSide = (
    <Face className="bg-surface">
      {!ruFirst && dot}
      {current && !focus && (
        <span className="absolute left-6 top-6 flex gap-1" data-testid="deck-box" aria-hidden="true">
          {Array.from({ length: 5 }, (_, k) => (
            <span key={k} data-filled={k < filled} className={`h-[5px] w-4 rounded-full ${k < filled ? 'bg-accent' : 'bg-dot-off'}`} />
          ))}
        </span>
      )}
      {/* Focus mode keeps only the article and the word. */}
      {!focus && <span className={label}>{t('cards.sideLearning', learning.vars)}</span>}
      <span lang={card.language} className="block">
        {article && <span className={`${focus ? '' : 'mt-4 '}block font-serif text-[26px] ${ARTICLE_COLOR[article]}`}>{article}</span>}
        <span data-testid="deck-word" lang={card.language} style={fitted(rest, textWidth, focus ? FOCUS_WORD_MAX_PX : WORD_MAX_PX)}
          className={`${article || focus ? '' : 'mt-4 '}block wrap-anywhere font-serif font-medium leading-none text-fg`}>{rest}</span>
      </span>
      {!focus && card.transcription && <span className="mt-3 block font-mono text-[15px] text-muted">{card.transcription}</span>}
      {!focus && card.example_sentence && (
        <>
          <span className="my-6 block h-0.5 w-10 rounded-full bg-line" />
          <span className={`${EXAMPLE_FIT} font-serif text-xl leading-snug text-fg`} lang={card.language}>
            <GapSentence answered answer={gapForm(card)} sentence={card.example_sentence} />
          </span>
        </>
      )}
      {hint('cards.flipToTranslation')}
    </Face>
  )
  const nativeSide = (
    <Face className="bg-surface-2">
      {ruFirst && dot}
      {!focus && <span className={label}>{t(`cards.sideNative.${nativeLang}`)}</span>}
      <span lang={nativeLang} style={fitted(translation, textWidth, focus ? FOCUS_TRANSLATION_MAX_PX : TRANSLATION_MAX_PX)}
        className={`${focus ? '' : 'mt-5 '}block wrap-anywhere font-bold leading-tight tracking-[-0.02em] text-accent-text`}>{translation}</span>
      {!focus && card.example_translation && (
        <>
          <span className="my-6 block h-0.5 w-10 rounded-full bg-line" />
          <span lang={nativeLang} className={`${EXAMPLE_FIT} text-[19px] leading-snug text-fg`}>{card.example_translation}</span>
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
      // A neighbour clips here, at the card's own rounded edge. Never the current card: it flips, and
      // its turning corners leave the button.
      style={{ ...cardBox(focus, offset, resizing), transform: 'translateX(-50%)', perspective: 1200, overflow: current ? undefined : 'hidden' }}
      className="absolute block rounded-[32px] border border-line shadow-[var(--shadow-card)]">
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
export interface FlipCardsHandle {
  /** Goes to the card at index (of the loaded ones): one card away it slides, further it fades. */
  jumpTo: (index: number) => void
}

export const FlipCards = forwardRef<FlipCardsHandle, {
  cards: CollectionCard[]
  direction?: Direction // which side is shown first
  resetKey: string // changes with the folder / direction → back to the first card
  onNearEnd?: () => void // load the next page before the user reaches the last card
  onIndexChange?: (index: number) => void // the deck index: the counter and the scrubber follow it
  focus?: boolean // focus mode: the card fills the stage, only the word and the sound
  onFocusChange?: (focus: boolean) => void // ⤢ turns it on, a downward drag off
  // The "review later" mark (the button on the back): resolves when saved, rejects when it was not.
  onToggleRepeat?: (card: CollectionCard, marked: boolean) => Promise<unknown>
}>(function FlipCards({ cards, direction = 'de_ru', resetKey, onNearEnd, onIndexChange, focus = false, onFocusChange, onToggleRepeat }, ref) {
  const { t } = useTranslation()
  const showHints = useFirstVisitsHints()
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [stageWidth, setStageWidth] = useState(0) // px, measured on the stage only
  // A focus switch animates the card's size, and only that: the render that changes focus turns the
  // transition on (resizing); it ends after FOCUS_RESIZE_MS, or at once on a press or a slide.
  const [focusLaidOut, setFocusLaidOut] = useState(focus)
  const [resizing, setResizing] = useState(false)
  if (focus !== focusLaidOut) {
    setFocusLaidOut(focus)
    setResizing(!reducedMotion())
  }

  // The track's position lives in the DOM, not in state: a spring frame or a pointer move writes it
  // straight to the element (no render per frame); React renders only when the card changes or flips.
  const stage = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const x = useRef(0) // the track's offset from the current card, px
  const v = useRef(0) // its velocity, px/s
  // The running spring: the cards to move by when it settles (0 = a spring-back).
  const aim = useRef<{ delta: number } | null>(null)
  const frame = useRef(0) // the requested animation frame, 0 = none
  const lastFrame = useRef<number | null>(null) // the previous frame's timestamp
  // axis: undecided until the finger has moved TAP_PX; 'y' only for a mostly downward drag in focus mode.
  const drag = useRef<{ x0: number; y0: number; raw0: number; points: Point[]; moved: boolean; interrupted: boolean; axis: 'x' | 'y' | null } | null>(null)
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
  const focusRef = useRef(focus)
  focusRef.current = focus
  const fadeTimer = useRef<ReturnType<typeof setTimeout>>()
  const backTimer = useRef<ReturnType<typeof setTimeout>>()
  const [chip, setChip] = useState(false)
  const [tip, setTip] = useState<string | null>(null) // the small tooltip next to the mark button
  const tipTimer = useRef<ReturnType<typeof setTimeout>>()

  /** Puts the track at px. */
  const write = useCallback((px: number) => {
    x.current = px
    const el = track.current
    if (el) el.style.transform = `translate3d(${px}px,0,0)`
  }, [])

  /** One card's distance: the card and the gap. */
  const pageWidth = useCallback(() => cardWidthPx(stage.current?.clientWidth ?? 0, focusRef.current) + GAP, [])

  const move = useCallback((delta: number) => {
    const next = Math.min(Math.max(iRef.current + delta, 0), lastRef.current)
    if (next === iRef.current) return
    setFlipped(false)
    setIndex(next)
  }, [])

  const flip = useCallback(() => setFlipped((f) => !f), [])

  /** Stops the spring where it is (a finger, a new folder). */
  const endResize = useCallback(() => setResizing(false), []) // a press or a slide ends a size transition at once
  const halt = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = 0
    lastFrame.current = null
    aim.current = null
    v.current = 0
  }, [])

  /**
   * The spring has come to rest on its page: the card changes and the track is rebased to 0 in the
   * same step (flushSync renders the new card first), so both land in one frame — cards are keyed by
   * id, nothing re-mounts and nothing jumps.
   */
  const settle = useCallback(() => {
    const delta = aim.current?.delta ?? 0
    halt()
    if (delta) {
      flushSync(() => move(delta))
      navigator.vibrate?.(HAPTIC_MS) // Android; iOS ignores it
    }
    write(0)
  }, [halt, move, write])

  /** One animation frame of the spring. */
  const tick = useCallback(function step(now: number) {
    frame.current = 0
    const a = aim.current
    if (!a) return
    const target = -a.delta * pageWidth()
    let dt = lastFrame.current === null ? 1 / 60 : Math.min((now - lastFrame.current) / 1000, MAX_DT)
    lastFrame.current = now
    let pos = x.current
    let vel = v.current
    while (dt > 1e-9) {
      const h = Math.min(dt, SUBSTEP)
      vel += (STIFFNESS * (target - pos) - DAMPING * vel) * h
      pos += vel * h
      dt -= h
    }
    if (Math.abs(pos - target) < REST && Math.abs(vel) < REST) {
      write(target)
      settle()
      return
    }
    v.current = vel
    write(pos)
    frame.current = requestAnimationFrame(step)
  }, [pageWidth, write, settle])

  /** Springs the track to the page `delta` cards away, starting at velocity px/s (a new target keeps a running spring going). */
  const springTo = useCallback((delta: number, velocity: number) => {
    aim.current = { delta }
    v.current = velocity
    const target = -delta * pageWidth()
    if (reducedMotion() || (Math.abs(x.current - target) < REST && Math.abs(velocity) < REST)) {
      write(target)
      settle()
      return
    }
    if (!frame.current) {
      lastFrame.current = null
      frame.current = requestAnimationFrame(tick)
    }
  }, [pageWidth, write, settle, tick])

  /** The buttons and keys: one card on, from rest (or from where a running spring is). */
  const slide = useCallback((delta: 1 | -1) => {
    endResize()
    const pending = aim.current?.delta ?? 0
    const total = Math.min(Math.max(pending + delta, -iRef.current), lastRef.current - iRef.current)
    if (total === pending) return
    springTo(total, aim.current ? v.current : 0)
  }, [springTo, endResize])

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
    halt()
    write(0)
    setIndex(0); setFlipped(false)
  }, [resetKey, halt, write])

  useEffect(() => { onIndexChange?.(i) }, [i, onIndexChange])

  const showTip = useCallback((text: string, ms: number) => {
    clearTimeout(tipTimer.current)
    setTip(text)
    tipTimer.current = setTimeout(() => setTip(null), ms)
  }, [])
  // A tooltip belongs to its card: another card starts without one.
  useEffect(() => { clearTimeout(tipTimer.current); setTip(null) }, [i, resetKey])

  // The first flip ever shows where the mark is (once, and only to someone who never used it).
  useEffect(() => {
    if (!flipped || !onToggleRepeat || !markHintDue()) return
    markHintDone()
    showTip(t('cards.repeatHint'), MARK_HINT_MS)
  }, [flipped, onToggleRepeat, showTip, t])

  /** The mark button: the new state at once (the page updates its cache), a tap of vibration, a tooltip; back on an error. */
  const toggleMark = () => {
    if (!card || !onToggleRepeat) return
    const marked = !card.repeat_marked
    markHintDone()
    navigator.vibrate?.(HAPTIC_TAP_MS)
    showTip(t(marked ? 'cards.repeatOn' : 'cards.repeatOff'), MARK_TIP_MS)
    onToggleRepeat(card, marked).catch(() => showTip(t('cards.repeatError'), MARK_ERROR_MS))
  }

  // The scrubber's jump: a neighbour slides in like a swipe; a card further away fades out, the deck
  // changes, it fades back in (at once under reduced motion).
  useImperativeHandle(ref, () => ({
    jumpTo(target: number) {
      endResize()
      const to = Math.min(Math.max(target, 0), lastRef.current)
      const delta = to - iRef.current
      if (!delta) return
      if (Math.abs(delta) === 1) return slide(delta as 1 | -1)
      const el = track.current
      const change = () => {
        halt()
        write(0)
        flushSync(() => { setFlipped(false); setIndex(to) })
      }
      clearTimeout(fadeTimer.current)
      if (reducedMotion() || !el) return change()
      el.style.transition = `opacity ${JUMP_FADE_MS}ms ease`
      el.style.opacity = '0'
      fadeTimer.current = setTimeout(() => {
        change()
        el.style.opacity = '1'
        fadeTimer.current = setTimeout(() => { el.style.transition = '' }, JUMP_FADE_MS)
      }, JUMP_FADE_MS)
    },
  }), [halt, write, slide, endResize])

  // The exit chip: the first FOCUS_CHIP_TIMES times focus mode opens, for FOCUS_CHIP_MS.
  useEffect(() => {
    if (!focus || !takeFocusChip()) return
    setChip(true)
    const timer = setTimeout(() => setChip(false), FOCUS_CHIP_MS)
    return () => { clearTimeout(timer); setChip(false) }
  }, [focus])

  useEffect(() => { if (onNearEnd && cards.length > 0 && i >= cards.length - 3) onNearEnd() }, [i, cards.length, onNearEnd])
  useEffect(() => () => {
    endDrag.current?.()
    cancelAnimationFrame(frame.current)
    clearTimeout(fadeTimer.current)
    clearTimeout(backTimer.current)
    clearTimeout(tipTimer.current)
  }, [])

  // Only the stage is observed: its width sets every face's text width (textWidthPx), so the fonts are
  // right in the render that switches focus, and a card that joins the deck is right from its first
  // render. Measured before the first paint too. clientWidth, as the flip distorts a rect.
  const shown = !!card
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const measure = () => setStageWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [shown])

  // The size transition of a focus switch is over after FOCUS_RESIZE_MS (and a margin).
  useEffect(() => {
    if (!resizing) return
    const timer = setTimeout(() => setResizing(false), FOCUS_RESIZE_MS + 20)
    return () => clearTimeout(timer)
  }, [resizing, focus])

  // ← → move, Space / Enter flip (not while typing)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (e.key === 'ArrowLeft') slide(-1)
      else if (e.key === 'ArrowRight') slide(1)
      else if (e.key === ' ' || e.key === 'Enter') {
        if (e.target instanceof Element && e.target.closest('[data-deck-tool]')) return // the button's own press
        e.preventDefault()
        flip()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slide, flip])

  /** The card pulled down by a finger dy px below where it started: it follows at FOCUS_FOLLOW, a bit smaller. */
  const pull = (dy: number) => {
    const el = track.current
    if (el) el.style.transform = `translate3d(${x.current}px,${dy * FOCUS_FOLLOW}px,0) scale(${1 - Math.min(dy / 600, 0.06)})`
  }
  /** A pull short of FOCUS_EXIT_PX: back up to where it was. */
  const springBack = () => {
    const el = track.current
    if (!el) return
    if (!reducedMotion()) {
      el.style.transition = `transform ${FOCUS_SPRING_BACK_MS}ms ease-out`
      clearTimeout(backTimer.current)
      backTimer.current = setTimeout(() => { el.style.transition = '' }, FOCUS_SPRING_BACK_MS)
    }
    write(x.current)
  }

  /**
   * Where the track is for a finger that has dragged it to raw px: 1:1 inside the deck, the iOS rubber
   * band beyond its first and last card. Only the cards that are rendered (AROUND) can be dragged to.
   */
  const follow = (raw: number) => {
    const W = pageWidth()
    const w = stage.current?.clientWidth || W
    const endLo = -(lastRef.current - iRef.current) * W
    const endHi = iRef.current * W
    const lo = Math.max(endLo, -AROUND * W)
    const hi = Math.min(endHi, AROUND * W)
    if (raw > hi) return hi === endHi ? hi + rubberBand(raw - hi, w) : hi
    if (raw < lo) return lo === endLo ? lo - rubberBand(lo - raw, w) : lo
    return raw
  }
  /** follow()'s inverse: the raw drag position behind a track that may be stretched at an end. */
  const rawOf = (px: number) => {
    const W = pageWidth()
    const w = stage.current?.clientWidth || W
    const endLo = -(lastRef.current - iRef.current) * W
    const endHi = iRef.current * W
    if (px > endHi && endHi <= AROUND * W) return endHi + unRubberBand(px - endHi, w)
    if (px < endLo && endLo >= -AROUND * W) return endLo - unRubberBand(endLo - px, w)
    return px
  }

  // Dragging: pointermove / pointerup are listened to on the window, so the cards under the finger
  // keep getting their own clicks (a tap on a neighbour, a tap on the card).
  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    endResize()
    endDrag.current?.() // a drag whose pointerup never came
    // A spring still running stops right here and the finger takes over from this very position.
    const interrupted = aim.current !== null
    if (interrupted) halt()
    const t0 = clock()
    drag.current = { x0: e.clientX, y0: e.clientY, raw0: rawOf(x.current), points: [{ x: e.clientX, t: t0 }], moved: false, interrupted, axis: null }
    suppressClick.current = false
    const onMove = (ev: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const t = clock()
      const delta = ev.clientX - d.x0
      const dy = ev.clientY - d.y0
      if (!d.axis && Math.max(Math.abs(delta), Math.abs(dy)) >= TAP_PX) {
        // Only a mostly vertical, downward drag in focus mode pulls the card down; anything else pages.
        d.axis = focusRef.current && dy > 0 && Math.abs(dy) > Math.abs(delta) ? 'y' : 'x'
        if (d.axis === 'y') write(follow(d.raw0))
      }
      if (d.axis === 'y') {
        d.moved = true
        pull(Math.max(dy, 0))
        return
      }
      if (Math.abs(delta) >= TAP_PX) d.moved = true
      d.points.push({ x: ev.clientX, t })
      while (d.points.length > 1 && d.points[0].t < t - VELOCITY_WINDOW_MS) d.points.shift() // only the recent ones count
      write(follow(d.raw0 + delta)) // 1:1 with the finger
    }
    const onUp = (ev: PointerEvent) => {
      endDrag.current?.()
      const d = drag.current
      drag.current = null
      if (!d) return
      if (d.moved || d.interrupted) suppressClick.current = true // the click that follows a drag (or stops a slide) is not a tap
      if (d.axis === 'y') {
        if (ev.clientY - d.y0 > FOCUS_EXIT_PX) {
          write(x.current) // no pull left over: the card grows back to its normal size from where it is
          onFocusChange?.(false)
        } else springBack()
        return
      }
      const vel = velocity(d.points, ev.clientX, clock())
      // Where the card would coast to decides the page, like paging in a UIScrollView; a very fast flick may skip one.
      const W = pageWidth()
      const reach = Math.abs(vel) > FAST_PX_PER_S ? 2 : 1
      const wanted = Math.round(-(x.current + vel * COAST_S) / W) || 0
      const page = Math.min(Math.max(wanted, -reach), reach)
      // The spring starts with the release velocity, so a flick carries on instead of starting over.
      springTo(Math.min(Math.max(page, -iRef.current), lastRef.current - iRef.current), vel)
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
  const textWidth = textWidthPx(stageWidth, focus)
  const circle = 'place-items-center rounded-full border border-line text-fg transition hover:bg-surface-2 disabled:opacity-40'
  const say = () => speak(card.word, card.language)
  // The in-card sound of focus mode: never on a front that would give the answer away (native → word).
  const focusSound = focus && canSpeak && (!ruFirst || flipped)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The stage takes the height that is left, 320–720 px; the card width stays as it was. From md up it
          is centred and only as wide as the card plus a thin peek of each neighbour (420 card → 412 + ~30).
          Focus mode: the whole height and width; touch-action none lets a downward drag reach the page. */}
      <div ref={stage} onPointerDown={onPointerDown} data-testid="deck-stage" data-focus={focus || undefined}
        className={`relative -mx-4 flex-1 overflow-hidden ${focus ? 'min-h-0' : 'max-h-[720px] min-h-[320px] md:mx-auto md:w-full md:max-w-[500px]'}`}
        style={{ touchAction: focus ? 'none' : 'pan-y' }}>
        {/* Its own GPU layer; moved only by write() — React never sets its transform, so a render leaves it be. */}
        <div ref={track} data-testid="deck-track" className="absolute inset-0" style={{ willChange: 'transform' }}>
          {around.map((c, k) => {
            const offset = from + k - i
            return <DeckCard key={c.id} card={c} offset={offset} direction={direction} focus={focus}
              flipped={offset === 0 && flipped} showHints={showHints} textWidth={textWidth} resizing={resizing} onTap={tap} />
          })}
          {/* The mark: on the back of the current card only, in its top-right corner, sliding with it. Like
              the sound below it sits over the card, not inside its button (no nested buttons), and a press
              on it neither flips the card nor starts a drag. The tooltip is to its left. */}
          {flipped && onToggleRepeat && (
            <div data-testid="deck-mark" className="absolute z-10 flex flex-row-reverse items-center gap-2"
              style={{ top: (focus ? FOCUS_INSET : 0) + MARK_EDGE_PX, right: `calc(50% - (${focus ? FOCUS_CARD_WIDTH : CARD_WIDTH}) / 2 + ${MARK_EDGE_PX}px)` }}>
              <button type="button" data-deck-tool="" onClick={toggleMark} onPointerDown={(e) => e.stopPropagation()}
                aria-label={t('cards.repeat')} title={t('cards.repeat')} aria-pressed={!!card.repeat_marked}
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition active:scale-95 ${card.repeat_marked
                  ? 'bg-mark text-on-mark' : 'border border-line bg-surface text-muted hover:bg-surface-2'}`}>
                <History size={20} aria-hidden="true" />
              </button>
              {tip && (
                <span data-testid="deck-mark-tip" role="status"
                  className="pointer-events-none whitespace-nowrap rounded-full bg-fg px-3 py-1.5 text-[13px] font-semibold text-bg shadow-[var(--shadow-card)]">
                  {tip}
                </span>
              )}
            </div>
          )}
          {/* On the current card, sliding with it; not inside the card's button (no nested buttons), and
              a press on it neither flips the card nor starts a drag. */}
          {focusSound && (
            <button type="button" data-testid="deck-focus-sound" data-deck-tool="" onClick={say} onPointerDown={(e) => e.stopPropagation()}
              aria-label={t('quiz.listenTitle')} title={t('quiz.listenTitle')} style={{ bottom: FOCUS_SOUND_BOTTOM_PX }}
              className="absolute left-1/2 z-10 grid h-18 w-18 -translate-x-1/2 place-items-center rounded-full bg-accent text-on-accent shadow-[var(--shadow-card)] transition active:scale-95">
              <Volume2 size={30} aria-hidden="true" />
            </button>
          )}
        </div>
        {focus && chip && (
          <span data-testid="deck-focus-chip" role="status" style={{ bottom: FOCUS_SOUND_BOTTOM_PX + (focusSound ? 72 + 12 : 0) }}
            className="pointer-events-none absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-2 px-3.5 py-2 text-[13px] font-semibold text-muted shadow-[var(--shadow-card)]">
            <ArrowDown size={14} aria-hidden="true" />{t('cards.focusExit')}
          </span>
        )}
      </div>

      {/* The controls: the same big, thumb-friendly row on phones and desktops — ⟳ 🔊 ⤢. None in focus mode. */}
      {!focus && (
        <div className="mt-3 flex shrink-0 flex-col items-center gap-1">
          <div className="flex h-16 items-center justify-center gap-6" data-testid="deck-controls">
            <button type="button" onClick={flip} aria-label={t('cards.flip')} title={t('cards.flip')}
              className={`grid h-13 w-13 ${circle}`}><RotateCw size={22} aria-hidden="true" /></button>
            {canSpeak ? (
              // In native → word, listening before the flip would give the answer away.
              <button type="button" onClick={say} disabled={ruFirst && !flipped}
                aria-label={t('quiz.listenTitle')} title={t('quiz.listenTitle')}
                className="grid h-16 w-16 place-items-center rounded-full bg-accent text-on-accent transition active:scale-95 disabled:opacity-40">
                <Volume2 size={24} aria-hidden="true" />
              </button>
            ) : <span className="h-16 w-16" />}
            <button type="button" onClick={() => onFocusChange?.(true)} aria-label={t('cards.focus')} title={t('cards.focus')}
              className={`grid h-13 w-13 ${circle}`}><Maximize2 size={20} aria-hidden="true" /></button>
          </div>
          {showHints && <p className="text-[13px] text-faint md:hidden">{t('cards.swipeHint')}</p>}
          <p className="hidden text-[13px] text-faint md:block">{t('collection.keysHint')}</p>
        </div>
      )}
    </div>
  )
})
