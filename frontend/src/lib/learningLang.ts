import { useQuery } from '@tanstack/react-query'
import { LEARNING_LANGS, meApi, type LearningLang } from '../api/endpoints'

// The language the current user learns (from /api/me, chosen at registration). Defaults to German.
export function useLearningLang() {
  const me = useQuery({ queryKey: ['me'], queryFn: meApi.get, staleTime: 5 * 60_000 })
  const code: LearningLang = me.data?.learning_language ?? 'de'
  const info = LEARNING_LANGS.find((l) => l.code === code) ?? LEARNING_LANGS[0]
  return { code, ...info }
}
