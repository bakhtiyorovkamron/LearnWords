import { useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { statsApi } from '../api/endpoints'
import { useFolderList } from '../components/Folders'
import { useDailyGoal } from './dailyGoal'

/**
 * Today's goal in numbers — the one place they are worked out (Home's card, the training and its result
 * all read them here). The target is min(goal, answered today + still due); the goal is met when the
 * answers reach it. `daily` is the last 7 days of GET /stats?period=week (the last one is today, the
 * server's day); the numbers are zeros until `ready`.
 */
export function useTodayGoal() {
  const folders = useFolderList()
  const week = useQuery({ queryKey: ['stats', 'week'], queryFn: () => statsApi.get('week') })
  const { goal, setGoal } = useDailyGoal()

  const all = folders.data?.all
  const daily = week.data?.daily ?? []
  const today = daily[daily.length - 1]
  const due = all?.due_today ?? 0
  const reviewed = today?.reviewed ?? 0
  const target = Math.min(goal, reviewed + due)
  const met = target > 0 && reviewed >= target
  const remaining = Math.max(target - reviewed, 0)
  const done = Math.min(reviewed, target)
  const active = !!today?.active || reviewed > 0
  const streak = week.data?.totals.current_streak_days ?? 0
  return {
    ready: !!all && !!week.data,
    // loaded or failed: nothing is being waited for any more
    settled: !folders.isLoading && !week.isLoading,
    goal, setGoal, due, reviewed, target, met, remaining, done, active, streak, today, daily,
  }
}

export type TodayGoal = ReturnType<typeof useTodayGoal>

/** The streak sentence under the week: what to do today, or that today counts. */
export function streakLine(t: TFunction, g: Pick<TodayGoal, 'met' | 'active' | 'remaining' | 'streak'>): string {
  const days = t('stats.days', { count: g.streak })
  if (g.met) return t('home.streakDone', { days })
  if (g.active) return t('home.streakActive', { days, left: t('folders.wordsCount', { count: g.remaining }) })
  if (g.streak > 0) return t('home.streakStart', { days, next: g.streak + 1 })
  return t('home.streakNew')
}
