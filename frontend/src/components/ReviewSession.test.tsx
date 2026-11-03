import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { cardsApi, foldersApi, heroApi, meApi, reviewApi, settingsApi, statsApi } from '../api/endpoints'
import type { DueCard, WordCard } from '../api/types'
import { ContextsPage } from '../pages/ContextsPage'
import { ReviewSession } from './ReviewSession'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    reviewApi: { due: vi.fn(), answer: vi.fn() },
    cardsApi: { list: vi.fn() },
    foldersApi: { list: vi.fn() },
    heroApi: { ...mod.heroApi, get: vi.fn() },
    settingsApi: { get: vi.fn(), setDailyGoal: vi.fn() },
    statsApi: { get: vi.fn() },
  }
})

const due = (n: number): DueCard => ({
  id: `c${n}`, context_id: 'x', word: `Wort${n}`, translation: `слово${n}`, transcription: '', language: 'de',
  example_sentence: '', example_translation: '', folder_id: null, created_at: '', box_level: 1, has_example: false,
} as DueCard)
const card = (n: number): WordCard => ({ ...due(n) } as unknown as WordCard)

const todayIso = () => new Date().toISOString().slice(0, 10)
/** GET /stats?period=week with today's answers so far. */
const week = (reviewed: number, streak = 0) => ({
  daily: [{ date: todayIso(), reviewed, correct: reviewed, new_words: 0, active: reviewed > 0, goal_met: false }],
  totals: { current_streak_days: streak, longest_streak_days: streak, total_words_learned: 0, accuracy_percent: 0 },
})

const Where = () => <div data-testid="where">{useLocation().pathname + useLocation().search}</div>
function renderSession(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[url]}><Where /><Routes><Route path="/train" element={<ReviewSession />} /><Route path="*" element={<div>ELSEWHERE</div>} /></Routes></MemoryRouter></QueryClientProvider>)
  return { invalidate }
}
const where = () => screen.getByTestId('where').textContent

