import { describe, expect, it } from 'vitest'
import type { WordCheck } from '../api/endpoints'
import { grammarOf, isCheckable, showBaseForm, suggestionOf } from './wordCheck'

const res = (r: Partial<WordCheck>): WordCheck => ({
  status: 'ok', input: '', lemma: '', article: null, plural: null, part_of_speech: 'other', translation: '', reason: '', ...r,
})

describe('word check helpers', () => {
  it('checks single words and short phrases only', () => {
    expect(isCheckable('Sfit')).toBe(true)
    expect(isCheckable('Bis nächste Woche!')).toBe(true)
    expect(isCheckable('  ')).toBe(false)
    expect(isCheckable('Ich gehe heute Abend mit meinen Freunden ins Kino')).toBe(false)
    expect(isCheckable('Zeile eins\nZeile zwei')).toBe(false)
  })

  it('suggests article + base form for nouns', () => {
    const sfit = res({ status: 'corrected', input: 'Sfit', lemma: 'Stift', article: 'der', plural: 'Stifte', part_of_speech: 'noun' })
    expect(suggestionOf(sfit)).toBe('der Stift')
    expect(grammarOf(sfit)).toEqual({ lemma: 'Stift', article: 'der', plural: 'Stifte', part_of_speech: 'noun' })
    expect(showBaseForm(sfit)).toBe(true)
  })

  it('shows the base form only when it differs from the input', () => {
    expect(showBaseForm(res({ input: 'komme', lemma: 'kommen', part_of_speech: 'verb' }))).toBe(true)
    expect(showBaseForm(res({ input: 'die Tisch', lemma: 'Tisch', article: 'der', part_of_speech: 'noun' }))).toBe(false)
    expect(showBaseForm(res({ input: 'Bis nächste Wohce', lemma: 'Bis nächste Woche', part_of_speech: 'phrase' }))).toBe(false)
  })

  it('stores no grammar for failed checks', () => {
    expect(grammarOf(res({ status: 'error', input: 'Zeit', lemma: 'Zeit' }))).toBeNull()
  })

  it('stores no grammar for unknown words', () => {
    expect(grammarOf(res({ status: 'unknown', input: 'Qwrtz' }))).toBeNull()
  })
})
