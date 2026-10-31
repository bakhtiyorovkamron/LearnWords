import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { cardsApi, foldersApi, heroApi, meApi, practiceApi, reviewApi, settingsApi, statsApi } from '../api/endpoints'
import type { DueCard, WordCard } from '../api/types'
import { ContextsPage } from '../pages/ContextsPage'
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
    heroApi: { ...mod.heroApi, get: vi.fn() },
    settingsApi: { get: vi.fn(), setReviewSessionSize: vi.fn(), setDailyGoal: vi.fn() },
    statsApi: { get: vi.fn() },
  }
})

const due = (n: number): DueCard => ({
  id: `c${n}`, context_id: 'x', word: `Wort${n}`, translation: `слово${n}`, transcription: '', language: 'de',
  example_sentence: '', example_translation: '', folder_id: null, created_at: '', box_level: 1, has_example: false,
} as DueCard)
const card = (n: number): WordCard => ({ ...due(n) } as unknown as WordCard)

const Where = () => <div data-testid="where">{useLocation().pathname + useLocation().search}</div>
function renderSession(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[url]}><Where /><ReviewSession /></MemoryRouter></QueryClientProvider>)
  return { invalidate }
}
const where = () => screen.getByTestId('where').textContent

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

describe('ReviewSession: ?start=1 (Home → Start training)', () => {
  it('with due words the session starts at once — no start screen — and the parameter is dropped', async () => {
    renderSession('/cards?start=1')
    // straight into the first question
    expect(await screen.findByRole('progressbar')).toBeTruthy()
    expect(screen.getByText('1/1')).toBeTruthy()
    expect(screen.queryByText(/Words to review today/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start training' })).toBeNull()
    await waitFor(() => expect(where()).toBe('/cards'))
  })

  it('it starts once: finishing the session does not start another', async () => {
    renderSession('/cards?start=1')
    await screen.findByRole('progressbar')
    await waitFor(() => expect(where()).toBe('/cards'))
    expect(reviewApi.due).toHaveBeenCalled()
    const asks = vi.mocked(reviewApi.due).mock.calls.length
    await new Promise((r) => setTimeout(r, 30))
    expect(vi.mocked(reviewApi.due).mock.calls.length).toBe(asks)
  })

  it('with nothing due: the normal "nothing to review" screen (and no session)', async () => {
    vi.mocked(reviewApi.due).mockResolvedValue({ cards: [], total: 0 })
    renderSession('/cards?start=1')
    expect(await screen.findByText('No words to review today')).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
    await waitFor(() => expect(where()).toBe('/cards'))
  })

  it('without the parameter the start screen is shown as before', async () => {
    renderSession('/cards')
    expect(await screen.findByRole('button', { name: 'Start training' })).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('while the session is on, the app knows it (the shell steps aside) and knows again when it is over', async () => {
    const { isTrainingOpen } = await import('../lib/trainingState')
    renderSession('/cards?start=1')
    await screen.findByRole('progressbar')
    await waitFor(() => expect(isTrainingOpen()).toBe(true))
    cleanup()
    expect(isTrainingOpen()).toBe(false)
  })
})

describe('ReviewSession: Home always starts a short session', () => {
  // The server hands out at most `limit` cards but reports the real total.
  const serve = (total: number) =>
    vi.mocked(reviewApi.due).mockImplementation(async (_folder, limit) => {
      const n = limit === 'all' ? total : Math.min(Number(limit), total)
      return { cards: Array.from({ length: n }, (_, i) => due(i + 1)), total }
    })

  it('?start=1&size=20 with the saved size "all": 20 questions, the saved size untouched', async () => {
    localStorage.setItem('review-session-size', 'all')
    serve(408)
    renderSession('/cards?start=1&size=20')
    expect(await screen.findByText('1/20')).toBeTruthy()
    expect(reviewApi.due).toHaveBeenCalledWith('', '20')
    expect(reviewApi.due).not.toHaveBeenCalledWith('', 'all')
    expect(localStorage.getItem('review-session-size')).toBe('all')
    expect(settingsApi.setReviewSessionSize).not.toHaveBeenCalled()
    await waitFor(() => expect(where()).toBe('/cards')) // both parameters are dropped
  })

  it('?start=1 without a size falls back to 20', async () => {
    localStorage.setItem('review-session-size', 'all')
    serve(408)
    renderSession('/cards?start=1')
    expect(await screen.findByText('1/20')).toBeTruthy()
  })

  it('Home → the button → a 20-question session; the saved size stays "all"', async () => {
    localStorage.setItem('review-session-size', 'all')
    serve(408)
    vi.mocked(foldersApi.list).mockResolvedValue({
      all: { total: 500, new_count: 0, learning_count: 0, learned_count: 0, due_today: 408 }, folders: [],
    } as never)
    const today = new Date().toISOString().slice(0, 10)
    vi.mocked(statsApi.get).mockResolvedValue({
      daily: [{ date: today, reviewed: 0, correct: 0, new_words: 0, active: false, goal_met: false }],
      totals: { current_streak_days: 0, longest_streak_days: 0, total_words_learned: 0, accuracy_percent: 0 },
    } as never)
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <Routes><Route path="/" element={<ContextsPage />} /><Route path="/cards" element={<ReviewSession />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('20 words')).toBeTruthy() // the daily goal, not the 408 due
    fireEvent.click(screen.getByRole('button', { name: /^Start/ }))
    expect(await screen.findByText('1/20')).toBeTruthy()
    expect(localStorage.getItem('review-session-size')).toBe('all')
  })

  it('without ?start the saved size is used as before', async () => {
    localStorage.setItem('review-session-size', 'all')
    serve(408)
    renderSession('/cards')
    await screen.findByRole('button', { name: 'Start training' })
    expect(reviewApi.due).toHaveBeenCalledWith('', 'all')
  })
})

describe('ReviewSession: ?start=1&size=N takes any whole number of words from 1 to 50', () => {
  const serve = (total: number) =>
    vi.mocked(reviewApi.due).mockImplementation(async (_folder, limit) => {
      const n = limit === 'all' ? total : Math.min(Number(limit), total)
      return { cards: Array.from({ length: n }, (_, i) => due(i + 1)), total }
    })

  it.each([
    ['12', '1/12', '20'], ['7', '1/7', '10'], ['1', '1/1', '10'], ['10', '1/10', '10'],
    ['21', '1/21', '50'], ['50', '1/50', '50'],
  ])('size=%s → %s questions, the server asked for %s', async (size, counter, fetched) => {
    serve(408)
    renderSession(`/cards?start=1&size=${size}`)
    expect(await screen.findByText(counter)).toBeTruthy()
    expect(reviewApi.due).toHaveBeenCalledWith('', fetched)
  })

  it('keeps the server order: the first N cards', async () => {
    serve(408)
    renderSession('/cards?start=1&size=12')
    await screen.findByText('1/12')
    // the first question is the first card the server sent
    expect(screen.getByText('Wort1')).toBeTruthy()
  })

  it.each(['0', '51', 'abc', '1.5', '-3', ''])('an invalid size (%j) falls back to 20', async (size) => {
    serve(408)
    renderSession(`/cards?start=1&size=${size}`)
    expect(await screen.findByText('1/20')).toBeTruthy()
  })

  it('fewer cards than N: the session is as long as what the server has', async () => {
    serve(5)
    renderSession('/cards?start=1&size=12')
    expect(await screen.findByText('1/5')).toBeTruthy()
  })
})

describe('ReviewSession: the screens use icons, not emoji', () => {
  it('the start screen has an icon', async () => {
    renderSession('/cards')
    await screen.findByRole('button', { name: 'Start training' })
    expect(document.querySelector('svg.text-accent-text')).not.toBeNull()
  })
})
