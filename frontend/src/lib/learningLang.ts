import { useQuery } from '@tanstack/react-query'
import { LEARNING_LANGS, meApi, type LearningLang } from '../api/endpoints'

// Per-language learning content shown in the UI (sample phrases, placeholders, greetings).
// This is learning content in the target language, so it is not part of i18n.
const CONTENT: Record<LearningLang, {
  greeting: string; greetingAccent: string
  phrasePlaceholder: string; gapPlaceholder: string; pronunciationPlaceholder: string
  examples: string[]
  // Words for i18n interpolation: ru — "немецкое слово", "на немецком", "по-немецки"; en — "German".
  vars: { langAdj: string; langPrep: string; langAdv: string; langName: string; langCode: string }
}> = {
  de: {
    greeting: 'Hallo!', greetingAccent: 'Was lernen wir heute?',
    phrasePlaceholder: 'z. B. „Ich freue mich schon auf das Wochenende!“',
    gapPlaceholder: 'Ich esse eine ___.',
    pronunciationPlaceholder: '[ихь]',
    examples: [
      'Guten Morgen! Wie geht es dir heute?',
      'Ich hätte gern einen Kaffee mit Milch, bitte.',
      'Das Wetter ist heute wunderschön, lass uns spazieren gehen.',
      'Kannst du mir bitte helfen? Ich habe mich verlaufen.',
    ],
    vars: { langAdj: 'немецкое', langPrep: 'немецком', langAdv: 'по-немецки', langName: 'German', langCode: 'DE' },
  },
  en: {
    greeting: 'Hello!', greetingAccent: 'What are we learning today?',
    phrasePlaceholder: 'e.g. “I’m really looking forward to the weekend!”',
    gapPlaceholder: 'I eat an ___ every day.',
    pronunciationPlaceholder: '[хэ́лоу]',
    examples: [
      'Good morning! How are you today?',
      'I would like a coffee with milk, please.',
      'The weather is beautiful today, let’s go for a walk.',
      'Can you help me, please? I got lost.',
    ],
    vars: { langAdj: 'английское', langPrep: 'английском', langAdv: 'по-английски', langName: 'English', langCode: 'EN' },
  },
  fr: {
    greeting: 'Bonjour !', greetingAccent: 'Qu’est-ce qu’on apprend aujourd’hui ?',
    phrasePlaceholder: 'p. ex. « J’ai hâte d’être au week-end ! »',
    gapPlaceholder: 'Je mange une ___.',
    pronunciationPlaceholder: '[бонжу́р]',
    examples: [
      'Bonjour ! Comment ça va aujourd’hui ?',
      'Je voudrais un café au lait, s’il vous plaît.',
      'Il fait très beau aujourd’hui, allons nous promener.',
      'Pouvez-vous m’aider, s’il vous plaît ? Je me suis perdu.',
    ],
    vars: { langAdj: 'французское', langPrep: 'французском', langAdv: 'по-французски', langName: 'French', langCode: 'FR' },
  },
  ko: {
    greeting: '안녕하세요!', greetingAccent: '오늘은 무엇을 배울까요?',
    phrasePlaceholder: '예: “주말이 정말 기다려져요!”',
    gapPlaceholder: '저는 매일 ___을 먹어요.',
    pronunciationPlaceholder: '[аннёнхасэё]',
    examples: [
      '좋은 아침이에요! 오늘 어떻게 지내요?',
      '우유 넣은 커피 한 잔 주세요.',
      '오늘 날씨가 정말 좋아요. 산책하러 가요.',
      '좀 도와주시겠어요? 길을 잃었어요.',
    ],
    vars: { langAdj: 'корейское', langPrep: 'корейском', langAdv: 'по-корейски', langName: 'Korean', langCode: 'KO' },
  },
}

// The language the current user learns (from /api/me, chosen at registration). Defaults to German.
// `vars` must be passed to t() for strings that mention the language: t('key', learning.vars).
export function useLearningLang() {
  const me = useQuery({ queryKey: ['me'], queryFn: meApi.get, staleTime: 5 * 60_000 })
  const code: LearningLang = me.data?.learning_language ?? 'de'
  const info = LEARNING_LANGS.find((l) => l.code === code) ?? LEARNING_LANGS[0]
  return { ...info, ...CONTENT[code], code, ready: !me.isLoading }
}
