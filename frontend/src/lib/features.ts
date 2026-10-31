import { useQuery } from '@tanstack/react-query'
import { meApi, type FeatureName } from '../api/endpoints'

/**
 * The current user's features (from the /me query). Only decides what to show — the backend
 * enforces them. While /me is loading (or an old server sends no features) everything counts as on.
 */

export function useFeatures() {
  const me = useQuery({ queryKey: ['me'], queryFn: meApi.get, staleTime: 5 * 60_000 })
  const features = me.data?.features
  return {
    isOn: (name: FeatureName) => features?.[name]?.enabled ?? true,
    remaining: (name: FeatureName) => features?.[name]?.remaining ?? null,
    /** The user's effective daily limit (null = unlimited). */
    dailyLimit: (name: FeatureName) => features?.[name]?.daily_limit ?? null,
  }
}
