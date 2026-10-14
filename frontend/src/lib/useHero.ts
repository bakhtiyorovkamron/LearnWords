import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { heroApi } from '../api/endpoints'

/** GET /api/hero for the current interface language; data stays undefined for users without the feature (404). */
export function useHero(options: { staleTime?: number } = {}) {
  const { i18n } = useTranslation()
  return useQuery({
    queryKey: ['hero', i18n.language],
    queryFn: () => heroApi.get(i18n.language),
    retry: false,
    staleTime: options.staleTime ?? 60_000,
  })
}
