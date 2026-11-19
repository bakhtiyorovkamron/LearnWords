import type { DueCard } from '../../api/types'

/** A word as a game gets it: one with a translation, its first variant only (GamePage picks them). */
export type GameWord = DueCard

/** What a finished game reports: the score to save, and what the result screen shows. */
export interface FinishedGame {
  score: number // pairs: ms with the penalties; articles: right on the first try
  of: number | null // articles: the nouns played; null for pairs
  words: number // the words played
  mistakes: GameWord[] // each once, in the order they were missed
  elapsedMs: number // the clock without penalties
  penaltyMs: number
}

/** The props of every game: its words, their language, the title, and the two ways out. */
export interface GameProps {
  words: GameWord[]
  lang: string
  title: string
  onFinish: (result: FinishedGame) => void
  onClose: () => void
}
