import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, CircleCheck, CircleX, Lock, Volume2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Progress, WordCard } from '../api/types'
import { whenLabel } from '../lib/boxInfo'
import { dateLocale } from '../i18n'
import {
  buildOptions, checkTyped, countsAsCorrect, pickDistractors,
  type QuizItem, type Verdict,
} from '../lib/quiz'
import { useLearningLang } from '../lib/learningLang'
import { speak, useCanSpeak } from '../lib/speech'

interface Props {
  item: QuizItem
  pool: WordCard[]
  position: number
  total: number
  saving: boolean
  error?: string | null
  onAnswer: (correct: boolean) => void // sent to the backend right after the answer
  onNext: () => void
  corner?: ReactNode // the training hero, left of the question label
  practice?: boolean // extra practice: no box line, the schedule does not change
  progress?: Progress | null // the server's answer to this question (box and next review); review mode
}

const BOX_SEGMENTS = 5

/** The sentence with its "___" turned into a blank — or, after the answer, the answer in the blank. */
function GapSentence({ sentence, answered, answer }: { sentence: string; answered: boolean; answer: string }) {
  const at = sentence.indexOf('___')
  if (at < 0) return <>{sentence}</>
  const blank = answered ? (
    <span data-testid="gap-answer" className="text-accent-text underline decoration-accent underline-offset-4">{answer}</span>
  ) : (
    <span data-testid="gap-blank" aria-hidden="true" className="inline-block min-w-[4ch] border-b-2 border-faint">&nbsp;</span>
  )
  return <>{sentence.slice(0, at)}{blank}{sentence.slice(at + 3)}</>
}

