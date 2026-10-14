import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HeroPhrase } from '../api/endpoints'
import { onHeroEvent } from '../lib/heroBus'
import { linePhrase, REACTIONS, stageFromApi } from '../lib/heroStages'
import { useHero } from '../lib/useHero'
import { Hero, type HeroGesture, type HeroMood } from './Hero'

const CORRECT_MS = 1500
const WRONG_MS = 2000

/**
 * Small hero in the corner of a training question. Reacts locally to answers — nod +
 * "Richtig!" for 1.5 s, mood "think" + "Hmm…" for 2 s — and never calls the server (the hero
 * data was already loaded on the start screen).
 */
export function TrainingHero() {
  const { i18n } = useTranslation()
  const { data: hero } = useHero({ staleTime: Infinity })
  const [mood, setMood] = useState<HeroMood>('idle')
  const [phrase, setPhrase] = useState<HeroPhrase | null>(null)
  const [gesture, setGesture] = useState<HeroGesture>()
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => onHeroEvent((e) => {
    if (e.type !== 'answer') return
    clearTimeout(timer.current)
    if (e.correct) {
      setMood('happy')
      setPhrase(linePhrase(REACTIONS.correct, i18n.language))
      setGesture((g) => ({ kind: 'nod', key: (g?.key ?? 0) + 1 }))
    } else {
      setMood('think')
      setPhrase(linePhrase(REACTIONS.wrong, i18n.language))
    }
    timer.current = setTimeout(() => {
      setMood('idle')
      setPhrase(null)
    }, e.correct ? CORRECT_MS : WRONG_MS)
  }), [i18n.language])
  useEffect(() => () => clearTimeout(timer.current), [])

  if (!hero) return null
  return (
    <div className="pointer-events-none relative h-6 w-14 shrink-0 sm:w-16">
      <div className="absolute bottom-0 right-0 w-14 sm:w-16" aria-hidden="true">
        <Hero stage={stageFromApi(hero.stage)} mood={mood} size="small" bubble={false} gesture={gesture} figureClassName="w-full" />
      </div>
      {phrase && (
        <div key={phrase.de} className="hero-bubble hero-bubble-side tail-right pop absolute bottom-6 right-full mr-2 w-max whitespace-nowrap" role="status">
          <div className="de">„{phrase.de}“</div>
          <div className="tr">{phrase.translation}</div>
        </div>
      )}
    </div>
  )
}

/** Review start screen: the hero with today's mood and phrase (falls back to the emoji). */
export function ReviewHero({ fallback }: { fallback: string }) {
  const { t } = useTranslation()
  const { data: hero } = useHero()
  if (!hero) return <div className="text-5xl">{fallback}</div>
  const stage = stageFromApi(hero.stage)
  return (
    <Hero stage={stage} mood={hero.mood} phrase={hero.phrase} size="small" label={t(`hero.stages.${stage}`)}
      className="mx-auto max-w-md justify-center text-left" />
  )
}
