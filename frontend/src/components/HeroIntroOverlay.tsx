import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { heroApi } from '../api/endpoints'
import { stageFromApi } from '../lib/heroStages'
import { useHero } from '../lib/useHero'
import { Hero } from './Hero'

/**
 * One-time «Meet your German hero!» for a user who meets the hero for the first time (also an
 * existing user with words: no «grew up» screen, just this). «Got it» calls
 * POST /api/hero/intro-seen, so it is shown once. Nothing without a hero (404) or when the
 * stage-up screen is up.
 */
export function HeroIntroOverlay() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: hero } = useHero()
  const [closed, setClosed] = useState(false)
  const seen = useMutation({
    mutationFn: heroApi.introSeen,
    onSettled: () => qc.invalidateQueries({ queryKey: ['hero'] }),
  })
  const open = !!hero?.intro && !hero.stage_up && !closed

  function close() {
    setClosed(true)
    seen.mutate()
  }
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !hero) return null
  const stage = stageFromApi(hero.stage)
  const name = t(`hero.stages.${stage}`)

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="hero-intro-title"
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 overflow-y-auto bg-gradient-to-b from-[#14452F] to-[#0B2B1C] px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
      <Hero stage={stage} mood="happy" phrase={hero.phrase} size="large" label={name} className="w-full max-w-sm" />
      <div className="max-w-md space-y-2 text-center">
        <h2 id="hero-intro-title" className="display text-balance text-2xl font-extrabold md:text-3xl">{t('hero.intro')}</h2>
        <p className="text-emerald-100/80">{t('hero.introText')}</p>
      </div>
      <button type="button" className="btn-primary" onClick={close} autoFocus>{t('hero.introOk')}</button>
    </div>
  )
}
