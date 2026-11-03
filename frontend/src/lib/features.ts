import { useQuery } from '@tanstack/react-query'
import { meApi, type FeatureName } from '../api/endpoints'

// Off until the admin turns them on for a user: the backend catalog's DisabledByDefault
// (internal/domain/feature.go). Keep the two lists in step.
const OFF_BY_DEFAULT: readonly FeatureName[] = ['daily_story']

/**
 * The current user's features (from the /me query). Only decides what to show — the backend
 * enforces them. While /me is loading (or an old server sends no features) a feature counts as its
 * catalog default: on, except the ones off by default — so their buttons never flash up and vanish.
 */

export function useFeatures() {
  const me = useQuery({ queryKey: ['me'], queryFn: meApi.get, staleTime: 5 * 60_000 })
  const features = me.data?.features
  return {
    isOn: (name: FeatureName) => features?.[name]?.enabled ?? !OFF_BY_DEFAULT.includes(name),
    remaining: (name: FeatureName) => features?.[name]?.remaining ?? null,
    /** The user's effective daily limit (null = unlimited). */
    dailyLimit: (name: FeatureName) => features?.[name]?.daily_limit ?? null,
  }
}
