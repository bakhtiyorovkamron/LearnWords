import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { foldersApi, meApi, settingsApi, statsApi } from '../api/endpoints'
import type { DueCard } from '../api/types'
import { ReviewResult } from './ReviewResult'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    foldersApi: { list: vi.fn() },
    statsApi: { get: vi.fn() },
    settingsApi: { get: vi.fn(), setDailyGoal: vi.fn() },
  }
})

const NOW = new Date('2026-10-28T10:00:00Z') // a Wednesday
const iso = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000).toISOString().slice(0, 10)
const day = (offset: number, over: object = {}) =>
  ({ date: iso(offset), reviewed: 0, correct: 0, new_words: 0, active: false, goal_met: false, ...over })
const weekOf = (streak: number, over: Record<number, object> = {}) => ({
  daily: [-6, -5, -4, -3, -2, -1, 0].map((o) => day(o, over[o])),
  totals: { current_streak_days: streak, longest_streak_days: streak, total_words_learned: 0, accuracy_percent: 0 },
})
const mistake = (n: number, over: Partial<DueCard> = {}): DueCard => ({
  id: `m${n}`, context_id: 'x', word: `Wort${n}`, translation: `слово${n}`, transcription: '', language: 'de', created_at: '',
  example_sentence: '', example_translation: '', folder_id: null, box_level: 1, has_example: false, ...over,
} as DueCard)

