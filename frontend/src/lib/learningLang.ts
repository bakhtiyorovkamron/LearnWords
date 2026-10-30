import { useQuery } from '@tanstack/react-query'
import { LEARNING_LANGS, meApi, type LearningLang } from '../api/endpoints'

// Per-language learning content shown in the UI (sample phrases, placeholders).
// This is learning content in the target language, so it is not part of i18n — it is the SAME
// for every interface language (a Russian-, English- and Uzbek-interface user learning German
// all see "Hallo! Was lernen wir heute?" and the "Deutsch lernen — Wort für Wort 🌿" footer).
const CONTENT: Record<LearningLang, {
  phrasePlaceholder: string; gapPlaceholder: string; pronunciationPlaceholder: string
  tagline: string // footer, e.g. "Deutsch lernen — Wort für Wort 🌿"
  // Every language must define ALL vars, otherwise i18next leaves raw "{{name}}" in the UI.
  // ru: langAdj/langPrep/langAdv · en: langName · uz: langUz ("nemis" → "nemis tilida") · all: langCode
  vars: { langAdj: string; langPrep: string; langAdv: string; langName: string; langCode: string; langUz: string }
}> = {
  de: {
    phrasePlaceholder: 'z. B. „Ich freue mich schon auf das Wochenende!“',
    gapPlaceholder: 'Ich esse eine ___.',
    pronunciationPlaceholder: '[ихь]',
    tagline: 'Deutsch lernen — Wort für Wort 🌿',
    vars: { langAdj: 'немецкое', langPrep: 'немецком', langAdv: 'по-немецки', langName: 'German', langCode: 'DE', langUz: 'nemis' },
  },
  en: {
    phrasePlaceholder: 'e.g. “I’m really looking forward to the weekend!”',
    gapPlaceholder: 'I eat an ___ every day.',
    pronunciationPlaceholder: '[хэ́лоу]',
    tagline: 'Learning English — word by word 🌿',
    vars: { langAdj: 'английское', langPrep: 'английском', langAdv: 'по-английски', langName: 'English', langCode: 'EN', langUz: 'ingliz' },
  },
  fr: {
    phrasePlaceholder: 'p. ex. « J’ai hâte d’être au week-end ! »',
    gapPlaceholder: 'Je mange une ___.',
    pronunciationPlaceholder: '[бонжу́р]',
    tagline: 'Apprendre le français — mot par mot 🌿',
    vars: { langAdj: 'французское', langPrep: 'французском', langAdv: 'по-французски', langName: 'French', langCode: 'FR', langUz: 'fransuz' },
  },
  ko: {
    phrasePlaceholder: '예: “주말이 정말 기다려져요!”',
    gapPlaceholder: '저는 매일 ___을 먹어요.',
    pronunciationPlaceholder: '[аннёнхасэё]',
    tagline: '한국어 배우기 — 한 단어씩 🌿',
    vars: { langAdj: 'корейское', langPrep: 'корейском', langAdv: 'по-корейски', langName: 'Korean', langCode: 'KO', langUz: 'koreys' },
  },
}

const LS_KEY = 'learning_language'
const isLang = (v: string | null): v is LearningLang => !!v && v in CONTENT

// The language the current user learns (from /api/me, chosen at registration).
// The last known value is cached in localStorage so the UI never flashes "DE" while /api/me loads.
// `vars` must be passed to t() for strings that mention the language: t('key', learning.vars).
export function useLearningLang() {
  const me = useQuery({ queryKey: ['me'], queryFn: meApi.get, staleTime: 5 * 60_000 })
  const fromServer = me.data?.learning_language
  if (fromServer && localStorage.getItem(LS_KEY) !== fromServer) localStorage.setItem(LS_KEY, fromServer)
  const cached = localStorage.getItem(LS_KEY)
  const code: LearningLang = fromServer ?? (isLang(cached) ? cached : 'de')
  const info = LEARNING_LANGS.find((l) => l.code === code) ?? LEARNING_LANGS[0]
  return { ...info, ...CONTENT[code], code, ready: !me.isLoading }
}
