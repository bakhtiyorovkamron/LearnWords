import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CircleCheck, Flame, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { statsApi } from '../api/endpoints'
import { minutesFor, useDailyGoal } from '../lib/dailyGoal'
import { GoalRing } from './GoalRing'
import { GoalSheet } from './GoalSheet'
import { useFolderList } from './Folders'
import { weekDays, WeekStrip } from './WeekStrip'

const MORE_STEP = 20 // "20 more" once the goal is met

/**
 * Home's "Today" card: the daily goal as a ring, what is left, the main button and this week's strip.
 * Today's target is min(goal, answered today + still due); the goal is met when the answers reach it.
 */
export function TodayCard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const folders = useFolderList()
  const week = useQuery({ queryKey: ['stats', 'week'], queryFn: () => statsApi.get('week') })
  const { goal, setGoal } = useDailyGoal()
  const [editing, setEditing] = useState(false)

  const all = folders.data?.all
  if (!all || !week.data) return <div className="glass h-[330px] animate-pulse rounded-[20px]" aria-busy="true" />

  const due = all.due_today
  const daily = week.data.daily
  const today = daily[daily.length - 1] // the server's day: the last of the 7
  const reviewed = today?.reviewed ?? 0
  const target = Math.min(goal, reviewed + due)
  const met = target > 0 && reviewed >= target
  const remaining = Math.max(target - reviewed, 0)
  const done = Math.min(reviewed, target)
  const active = !!today?.active || reviewed > 0
  const streak = week.data.totals.current_streak_days
  const days = t('stats.days', { count: streak })
  const queue = due - remaining

  function go(url: string) {
    localStorage.setItem('review-folder', '') // the count is for all words
    navigate(url)
  }

  const caption = met ? t('home.streakDone', { days })
    : active ? t('home.streakActive', { days, left: t('folders.wordsCount', { count: remaining }) })
    : streak > 0 ? t('home.streakStart', { days, next: streak + 1 })
    : t('home.streakNew')

  const week7 = weekDays(today?.date ?? new Date().toISOString().slice(0, 10), daily, met)

  return (
    <section className="glass space-y-4 rounded-[20px] p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{t('home.goalTitle')}</h2>
        <button type="button" onClick={() => setEditing(true)} aria-haspopup="dialog"
          className="-mr-2 flex min-h-11 items-center gap-1 px-2 text-sm font-semibold text-accent-text">
          <Pencil size={14} aria-hidden="true" />{t('home.goalEdit')}
        </button>
      </div>

      {target === 0 ? (
        <div className="space-y-2 py-1">
          <CircleCheck size={32} aria-hidden="true" className="text-accent-text" />
          <p className="text-[19px] font-semibold text-fg">{t('home.nothingDue')}</p>
          <p className="text-muted">{t('home.nothingDueHint')}</p>
          <button type="button" onClick={() => go('/cards?practice=1')} className="btn-ghost mt-2 h-[52px] w-full rounded-[14px]">
            {t('practice.start')}
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <GoalRing done={done} target={target} met={met} />
            <div className="min-w-0">
              {met ? (
                <>
                  <p className="text-[26px] font-bold leading-tight text-fg">{t('home.goalDone')}</p>
                  <p className="text-muted">{t('home.goalOf', { done: reviewed, goal: target })}</p>
                </>
              ) : (
                <>
                  <p className="text-[34px] font-bold leading-none tabular-nums text-fg">{t('folders.wordsCount', { count: remaining })}</p>
                  <p className="mt-1.5 text-muted">{t('home.toGoal', { count: minutesFor(remaining) })}</p>
                </>
              )}
            </div>
          </div>
          {!met ? (
            <button type="button" onClick={() => go(`/cards?start=1&size=${remaining}`)} className="btn-primary h-[52px] w-full rounded-[14px]">
              {reviewed === 0 ? t('home.begin') : t('training.continue')}<ArrowRight size={18} aria-hidden="true" />
            </button>
          ) : due > 0 ? (
            <button type="button" onClick={() => go(`/cards?start=1&size=${MORE_STEP}`)} className="btn-ghost h-[52px] w-full rounded-[14px]">
              {t('home.more', { words: t('folders.wordsCount', { count: MORE_STEP }) })}<ArrowRight size={18} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" onClick={() => go('/cards?practice=1')} className="btn-ghost h-[52px] w-full rounded-[14px]">
              {t('practice.start')}
            </button>
          )}
          {queue > 0 && (
            <p className="text-center text-[13px] text-muted">{t('home.queueLeft', { words: t('folders.wordsCount', { count: queue }) })}</p>
          )}
        </>
      )}

      <div className="space-y-3 border-t border-divider pt-3.5">
        <WeekStrip days={week7} />
        <p className="flex items-center gap-2 text-sm text-muted">
          <Flame size={16} aria-hidden="true" className={streak > 0 ? 'shrink-0 text-streak' : 'shrink-0 text-faint'} />
          {caption}
        </p>
      </div>
      {editing && <GoalSheet goal={goal} onPick={setGoal} onClose={() => setEditing(false)} />}
    </section>
  )
}
