import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { foldersApi, meApi, settingsApi, statsApi, type Me } from '../api/endpoints'
import type { DayStat, FolderList } from '../api/types'
import { takeHandedOffPhoto } from '../lib/photoHandoff'
import { ContextsPage } from './ContextsPage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    foldersApi: { list: vi.fn(), create: vi.fn() },
    statsApi: { get: vi.fn() },
    settingsApi: { get: vi.fn(), setDailyGoal: vi.fn() },
  }
})

const stats = (total: number, due: number) => ({ total, new_count: 0, learning_count: 0, learned_count: 0, due_today: due })
const folder = (id: string, name: string, total = 1, extra: object = {}) => ({ id, name, color: 'sky', created_at: '', ...stats(total, 0), ...extra })
const list = (total: number, due: number, folders: object[] = []): FolderList => ({ all: stats(total, due), folders } as unknown as FolderList)

const features = (photo: boolean, remaining = 10) => ({
  photo_import: { enabled: photo, daily_limit: 10, remaining },
  daily_story: { enabled: true, daily_limit: null, remaining: null },
  word_search: { enabled: true, daily_limit: null, remaining: null },
  story_autotranslate: { enabled: true, daily_limit: null, remaining: null },
  theme_picker: { enabled: false, daily_limit: null, remaining: null },
})
const me = (photo = true, remaining = 10): Me => ({ id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de', features: features(photo, remaining) })
// A fixed Wednesday, so "Monday..Sunday of this week" has 2 past days, today and 4 days to come.
const NOW = new Date('2026-10-28T10:00:00Z')
const iso = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000).toISOString().slice(0, 10)
const day = (offset: number, over: Partial<DayStat> = {}): DayStat =>
  ({ date: iso(offset), reviewed: 0, correct: 0, new_words: 0, active: false, goal_met: false, ...over })
/** The last 7 days like GET /stats?period=week; `over` maps an offset (-6..0) to its changes. */
const weekOf = (streak: number, over: Record<number, Partial<DayStat>> = {}) => ({
  daily: [-6, -5, -4, -3, -2, -1, 0].map((o) => day(o, over[o])),
  totals: { current_streak_days: streak, longest_streak_days: 9, total_words_learned: 0, accuracy_percent: 0 },
})

const Where = () => <div data-testid="where">{useLocation().pathname + useLocation().search}</div>
function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Where />
        <Routes><Route path="/" element={<ContextsPage />} /><Route path="*" element={<div>elsewhere</div>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const where = () => screen.getByTestId('where').textContent

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  await i18n.changeLanguage('en')
  localStorage.clear()
  takeHandedOffPhoto()
  vi.mocked(meApi.get).mockResolvedValue(me())
  vi.mocked(foldersApi.list).mockResolvedValue(list(40, 12, [folder('f1', 'Tiere', 5)]))
  vi.mocked(statsApi.get).mockResolvedValue(weekOf(3, { 0: { reviewed: 8, active: true } }) as never)
  vi.mocked(settingsApi.get).mockResolvedValue({ interface_language: '', review_session_size: '', theme: '', daily_goal: 20 })
  vi.mocked(settingsApi.setDailyGoal).mockResolvedValue({} as never)
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers() })

const strip = () => within(screen.getByTestId('week-strip')).getAllByRole('listitem')
const states = () => strip().map((li) => li.getAttribute('data-state'))
const waitCard = () => screen.findByTestId('goal-ring')

