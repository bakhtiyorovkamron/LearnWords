import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Check, Timer, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ARTICLE_COLOR, splitArticle, type Article } from '../../lib/article'
import { speak, useCanSpeak } from '../../lib/speech'
import { Word } from '../WordCard'
import { formatClock } from './format'
import { GameHeader } from './GameHeader'
import type { GameProps, GameWord } from './types'

const ARTICLES: Article[] = ['der', 'die', 'das']
const RIGHT_FLASH_MS = 250
const RIGHT_NEXT_MS = 350
const WRONG_MS = 900 // the right article stays on screen this long
const TICK_MS = 250

// Each button in its article's colour; lit = the right answer after a miss, or a right tap.
const TONE: Record<Article, { base: string; lit: string }> = {
  der: { base: 'border-der/40 bg-der/10 text-der', lit: 'border-der bg-der/25 text-der ring-[3px] ring-der/25' },
  die: { base: 'border-die/40 bg-die/10 text-die', lit: 'border-die bg-die/25 text-die ring-[3px] ring-die/25' },
  das: { base: 'border-das/40 bg-das/10 text-das', lit: 'border-das bg-das/25 text-das ring-[3px] ring-das/25' },
}

/** The big noun: smaller for longer words, so one fits the screen. */
function nounSize(text: string) {
  return text.length >= 14 ? 'text-[38px]' : text.length >= 10 ? 'text-[48px]' : 'text-[64px]'
}

type State = {
  queue: string[] // card ids; a missed one comes back once at the end
  pos: number
  answered: string[] // distinct ids answered at least once
  right: number // right on the first try
  streak: number
  requeued: string[]
  mistakes: string[]
  last: { id: string; ok: boolean } | null // the previous answer, shown above the noun
  feedback: { tapped: Article; ok: boolean } | null // the answer being shown; input waits
  done: boolean
}
type Action = { type: 'answer'; tapped: Article; correct: Article } | { type: 'next' }

function reducer(s: State, a: Action): State {
  if (a.type === 'answer') {
    if (s.feedback || s.done) return s
    const id = s.queue[s.pos]
    const ok = a.tapped === a.correct
    const first = !s.answered.includes(id)
    const back = !ok && !s.requeued.includes(id)
    return {
      ...s,
      answered: first ? [...s.answered, id] : s.answered,
      right: s.right + (ok && first ? 1 : 0),
      streak: ok ? s.streak + 1 : 0,
      queue: back ? [...s.queue, id] : s.queue,
      requeued: back ? [...s.requeued, id] : s.requeued,
      mistakes: !ok && !s.mistakes.includes(id) ? [...s.mistakes, id] : s.mistakes,
      feedback: { tapped: a.tapped, ok },
    }
  }
  if (!s.feedback) return s
  const last = { id: s.queue[s.pos], ok: s.feedback.ok }
  if (s.pos + 1 >= s.queue.length) return { ...s, feedback: null, last, done: true }
  return { ...s, pos: s.pos + 1, feedback: null, last }
}

/**
 * der · die · das (German only): a noun without its article, three buttons (or the keys 1 / 2 / 3).
 * Right → it is read aloud with its article and the next one comes. Wrong → the right article lights
 * up, the noun shows with it for WRONG_MS, the streak resets, and the noun comes back once at the end.
 * The score is the nouns right on the first try, out of all of them.
 */
