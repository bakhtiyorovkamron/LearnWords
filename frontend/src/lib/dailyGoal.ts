import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DAILY_GOALS, settingsApi, type DailyGoal, type UserSettings } from '../api/endpoints'

export const DEFAULT_GOAL: DailyGoal = 20
const SECONDS_PER_WORD = 15

/** Minutes for n words, at least 1 ("≈3 min"). */
export const minutesFor = (n: number) => Math.max(1, Math.ceil((n * SECONDS_PER_WORD) / 60))

const isGoal = (v: unknown): v is DailyGoal => (DAILY_GOALS as readonly unknown[]).includes(v)

/**
 * The daily goal from the user's settings (20 until they load or when the server sends none), and a
 * setter that updates the settings query at once and rolls back if the save fails.
 */
export function useDailyGoal() {
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get, staleTime: 5 * 60_000 })
  const goal = isGoal(settings.data?.daily_goal) ? settings.data.daily_goal : DEFAULT_GOAL

  const save = useMutation({
    mutationFn: (g: DailyGoal) => settingsApi.setDailyGoal(g),
    onMutate: async (g) => {
      await qc.cancelQueries({ queryKey: ['settings'] })
      const prev = qc.getQueryData<UserSettings>(['settings'])
      qc.setQueryData<UserSettings>(['settings'], (old) => ({
        interface_language: '', review_session_size: '', theme: '', ...old, daily_goal: g,
      }))
      return { prev }
    },
    onError: (_e, _g, ctx) => { if (ctx?.prev) qc.setQueryData(['settings'], ctx.prev) },
  })
  return { goal, setGoal: (g: DailyGoal) => save.mutate(g) }
}
