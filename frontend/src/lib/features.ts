import { useQuery } from '@tanstack/react-query'
import { meApi, type FeatureName } from '../api/endpoints'

/**
 * The current user's features (from the /me query). Only decides what to show — the backend
 * enforces them. isOn: while /me is loading (or an old server sends no features) everything counts
 * as on. isEnabled: on only once /me has loaded and says so — for DisabledByDefault features, which
 * must never flash for the users who don't have them.
 */

export function useFeatures() {
  const me = useQuery({ queryKey: ['me'], queryFn: meApi.get, staleTime: 5 * 60_000 })
  const features = me.data?.features
  return {
    isOn: (name: FeatureName) => features?.[name]?.enabled ?? true,
    isEnabled: (name: FeatureName) => features?.[name]?.enabled === true,
    /** /me has answered (or failed): isEnabled is final. */
    loaded: me.isFetched,
    remaining: (name: FeatureName) => features?.[name]?.remaining ?? null,
    /** The user's effective daily limit (null = unlimited). */
    dailyLimit: (name: FeatureName) => features?.[name]?.daily_limit ?? null,
    /** Bought units left, spent once the free ones of the day run out (0 from an old server). */
    credits: (name: FeatureName) => features?.[name]?.credits ?? 0,
  }
}
