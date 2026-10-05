import type { DueCard, WordCard } from '../api/types'

// Question formats in the daily training.
export type QuizFormat =
  | 'de_ru'     // German word → choose Russian translation
  | 'ru_de'     // Russian translation → choose German word
  | 'ru_de_type'// Russian translation → type the German word
  | 'gap'       // example sentence with ___ → choose the missing word

export interface QuizItem {
  card: DueCard
  format: QuizFormat
}

export type Verdict = 'correct' | 'almost_article' | 'almost_typo' | 'wrong'

const ARTICLES = ['der', 'die', 'das']

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// "der Samstag / der Sonnabend" → ["der Samstag", "der Sonnabend"]
export function variants(word: string): string[] {
  return word.split('/').map((v) => v.trim()).filter(Boolean)
}

export function firstVariant(word: string): string {
  return variants(word)[0] ?? word
}

/** Training direction: what is shown (DE word or RU translation). "mixed" picks per word. */
export type Direction = 'de_ru' | 'ru_de' | 'mixed'

/**
 * Formats that make sense for this card in the chosen direction.
 * - DE → RU: German word → choose translation; gap-fill (German sentence) too.
 * - RU → DE: translation → choose German word, or type it (box 3+ only); gap-fill too.
 * - mixed: every word randomly gets one of the two directions, then a format of that direction.
 * Gap only with an example; words without a translation can only be asked as gap-fill.
 */
export function availableFormats(card: DueCard, direction: Direction = 'mixed'): QuizFormat[] {
  const dir = direction === 'mixed' ? (Math.random() < 0.5 ? 'de_ru' : 'ru_de') : direction
  const hasTranslation = card.translation.trim() !== ''
  const out: QuizFormat[] = []
  if (hasTranslation) {
    if (dir === 'de_ru') {
      out.push('de_ru')
    } else {
      out.push('ru_de')
      if (card.box_level >= 3) out.push('ru_de_type')
    }
  }
  if (card.has_example) out.push('gap')
  return out
}

/** Builds the session queue: a random suitable format per card; cards with nothing to ask are skipped. */
export function buildQueue(cards: DueCard[], direction: Direction = 'mixed'): QuizItem[] {
  const items: QuizItem[] = []
  for (const card of cards) {
    const formats = availableFormats(card, direction)
    if (!formats.length) continue
    items.push({ card, format: formats[Math.floor(Math.random() * formats.length)] })
  }
  return items
}

/** Correct answer + 2 random distinct wrong ones taken from the user's other cards. */
export function buildOptions(item: QuizItem, pool: WordCard[]) {
  const pick = (c: WordCard) => (item.format === 'de_ru' ? c.translation : firstVariant(c.word)).trim()
  const right = pick(item.card)
  const seen = new Set([right.toLowerCase()])
  const wrong: string[] = []
  for (const c of shuffle(pool)) {
    const v = pick(c)
    if (!v || c.id === item.card.id || seen.has(v.toLowerCase())) continue
    seen.add(v.toLowerCase())
    wrong.push(v)
    if (wrong.length === 2) break
  }
  const lacking = wrong.length < 2
  while (wrong.length < 2) wrong.push('—')
  return {
    lacking,
    options: shuffle([{ text: right, correct: true }, ...wrong.map((text) => ({ text, correct: false }))]),
  }
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,!?;:"„“]/g, '')
}

function splitArticle(s: string): { article: string | null; noun: string } {
  const [first, ...rest] = s.split(' ')
  if (rest.length && ARTICLES.includes(first)) return { article: first, noun: rest.join(' ') }
  return { article: null, noun: s }
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}

/**
 * Checks a typed German answer against every spelling variant of the card.
 * - exact (case-insensitive) → correct
 * - right noun, wrong/missing article → almost_article (counts as correct for progress)
 * - one typo (Levenshtein ≤ 1, words longer than 3 letters) → almost_typo (counts as correct)
 */
export function checkTyped(input: string, word: string): Verdict {
  const typed = normalize(input)
  if (!typed) return 'wrong'
  let best: Verdict = 'wrong'
  const rank: Record<Verdict, number> = { correct: 3, almost_article: 2, almost_typo: 1, wrong: 0 }
  for (const v of variants(word)) {
    const expected = normalize(v)
    let verdict: Verdict = 'wrong'
    if (typed === expected) {
      verdict = 'correct'
    } else {
      const e = splitArticle(expected)
      const t = splitArticle(typed)
      if (e.article && t.noun === e.noun) {
        verdict = 'almost_article'
      } else if (!e.article && t.article && t.noun === e.noun) {
        verdict = 'correct' // user added an article the word doesn't have in our data
      } else if (e.noun.length > 3 && levenshtein(t.noun, e.noun) <= 1 && (!e.article || t.article === e.article)) {
        verdict = 'almost_typo'
      }
    }
    if (rank[verdict] > rank[best]) best = verdict
  }
  return best
}

export const countsAsCorrect = (v: Verdict) => v !== 'wrong'
