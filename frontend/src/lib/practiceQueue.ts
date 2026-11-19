import type { DueCard } from '../api/types'
import type { PracticeMode } from '../api/endpoints'

// Free practice: batches of PRACTICE_BATCH words, the next one asked for when PREFETCH_AT questions
// are left; a word asked in the last RECENT_WINDOW questions is not asked again (when the collection
// is large enough); a word answered wrong comes back REPLAY_MIN..REPLAY_MAX questions later, once.
export const PRACTICE_BATCH = '20'
// Fewer words in the collection / the folder: no real answer options (quiz.lacking), so no practice.
export const MIN_PRACTICE_WORDS = 4
export const PREFETCH_AT = 3
export const RECENT_WINDOW = 15
export const REPLAY_MIN = 3
export const REPLAY_MAX = 5

/** The first batch brings the hardest words; then random and hard take turns. */
export function batchMode(n: number): PracticeMode {
  return n % 2 === 1 ? 'random' : 'hard'
}

/**
 * The words of a fresh batch to queue. Words asked recently or already queued are skipped; when that
 * leaves nothing (a small collection) repeats are allowed, but the batch never starts with `lastId`
 * (the word asked or queued right before it), so no word comes twice in a row.
 */
export function nextBatch(cards: DueCard[], recent: string[], queued: string[], lastId: string | null): DueCard[] {
  const seen = new Set<string>()
  const unique = cards.filter((c) => !seen.has(c.id) && !!seen.add(c.id))
  const avoid = new Set([...recent.slice(-RECENT_WINDOW), ...queued])
  const fresh = unique.filter((c) => !avoid.has(c.id))
  if (fresh.length) return fresh
  const i = unique.findIndex((c) => c.id !== lastId)
  return i <= 0 ? unique : [...unique.slice(i), ...unique.slice(0, i)]
}

/** How many questions after a wrong answer the word comes back: REPLAY_MIN..REPLAY_MAX. */
export function replayOffset(random = Math.random): number {
  return REPLAY_MIN + Math.floor(random() * (REPLAY_MAX - REPLAY_MIN + 1))
}
