import { useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { translationsApi } from '../api/endpoints'
import type { WordCard } from '../api/types'
import {
  buildOptions, checkTyped, countsAsCorrect, firstVariant, pickDistractors,
  type QuizItem, type Verdict,
} from '../lib/quiz'
import { useLearningLang } from '../lib/learningLang'

function speak(card: WordCard) {
  // Pronunciation is available only for German.
  if (card.language !== 'de' || !('speechSynthesis' in window)) return
  // "der Samstag / der Sonnabend" → pronounce only the first variant.
  const u = new SpeechSynthesisUtterance(firstVariant(card.word))
  u.lang = 'de-DE'
  window.speechSynthesis.speak(u)
}

interface Props {
  item: QuizItem
  pool: WordCard[]
  position: number
  total: number
  saving: boolean
  error?: string | null
  onAnswer: (correct: boolean) => void // sent to the backend right after the answer
  onNext: () => void
}

// One training question in one of 4 formats. Choice formats (de_ru, ru_de, gap) share the
// option buttons; ru_de_type uses a text field. Progress is updated the same way for all.
//
// Cards keep exactly one `translation` — in whatever interface language was active when the
// word was added. To show the question in the user's CURRENT interface language, every format
// that needs translated text (the 'de_ru' answer options, the 'ru_de'/'ru_de_type' prompt) looks
// it up via /api/translations, which returns a cached value or generates+caches one via AI. The
// 'gap' format needs no blocking lookup — its prompt is the learning-language sentence itself;
// the native-language hint underneath it just appears once (if) the lookup resolves.
export function QuizQuestion({ item, pool, position, total, saving, error, onAnswer, onNext }: Props) {
  const { t, i18n } = useTranslation()
  const learning = useLearningLang()
  const { card, format } = item
  const isChoice = format !== 'ru_de_type'
  const needsTranslation = format !== 'gap' // de_ru, ru_de, ru_de_type all show translated text up front

  // ru_de_type has no options at all; de_ru/ru_de/gap all need 2 distractor cards (ru_de/gap
  // pick them by their learning-language word — no translation needed for those two formats).
  const distractors = useMemo(
    () => (isChoice ? pickDistractors(item, pool) : { cards: [], lacking: false }),
    [item, pool, isChoice],
  )

  // Only 'de_ru' shows translated TEXT for the distractors (its options ARE translations);
  // 'ru_de'/'gap' show the distractors' own words, so only the current card needs translating.
  const neededIds = useMemo(() => {
    const ids = [card.id]
    if (format === 'de_ru') ids.push(...distractors.cards.map((c) => c.id))
    return ids
  }, [card.id, format, distractors.cards])

  const translationsQuery = useQuery({
    queryKey: ['translations', [...neededIds].sort().join(','), i18n.language],
    queryFn: () => translationsApi.batch(neededIds, i18n.language),
    staleTime: Infinity, // a word's translation never changes once generated
  })
  const translations = translationsQuery.data ?? {}
  const translatedSelf = translations[card.id]?.translation ?? ''
  const translatedExample = translations[card.id]?.example_translation ?? ''

  const { options, lacking: optionsLacking } = useMemo(
    () => (isChoice
      ? buildOptions(item, distractors.cards, Object.fromEntries(Object.entries(translations).map(([id, v]) => [id, v.translation])))
      : { options: [], lacking: false }),
    [item, distractors.cards, translations, isChoice],
  )
  const lacking = distractors.lacking || optionsLacking

  const [picked, setPicked] = useState<number | null>(null)
  const [typed, setTyped] = useState('')
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const answered = verdict !== null

  function choose(i: number) {
    if (answered) return
    setPicked(i)
    const v: Verdict = options[i].correct ? 'correct' : 'wrong'
    setVerdict(v)
    onAnswer(countsAsCorrect(v))
  }

  function submitTyped(e: FormEvent) {
    e.preventDefault()
    if (answered || !typed.trim()) return
    const v = checkTyped(typed, card.word)
    setVerdict(v)
    onAnswer(countsAsCorrect(v)) // "almost" (article/typo) counts as correct for box_level
  }

  function style(i: number) {
    const base = 'w-full rounded-2xl border px-5 py-4 text-left text-lg font-semibold transition '
    if (!answered) return base + 'border-emerald-400/20 bg-emerald-900/40 text-white hover:border-lime-400/60 hover:bg-lime-400/10'
    if (options[i].correct) return base + 'border-lime-400 bg-lime-400/20 text-lime-100'
    if (i === picked) return base + 'border-red-400 bg-red-500/20 text-red-100'
    return base + 'border-emerald-400/10 bg-emerald-900/20 text-emerald-100/40'
  }

  const typedStyle =
    verdict === 'correct' ? 'border-lime-400 bg-lime-400/15'
      : verdict === 'almost_article' || verdict === 'almost_typo' ? 'border-amber-400 bg-amber-400/15'
        : verdict === 'wrong' ? 'border-red-400 bg-red-500/15' : ''

  // Waiting only for formats whose prompt/options need translated text; 'gap' renders right away.
  if (needsTranslation && translationsQuery.isLoading) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="glass flex h-64 items-center justify-center p-8 text-emerald-100/60">{t('common.loading')}</div>
      </div>
    )
  }

  // What the question shows and what the right answer is, per format.
  const prompt = format === 'de_ru' ? card.word : format === 'gap' ? card.example_sentence ?? '' : translatedSelf
  const answerText = format === 'de_ru' ? translatedSelf : card.word

  const feedback = () => {
    switch (verdict) {
      case 'correct': return <span className="text-lime-300">{t('quiz.correct')}</span>
      case 'almost_article': return <span className="text-amber-300">{t('quiz.almostArticle', { answer: card.word })}</span>
      case 'almost_typo': return <span className="text-amber-300">{t('quiz.almostTypo', { answer: card.word })}</span>
      default: return <span className="text-red-300">{t('quiz.correctAnswer', { answer: answerText })}</span>
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="flex items-center justify-between text-sm text-emerald-100/70">
        <span>{position} / {total}</span>
        <div className="mx-4 h-2 flex-1 overflow-hidden rounded-full bg-emerald-900/60">
          <div className="h-full bg-lime-400 transition-all" style={{ width: `${((position - (answered ? 0 : 1)) / total) * 100}%` }} />
        </div>
      </div>

      <div className="glass p-8 text-center">
        <p className="text-xs uppercase tracking-widest text-lime-300/80">{t(`quiz.prompt.${format}`, learning.vars)}</p>
        <div className={`display mt-3 font-extrabold text-white ${format === 'gap' ? 'text-2xl leading-snug' : 'text-4xl'}`}>
          {prompt}
        </div>
        {format === 'gap' && translatedExample && (
          <div className="mt-2 text-sm text-emerald-100/60">{translatedExample}</div>
        )}
        {/* Listening would give the answer away in the reverse formats — only after answering there. */}
        {card.language === 'de' && (format === 'de_ru' || answered) && (
          <button type="button" onClick={() => speak(card)} className="btn-ghost mt-2" title={t('quiz.listenTitle')}>{t('quiz.listen')}</button>
        )}

        {answered && (
          <div className="mt-4 space-y-1">
            {format !== 'de_ru' && <div className="text-lg font-bold text-white">{card.word}</div>}
            <div className="font-mono text-sm text-lime-300/90">{card.transcription || '—'}</div>
            {format !== 'de_ru' && translatedSelf && <div className="text-sm text-emerald-100/70">{translatedSelf}</div>}
            <div className="text-sm">{feedback()}</div>
          </div>
        )}
      </div>

      {isChoice ? (
        <div className="space-y-3">
          {options.map((o, i) => (
            <button key={i} type="button" disabled={answered} onClick={() => choose(i)} className={style(i)}>
              {o.text}
            </button>
          ))}
        </div>
      ) : (
        <form onSubmit={submitTyped} className="flex gap-3">
          <input
            autoFocus
            value={typed}
            disabled={answered}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={t('quiz.typePlaceholder', learning.vars)}
            autoComplete="off" autoCapitalize="off" spellCheck={false}
            className={`field flex-1 text-lg ${typedStyle}`}
            lang={learning.code}
          />
          {!answered && (
            <button type="submit" disabled={!typed.trim()} className="btn-primary shrink-0">{t('quiz.check')}</button>
          )}
        </form>
      )}

      {lacking && (
        <p className="text-center text-xs text-amber-200/80">{t('quiz.lacking')}</p>
      )}
      {error && <p className="text-center text-sm text-red-300">{error}</p>}

      {answered && (
        <button type="button" onClick={onNext} disabled={saving} className="btn-primary w-full text-lg">
          {position === total ? t('quiz.finish') : t('quiz.next')}
        </button>
      )}
    </div>
  )
}
