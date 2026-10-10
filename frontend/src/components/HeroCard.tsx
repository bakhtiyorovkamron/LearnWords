import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { heroApi } from '../api/endpoints'

// Mirrors the backend's heroStageMinCount (service/hero.go) — used only to size the progress
// bar; the authoritative stage/learned_count always come from the server.
const STAGE_MIN = [0, 50, 200, 500, 1300, 2400]
const STAGE_EMOJI = ['👶', '🧒', '🎨', '🎒', '🎧', '🧑‍💼']

const CELEBRATE_MS = 1600

/**
 * "German hero" card for the Stats page. Gated entirely server-side (FEATURE_HERO_EMAILS) —
 * a 404 means this user simply doesn't have the feature, so the card renders nothing at all,
 * not an error state.
 */
export function HeroCard() {
  const { t, i18n } = useTranslation()
  const { data: hero, isError } = useQuery({
    queryKey: ['hero', i18n.language],
    queryFn: () => heroApi.get(i18n.language),
    retry: false,
    staleTime: 60_000,
  })

  const [celebrate, setCelebrate] = useState(false)
  useEffect(() => {
    if (!hero?.stage_changed) return
    setCelebrate(true)
    const id = setTimeout(() => setCelebrate(false), CELEBRATE_MS)
    return () => clearTimeout(id)
  }, [hero?.stage_changed])

  if (isError || !hero) return null

  const idx = Math.min(Math.max(hero.stage, 1), 6) - 1
  const bucketStart = STAGE_MIN[idx]
  const bucketEnd = idx < 5 ? STAGE_MIN[idx + 1] : bucketStart
  const progress = idx >= 5
    ? 100
    : Math.max(0, Math.min(100, Math.round(((hero.learned_count - bucketStart) / (bucketEnd - bucketStart)) * 100)))

  return (
    <section className={`glass animate-rise relative overflow-hidden p-6 ${celebrate ? 'animate-bounce' : ''}`}>
      <div className="flex items-center gap-4">
        <div className="text-5xl">{STAGE_EMOJI[idx]}</div>
        <div className="min-w-0 flex-1">
          <h2 className="display text-lg font-bold">{t('hero.title')}</h2>
          <p className="text-sm font-semibold text-lime-300">{hero.stage_name}</p>
        </div>
      </div>

      <div className="mt-4 flex items-baseline justify-between gap-2 text-sm text-emerald-100/70">
        <span>{t('hero.wordsLearned')}: <b className="text-white">{hero.learned_count}</b></span>
        {hero.words_to_next_stage > 0 && (
          <span className="text-xs text-emerald-100/50">{t('hero.toNextStage')}: {hero.words_to_next_stage}</span>
        )}
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-emerald-900/60">
        <div className="h-full bg-lime-400 transition-all" style={{ width: `${progress}%` }} />
      </div>

      {hero.phrase && (
        <div className="mt-4 inline-block max-w-full rounded-2xl rounded-bl-none bg-white/10 px-4 py-2 text-sm italic text-white">
          „{hero.phrase}“
        </div>
      )}
    </section>
  )
}
