import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { HeroPhrase } from '../api/endpoints'
import { buildHero, type HeroMood } from '../lib/heroArt'
import { clampStage, stagePhrases } from '../lib/heroStages'

export type { HeroMood }

export interface HeroGesture {
  kind: 'nod' | 'wave'
  key: number // change it to play the gesture again
}

interface Props {
  stage: number // 0 Little Mozart … 5 Goethe
  mood?: HeroMood
  phrase?: HeroPhrase | null
  size?: 'large' | 'small'
  silhouette?: boolean // locked stage: dark outline only, no bubble, no interaction
  bubble?: boolean // show the speech bubble (default true)
  bubbleSide?: 'left' | 'right' // small size only
  gesture?: HeroGesture
  label?: string // accessible name (stage name)
  onTap?: () => void
  className?: string
  figureClassName?: string // small size: width of the figure (default w-24 / sm:w-28)
}

const FLASH_MS = { waving: 1400, nodding: 700 } as const

/**
 * The drawn, animated German hero (art and animations from docs/hero-prototype.html).
 * Tap: waves and says the next phrase — the given `phrase` first, then the stage's own ones.
 * Animations are switched off under prefers-reduced-motion (index.css).
 */
export function Hero({
  stage, mood = 'idle', phrase, size = 'large', silhouette = false, bubble = true, bubbleSide = 'right',
  gesture, label, onTap, className = '', figureClassName = 'w-24 sm:w-28',
}: Props) {
  const { i18n } = useTranslation()
  const uid = 'h' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const s = clampStage(stage)

  const phrases = useMemo(() => {
    const list = [...(phrase ? [phrase] : []), ...stagePhrases(s, i18n.language)]
    return list.filter((p, i) => list.findIndex((q) => q.de === p.de) === i)
  }, [phrase, s, i18n.language])

  const [idx, setIdx] = useState(0)
  const [pop, setPop] = useState(0)
  const [tapMood, setTapMood] = useState<HeroMood | null>(null) // tapping calms the hero, as in the prototype
  const [flash, setFlash] = useState<keyof typeof FLASH_MS | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout>>()

  // A new phrase from outside (training reaction, API) is shown right away.
  useEffect(() => {
    setIdx(0)
    setPop((p) => p + 1)
  }, [phrase?.de, phrase?.translation])
  useEffect(() => setTapMood(null), [mood])

  function play(kind: keyof typeof FLASH_MS) {
    setFlash(null)
    requestAnimationFrame(() => setFlash(kind)) // restart the CSS animation
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS[kind])
  }
  useEffect(() => {
    if (gesture) play(gesture.kind === 'nod' ? 'nodding' : 'waving')
  }, [gesture?.key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  const effMood = tapMood ?? mood
  const drawing = useMemo(() => buildHero(s, effMood, uid, silhouette), [s, effMood, uid, silhouette])
  const interactive = !silhouette

  function tap() {
    onTap?.()
    if (!interactive) return
    setIdx((i) => (i + 1) % Math.max(phrases.length, 1))
    setTapMood('idle')
    setPop((p) => p + 1)
    play('waving')
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      tap()
    }
  }

  const current = bubble && !silhouette ? phrases[idx % phrases.length] : undefined

  // Large: the bubble floats above the head, like the prototype's build() positions it.
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const [bubbleTop, setBubbleTop] = useState(0)
  useLayoutEffect(() => {
    if (size !== 'large' || !current) return
    const place = () => {
      const svg = svgRef.current, b = bubbleRef.current
      if (!svg || !b) return
      const scale = svg.clientWidth / 300 || 1
      const offset = svg.getBoundingClientRect().top - (wrapRef.current?.getBoundingClientRect().top ?? 0)
      setBubbleTop(Math.max(0, offset + (drawing.hy - drawing.r * 1.25) * scale - b.offsetHeight - 14))
    }
    place()
    const ro = new ResizeObserver(place)
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [size, current, drawing])

  const svg = (
    <svg
      ref={svgRef}
      viewBox="0 0 300 380"
      role="img"
      aria-label={label}
      tabIndex={interactive ? 0 : -1}
      onClick={tap}
      onKeyDown={interactive ? onKey : undefined}
      className={`hero-svg m-${effMood} ${flash ?? ''} block h-auto ${interactive ? 'cursor-pointer' : ''} ${
        size === 'large' ? 'mx-auto w-full max-w-[440px]' : 'w-full'
      }`}
      style={{ touchAction: 'manipulation' }}
      // Generated from constants in lib/heroArt.ts only — no user text goes into the markup.
      dangerouslySetInnerHTML={{ __html: drawing.markup }}
    />
  )

  if (size === 'large') {
    return (
      <div ref={wrapRef} className={`relative ${className}`}>
        {current && (
          <div key={pop} ref={bubbleRef} className="hero-bubble hero-bubble-up pop" style={{ top: bubbleTop }} aria-live="polite">
            <div className="de">„{current.de}“</div>
            <div className="tr">{current.translation}</div>
          </div>
        )}
        {svg}
      </div>
    )
  }

  const bubbleEl = current && (
    <div key={pop} className={`hero-bubble hero-bubble-side pop relative min-w-0 ${bubbleSide === 'right' ? 'tail-left' : 'tail-right'}`} aria-live="polite">
      <div className="de">„{current.de}“</div>
      {current.translation && <div className="tr">{current.translation}</div>}
    </div>
  )
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {bubbleSide === 'left' && bubbleEl}
      <div className={`shrink-0 ${figureClassName}`}>{svg}</div>
      {bubbleSide === 'right' && bubbleEl}
    </div>
  )
}
