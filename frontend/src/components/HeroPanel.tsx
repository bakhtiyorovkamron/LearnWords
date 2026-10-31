import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HeroPhrase } from '../api/endpoints'
import { dateLocale } from '../i18n'
import { LAST_STAGE, STAGE_MIN, stageFromApi, stagePhrases, stageProgress } from '../lib/heroStages'
import { useHero } from '../lib/useHero'
import { Hero } from './Hero'

/**
 * Stats page: the big hero, the two-part progress bar (learned solid, almost learned hatched)
 * and the strip of all six stages. Renders nothing for users without the feature (404).
 */
export function HeroPanel() {
  const { t } = useTranslation()
  const { data: hero } = useHero()
  if (!hero) return null

  const stage = stageFromApi(hero.stage)
  const name = t(`hero.stages.${stage}`)
  const num = (n: number) => n.toLocaleString(dateLocale())
  const { learnedPct, almostPct } = stageProgress(stage, hero.learned_count, hero.almost_count)
  const range = stage < LAST_STAGE
    ? t('hero.range', { from: num(STAGE_MIN[stage]), to: num(STAGE_MIN[stage + 1] - 1) })
    : t('hero.rangeFrom', { from: num(STAGE_MIN[LAST_STAGE]) })

  return (
    <section className="glass relative space-y-4 overflow-hidden p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xl font-bold text-fg">{name}</h2>
        <span className="text-xs font-semibold uppercase tracking-wider text-accent-text">{range}</span>
      </div>

      <Hero stage={stage} mood={hero.mood} phrase={hero.phrase} size="large" label={name} />
      <p className="text-center text-xs text-faint">{t('hero.tapHint')}</p>

      <div>
        <div className="mb-1.5 flex flex-wrap justify-between gap-2 text-sm tabular-nums text-muted">
          <span>
            {t('hero.learned')}: <b className="text-fg">{num(hero.learned_count)}</b>
            {' · '}{t('hero.almost')}: <b className="text-fg">{num(hero.almost_count)}</b>
          </span>
          <span>
            {stage === LAST_STAGE ? t('hero.lastStage') : t('hero.toNextStage', { n: num(hero.words_to_next_stage) })}
          </span>
        </div>
        <div className="hero-bar" role="img"
          aria-label={`${t('hero.learned')}: ${hero.learned_count}, ${t('hero.almost')}: ${hero.almost_count}`}>
          <div className="learned" style={{ width: `${learnedPct}%` }} />
          <div className="almost" style={{ width: `${almostPct}%` }} />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-4 text-xs text-faint">
          <span><i className="hero-legend-learned mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px] align-[-1px]" />{t('hero.learned')}</span>
          <span><i className="hero-legend-almost mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px] align-[-1px]" />{t('hero.almost')}</span>
        </div>
      </div>

      <StageStrip current={stage} learned={hero.learned_count} />
    </section>
  )
}

/**
 * All six stages in a row (scrolls sideways on phones). Reached stages are in colour and say
 * their phrases when tapped; the current one is framed; the next is a silhouette with its name
 * and the words still missing; the rest are silhouettes with "?" and their threshold.
 */
function StageStrip({ current, learned }: { current: number; learned: number }) {
  const { t, i18n } = useTranslation()
  const [said, setSaid] = useState<{ stage: number; idx: number; phrase: HeroPhrase } | null>(null)

  function say(stage: number) {
    const list = stagePhrases(stage, i18n.language)
    const idx = said?.stage === stage ? (said.idx + 1) % list.length : 0
    setSaid({ stage, idx, phrase: list[idx] })
  }

  return (
    <div className="space-y-3 pt-2">
      <div className="-mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-1 md:mx-0 md:grid md:grid-cols-6 md:overflow-visible md:px-0">
        {STAGE_MIN.map((min, i) => {
          const reached = i <= current
          const isNext = i === current + 1
          const name = t(`hero.stages.${i}`)
          return (
            <div key={i}
              className={`flex w-24 shrink-0 snap-start flex-col items-center gap-1 rounded-2xl p-2 text-center md:w-auto ${
                i === current ? 'border-2 border-accent bg-surface-2' : 'border border-line'
              }`}
              title={!reached && !isNext ? t('hero.locked') : name}
            >
              <Hero stage={i} size="small" bubble={false} silhouette={!reached} label={reached || isNext ? name : t('hero.locked')}
                className="w-full justify-center" figureClassName="w-16 md:w-full md:max-w-[96px]" onTap={reached ? () => say(i) : undefined} />
              <span className={`text-[11px] font-semibold leading-tight ${reached ? 'text-fg' : 'text-muted'}`}>
                {reached || isNext ? name : <span className="text-base font-bold">?</span>}
              </span>
              {!reached && (
                <span className="text-[10px] leading-tight text-faint">
                  {isNext ? t('hero.inWords', { count: Math.max(min - learned, 0) }) : t('hero.wordsAt', { count: min })}
                </span>
              )}
            </div>
          )
        })}
      </div>
      {said && (
        <div key={`${said.stage}-${said.idx}`} className="hero-bubble hero-bubble-side pop relative mx-auto w-fit max-w-full" aria-live="polite">
          <div className="de">„{said.phrase.de}“</div>
          <div className="tr">{said.phrase.translation} · {t(`hero.stages.${said.stage}`)}</div>
        </div>
      )}
    </div>
  )
}
