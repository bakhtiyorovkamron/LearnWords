import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Flame, Volume2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DueCard } from '../api/types'
import { ARTICLE_COLOR, splitArticle } from '../lib/article'
import { speak, useCanSpeak } from '../lib/speech'
import { streakLine, useTodayGoal } from '../lib/todayGoal'
import { GoalRing } from './GoalRing'
import { weekDays, WeekStrip } from './WeekStrip'

const FIRST_MISTAKES = 5

interface Props {
  correct: number
  total: number
  mistakes: DueCard[]
  bestStreak: number // the longest run of right answers in this session
  minutes: number
  // Today's goal as it stood when the session started, plus this session's answers.
  goal: { done: number; target: number }
  // moreCount > 0 → there are still due words left: offer "N more" (same folder, same direction).
  moreCount?: number
  onMore?: () => void
  moreLoading?: boolean
}

function MistakeRow({ card }: { card: DueCard }) {
  const { t } = useTranslation()
  const canSpeak = useCanSpeak(card.language)
  const { article, rest } = splitArticle(card.word, card.article)
  return (
    <li className="flex min-h-[54px] items-center gap-3 py-1.5 pl-4 pr-1.5">
      <p className="min-w-0 flex-1">
        <span className="font-serif text-lg text-fg" lang={card.language}>
          {article && <span className={ARTICLE_COLOR[article]}>{article} </span>}{rest}
        </span>
        {card.translation && <span className="text-sm text-muted"> — {card.translation}</span>}
      </p>
      {canSpeak && (
        <button type="button" onClick={() => speak(card.word, card.language)} aria-label={t('quiz.listenTitle')} title={t('quiz.listenTitle')}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface-2">
          <Volume2 size={18} aria-hidden="true" />
        </button>
      )}
    </li>
  )
}

/**
 * The end of a session: the goal ring, this week with the streak, three numbers, the words that were
 * missed, and what to do next. The week and the streak are live (the stats refetch after the answers).
 */
export function ReviewResult({ correct, total, mistakes, bestStreak, minutes, goal, moreCount = 0, onMore, moreLoading }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const g = useTodayGoal()
  const [expanded, setExpanded] = useState(false)
  const wrong = total - correct
  const met = goal.done >= goal.target
  const shown = expanded ? mistakes : mistakes.slice(0, FIRST_MISTAKES)
  const hasMore = moreCount > 0
  const min = t('result.minutes', { count: minutes })

  const subtitle = met
    ? `${t('home.goalOf', { done: goal.done, goal: goal.target })} · ${min}`
    : `${t('result.toGoal', { words: t('folders.wordsCount', { count: Math.max(goal.target - goal.done, 0) }) })} · ${min}`
  const moreLabel = t('home.more', { words: t('folders.wordsCount', { count: moreCount }) })
  const week = weekDays(g.today?.date ?? new Date().toISOString().slice(0, 10), g.daily, g.met)

  const primary = 'btn-primary h-[52px] w-full rounded-[14px]'
  const ghost = 'btn-ghost h-[52px] w-full rounded-[14px]'
  const done = <button type="button" onClick={() => navigate('/')} className={met || !hasMore ? primary : ghost}>{t('home.sheetDone')}</button>
  const more = hasMore && (
    <button type="button" onClick={onMore} disabled={moreLoading} className={`${met ? ghost : primary} disabled:opacity-60`}>
      {moreLoading ? t('common.loading') : <>{moreLabel}<ArrowRight size={18} aria-hidden="true" /></>}
    </button>
  )

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-2rem)] max-w-xl flex-col">
      <div className="flex h-11 items-center">
        <button type="button" onClick={() => navigate('/')} aria-label={t('result.home')} title={t('result.home')}
          className="-ml-2.5 grid h-11 w-11 place-items-center rounded-full text-muted transition hover:bg-surface-2">
          <X size={22} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-2 flex flex-col items-center text-center">
        <GoalRing size={136} stroke={12} done={Math.min(goal.done, goal.target)} target={goal.target} met={met} />
        <h2 className="mt-4 text-[28px] font-bold tracking-[-0.02em] text-fg">{met ? t('home.goalDone') : t('result.done')}</h2>
        <p className="mt-1 text-base text-muted">{subtitle}</p>
      </div>

      {/* Only once the stats are in, so the week never flashes empty. */}
      {g.ready ? (
        <div className="glass mt-5 space-y-3 rounded-[20px] px-4 py-3.5">
          <WeekStrip days={week} />
          <p className="flex items-center gap-2 text-sm text-muted">
            <Flame size={16} aria-hidden="true" className={g.streak > 0 ? 'shrink-0 text-streak' : 'shrink-0 text-faint'} />
            {streakLine(t, g)}
          </p>
        </div>
      ) : (
        <div className="glass mt-5 h-[110px] animate-pulse rounded-[20px]" aria-busy="true" />
      )}

      <div className="mt-2.5 grid grid-cols-3 gap-2">
        {[
          [correct, 'text-accent-text', t('result.correct')],
          [wrong, 'text-danger', t('result.wrong')],
          [bestStreak, 'text-streak', t('result.bestStreak')],
        ].map(([n, color, label]) => (
          <div key={label as string} className="glass rounded-2xl py-2.5 text-center">
            <div className={`text-[22px] font-bold tabular-nums ${color}`}>{n}</div>
            <div className="text-[13px] text-muted">{label}</div>
          </div>
        ))}
      </div>

      {mistakes.length > 0 && (
        <section data-testid="mistakes">
          <div className="mt-4 flex items-baseline justify-between">
            <h3 className="text-[15px] font-semibold text-fg">{t('result.mistakes')}</h3>
            <span className="text-[13px] text-muted">{t('result.mistakesHint')}</span>
          </div>
          <ul className="glass mt-2 divide-y divide-divider overflow-hidden">
            {shown.map((c, i) => <MistakeRow key={`${c.id}-${i}`} card={c} />)}
          </ul>
          {!expanded && mistakes.length > FIRST_MISTAKES && (
            <button type="button" onClick={() => setExpanded(true)} className="mt-2 w-full py-2 text-center text-sm font-semibold text-accent-text">
              {t('result.showMore', { count: mistakes.length - FIRST_MISTAKES })}
            </button>
          )}
        </section>
      )}

      <div className="mt-auto space-y-2.5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-6">
        {met ? <>{done}{more}</> : <>{more}{done}</>}
      </div>
    </div>
  )
}
