import type { ComponentType } from 'react'
import type { TFunction } from 'i18next'
import type { GameName, GameRecord, LearningLang } from '../../api/endpoints'
import { splitArticle } from '../../lib/article'
import { MIN_PRACTICE_WORDS } from '../../lib/practiceQueue'
import { ArticlesGame } from './ArticlesGame'
import { ArticlesIcon, ArticlesName, PairsIcon } from './GameArt'
import { formatClock, formatPoints } from './format'
import { PairsGame } from './PairsGame'
import type { FinishedGame, GameProps, GameWord } from './types'

/**
 * The folder games. One entry per game: the tile, the start sheet, the game page and the result
 * screen all read it, so a new game is an entry here plus its component.
 */
export interface GameDef {
  id: GameName
  nameKey: string
  ruleKey: string
  Icon: ComponentType<{ size: number }>
  /** The name drawn its own way (der · die · das in the article colours); t(nameKey) without it. */
  Name?: ComponentType<{ className?: string }>
  Play: ComponentType<GameProps>
  minWords: number
  maxWords: number
  /** Only for these learning languages; every language without it. */
  languages?: LearningLang[]
  /** Which words of the folder it can use (they all have a translation already). */
  fits: (word: GameWord) => boolean
  notEnoughKey: string
  /** The start sheet's fact chip: what the game is played with. */
  fact: (t: TFunction, total: number) => string
  lowerIsBetter: boolean
  /** A score (or a record's best) as the screen shows it; `of` for points out of a total. */
  format: (score: number, of: number | null) => string
  /** The three cells under the result. */
  cells: (t: TFunction, r: FinishedGame) => { value: string; label: string }[]
}

const PAIRS_MAX = 12

export const GAMES: GameDef[] = [
  {
    id: 'pairs',
    nameKey: 'games.pairs.name',
    ruleKey: 'games.pairs.rule',
    Icon: PairsIcon,
    Play: PairsGame,
    minWords: MIN_PRACTICE_WORDS,
    maxWords: PAIRS_MAX,
    fits: () => true,
    notEnoughKey: 'games.notEnough',
    fact: (t, total) => t('games.wordsFromFolder', { count: Math.min(PAIRS_MAX, total) }),
    lowerIsBetter: true,
    format: (ms) => formatClock(ms),
    cells: (t, r) => [
      { value: String(r.words), label: t('games.stat.words', { count: r.words }) },
      { value: String(r.mistakes.length), label: t('games.stat.mistakes', { count: r.mistakes.length }) },
      { value: t('games.seconds', { n: Math.round(r.penaltyMs / 1000) }), label: t('games.stat.penalty') },
    ],
  },
  {
    id: 'articles',
    nameKey: 'games.articles.name',
    ruleKey: 'games.articles.rule',
    Icon: ArticlesIcon,
    Name: ArticlesName,
    Play: ArticlesGame,
    minWords: MIN_PRACTICE_WORDS,
    maxWords: 20,
    languages: ['de'],
    fits: (w) => splitArticle(w.word, w.article).article !== null,
    notEnoughKey: 'games.notEnoughNouns',
    fact: (t) => t('games.articles.fact'),
    lowerIsBetter: false,
    format: formatPoints,
    cells: (t, r) => [
      { value: String(r.words), label: t('games.stat.words', { count: r.words }) },
      { value: String(r.mistakes.length), label: t('games.stat.mistakes', { count: r.mistakes.length }) },
      { value: formatClock(r.elapsedMs), label: t('games.stat.time') },
    ],
  },
]

export const gameById = (id: string | undefined): GameDef | undefined => GAMES.find((g) => g.id === id)

/** The games of a learning language, in catalog order. */
export const gamesFor = (lang: LearningLang): GameDef[] => GAMES.filter((g) => !g.languages || g.languages.includes(lang))

/** A record's best as the screen shows it: pairs "0:42", articles "17/20". */
export const formatRecord = (game: GameDef, rec: Pick<GameRecord, 'best' | 'best_of'>): string => game.format(rec.best, rec.best_of)
