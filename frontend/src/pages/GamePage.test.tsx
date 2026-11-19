import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { foldersApi, gamesApi, meApi, practiceApi, type Me } from '../api/endpoints'
import type { DueCard } from '../api/types'
import { isTrainingOpen } from '../lib/trainingState'
import { GamePage } from './GamePage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    practiceApi: { words: vi.fn(), answer: vi.fn() },
    gamesApi: { records: vi.fn(), result: vi.fn() },
    foldersApi: { list: vi.fn() },
  }
})

const me = (games: boolean): Me => ({
  id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de',
  features: { folder_games: { enabled: games, daily_limit: null, remaining: null, credits: 0 } },
})
const card = (n: number, over: Partial<DueCard> = {}): DueCard => ({
  id: `c${n}`, context_id: 'x', word: `Wort${n}`, translation: `слово${n}`, transcription: '', language: 'de', created_at: '',
  translation_language: 'ru', box_level: 1, has_example: false, ...over,
})

const Where = () => <div data-testid="where">{useLocation().pathname + useLocation().search}</div>
function open(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/games/:game" element={<GamePage />} />
          <Route path="/words" element={<div>HUB</div>} />
          <Route path="/words/:folder" element={<div>FOLDER</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const where = () => screen.getByTestId('where').textContent

beforeEach(async () => {
  await i18n.changeLanguage('en')
  localStorage.clear()
  vi.mocked(meApi.get).mockResolvedValue(me(true))
  vi.mocked(practiceApi.words).mockResolvedValue([card(1), card(2), card(3), card(4)])
  vi.mocked(gamesApi.records).mockResolvedValue([])
  vi.mocked(gamesApi.result).mockResolvedValue({ record: { game: 'pairs', best: 5000, best_of: null, plays: 1 }, new_record: true, previous: null })
  vi.mocked(foldersApi.list).mockResolvedValue({ all: { total: 4, new_count: 0, learning_count: 0, learned_count: 0, due_today: 0 }, folders: [] } as never)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('GamePage', () => {
  it('full screen like a training, the deck page height; a random set of 50 words of the folder', async () => {
    open('/games/pairs?folder=f1')
    expect(await screen.findAllByTestId('pairs-left')).toHaveLength(4)
    expect(isTrainingOpen()).toBe(true)
    const page = screen.getByTestId('game-page').className.split(/\s+/)
    expect(page).toEqual(expect.arrayContaining([
      'max-w-xl', 'h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)]', 'md:h-[calc(100dvh-5rem)]',
    ]))
    expect(practiceApi.words).toHaveBeenCalledWith('random', 'f1', '50')
    cleanup()
    expect(isTrainingOpen()).toBe(false)
  })

  it('"all" asks for every word; only words with a translation, each by its first variant', async () => {
    vi.mocked(practiceApi.words).mockResolvedValue([
      card(1, { word: 'der Samstag / der Sonnabend' }), card(2), card(3), card(4), card(5, { translation: '  ' }),
    ])
    open('/games/pairs?folder=all')
    const left = await screen.findAllByTestId('pairs-left')
    expect(practiceApi.words).toHaveBeenCalledWith('random', '', '50')
    expect(left.map((b) => b.textContent).sort()).toEqual(['Wort2', 'Wort3', 'Wort4', 'der Samstag'])
  })

  it('too few words with a translation: the empty state and a way back to the folder', async () => {
    vi.mocked(practiceApi.words).mockResolvedValue([card(1), card(2), card(3), card(4, { translation: '' })])
    open('/games/pairs?folder=f1')
    expect((await screen.findByTestId('game-empty')).textContent).toContain('This game needs at least 4 words with a translation')
    fireEvent.click(screen.getByRole('button', { name: 'Back to the folder' }))
    expect(where()).toBe('/words/f1')
  })

  it('der · die · das with too few nouns: its own empty state', async () => {
    vi.mocked(practiceApi.words).mockResolvedValue([card(1, { word: 'der Hund' }), card(2, { word: 'Katze', article: 'die' }), card(3), card(4), card(5)])
    open('/games/articles?folder=none')
    expect((await screen.findByTestId('game-empty')).textContent).toContain('You need at least 4 nouns with an article')
    expect(practiceApi.words).toHaveBeenCalledWith('random', 'none', '50')
  })

  it('the flag off → back to the folder page; an unknown game → the folders', async () => {
    vi.mocked(meApi.get).mockResolvedValue(me(false))
    open('/games/pairs?folder=f1')
    await waitFor(() => expect(where()).toBe('/words/f1'))
    expect(practiceApi.words).not.toHaveBeenCalled()
    cleanup()
    vi.mocked(meApi.get).mockResolvedValue(me(true))
    open('/games/sprint?folder=f1')
    await waitFor(() => expect(where()).toBe('/words'))
  })

  it('while /me loads nothing of the game shows and no words are asked for', async () => {
    vi.mocked(meApi.get).mockReturnValue(new Promise(() => {}))
    open('/games/pairs?folder=f1')
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('pairs-left')).toBeNull()
    expect(practiceApi.words).not.toHaveBeenCalled()
    expect(where()).toBe('/games/pairs?folder=f1')
  })

  it('the X leaves for the folder page; nothing is saved', async () => {
    open('/games/pairs?folder=f1')
    await screen.findAllByTestId('pairs-left')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(where()).toBe('/words/f1')
    expect(gamesApi.result).not.toHaveBeenCalled()
  })

  it('a finished game: the result at once, the POST, the records refreshed; Play again deals a new set', async () => {
    open('/games/pairs?folder=f1')
    await screen.findAllByTestId('pairs-left')
    for (const n of [1, 2, 3, 4]) {
      fireEvent.click(screen.getByRole('button', { name: `Wort${n}` }))
      fireEvent.click(screen.getByRole('button', { name: `слово${n}` }))
    }
    expect(await screen.findByTestId('game-score')).toBeTruthy()
    expect(gamesApi.result).toHaveBeenCalledWith({ game: 'pairs', folder_id: 'f1', score: expect.any(Number), of: null })
    expect((await screen.findByTestId('game-record')).textContent).toBe('Your first best')
    await waitFor(() => expect(gamesApi.records).toHaveBeenCalledTimes(2)) // invalidated after the save

    fireEvent.click(screen.getByRole('button', { name: 'Play again' }))
    expect(await screen.findAllByTestId('pairs-left')).toHaveLength(4)
    expect(practiceApi.words).toHaveBeenCalledTimes(2)
  })
})
