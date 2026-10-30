import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { cardsApi, foldersApi, heroApi, meApi, practiceApi, reviewApi, settingsApi, translationsApi } from '../api/endpoints'
import type { DueCard, WordCard } from '../api/types'
import { ReviewSession } from './ReviewSession'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    reviewApi: { due: vi.fn(), answer: vi.fn() },
    practiceApi: { words: vi.fn(), answer: vi.fn() },
    cardsApi: { list: vi.fn() },
    foldersApi: { list: vi.fn() },
    translationsApi: { batch: vi.fn() },
    heroApi: { ...mod.heroApi, get: vi.fn() },
    settingsApi: { get: vi.fn(), setReviewSessionSize: vi.fn() },
  }
})

const due = (n: number): DueCard => ({
  id: `c${n}`, context_id: 'x', word: `Wort${n}`, translation: `слово${n}`, transcription: '', language: 'de',
  example_sentence: '', example_translation: '', folder_id: null, created_at: '', box_level: 1, has_example: false,
} as DueCard)
const card = (n: number): WordCard => ({ ...due(n) } as unknown as WordCard)

function renderSession(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[url]}><ReviewSession /></MemoryRouter></QueryClientProvider>)
  return { invalidate }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  localStorage.clear()
  localStorage.setItem('review-direction', 'de_ru')
  vi.mocked(meApi.get).mockResolvedValue({ id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de' })
  vi.mocked(foldersApi.list).mockResolvedValue({ all: { total: 0 }, folders: [] } as never)
  vi.mocked(heroApi.get).mockRejectedValue({ response: { status: 404 } })
  vi.mocked(settingsApi.get).mockResolvedValue({ interface_language: '', review_session_size: '', theme: '' })
  vi.mocked(settingsApi.setReviewSessionSize).mockResolvedValue({} as never)
  vi.mocked(cardsApi.list).mockResolvedValue([1, 2, 3, 4].map(card))
  vi.mocked(translationsApi.batch).mockImplementation(async (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, { translation: `перевод ${id}`, example_translation: '' }])))
  vi.mocked(reviewApi.due).mockResolvedValue({ cards: [due(1)], total: 1 })
  vi.mocked(reviewApi.answer).mockResolvedValue({ box_level: 2, is_learned: false } as never)
  vi.mocked(practiceApi.words).mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('ReviewSession: ?practice=1', () => {
  it('opens the "Which words to practice?" screen right away', async () => {
    renderSession('/cards?practice=1')
    expect(await screen.findByText('Which words to practice?')).toBeTruthy()
    expect(screen.queryByText(/Words to review today/)).toBeNull()
  })

  it('without the parameter the normal start screen is shown', async () => {
    renderSession('/cards')
    expect(await screen.findByText('Words to review today: 1')).toBeTruthy()
    expect(screen.queryByText('Which words to practice?')).toBeNull()
  })

  it('the practice screen starts a practice session as usual', async () => {
    vi.mocked(practiceApi.words).mockResolvedValue([due(2)])
    renderSession('/cards?practice=1')
    await screen.findByText('Which words to practice?')
    fireEvent.click(screen.getByRole('button', { name: /Start|Practice/ }))
    await waitFor(() => expect(practiceApi.words).toHaveBeenCalled())
  })
})

describe('ReviewSession: Home shows a fresh due count', () => {
  it('an answer invalidates the folders list (and the stats)', async () => {
    const { invalidate } = renderSession('/cards')
    fireEvent.click(await screen.findByRole('button', { name: 'Start training' }))
    // the first question: pick any option
    const options = await screen.findAllByRole('button', { name: /перевод c\d|слово\d/ })
    fireEvent.click(options[0])
    await waitFor(() => expect(reviewApi.answer).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['folders'] }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['stats'] })
  })
})
