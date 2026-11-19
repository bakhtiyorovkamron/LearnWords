import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { ArticlesGame } from './ArticlesGame'
import type { FinishedGame, GameWord } from './types'

const noun = (id: string, word: string, translation: string, article: string | null = null): GameWord => ({
  id, context_id: 'x', word, translation, transcription: '', language: 'de', created_at: '', translation_language: 'ru',
  box_level: 1, has_example: false, article,
})
// In this order (GamePage shuffles them before): Hund, Katze, Haus, Tisch.
const nouns = () => [
  noun('h', 'der Hund', 'собака'),
  noun('k', 'Katze', 'кошка', 'die'), // the article from the word check, not in the word
  noun('a', 'das Haus', 'дом'),
  noun('t', 'der Tisch', 'стол'),
]

function play(list = nouns()) {
  const onFinish = vi.fn<(r: FinishedGame) => void>()
  render(<ArticlesGame words={list} lang="de" title="der · die · das" onFinish={onFinish} onClose={() => {}} />)
  return onFinish
}
const shown = () => screen.getByTestId('articles-noun').textContent
const pick = (a: 'der' | 'die' | 'das') => fireEvent.click(screen.getByTestId(`articles-${a}`))
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
const sub = () => screen.getByTestId('game-sub').textContent

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.useFakeTimers()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('ArticlesGame', () => {
  it('the noun without its article, its translation, three buttons; 1 of 4', () => {
    play()
    expect(shown()).toBe('Hund')
    expect(screen.getByText('собака')).toBeTruthy()
    expect(['der', 'die', 'das'].map((a) => screen.getByTestId(`articles-${a}`).textContent)).toEqual(['der', 'die', 'das'])
    expect(screen.getByTestId('articles-der').className).toContain('text-der')
    expect(sub()).toBe('1 of 4')
  })

  it('right: the button lights up, the next noun comes after 350 ms, the line above shows the answer', () => {
    play()
    pick('der')
    expect(screen.getByTestId('articles-der').className).toContain('bg-der/25')
    wait(349)
    expect(shown()).toBe('Hund')
    wait(1)
    expect(shown()).toBe('Katze')
    expect(screen.getByTestId('articles-last').textContent).toBe('der Hund')
    expect(screen.getByTestId('articles-last-right')).toBeTruthy()
    expect(sub()).toBe('2 of 4')
    expect(screen.getByTestId('game-progress').style.width).toBe('25%')
  })

  it('a press while an answer is shown counts for nothing', () => {
    const onFinish = play()
    pick('der')
    pick('die') // still on Hund's answer
    wait(350)
    expect(shown()).toBe('Katze')
    pick('die'); wait(350)
    pick('das'); wait(350)
    pick('der'); wait(350)
    expect(onFinish.mock.calls[0][0].score).toBe(4)
  })

  it('wrong: the tapped one flashes, the right one lights up, the noun shows with its article for 900 ms', () => {
    play()
    pick('das')
    expect(screen.getByTestId('articles-das').className).toContain('border-danger')
    expect(screen.getByTestId('articles-der').className).toContain('bg-der/25')
    expect(shown()).toBe('der Hund')
    expect(screen.getByTestId('articles-noun').querySelector('.text-der')?.textContent).toBe('der ')
    wait(899)
    expect(shown()).toBe('der Hund')
    wait(1)
    expect(shown()).toBe('Katze')
    expect(screen.getByTestId('articles-last-wrong')).toBeTruthy()
  })

  it('a missed noun comes back once at the end; the score counts first tries only', () => {
    const onFinish = play()
    pick('die'); wait(900) // Hund: wrong → comes back
    pick('die'); wait(350) // Katze
    pick('der'); wait(900) // Haus: wrong → comes back
    pick('der'); wait(350) // Tisch
    expect(shown()).toBe('Hund')
    expect(sub()).toBe('4 of 4')
    pick('der'); wait(350) // Hund again: right, but not on the first try
    expect(shown()).toBe('Haus')
    pick('die'); wait(900) // Haus wrong again: it does not come back a second time
    expect(onFinish).toHaveBeenCalledTimes(1)
    const r = onFinish.mock.calls[0][0]
    expect(r.score).toBe(2)
    expect(r.of).toBe(4)
    expect(r.words).toBe(4)
    expect(r.mistakes.map((w) => w.id)).toEqual(['h', 'a'])
  })

  it('the streak shows from 2 and a miss resets it', () => {
    play()
    pick('der'); wait(350)
    expect(screen.getByTestId('articles-streak').textContent).toBe('')
    pick('die'); wait(350)
    expect(screen.getByTestId('articles-streak').textContent).toBe('streak 2')
    pick('der'); wait(900) // Haus is das
    expect(screen.getByTestId('articles-streak').textContent).toBe('')
  })

  it('keys 1 / 2 / 3 answer der / die / das', () => {
    const onFinish = play()
    fireEvent.keyDown(window, { key: '1' }); wait(350) // Hund: der
    expect(shown()).toBe('Katze')
    fireEvent.keyDown(window, { key: '2' }); wait(350) // Katze: die
    fireEvent.keyDown(window, { key: '3' }); wait(350) // Haus: das
    fireEvent.keyDown(window, { key: '1' }); wait(350) // Tisch: der
    expect(onFinish.mock.calls[0][0].score).toBe(4)
  })

  it('the clock counts up and stops at the end', () => {
    vi.setSystemTime(new Date('2026-11-19T10:00:00Z'))
    const onFinish = play()
    wait(61_000)
    expect(screen.getByTestId('game-pill').textContent).toBe('1:01')
    for (const a of ['der', 'die', 'das', 'der'] as const) { pick(a); wait(350) }
    expect(onFinish.mock.calls[0][0].elapsedMs).toBe(61_000 + 4 * 350)
  })
})
