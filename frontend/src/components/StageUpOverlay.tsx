import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { heroApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { stageFromApi } from '../lib/heroStages'
import { shareHeroCard } from '../lib/heroShare'
import { useHero } from '../lib/useHero'
import { playSound } from '../lib/sounds'
import { Hero } from './Hero'

/**
 * Full-screen "your hero grew up" when GET /api/hero reports stage_up. Closing it calls
 * POST /api/hero/stage-seen, so it is shown once per new stage.
 */
export function StageUpOverlay() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: hero } = useHero()
  const [closed, setClosed] = useState(false)
  const seen = useMutation({
    mutationFn: heroApi.stageSeen,
    onSettled: () => qc.invalidateQueries({ queryKey: ['hero'] }),
  })
  const share = useMutation({
    mutationFn: ({ stage, name }: { stage: number; name: string }) => shareHeroCard(stage, name),
  })
  const open = !!hero?.stage_up && !closed
  useEffect(() => { if (open) playSound('stageUp') }, [open]) // the hero's congratulation

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
    <div role="dialog" aria-modal="true" aria-labelledby="stage-up-title"
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 overflow-y-auto bg-gradient-to-b from-[#14452F] to-[#0B2B1C] px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
      <Hero stage={stage} mood="happy" phrase={hero.phrase} size="large" label={name} className="w-full max-w-sm" />
      <h2 id="stage-up-title" className="display max-w-md text-balance text-center text-2xl font-extrabold md:text-3xl">
        {t('hero.stageUp', { name })}
      </h2>
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" className="btn-primary" disabled={share.isPending}
          onClick={() => share.mutate({ stage, name })}>
          {share.isPending ? t('common.loading') : `📤 ${t('hero.share')}`}
        </button>
        <button type="button" className="btn-ghost" onClick={close}>{t('hero.close')}</button>
      </div>
      {share.error && <p className="text-sm text-red-300">{errorMessage(share.error)}</p>}
    </div>
  )
}