const Where = () => <div data-testid="where">{useLocation().pathname}</div>
const props = {
  correct: 18, total: 20, mistakes: [mistake(1), mistake(2, { word: 'der Hund', article: 'der', translation: 'собака' })],
  bestStreak: 10, minutes: 6, goal: { done: 20, target: 20 }, moreCount: 12, onMore: vi.fn(), moreLoading: false,
}
function renderResult(over: Partial<Parameters<typeof ReviewResult>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/train']}>
        <Where />
        <Routes>
          <Route path="/train" element={<ReviewResult {...props} {...over} />} />
          <Route path="/" element={<div>HOME</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const where = () => screen.getByTestId('where').textContent

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  await i18n.changeLanguage('en')
  localStorage.clear()
  vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [], addEventListener: vi.fn() })
  vi.stubGlobal('SpeechSynthesisUtterance', function (this: { text: string }, text: string) { this.text = text })
  vi.mocked(meApi.get).mockResolvedValue({ id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de' })
  vi.mocked(foldersApi.list).mockResolvedValue({ all: { total: 500, due_today: 12 }, folders: [] } as never)
  vi.mocked(statsApi.get).mockResolvedValue(weekOf(4, { [-2]: { reviewed: 20, active: true, goal_met: true }, 0: { reviewed: 20, active: true } }) as never)
  vi.mocked(settingsApi.get).mockResolvedValue({ interface_language: '', review_session_size: '', theme: '', daily_goal: 20 })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('ReviewResult: the goal is met', () => {
  it('a full ring with the check, "Goal reached", "20 of 20 · 6 min"', async () => {
    renderResult()
    const ring = screen.getByTestId('goal-ring')
    expect(ring.getAttribute('data-met')).toBe('true')
    expect(ring.style.width).toBe('136px')
    expect(ring.querySelectorAll('svg')).toHaveLength(2) // the ring and the check
    expect(Number(screen.getByTestId('goal-arc').getAttribute('stroke-dashoffset'))).toBe(0)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Goal reached')
    expect(screen.getByText('20 of 20 · 6 min')).toBeTruthy()
  })

  it('the week with the streak line; today is up to date from the stats', async () => {
    renderResult()
    const strip = await screen.findByTestId('week-strip')
    const days = within(strip).getAllByRole('listitem')
    expect(days.map((d) => d.getAttribute('data-state'))).toEqual(['met', 'empty', 'met', 'future', 'future', 'future', 'future'])
    expect(await screen.findByText('Streak: 4 days. Today fully counts.')).toBeTruthy()
  })

  it('three tiles: right 18 (accent), wrong 2 (danger), best streak 10 (streak colour)', () => {
    renderResult()
    const tile = (label: string) => screen.getByText(label).parentElement!
    expect(tile('correct').querySelector('div')!.textContent).toBe('18')
    expect(tile('correct').querySelector('div')!.className).toContain('text-accent-text')
    expect(tile('wrong').querySelector('div')!.textContent).toBe('2')
    expect(tile('wrong').querySelector('div')!.className).toContain('text-danger')
    expect(tile('best streak').querySelector('div')!.textContent).toBe('10')
    expect(tile('best streak').querySelector('div')!.className).toContain('text-streak')
    expect(tile('correct').className).toContain('rounded-2xl')
  })

  it('two mistakes with their translations; the article is coloured', () => {
    renderResult()
    const block = screen.getByTestId('mistakes')
    const rows = within(block).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Wort1')
    expect(rows[0].textContent).toContain('слово1')
    expect(rows[1].textContent).toContain('собака')
    expect(within(rows[1]).getByText('der').className).toContain('text-der')
    expect(within(rows[1]).getByText('Hund').closest('span')!.className).toContain('font-serif')
    expect(within(block).getByText('Mistakes')).toBeTruthy()
    expect(within(block).getByText('Worth another look')).toBeTruthy()
    expect(rows.every((r) => r.className.includes('min-h-[54px]'))).toBe(true)
  })

  it('primary "Done" goes Home; the ghost "12 words more" asks for the next portion', () => {
    const onMore = vi.fn()
    renderResult({ onMore })
    const done = screen.getByRole('button', { name: 'Done' })
    expect(done.className).toContain('btn-primary')
    const more = screen.getByRole('button', { name: /12 words more/ })
    expect(more.className).toContain('btn-ghost')
    fireEvent.click(more)
    expect(onMore).toHaveBeenCalledTimes(1)
    fireEvent.click(done)
    expect(where()).toBe('/')
  })

  it('nothing more due → only the primary Done', () => {
    renderResult({ moreCount: 0 })
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Done' }).className).toContain('btn-primary')
  })

  it('the X in the corner leaves for Home', () => {
    renderResult()
    const x = screen.getByRole('button', { name: 'Back to home' })
    expect(x.className).toContain('h-11')
    fireEvent.click(x)
    expect(where()).toBe('/')
  })
})

describe('ReviewResult: the goal is not met', () => {
  const notMet = { goal: { done: 8, target: 20 }, correct: 6, total: 8 }

  it('"Training complete", the words left to the goal, the primary button is "more"', () => {
    renderResult(notMet)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Training complete')
    expect(screen.getByText('12 words to the goal · 6 min')).toBeTruthy()
    expect(screen.getByTestId('goal-ring').getAttribute('data-met')).toBe('false')
    expect(screen.getByTestId('goal-ring').textContent).toBe('8/20')
    expect(screen.getByRole('button', { name: /12 words more/ }).className).toContain('btn-primary')
    expect(screen.getByRole('button', { name: 'Done' }).className).toContain('btn-ghost')
  })

  it('nothing more due, goal not met → only Done (primary)', () => {
    renderResult({ ...notMet, moreCount: 0 })
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Done' }).className).toContain('btn-primary')
  })
})

describe('ReviewResult: the mistakes list', () => {
  it('no mistakes → no block', () => {
    renderResult({ mistakes: [], correct: 20 })
    expect(screen.queryByTestId('mistakes')).toBeNull()
    expect(screen.queryByText('Mistakes')).toBeNull()
  })

  it('7 mistakes: 5 rows and "Show 2 more", which expands the rest', () => {
    renderResult({ mistakes: Array.from({ length: 7 }, (_, i) => mistake(i + 1)) })
    expect(within(screen.getByTestId('mistakes')).getAllByRole('listitem')).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more' }))
    expect(within(screen.getByTestId('mistakes')).getAllByRole('listitem')).toHaveLength(7)
    expect(screen.queryByRole('button', { name: /Show/ })).toBeNull()
  })

  it('exactly 5: no "show more"', () => {
    renderResult({ mistakes: Array.from({ length: 5 }, (_, i) => mistake(i + 1)) })
    expect(screen.queryByRole('button', { name: /Show/ })).toBeNull()
  })

  it('a 44px listen button per row reads the word with its language; absent when the device cannot read it', () => {
    renderResult({ mistakes: [mistake(1), mistake(2, { language: 'en', word: 'the house' })] })
    const listen = screen.getAllByRole('button', { name: 'Listen' })
    expect(listen).toHaveLength(2)
    expect(listen[0].className).toContain('h-11')
    fireEvent.click(listen[1])
    const speak = (globalThis as unknown as { speechSynthesis: { speak: ReturnType<typeof vi.fn> } }).speechSynthesis.speak
    const u = speak.mock.calls[0][0] as { text: string; lang: string }
    expect([u.text, u.lang]).toEqual(['the house', 'en-US'])
    cleanup()
    vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [{ lang: 'ko-KR' }], addEventListener: vi.fn() })
    renderResult({ mistakes: [mistake(1)] })
    expect(screen.queryByRole('button', { name: 'Listen' })).toBeNull()
  })
})
