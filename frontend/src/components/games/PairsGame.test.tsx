import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { PairsGame, splitRounds } from './PairsGame'
import type { FinishedGame, GameWord } from './types'

const word = (n: number, over: Partial<GameWord> = {}): GameWord => ({
  id: `c${n}`, context_id: 'x', word: `Wort${n}`, translation: `слово${n}`, transcription: '', language: 'de', created_at: '',
  translation_language: 'ru', box_level: 1, has_example: false, ...over,
})
const words = (n: number) => Array.from({ length: n }, (_, i) => word(i + 1))

function play(list: GameWord[]) {
  const onFinish = vi.fn<(r: FinishedGame) => void>()
  render(<PairsGame words={list} lang="de" title="Pairs" onFinish={onFinish} onClose={() => {}} />)
  return onFinish
}
const tile = (name: string) => screen.getByRole('button', { name })
const tap = (name: string) => fireEvent.click(tile(name))
const pill = () => screen.getByTestId('game-pill').textContent
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-19T10:00:00Z'))
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('splitRounds', () => {
  it('up to 6 words → one round; more → two, split evenly', () => {
    expect(splitRounds(words(4)).map((r) => r.length)).toEqual([4])
    expect(splitRounds(words(6)).map((r) => r.length)).toEqual([6])
    expect(splitRounds(words(7)).map((r) => r.length)).toEqual([4, 3])
    expect(splitRounds(words(12)).map((r) => r.length)).toEqual([6, 6])
  })
})

describe('PairsGame', () => {
  it('the words on the left, their translations on the right, the hint, round 1 of 1, 0:00', () => {
    play(words(4))
    expect(screen.getAllByTestId('pairs-left').map((b) => b.textContent)).toEqual(['Wort1', 'Wort2', 'Wort3', 'Wort4'])
    expect(screen.getAllByTestId('pairs-right').map((b) => b.textContent).sort()).toEqual(['слово1', 'слово2', 'слово3', 'слово4'])
    expect(screen.getByText('Tap a word, then its translation')).toBeTruthy()
    expect(screen.getByTestId('game-sub').textContent).toBe('round 1 of 1')
    expect(pill()).toBe('0:00')
  })

  it('a tap selects; another tile of the same column moves the selection; the same tile again deselects', () => {
    play(words(4))
    tap('Wort1')
    expect(tile('Wort1').getAttribute('aria-pressed')).toBe('true')
    tap('Wort2')
    expect(tile('Wort1').getAttribute('aria-pressed')).toBe('false')
    expect(tile('Wort2').getAttribute('aria-pressed')).toBe('true')
    tap('Wort2')
    expect(tile('Wort2').getAttribute('aria-pressed')).toBe('false')
  })

  it('a match marks both done (disabled, with a check) and moves the progress', () => {
    play(words(4))
    tap('Wort1')
    tap('слово1')
    for (const name of ['Wort1', 'слово1']) {
      expect(tile(name).dataset.done).toBe('true')
      expect((tile(name) as HTMLButtonElement).disabled).toBe(true)
      expect(tile(name).className).toContain('opacity-30')
    }
    expect(screen.getByTestId('game-progress').style.width).toBe('25%')
    // Either side first: a translation, then its word.
    tap('слово2')
    tap('Wort2')
    expect(tile('Wort2').dataset.done).toBe('true')
  })

  it('the same translation text matches too (two words with one translation)', () => {
    play([word(1, { translation: 'дом' }), word(2, { translation: 'дом' }), word(3), word(4)])
    const [first, second] = screen.getAllByRole('button', { name: 'дом' })
    tap('Wort1')
    fireEvent.click(second) // whichever "дом" it is
    tap('Wort2')
    fireEvent.click(first)
    expect([first, second].every((b) => b.dataset.done === 'true')).toBe(true)
    expect(tile('Wort2').dataset.done).toBe('true')
  })

  it('a miss flashes both, shows "+2 s" for a moment, adds 2 s to the clock; nothing is done', () => {
    play(words(4))
    tap('Wort1')
    tap('слово2')
    expect(tile('Wort1').dataset.missed).toBe('true')
    expect(tile('слово2').dataset.missed).toBe('true')
    expect(tile('Wort1').className).toContain('game-shake')
    expect(screen.getByTestId('pairs-penalty').textContent).toBe('+2 s')
    expect(pill()).toBe('0:02')
    expect(tile('Wort1').dataset.done).toBeUndefined()
    wait(700)
    expect(screen.queryByTestId('pairs-penalty')).toBeNull()
    expect(tile('Wort1').dataset.missed).toBeUndefined()
  })

  it('the clock starts at the first tap, not on opening', () => {
    play(words(4))
    wait(5000)
    expect(pill()).toBe('0:00')
    tap('Wort1')
    wait(3000)
    expect(pill()).toBe('0:03')
  })

  it('the last match calls onFinish with the time plus the penalties, and the mistakes', () => {
    const onFinish = play(words(4))
    tap('Wort1')
    wait(1000)
    tap('слово3') // a miss: Wort1 goes to the mistakes
    tap('Wort3')
    tap('слово4') // a second miss, with another word
    for (const n of [1, 2, 3, 4]) {
      wait(1000)
      tap(`Wort${n}`)
      tap(`слово${n}`)
    }
    expect(onFinish).not.toHaveBeenCalled() // the last check is shown first
    wait(400)
    expect(onFinish).toHaveBeenCalledTimes(1)
    const r = onFinish.mock.calls[0][0]
    expect(r.elapsedMs).toBe(5000)
    expect(r.penaltyMs).toBe(4000)
    expect(r.score).toBe(9000)
    expect(r.of).toBeNull()
    expect(r.words).toBe(4)
    expect(r.mistakes.map((w) => w.id)).toEqual(['c1', 'c3'])
    wait(5000)
    expect(pill()).toBe('0:09') // the clock stopped at the last match
  })

  it('7 words: two rounds (4 + 3); the second comes 400 ms after the first is done', () => {
    const onFinish = play(words(7))
    expect(screen.getAllByTestId('pairs-left')).toHaveLength(4)
    const round1 = screen.getAllByTestId('pairs-left').map((b) => b.textContent!)
    for (const w of round1) { tap(w); tap(w.replace('Wort', 'слово')) }
    wait(399)
    expect(screen.getByTestId('game-sub').textContent).toBe('round 1 of 2')
    wait(1)
    expect(screen.getByTestId('game-sub').textContent).toBe('round 2 of 2')
    const round2 = screen.getAllByTestId('pairs-left').map((b) => b.textContent!)
    expect(round2).toHaveLength(3)
    expect(round2.every((w) => !round1.includes(w))).toBe(true)
    expect(screen.getByTestId('game-progress').style.width).toBe(`${(4 / 7) * 100}%`)
    for (const w of round2) { tap(w); tap(w.replace('Wort', 'слово')) }
    wait(400)
    expect(onFinish).toHaveBeenCalledTimes(1)
    expect(onFinish.mock.calls[0][0].words).toBe(7)
  })

  it('the article of a word is coloured on its tile', () => {
    play([word(1, { word: 'der Hund', article: 'der' }), word(2), word(3), word(4)])
    const art = tile('der Hund').querySelector('[data-article="der"]')
    expect(art?.className).toContain('text-der')
  })
})
