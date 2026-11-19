import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Timer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { shuffle } from '../../lib/quiz'
import { speak, useCanSpeak } from '../../lib/speech'
import { Word } from '../WordCard'
import { formatClock } from './format'
import { GameHeader } from './GameHeader'
import type { GameProps, GameWord } from './types'

export const PAIRS_PENALTY_MS = 2000 // every miss adds this to the time
const ROUND_SIZE = 6 // more words than this are played in two rounds
const NEXT_ROUND_MS = 400 // after a round's last match
const MISS_MS = 450 // how long a wrong pair flashes
const BUBBLE_MS = 700 // the "+2 s" under the clock
const TICK_MS = 250
const HAPTIC_MS = 8
const LONG = 14 // a text longer than this is one size smaller

/** ≤ ROUND_SIZE words → one round; more → two, split evenly (7 → 4 + 3). */
export function splitRounds<T>(words: T[]): T[][] {
  if (words.length <= ROUND_SIZE) return [words]
  const first = Math.ceil(words.length / 2)
  return [words.slice(0, first), words.slice(first)]
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

type Side = 'left' | 'right'

const tile = 'relative flex h-[74px] w-full items-center justify-center rounded-2xl border px-2.5 text-center text-balance transition'

/**
 * Pairs: the words on the left, their translations shuffled on the right; tap one of each to match
 * them. A word and a translation match when they are the same card or the translations read the same
 * (two words may share one). A miss flashes both, adds PAIRS_PENALTY_MS and puts the word with the
 * mistakes. The clock starts at the first tap; the score is the time plus the penalties.
 */
export function PairsGame({ words, lang, title, onFinish, onClose }: GameProps) {
  const { t } = useTranslation()
  const canSpeak = useCanSpeak(lang)
  const rounds = useMemo(() => splitRounds(words), [words])
  const [round, setRound] = useState(0)
  const left = rounds[round]
  const right = useMemo(() => shuffle(left), [left])
  const [selected, setSelected] = useState<{ side: Side; id: string } | null>(null)
  const [doneLeft, setDoneLeft] = useState<Set<string>>(() => new Set())
  const [doneRight, setDoneRight] = useState<Set<string>>(() => new Set())
  const [matched, setMatched] = useState(0) // over every round
  const [misses, setMisses] = useState(0)
  const [miss, setMiss] = useState<{ left: string; right: string } | null>(null)
  const [bubble, setBubble] = useState(false)
  const mistakes = useRef<GameWord[]>([])
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [endedAt, setEndedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => { timers.current.delete(id); fn() }, ms)
    timers.current.add(id)
    return id
  }, [])
  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])
  const missTimer = useRef<ReturnType<typeof setTimeout>>()
  const bubbleTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => { clearTimeout(missTimer.current); clearTimeout(bubbleTimer.current) }, [])

  // The clock ticks from the first tap until the last match.
  const running = startedAt !== null && endedAt === null
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [running])
  const elapsed = startedAt === null ? 0 : (endedAt ?? now) - startedAt

  function tap(side: Side, card: GameWord) {
    if (endedAt !== null) return
    let start = startedAt
    if (start === null) {
      start = Date.now()
      setStartedAt(start)
      setNow(start)
    }
    if ((side === 'left' ? doneLeft : doneRight).has(card.id)) return
    if (!selected) return setSelected({ side, id: card.id })
    if (selected.side === side) return setSelected(selected.id === card.id ? null : { side, id: card.id })

    const other = left.find((c) => c.id === selected.id)
    if (!other) return setSelected({ side, id: card.id })
    const word = side === 'left' ? card : other
    const translation = side === 'right' ? card : other
    setSelected(null)

    if (word.id === translation.id || sameText(word.translation, translation.translation)) {
      const nextLeft = new Set(doneLeft).add(word.id)
      setDoneLeft(nextLeft)
      setDoneRight(new Set(doneRight).add(translation.id))
      setMatched((n) => n + 1)
      if (canSpeak) speak(word.word, word.language)
      navigator.vibrate?.(HAPTIC_MS)
      if (nextLeft.size < left.length) return
      if (round + 1 < rounds.length) {
        later(() => {
          setRound((r) => r + 1)
          setDoneLeft(new Set())
          setDoneRight(new Set())
        }, NEXT_ROUND_MS)
        return
      }
      // The last match: the clock stops here; the result follows once the check has been seen.
      const end = Date.now()
      setEndedAt(end)
      const time = end - start
      const penaltyMs = misses * PAIRS_PENALTY_MS
      later(() => onFinish({
        score: time + penaltyMs, of: null, words: words.length, mistakes: mistakes.current, elapsedMs: time, penaltyMs,
      }), NEXT_ROUND_MS)
      return
    }

    // A miss: both flash and shake, the clock gains the penalty, the word goes to the mistakes.
    setMisses((n) => n + 1)
    if (!mistakes.current.some((m) => m.id === word.id)) mistakes.current = [...mistakes.current, word]
    setMiss({ left: word.id, right: translation.id })
    clearTimeout(missTimer.current)
    missTimer.current = setTimeout(() => setMiss(null), MISS_MS)
    setBubble(true)
    clearTimeout(bubbleTimer.current)
    bubbleTimer.current = setTimeout(() => setBubble(false), BUBBLE_MS)
  }

  function renderTile(side: Side, card: GameWord) {
    const done = (side === 'left' ? doneLeft : doneRight).has(card.id)
    const isSelected = selected?.side === side && selected.id === card.id
    const missed = miss !== null && miss[side] === card.id
    const text = side === 'left' ? card.word : card.translation
    const size = side === 'left'
      ? `font-serif font-medium ${text.length > LONG ? 'text-[17px]' : 'text-[20px]'}`
      : `font-semibold ${text.length > LONG ? 'text-[14.5px]' : 'text-[16.5px]'}`
    const state = missed ? 'game-shake border-danger bg-danger/10'
      : isSelected ? 'border-accent bg-accent/10 ring-[3px] ring-accent/15'
      : 'border-line bg-surface hover:bg-surface-2'
    return (
      <div className="relative">
        <button type="button" onClick={() => tap(side, card)} disabled={done} aria-pressed={isSelected}
          data-testid={`pairs-${side}`} data-done={done || undefined} data-missed={missed || undefined}
          lang={side === 'left' ? card.language : card.translation_language ?? undefined}
          className={`${tile} ${size} text-fg ${state} ${done ? 'opacity-30' : ''}`}>
          {side === 'left' ? <span><Word card={card} /></span> : <span>{card.translation}</span>}
        </button>
        {done && (
          <span aria-hidden="true" className="pointer-events-none absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-accent text-on-accent">
            <Check size={13} strokeWidth={3} />
          </span>
        )}
      </div>
    )
  }

  return (
    <>
      <GameHeader title={title} onClose={onClose} sub={t('games.round', { n: round + 1, total: rounds.length })}
        pill={{ icon: Timer, text: formatClock(elapsed + misses * PAIRS_PENALTY_MS) }} progress={matched / words.length}>
        {bubble && (
          <span data-testid="pairs-penalty" role="status"
            className="animate-rise pointer-events-none absolute right-0 top-full mt-1.5 whitespace-nowrap rounded-full bg-danger/15 px-2.5 py-1 text-[13px] font-bold tabular-nums text-danger">
            {t('games.seconds', { n: PAIRS_PENALTY_MS / 1000 })}
          </span>
        )}
      </GameHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="mt-5 text-center text-[14.5px] text-muted">{t('games.pairs.hint')}</p>
        <div className="mt-4 grid grid-cols-2 gap-2.5 pb-4">
          {left.map((card, i) => (
            // A row: a word and a translation (most likely another word's); the grid lays them out.
            <Fragment key={card.id}>
              {renderTile('left', card)}
              {renderTile('right', right[i])}
            </Fragment>
          ))}
        </div>
      </div>
    </>
  )
}