describe('Home: the goal card', () => {
  it('goal 20, 8 reviewed, 393 due → ring 8/20, 12 words, ≈3 min, Continue, the queue line', async () => {
    vi.mocked(foldersApi.list).mockResolvedValue(list(500, 393))
    renderHome()
    await waitCard()
    expect(screen.getByText('8/20')).toBeTruthy()
    expect(screen.getByText('12 words')).toBeTruthy()
    expect(screen.getByText('to your goal · ≈3 min')).toBeTruthy() // 12 × 15 s
    expect(screen.getByText('381 words more in the queue — a goal a day')).toBeTruthy()
    expect(screen.getByText('Today’s goal')).toBeTruthy()
    localStorage.setItem('review-folder', 'f1')
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    expect(localStorage.getItem('review-folder')).toBe('')
    expect(where()).toBe('/cards?start=1&size=12')
  })

  it('nothing done yet: the button says Start; the queue line is absent when nothing waits', async () => {
    vi.mocked(statsApi.get).mockResolvedValue(weekOf(0) as never)
    vi.mocked(foldersApi.list).mockResolvedValue(list(40, 12))
    renderHome()
    await waitCard()
    expect(screen.getByText('0/12')).toBeTruthy() // fewer due than the goal: the target is what is there
    fireEvent.click(screen.getByRole('button', { name: /^Start/ }))
    expect(where()).toBe('/cards?start=1&size=12')
    expect(screen.queryByText(/in the queue/)).toBeNull()
  })

  it('the estimate is at least one minute', async () => {
    vi.mocked(statsApi.get).mockResolvedValue(weekOf(0) as never)
    vi.mocked(foldersApi.list).mockResolvedValue(list(40, 1))
    renderHome()
    await waitCard()
    expect(screen.getByText('1 word')).toBeTruthy()
    expect(screen.getByText('to your goal · ≈1 min')).toBeTruthy()
  })

  it('goal met, words still due → check in the ring, "Goal reached", and "20 words more"', async () => {
    vi.mocked(statsApi.get).mockResolvedValue(weekOf(4, { 0: { reviewed: 20, active: true } }) as never)
    vi.mocked(foldersApi.list).mockResolvedValue(list(500, 100))
    renderHome()
    await waitCard()
    expect(screen.getByTestId('goal-ring').getAttribute('data-met')).toBe('true')
    expect(screen.getByText('Goal reached')).toBeTruthy()
    expect(screen.getByText('20 of 20')).toBeTruthy()
    expect(screen.queryByText('20/20')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /20 words more/ }))
    expect(where()).toBe('/cards?start=1&size=20')
  })

  it('goal met and nothing due → Practice more', async () => {
    vi.mocked(statsApi.get).mockResolvedValue(weekOf(4, { 0: { reviewed: 20, active: true } }) as never)
    vi.mocked(foldersApi.list).mockResolvedValue(list(500, 0))
    renderHome()
    await waitCard()
    expect(screen.getByText('Goal reached')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Practice more' }))
    expect(where()).toBe('/cards?practice=1')
  })

  it('a small queue is the target: 5 reviewed, 3 due → target 8, goal not met', async () => {
    vi.mocked(statsApi.get).mockResolvedValue(weekOf(1, { 0: { reviewed: 5, active: true } }) as never)
    vi.mocked(foldersApi.list).mockResolvedValue(list(40, 3))
    renderHome()
    await waitCard()
    expect(screen.getByText('5/8')).toBeTruthy()
    expect(screen.getByText('3 words')).toBeTruthy()
  })

  it('nothing due and nothing done → "Nothing to review today", no ring, practice; the week stays', async () => {
    vi.mocked(statsApi.get).mockResolvedValue(weekOf(0) as never)
    vi.mocked(foldersApi.list).mockResolvedValue(list(40, 0))
    renderHome()
    expect(await screen.findByText('Nothing to review today')).toBeTruthy()
    expect(screen.getByText('More words will be due tomorrow.')).toBeTruthy()
    expect(screen.queryByTestId('goal-ring')).toBeNull()
    expect(screen.getByTestId('week-strip')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Practice more' }))
    expect(where()).toBe('/cards?practice=1')
  })

  it('no words at all → the empty text; no ring, no week', async () => {
    vi.mocked(foldersApi.list).mockResolvedValue(list(0, 0))
    renderHome()
    expect(await screen.findByText(/Nothing here yet\. Add your first German phrase!/)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome!')
    expect(screen.queryByTestId('goal-ring')).toBeNull()
    expect(screen.queryByTestId('week-strip')).toBeNull()
    expect(screen.queryByText('My folders')).toBeNull()
  })

  it('while the data loads the card is a same-size placeholder', () => {
    vi.mocked(foldersApi.list).mockReturnValue(new Promise(() => undefined))
    renderHome()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByTestId('goal-ring')).toBeNull()
  })

  it('the title follows the due count; the top row is the logo only (no streak chip)', async () => {
    renderHome()
    await waitCard()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Time to review')
    expect(screen.getByText(/^Today, /)).toBeTruthy()
    expect(screen.getByText('yodla').parentElement!.className).toContain('md:invisible')
    expect(screen.queryByText('3 days')).toBeNull() // the streak lives in the card now
  })
})

