import { describe, expect, it } from 'vitest'
import { heroTranslation, pickHeroPhrase } from './heroPhrases'

describe('pickHeroPhrase', () => {
  it('stage 1 shortens "correct" to the one-word form', () => {
    const phrase = pickHeroPhrase('correct', 1, () => 0)
    expect(phrase.de).toBe('Super!')
  })

  it('stage 1 shortens "wrong" to "Oh!", not the full-list lines', () => {
    const phrase = pickHeroPhrase('wrong', 1, () => 0)
    expect(phrase.de).toBe('Oh!')
  })

  it('stage 2+ uses the full line pool for "wrong" (not the stage-1 "Oh!")', () => {
    const picks = [0, 1, 2].map((i) => pickHeroPhrase('wrong', 2, () => i).de)
    expect(picks).toEqual(['Ach nein!', 'Schade!', 'Nicht schlimm!'])
  })

  it('a key with only one line (e.g. word_learned) ignores stage entirely', () => {
    expect(pickHeroPhrase('wordLearned', 1, () => 0).de).toBe('Neues Wort gelernt!')
    expect(pickHeroPhrase('wordLearned', 6, () => 0).de).toBe('Neues Wort gelernt!')
  })

  it('pick(n) selects the exact index, not just the first', () => {
    const last = pickHeroPhrase('correct', 5, (n) => n - 1)
    expect(last.de).toBe('Toll!')
  })
})

describe('heroTranslation', () => {
  it('returns the requested language line', () => {
    const phrase = pickHeroPhrase('sessionFinished', 3, () => 0)
    expect(heroTranslation(phrase, 'ru')).toBe('Молодец!')
    expect(heroTranslation(phrase, 'en')).toBe('Well done!')
    expect(heroTranslation(phrase, 'uz')).toBe('Barakalla!')
  })

  it('uz lines use U+02BB for every apostrophe, never U+2019/U+0027', () => {
    const phrase = pickHeroPhrase('streak5', 3, () => 0)
    const uz = heroTranslation(phrase, 'uz')
    expect(uz).not.toMatch(/['’]/)
    expect(uz).toContain('ʻ')
  })
})