export function ArticlesGame({ words, lang, title, onFinish, onClose }: GameProps) {
  const { t } = useTranslation()
  const canSpeak = useCanSpeak(lang)
  const byId = useMemo(() => new Map(words.map((w) => [w.id, w])), [words])
  const of = words.length
  const [s, dispatch] = useReducer(reducer, words, (ws): State => ({
    queue: ws.map((w) => w.id), pos: 0, answered: [], right: 0, streak: 0, requeued: [], mistakes: [],
    last: null, feedback: null, done: false,
  }))
  const [flash, setFlash] = useState(false) // a right tap lights its button for RIGHT_FLASH_MS
  const startedAt = useRef(Date.now())
  const [endedAt, setEndedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => { timers.current.delete(id); fn() }, ms)
    timers.current.add(id)
  }, [])
  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  useEffect(() => {
    if (endedAt !== null) return
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [endedAt])

  // The last answer has been shown: the clock stops and the result is reported, once.
  const reported = useRef(false)
  useEffect(() => {
    if (!s.done || reported.current) return
    reported.current = true
    const end = Date.now()
    setEndedAt(end)
    const time = end - startedAt.current
    onFinish({
      score: s.right, of, words: of, elapsedMs: time, penaltyMs: 0,
      mistakes: s.mistakes.map((id) => byId.get(id)).filter((w): w is GameWord => !!w),
    })
  }, [s.done, s.right, s.mistakes, of, byId, onFinish])

  const card = byId.get(s.queue[s.pos])
  const { article, rest } = splitArticle(card?.word ?? '', card?.article)

  const answer = useCallback((tapped: Article) => {
    if (!card || !article || s.feedback || s.done) return
    const ok = tapped === article
    dispatch({ type: 'answer', tapped, correct: article })
    if (canSpeak) speak(`${article} ${rest}`, card.language)
    if (ok) {
      setFlash(true)
      later(() => setFlash(false), RIGHT_FLASH_MS)
    }
    later(() => dispatch({ type: 'next' }), ok ? RIGHT_NEXT_MS : WRONG_MS)
  }, [card, article, rest, s.feedback, s.done, canSpeak, later])

  // 1 / 2 / 3 = der / die / das.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const n = ['1', '2', '3'].indexOf(e.key)
      if (n === -1) return
      e.preventDefault()
      answer(ARTICLES[n])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [answer])

  if (!card || !article) return null
  const wrong = s.feedback && !s.feedback.ok
  const current = s.answered.includes(card.id)
  const lastCard = s.last ? byId.get(s.last.id) : undefined
  const elapsed = (endedAt ?? now) - startedAt.current

  function buttonClass(a: Article) {
    const base = 'h-[84px] rounded-[20px] border font-serif text-[28px] font-semibold transition active:scale-[0.97]'
    if (s.feedback?.tapped === a && !s.feedback.ok) return `${base} game-shake border-danger bg-danger/10 text-danger`
    if ((wrong && a === article) || (flash && s.feedback?.ok && s.feedback.tapped === a)) return `${base} ${TONE[a].lit}`
    return `${base} ${TONE[a].base}`
  }

  return (
    <>
      <GameHeader title={title} onClose={onClose}
        sub={t('games.progress', { n: Math.min(s.answered.length + (current ? 0 : 1), of), total: of })}
        pill={{ icon: Timer, text: formatClock(elapsed) }} progress={s.answered.length / of} />

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-2 text-center">
        <p data-testid="articles-last" className="flex h-7 items-center gap-1.5 font-serif text-[17px] text-muted">
          {s.last && lastCard && (
            <>
              {s.last.ok
                ? <Check size={16} aria-hidden="true" data-testid="articles-last-right" className="text-accent-text" />
                : <X size={16} aria-hidden="true" data-testid="articles-last-wrong" className="text-danger" />}
              <span lang={lastCard.language}><Word card={lastCard} /></span>
            </>
          )}
        </p>
        <p data-testid="articles-streak" className="mt-6 h-5 text-[12.5px] font-bold uppercase tracking-[0.12em] text-streak">
          {s.streak >= 2 ? t('games.streak', { n: s.streak }) : ''}
        </p>
        <p data-testid="articles-noun" lang={card.language}
          className={`mt-2 max-w-full break-words font-serif font-medium leading-none tracking-[-0.02em] text-fg ${nounSize(rest)}`}>
          {wrong && <span className={ARTICLE_COLOR[article]}>{article} </span>}{rest}
        </p>
        <p className="mt-3 text-lg text-muted" lang={card.translation_language ?? undefined}>{card.translation}</p>
      </div>

      <div className="mb-4 mt-auto grid shrink-0 grid-cols-3 gap-2.5" role="group" aria-label={title}>
        {ARTICLES.map((a, i) => (
          <button key={a} type="button" onClick={() => answer(a)} aria-keyshortcuts={String(i + 1)}
            data-testid={`articles-${a}`} className={buttonClass(a)}>
            {a}
          </button>
        ))}
      </div>
    </>
  )
}