// One training question in one of 4 formats. Choice formats (de_ru, ru_de, gap) share the
// option buttons; ru_de_type uses a text field. Progress is updated the same way for all.
//
// Every format uses the card's OWN stored translation (and example translation) — whatever the
// interface language is now; nothing is looked up or generated at training time.
export function QuizQuestion({ item, pool, position, total, saving, error, onAnswer, onNext, corner, practice = false, progress }: Props) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const learning = useLearningLang()
  const { card, format } = item
  const canSpeak = useCanSpeak(card.language)
  const isChoice = format !== 'ru_de_type'

  // ru_de_type has no options at all; de_ru/ru_de/gap all need 2 distractor cards (ru_de/gap
  // pick them by their learning-language word, de_ru by the stored translation).
  const distractors = useMemo(
    () => (isChoice ? pickDistractors(item, pool) : { cards: [], lacking: false }),
    [item, pool, isChoice],
  )

  const { options, lacking: optionsLacking } = useMemo(
    () => (isChoice ? buildOptions(item, distractors.cards) : { options: [], lacking: false }),
    [item, distractors.cards, isChoice],
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

  // German (learning-language) option text is set in the serif face; translations stay sans.
  const germanOptions = format === 'ru_de' || format === 'gap'

  function optionClass(i: number) {
    const base = 'flex min-h-14 w-full items-center justify-between gap-3 rounded-[14px] border px-4 py-3 text-left text-[17px] font-medium transition '
    if (!answered) return base + 'border-line bg-surface text-fg hover:bg-surface-2'
    if (options[i].correct) return base + 'border-accent bg-surface-2 text-fg'
    if (i === picked) return base + 'border-danger bg-surface text-fg'
    return base + 'border-divider bg-surface text-faint'
  }

  const typedBorder =
    verdict === 'correct' ? '!border-accent'
      : verdict === 'almost_article' || verdict === 'almost_typo' ? '!border-streak'
        : verdict === 'wrong' ? '!border-danger' : ''

  const almost = verdict === 'almost_article' || verdict === 'almost_typo'
  const correctOption = options.find((o) => o.correct)?.text ?? card.word
  const doneShare = ((position - (answered ? 0 : 1)) / total) * 100
  const listenable = canSpeak && (format === 'de_ru' || answered) // listening would give the answer away otherwise

  return (
    <div className={`mx-auto max-w-xl ${answered ? 'pb-72' : ''}`}>
      <div className="flex h-11 items-center gap-3">
        <button type="button" onClick={() => navigate('/')} aria-label={t('training.exit')} title={t('training.exit')}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface-2">
          <X size={22} aria-hidden="true" />
        </button>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-track" role="progressbar"
          aria-valuemin={0} aria-valuemax={total} aria-valuenow={position - (answered ? 0 : 1)}>
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${doneShare}%` }} />
        </div>
        <span className="text-sm tabular-nums text-muted">{position}/{total}</span>
      </div>
      {practice && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-faint"><Lock size={14} aria-hidden="true" />{t('practice.note')}</p>
      )}

      <div className="mt-4 flex items-center gap-3">
        {corner}
        <p className="text-[15px] text-muted">{t(`quiz.prompt.${format}`, learning.vars)}</p>
      </div>

      <div className="mt-6">
        {format === 'de_ru' && <p className="font-serif text-[34px] leading-tight text-fg" lang={learning.code}>{card.word}</p>}
        {(format === 'ru_de' || format === 'ru_de_type') && <p className="text-[26px] font-semibold text-fg">{card.translation}</p>}
        {format === 'gap' && (
          <p className="font-serif text-[28px] leading-snug text-fg" lang={learning.code}>
            <GapSentence sentence={card.example_sentence ?? ''} answered={answered} answer={correctOption} />
          </p>
        )}
        {format === 'gap' && card.example_translation && <p className="mt-2 text-[15px] text-muted">{card.example_translation}</p>}
        {listenable && (
          <button type="button" onClick={() => speak(card.word, card.language)} aria-label={t('quiz.listenTitle')} title={t('quiz.listenTitle')}
            className="mt-4 grid h-11 w-11 place-items-center rounded-full border border-line text-muted transition hover:bg-surface-2">
            <Volume2 size={20} aria-hidden="true" />
          </button>
        )}
      </div>

      {isChoice ? (
        <div className="mt-8 space-y-2.5">
          {options.map((o, i) => (
            <button key={i} type="button" disabled={answered} onClick={() => choose(i)} className={optionClass(i)}>
              <span className={germanOptions ? 'font-serif text-[19px]' : ''} lang={germanOptions ? learning.code : undefined}>{o.text}</span>
              {answered && o.correct && <Check size={20} aria-hidden="true" className="shrink-0 text-accent-text" />}
              {answered && !o.correct && i === picked && <X size={20} aria-hidden="true" className="shrink-0 text-danger" />}
            </button>
          ))}
        </div>
      ) : (
        <form onSubmit={submitTyped} className="mt-8 flex gap-3">
          <input
            autoFocus
            value={typed}
            disabled={answered}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={t('quiz.typePlaceholder', learning.vars)}
            autoComplete="off" autoCapitalize="off" spellCheck={false}
            className={`field !h-14 min-w-0 flex-1 font-serif text-[19px] ${typedBorder}`}
            lang={learning.code}
          />
          {!answered && (
            <button type="submit" disabled={!typed.trim()} className="btn-primary h-14 shrink-0">{t('quiz.check')}</button>
          )}
        </form>
      )}

      {lacking && <p className="mt-4 text-center text-xs text-faint">{t('quiz.lacking')}</p>}

      {answered && (
        <div role="status" aria-live="polite"
          className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-xl animate-rise rounded-t-[22px] border-t border-line bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-card)] md:bottom-4 md:rounded-[22px] md:border">
          <div className="flex items-center gap-2 text-[19px] font-semibold">
            {verdict === 'correct' && <><CircleCheck size={22} aria-hidden="true" className="text-accent-text" /><span>{t('training.correct')}</span></>}
            {almost && <><CircleCheck size={22} aria-hidden="true" className="text-streak" /><span>{t('training.almost')}</span></>}
            {verdict === 'wrong' && <><CircleX size={22} aria-hidden="true" className="text-danger" /><span>{t('training.wrong')}</span></>}
          </div>
          <p className="mt-2 text-[15px] text-fg">
            <span className="font-serif" lang={learning.code}>{card.word}</span>{card.translation && <> — {card.translation}</>}
          </p>
          {card.transcription && <p className="mt-0.5 text-sm text-muted">{card.transcription}</p>}
          {almost && (
            <p className="mt-1 text-sm text-streak">
              {t(verdict === 'almost_article' ? 'training.hintArticle' : 'training.hintTypo', { answer: card.word })}
            </p>
          )}

          <div className="mt-3 min-h-[38px]">
            {practice ? (
              <p className="text-sm text-muted">{t('summary.practice')}</p>
            ) : saving ? (
              <div data-testid="box-saving" className="h-[38px] animate-pulse rounded-lg bg-surface-2" />
            ) : progress ? (
              <>
                <div className="flex gap-1" data-testid="box-bar">
                  {Array.from({ length: BOX_SEGMENTS }, (_, i) => (
                    <span key={i} data-filled={i < progress.box_level}
                      className={`h-1.5 flex-1 rounded-full ${i < progress.box_level ? 'bg-accent' : 'bg-dot-off'}`} />
                  ))}
                </div>
                <p className="mt-1.5 text-sm text-muted">
                  {progress.is_learned
                    ? t('box.learned', { when: whenLabel(progress.next_review_at, t, dateLocale()) })
                    : t('training.box', { box: progress.box_level, when: whenLabel(progress.next_review_at, t, dateLocale()) })}
                </p>
              </>
            ) : null}
          </div>

          {error && <p className="mt-2 text-sm text-danger">{error}</p>}

          <button type="button" autoFocus disabled={saving} onClick={onNext} className="btn-primary mt-4 h-[52px] w-full rounded-[14px]">
            {position === total ? t('quiz.finish') : t('training.continue')}
          </button>
        </div>
      )}
    </div>
  )
}
