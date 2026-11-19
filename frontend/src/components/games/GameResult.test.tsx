import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { foldersApi, wordsApi, type GameResultResponse } from '../../api/endpoints'
import { GameResult } from './GameResult'
import { gameById } from './registry'
import type { FinishedGame, GameWord } from './types'

vi.mock('../../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../api/endpoints')>()
  return { ...mod, foldersApi: { list: vi.fn() }, wordsApi: { ...mod.wordsApi, setRepeat: vi.fn() } }
})
vi.mock('../Toaster', () => ({ toast: vi.fn() }))

const word = (n: number, over: Partial<GameWord> = {}): GameWord => ({
  id: `c${n}`, context_id: 'x', word: `Wort${n}`, translation: `слово${n}`, transcription: '', language: 'de', created_at: '',
  translation_language: 'ru', box_level: 1, has_example: false, ...over,
})
const pairs = gameById('pairs')!
const articles = gameById('articles')!
const pairsResult = (mistakes: GameWord[] = []): FinishedGame => ({
  score: 38_000 + mistakes.length * 2000, of: null, words: 8, mistakes, elapsedMs: 38_000, penaltyMs: mistakes.length * 2000,
})
type Save = { pending: boolean; error: boolean; data?: GameResultResponse }
const saved = (data: GameResultResponse): Save => ({ pending: false, error: false, data })

function show(props: Partial<React.ComponentProps<typeof GameResult>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  const onAgain = vi.fn()
  const onBack = vi.fn()
  render(
    <QueryClientProvider client={qc}>
      <GameResult game={pairs} folder="f1" result={pairsResult()} save={{ pending: true, error: false }}
        onAgain={onAgain} onBack={onBack} {...props} />
    </QueryClientProvider>,
  )
  return { invalidate, onAgain, onBack }
}
const pill = () => screen.getByTestId('game-record').textContent

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(foldersApi.list).mockResolvedValue({
    all: { total: 30, new_count: 0, learning_count: 0, learned_count: 0, due_today: 0 },
    folders: [{ id: 'f1', name: 'Tiere', color: 'sky', created_at: '', total: 8, new_count: 0, learning_count: 0, learned_count: 0, due_today: 0 }],
  } as never)
  vi.mocked(wordsApi.setRepeat).mockResolvedValue({ marked: true })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('GameResult', () => {
  it('the kicker (game · folder), the time, a placeholder while saving, the three cells', async () => {
    show({ result: pairsResult([word(1), word(2)]) })
    expect(await screen.findByText('Pairs · Tiere')).toBeTruthy()
    expect(screen.getByTestId('game-score').textContent).toBe('0:42') // 38 s + 2 × 2 s
    expect(screen.getByTestId('game-record-pending')).toBeTruthy()
    expect(screen.getByText('8')).toBeTruthy()
    expect(screen.getByText('words')).toBeTruthy()
    expect(screen.getByText('mistakes')).toBeTruthy()
    expect(screen.getByText('+4 s')).toBeTruthy()
    expect(screen.getByText('penalty')).toBeTruthy()
  })

  it('a new record: "New best · was …" in the accent; the first one: "Your first best"', () => {
    show({ save: saved({ record: { game: 'pairs', best: 42_000, best_of: null, plays: 4 }, new_record: true, previous: 45_500 }) })
    expect(pill()).toBe('New best · was 0:45')
    expect(screen.getByTestId('game-record').className).toContain('bg-accent/15')
    cleanup()
    show({ save: saved({ record: { game: 'pairs', best: 42_000, best_of: null, plays: 1 }, new_record: true, previous: null }) })
    expect(pill()).toBe('Your first best')
  })

  it('no record: the best to beat, plain', () => {
    show({ save: saved({ record: { game: 'pairs', best: 31_000, best_of: null, plays: 5 }, new_record: false, previous: null }) })
    expect(pill()).toBe('Best: 0:31')
    expect(screen.getByTestId('game-record').className).not.toContain('bg-accent/15')
  })

  it('der · die · das: 17/20, the old best with its "out of", the time cell; "all words" as the folder', async () => {
    show({
      game: articles, folder: 'all',
      result: { score: 17, of: 20, words: 20, mistakes: [], elapsedMs: 75_000, penaltyMs: 0 },
      before: { game: 'articles', best: 15, best_of: 19, plays: 2 },
      save: saved({ record: { game: 'articles', best: 17, best_of: 20, plays: 3 }, new_record: true, previous: 15 }),
    })
    expect(screen.getByText('der · die · das · All words')).toBeTruthy()
    expect(screen.getByTestId('game-score').textContent).toBe('17/20')
    expect(pill()).toBe('New best · was 15/19')
    expect(screen.getByText('1:15')).toBeTruthy()
    expect(screen.getByText('time')).toBeTruthy()
  })

  it('the save failed: a small error line', () => {
    show({ save: { pending: false, error: true } })
    expect(screen.getByText('The result was not saved').className).toContain('text-danger')
  })

  it('no mistakes: no list and no "Review later"', () => {
    show()
    expect(screen.queryByText('Mistakes')).toBeNull()
    expect(screen.queryByRole('button', { name: /Review later/ })).toBeNull()
  })

  it('"Review later" marks every mistake, then shows the done state and refreshes the lists', async () => {
    const { invalidate } = show({ result: pairsResult([word(1, { word: 'der Hund', article: 'der' }), word(2)]) })
    expect(screen.getAllByTestId('game-mistake').map((r) => r.textContent)).toEqual(['der Hundслово1', 'Wort2слово2'])
    expect(screen.getByText('These words will come first in the cards and in training.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Review later · 2' }))
    const done = await screen.findByRole('button', { name: "We'll review them first · 2" })
    expect((done as HTMLButtonElement).disabled).toBe(true)
    expect(wordsApi.setRepeat).toHaveBeenCalledTimes(2)
    expect(wordsApi.setRepeat).toHaveBeenCalledWith('c1', true)
    expect(wordsApi.setRepeat).toHaveBeenCalledWith('c2', true)
    await waitFor(() => {
      for (const key of ['collection', 'folders', 'review-due', 'cards']) expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] })
    })
  })

  it('"Review later" fails: a toast, and the button can be pressed again', async () => {
    const { toast } = await import('../Toaster')
    vi.mocked(wordsApi.setRepeat).mockRejectedValue(new Error('down'))
    show({ result: pairsResult([word(1)]) })
    const button = screen.getByRole('button', { name: 'Review later · 1' })
    fireEvent.click(button)
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Couldn't save the mark"))
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })

  it('Play again and Back to the folder; the X goes back too', () => {
    const { onAgain, onBack } = show()
    fireEvent.click(screen.getByRole('button', { name: 'Play again' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to the folder' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onAgain).toHaveBeenCalledTimes(1)
    expect(onBack).toHaveBeenCalledTimes(2)
  })
})