beforeEach(async () => {
  await i18n.changeLanguage('en')
  localStorage.clear()
  localStorage.setItem('review-direction', 'de_ru')
  vi.mocked(meApi.get).mockResolvedValue({ id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de' })
  vi.mocked(foldersApi.list).mockResolvedValue({ all: { total: 500, due_today: 30 }, folders: [] } as never)
  vi.mocked(statsApi.get).mockResolvedValue(week(0) as never)
  vi.mocked(heroApi.get).mockRejectedValue({ response: { status: 404 } })
  vi.mocked(settingsApi.get).mockResolvedValue({ interface_language: '', review_session_size: '', theme: '' })
  vi.mocked(cardsApi.list).mockResolvedValue([1, 2, 3, 4].map(card))
  vi.mocked(reviewApi.due).mockResolvedValue({ cards: [due(1)], total: 1 })
  vi.mocked(reviewApi.answer).mockResolvedValue({ box_level: 2, is_learned: false } as never)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

// The server hands out at most `limit` cards but reports the real total.
const serve = (total: number) =>
  vi.mocked(reviewApi.due).mockImplementation(async (_folder, limit) => {
    const n = limit === 'all' ? total : Math.min(Number(limit), total)
    return { cards: Array.from({ length: n }, (_, i) => due(i + 1)), total }
  })

describe('ReviewSession: /train starts at once', () => {
  it('with due words the first question is on screen, no start screen, the URL stays as it is', async () => {
    renderSession('/train?size=1')
    expect(await screen.findByRole('progressbar')).toBeTruthy()
    expect(screen.getByText('1/1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Start training/ })).toBeNull()
    expect(where()).toBe('/train?size=1')
  })

  it('it starts once: no second start after the data settles', async () => {
    renderSession('/train?size=1')
    await screen.findByRole('progressbar')
    const asks = vi.mocked(reviewApi.due).mock.calls.length
    await new Promise((r) => setTimeout(r, 30))
    expect(vi.mocked(reviewApi.due).mock.calls.length).toBe(asks)
    expect(screen.getByText('1/1')).toBeTruthy()
  })

  it('there are no pickers, no practice and no tabs on the screen', async () => {
    renderSession('/train?size=1')
    await screen.findByRole('progressbar')
    expect(screen.queryByText(/Which words to practice|Session size|Train words from/)).toBeNull()
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('while the session is on, the app knows it (the shell steps aside) and knows again when it is over', async () => {
    const { isTrainingOpen } = await import('../lib/trainingState')
    renderSession('/train?size=1')
    await screen.findByRole('progressbar')
    await waitFor(() => expect(isTrainingOpen()).toBe(true))
    cleanup()
    expect(isTrainingOpen()).toBe(false)
  })

  it('an answer saves progress and refreshes Home (folders) and the stats', async () => {
    const { invalidate } = renderSession('/train?size=1')
    const options = await screen.findAllByRole('button', { name: /слово\d/ })
    fireEvent.click(options[0])
    await waitFor(() => expect(reviewApi.answer).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['folders'] }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['stats'] })
  })
})

describe('ReviewSession: nothing due', () => {
  it('a card with the hero icon, the come-back text and a link Home — and no practice button', async () => {
    vi.mocked(reviewApi.due).mockResolvedValue({ cards: [], total: 0 })
    renderSession('/train?size=12')
    expect(await screen.findByText('No words to review today')).toBeTruthy()
    expect(screen.getByText('Come back tomorrow or add new words.')).toBeTruthy()
    const home = screen.getByRole('link', { name: 'Back to home' })
    expect(home.getAttribute('href')).toBe('/')
    expect(home.className).toContain('btn-primary')
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByRole('button', { name: /Practice/ })).toBeNull()
  })

  it('in a folder the text says so', async () => {
    vi.mocked(reviewApi.due).mockResolvedValue({ cards: [], total: 0 })
    renderSession('/train?folder=f1')
    expect(await screen.findByText('Nothing to review in this folder today')).toBeTruthy()
  })
})

describe('ReviewSession: the URL is the only input', () => {
  it('?folder=<id> asks the server for that folder; ?folder=none for words without one; nothing for all', async () => {
    serve(30)
    renderSession('/train?folder=f1&size=5')
    await screen.findByText('1/5')
    expect(reviewApi.due).toHaveBeenCalledWith('f1', '10')
    cleanup()
    vi.clearAllMocks()
    serve(30)
    renderSession('/train?folder=none')
    await screen.findByText('1/20')
    expect(reviewApi.due).toHaveBeenCalledWith('none', '20')
    cleanup()
    vi.clearAllMocks()
    serve(30)
    renderSession('/train')
    await screen.findByText('1/20')
    expect(reviewApi.due).toHaveBeenCalledWith('', '20')
  })

  it('the old localStorage choices (review-folder, review-session-size) are not read', async () => {
    localStorage.setItem('review-folder', 'f9')
    localStorage.setItem('review-session-size', 'all')
    serve(408)
    renderSession('/train')
    await screen.findByText('1/20')
    expect(reviewApi.due).toHaveBeenCalledWith('', '20')
  })

  it.each([
    ['12', '1/12', '20'], ['7', '1/7', '10'], ['1', '1/1', '10'], ['10', '1/10', '10'],
    ['21', '1/21', '50'], ['50', '1/50', '50'],
  ])('size=%s → %s questions, the server asked for %s', async (size, counter, fetched) => {
    serve(408)
    renderSession(`/train?size=${size}`)
    expect(await screen.findByText(counter)).toBeTruthy()
    expect(reviewApi.due).toHaveBeenCalledWith('', fetched)
  })

  it('keeps the server order: the first N cards', async () => {
    serve(408)
    renderSession('/train?size=12')
    await screen.findByText('1/12')
    expect(screen.getByText('Wort1')).toBeTruthy()
  })

  it.each(['0', '51', 'abc', '1.5', '-3', ''])('an invalid size (%j) falls back to 20', async (size) => {
    serve(408)
    renderSession(`/train?size=${size}`)
    expect(await screen.findByText('1/20')).toBeTruthy()
  })

  it('fewer cards than N: the session is as long as what the server has', async () => {
    serve(5)
    renderSession('/train?size=12')
    expect(await screen.findByText('1/5')).toBeTruthy()
  })
})

describe('ReviewSession: the result', () => {
  /** Answers `size` questions; `pick` chooses the option (default: the right one — 'слово<n>' of the card shown). */
  async function finish(total: number, size: string, answer: 'right' | 'wrong' = 'right') {
    serve(total)
    vi.mocked(reviewApi.answer).mockResolvedValue({ box_level: 2, is_learned: false, next_review_at: '2030-01-01' } as never)
    renderSession(`/train?size=${size}`)
    for (let i = 0; i < Number(size); i++) {
      const word = await screen.findByText(/^Wort\d+$/)
      const right = `слово${word.textContent!.slice(4)}`
      const options = await screen.findAllByRole('button', { name: /слово\d/ })
      fireEvent.click(options.find((o) => (answer === 'right') === (o.textContent === right))!)
      fireEvent.click(await screen.findByRole('button', { name: /Continue|Finish/ }))
    }
  }

  it('goal not met: "Training complete", what is left to the goal, and "N more" is the primary button', async () => {
    await finish(30, '2')
    expect(await screen.findByText('Training complete')).toBeTruthy()
    expect(screen.getByText('18 words to the goal · 1 min')).toBeTruthy() // 20 − 2
    const more = screen.getByRole('button', { name: /2 words more/ })
    expect(more.className).toContain('btn-primary')
    const done = screen.getByRole('button', { name: 'Done' })
    expect(done.className).toContain('btn-ghost')
    expect(screen.queryByRole('button', { name: /Practice|Try again/ })).toBeNull()
  })

  it('"more" is capped by what is left', async () => {
    await finish(3, '2')
    await screen.findByText('Training complete')
    expect(screen.getByRole('button', { name: /1 word more/ })).toBeTruthy()
  })

  it('nothing is left: only "Done", as the primary button', async () => {
    await finish(2, '2')
    await screen.findByText('Training complete')
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Done' }).className).toContain('btn-primary')
  })

  it('"more" asks the next portion with the same folder and size', async () => {
    await finish(30, '2')
    await screen.findByText('Training complete')
    vi.mocked(reviewApi.due).mockClear()
    fireEvent.click(screen.getByRole('button', { name: /2 words more/ }))
    expect(await screen.findByText('1/2')).toBeTruthy()
    expect(reviewApi.due).toHaveBeenCalledWith('', '10')
  })

  it('a wrong answer lands in the mistakes with its translation; right answers do not', async () => {
    await finish(30, '2', 'wrong')
    await screen.findByText('Training complete')
    const block = screen.getByTestId('mistakes')
    expect(within(block).getAllByRole('listitem')).toHaveLength(2)
    expect(within(block).getByText('Mistakes')).toBeTruthy()
    expect(block.textContent).toMatch(/Wort\d+ — слово\d+/)
  })

  it('no mistakes → no mistakes block; the tiles show right / wrong / best streak', async () => {
    await finish(30, '3')
    await screen.findByText('Training complete')
    expect(screen.queryByTestId('mistakes')).toBeNull()
    const tiles = screen.getByText('correct').parentElement!.parentElement!
    expect(tiles.textContent).toContain('3correct')
    expect(tiles.textContent).toContain('0wrong')
    expect(tiles.textContent).toContain('3best streak')
  })

  it('the result screen keeps the shell hidden; leaving it brings it back', async () => {
    const { isTrainingOpen } = await import('../lib/trainingState')
    await finish(30, '2')
    await screen.findByText('Training complete')
    expect(isTrainingOpen()).toBe(true) // the questions are over, the result is still a session screen
    cleanup()
    expect(isTrainingOpen()).toBe(false)
  })

  it('"almost" (a typo) counts as right: it is not a mistake', async () => {
    localStorage.setItem('review-direction', 'ru_de')
    vi.mocked(reviewApi.due).mockResolvedValue({ cards: [{ ...due(1), box_level: 3 }], total: 1 })
    vi.mocked(reviewApi.answer).mockResolvedValue({ box_level: 4, is_learned: false, next_review_at: '2030-01-01' } as never)
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99) // the last format of the direction: typing
    renderSession('/train?size=1')
    const field = await screen.findByPlaceholderText(/./)
    fireEvent.change(field, { target: { value: 'Wort2' } }) // one letter off
    fireEvent.submit(field.closest('form')!)
    fireEvent.click(await screen.findByRole('button', { name: /Finish|Continue/ }))
    await screen.findByText('Training complete')
    expect(screen.queryByTestId('mistakes')).toBeNull()
    random.mockRestore()
  })

  it('a typed wrong answer is a mistake', async () => {
    localStorage.setItem('review-direction', 'ru_de')
    vi.mocked(reviewApi.due).mockResolvedValue({ cards: [{ ...due(1), box_level: 3 }], total: 1 })
    vi.mocked(reviewApi.answer).mockResolvedValue({ box_level: 1, is_learned: false, next_review_at: '2030-01-01' } as never)
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99)
    renderSession('/train?size=1')
    const field = await screen.findByPlaceholderText(/./)
    fireEvent.change(field, { target: { value: 'xyzxyz' } })
    fireEvent.submit(field.closest('form')!)
    fireEvent.click(await screen.findByRole('button', { name: /Finish|Continue/ }))
    await screen.findByText('Training complete')
    expect(within(screen.getByTestId('mistakes')).getAllByRole('listitem')).toHaveLength(1)
    random.mockRestore()
  })
})

describe('ReviewSession: Home → the goal card → /train', () => {
  it('the Start button opens a session of the goal size; the saved sizes are not involved', async () => {
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
          <Routes><Route path="/" element={<ContextsPage />} /><Route path="/train" element={<ReviewSession />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('20 words')).toBeTruthy() // the daily goal, not the 408 due
    fireEvent.click(screen.getByRole('button', { name: /^Start/ }))
    expect(await screen.findByText('1/20')).toBeTruthy()
  })
})

describe('ReviewSession: the screens use icons, not emoji', () => {
  it('the nothing-to-review screen has an icon', async () => {
    vi.mocked(reviewApi.due).mockResolvedValue({ cards: [], total: 0 })
    renderSession('/train')
    await screen.findByText('No words to review today')
    expect(document.querySelector('svg.text-accent-text')).not.toBeNull()
  })
})
