import { describe, expect, it } from 'vitest'
import type { DueCard, WordCard } from '../api/types'
import { buildOptions, pickDistractors, type QuizFormat, type QuizItem } from './quiz'

const w = (n: number, lang: string | null | undefined, over: Partial<WordCard> = {}): WordCard => ({
  id: `c${n}`, context_id: 'x', word: `Wort${n}`, translation: `перевод${n}`, transcription: '', language: 'de',
  created_at: '', translation_language: lang, ...over,
} as WordCard)
const item = (card: WordCard, format: QuizFormat): QuizItem => ({ card: { ...card, box_level: 1, has_example: false } as DueCard, format })

describe('pickDistractors (de_ru)', () => {
  it('prefers distractors with the same translation language when there are at least 2', () => {
    const pool = [w(2, 'ru'), w(3, 'uz'), w(4, 'ru'), w(5, 'en'), w(6, 'ru')]
    for (let i = 0; i < 20; i++) { // the pool is shuffled: the result must not depend on the order
      const r = pickDistractors(item(w(1, 'ru'), 'de_ru'), pool)
      expect(r.cards).toHaveLength(2)
      expect(r.cards.every((c) => c.translation_language === 'ru')).toBe(true)
      expect(r.lacking).toBe(false)
    }
  })

  it('with only 1 same-language distractor it fills up with another and is not lacking', () => {
    const pool = [w(2, 'ru'), w(3, 'uz'), w(4, 'en')]
    const r = pickDistractors(item(w(1, 'ru'), 'de_ru'), pool)
    expect(r.cards).toHaveLength(2)
    expect(r.cards.some((c) => c.id === 'c2')).toBe(true)
    expect(r.lacking).toBe(false)
  })

  it('is lacking only when 2 distractors cannot be found at all', () => {
    expect(pickDistractors(item(w(1, 'ru'), 'de_ru'), [w(2, 'ru')]).lacking).toBe(true)
    expect(pickDistractors(item(w(1, 'ru'), 'de_ru'), [w(2, 'uz'), w(3, 'en')]).lacking).toBe(false)
  })

  it('a missing language (cards from before the column) is its own group', () => {
    const pool = [w(2, null), w(3, undefined), w(4, 'ru'), w(5, 'ru')]
    for (let i = 0; i < 20; i++) {
      const r = pickDistractors(item(w(1, null), 'de_ru'), pool)
      expect(r.cards.map((c) => c.id).sort()).toEqual(['c2', 'c3'])
    }
  })

  it('never uses the same translation text twice or the question card', () => {
    const pool = [w(1, 'ru'), w(2, 'ru', { translation: 'перевод1' }), w(3, 'ru')]
    const r = pickDistractors(item(w(1, 'ru'), 'de_ru'), pool)
    expect(r.cards.map((c) => c.id)).toEqual(['c3'])
    expect(r.lacking).toBe(true)
  })
})

describe('pickDistractors (ru_de, gap)', () => {
  it('ignores the translation language: options are German words', () => {
    const pool = [w(2, 'uz'), w(3, 'en'), w(4, 'ru')]
    for (const format of ['ru_de', 'gap'] as const) {
      const seen = new Set<string>()
      for (let i = 0; i < 60; i++) pickDistractors(item(w(1, 'ru'), format), pool).cards.forEach((c) => seen.add(c.id))
      expect(seen.size).toBe(3) // every card can be picked, whatever its language
    }
  })
})

describe('buildOptions', () => {
  it('de_ru: the options are the cards\' own stored translations', () => {
    const q = item(w(1, 'ru', { translation: 'когда' }), 'de_ru')
    const { options, lacking } = buildOptions(q, [w(2, 'ru'), w(3, 'ru')])
    expect(lacking).toBe(false)
    expect(options.map((o) => o.text).sort()).toEqual(['когда', 'перевод2', 'перевод3'])
    expect(options.find((o) => o.correct)?.text).toBe('когда')
  })

  it('ru_de: German words; fewer than 2 distractors is lacking', () => {
    const { options, lacking } = buildOptions(item(w(1, 'ru'), 'ru_de'), [w(2, 'ru')])
    expect(lacking).toBe(true)
    expect(options.find((o) => o.correct)?.text).toBe('Wort1')
  })
})