describe('Home: the week strip', () => {
  it('Mon..Sun of this week: met, half (active), empty, today, then 4 days to come', async () => {
    vi.mocked(statsApi.get).mockResolvedValue(weekOf(2, {
      [-2]: { reviewed: 20, active: true, goal_met: true }, // Monday
      [-1]: { reviewed: 4, active: true }, // Tuesday
      0: { reviewed: 8, active: true }, // Wednesday = today
    }) as never)
    renderHome()
    await waitCard()
    expect(states()).toEqual(['met', 'half', 'half', 'future', 'future', 'future', 'future'])
    expect(strip().map((li) => li.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(strip().map((li) => li.getAttribute('data-today'))).toEqual(['false', 'false', 'true', 'false', 'false', 'false', 'false'])
    expect(within(strip()[2]).getByText('Wed').className).toContain('text-accent-text')
    expect(within(strip()[0]).getByText('Mon').className).toContain('text-muted')
    expect(strip()[0].querySelector('svg')).not.toBeNull() // the check of a met day
  })

  it('a day without activity is empty; a future day is dashed; today turns met when the goal is reached', async () => {
    vi.mocked(statsApi.get).mockResolvedValue(weekOf(0, { 0: { reviewed: 20, active: true } }) as never)
    vi.mocked(foldersApi.list).mockResolvedValue(list(500, 50))
    renderHome()
    await waitCard()
    expect(states()).toEqual(['empty', 'empty', 'met', 'future', 'future', 'future', 'future'])
    expect(strip()[3].firstElementChild!.className).toContain('border-dashed')
    expect(strip()[0].firstElementChild!.className).toContain('border-dot-off')
  })

  it('weekday names follow the interface language', async () => {
    await i18n.changeLanguage('ru')
    renderHome()
    await waitCard()
    expect(strip().map((li) => li.textContent)).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'])
  })
})

describe('Home: the streak caption', () => {
  it('no activity today and a streak → "Practice today to make it N+1"', async () => {
    vi.mocked(statsApi.get).mockResolvedValue(weekOf(3) as never)
    renderHome()
    expect(await screen.findByText('Streak: 3 days. Practice today to make it 4.')).toBeTruthy()
  })

  it('no activity and no streak → start one', async () => {
    vi.mocked(statsApi.get).mockResolvedValue(weekOf(0) as never)
    renderHome()
    expect(await screen.findByText('Practice today to start a streak')).toBeTruthy()
  })

  it('active, goal not met → words left for the check mark', async () => {
    renderHome() // 8 reviewed, 12 due, goal 20
    expect(await screen.findByText('Streak: 3 days. 12 words left for the check mark.')).toBeTruthy()
  })

  it('goal met → "Today fully counts"', async () => {
    vi.mocked(statsApi.get).mockResolvedValue(weekOf(3, { 0: { reviewed: 12, active: true } }) as never)
    vi.mocked(foldersApi.list).mockResolvedValue(list(40, 0)) // 12 answered, nothing left → target 12 reached
    renderHome()
    expect(await screen.findByText('Streak: 3 days. Today fully counts.')).toBeTruthy()
  })
})

describe('Home: the goal sheet', () => {
  it('opens from "Change", has the four goals with minutes, and a pick saves it, closes, and changes the ring', async () => {
    vi.mocked(foldersApi.list).mockResolvedValue(list(500, 393))
    renderHome()
    await waitCard()
    expect(screen.getByText('8/20')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Change/ }))
    const dialog = screen.getByRole('dialog', { name: 'How many words a day?' })
    const tiles = within(dialog).getAllByRole('radio')
    expect(tiles.map((t) => t.textContent)).toEqual(['10≈3 min', '20≈5 min', '30≈8 min', '50≈13 min'])
    expect(tiles.map((t) => t.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false'])
    expect(within(dialog).getByText('Nothing is lost — the rest waits in the queue.')).toBeTruthy()
    fireEvent.click(tiles[2])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByText('8/30')).toBeTruthy() // optimistic: no waiting for the server
    await waitFor(() => expect(settingsApi.setDailyGoal).toHaveBeenCalledWith(30))
  })

  it('Esc closes it without saving', async () => {
    renderHome()
    await waitCard()
    fireEvent.click(screen.getByRole('button', { name: /Change/ }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(settingsApi.setDailyGoal).not.toHaveBeenCalled()
  })

  it('a failed save puts the old goal back', async () => {
    vi.mocked(settingsApi.setDailyGoal).mockRejectedValue(new Error('no'))
    vi.mocked(foldersApi.list).mockResolvedValue(list(500, 393))
    renderHome()
    await waitCard()
    fireEvent.click(screen.getByRole('button', { name: /Change/ }))
    fireEvent.click(screen.getAllByRole('radio')[3])
    await waitFor(() => expect(screen.getByText('8/20')).toBeTruthy())
  })
})

describe('Home: quick actions', () => {
  it('"Add a word" goes to /contexts/new', async () => {
    renderHome()
    fireEvent.click(await screen.findByRole('link', { name: 'Add a word' }))
    expect(where()).toBe('/contexts/new')
  })

  it('without photo_import there is no photo action and "Add a word" spans both columns', async () => {
    vi.mocked(meApi.get).mockResolvedValue(me(false))
    renderHome()
    const add = await screen.findByRole('link', { name: 'Add a word' })
    await waitFor(() => expect(screen.queryByText('Textbook photo')).toBeNull())
    expect(add.className).toContain('col-span-2')
  })

  it('choosing a photo hands it off and opens the Add page', async () => {
    renderHome()
    await screen.findByText('Textbook photo')
    const file = new File([new Uint8Array(10)], 'page.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByTestId('home-photo-input'), { target: { files: [file] } })
    expect(where()).toBe('/contexts/new')
    expect(takeHandedOffPhoto()).toBe(file)
    expect(takeHandedOffPhoto()).toBeNull() // once
  })

  it('the photo action opens the file picker; with no photos left it only goes to the Add page', async () => {
    renderHome()
    const input = screen.getByTestId('home-photo-input') as HTMLInputElement
    const click = vi.spyOn(input, 'click').mockImplementation(() => undefined)
    fireEvent.click(await screen.findByRole('button', { name: 'Textbook photo' }))
    expect(click).toHaveBeenCalledTimes(1)
    expect(where()).toBe('/')

    cleanup()
    vi.mocked(meApi.get).mockResolvedValue(me(true, 0))
    renderHome()
    const noneLeft = screen.getByTestId('home-photo-input') as HTMLInputElement
    const click2 = vi.spyOn(noneLeft, 'click').mockImplementation(() => undefined)
    await waitFor(() => expect(meApi.get).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 30))
    fireEvent.click(await screen.findByRole('button', { name: 'Textbook photo' }))
    expect(click2).not.toHaveBeenCalled()
    expect(where()).toBe('/contexts/new')
    expect(takeHandedOffPhoto()).toBeNull()
  })
})

describe('Home: folders', () => {
  it('the folder list is on the page when there are words', async () => {
    renderHome()
    const section = (await screen.findByText('My folders')).closest('section')!
    expect(within(section).getByRole('link', { name: /Tiere/ })).toBeTruthy()
    expect(within(section).getByRole('link', { name: 'All · 40' }).getAttribute('href')).toBe('/cards?tab=all')
  })
})
