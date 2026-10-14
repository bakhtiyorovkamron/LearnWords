import { describe, expect, it } from 'vitest'
import { highlightStory, wordForms } from './storyHighlight'

const hl = (text: string, words: Parameters<typeof highlightStory>[1]) =>
  highlightStory(text, words).filter((s) => s.hl).map((s) => s.text)

describe('highlightStory', () => {
  it('finds a conjugated verb by its lemma: kommen → kommt', () => {
    const words = [{ word: 'kommen', translation: '', lemma: 'kommen', part_of_speech: 'verb' }]
    expect(hl('Sie kommt heute nach Hause.', words)).toEqual(['kommt'])
  })

  it('works for a word saved in another form, via its lemma', () => {
    const words = [{ word: 'komme', translation: '', lemma: 'kommen', part_of_speech: 'verb' }]
    expect(hl('Er kommt, wir kommen.', words)).toEqual(['kommt', 'kommen'])
  })

  it('uses forms reported by proofreading for irregular forms', () => {
    const words = [{ word: 'kommen', translation: '', lemma: 'kommen', part_of_speech: 'verb', forms: ['kam'] }]
    expect(hl('Gestern kam sie spät.', words)).toEqual(['kam'])
  })

  it('finds nouns with endings and keeps the AI bold markers', () => {
    const words = [{ word: 'der Stift', translation: '', lemma: 'Stift', article: 'der', part_of_speech: 'noun' }]
    const segs = highlightStory('**Der magische Stift** liegt bei den Stiften.', words)
    expect(segs.filter((s) => s.hl).map((s) => s.text)).toEqual(['Der magische Stift', 'Stiften'])
    expect(segs.map((s) => s.text).join('')).toBe('Der magische Stift liegt bei den Stiften.')
  })

  it('does not highlight unrelated words with the same beginning', () => {
    const words = [{ word: 'kommen', translation: '', lemma: 'kommen', part_of_speech: 'verb' }]
    expect(hl('Die Kommode ist alt.', words)).toEqual([])
  })

  it('highlights phrases as a whole', () => {
    const words = [{ word: 'Bis nächste Woche!', translation: '', lemma: 'Bis nächste Woche!', part_of_speech: 'phrase' }]
    expect(hl('Sie sagt: bis nächste Woche! Dann geht sie.', words)).toEqual(['bis nächste Woche!'])
  })

  it('guesses infinitives of unchecked words', () => {
    expect(wordForms({ word: 'spielen', translation: '' }).has('spielt')).toBe(true)
  })
})
