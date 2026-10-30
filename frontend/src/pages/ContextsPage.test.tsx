import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { foldersApi, heroApi, meApi, statsApi, type Hero as HeroData, type Me } from '../api/endpoints'
import type { FolderList } from '../api/types'
import { takeHandedOffPhoto } from '../lib/photoHandoff'
import { ContextsPage } from './ContextsPage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    foldersApi: { list: vi.fn(), create: vi.fn() },
    statsApi: { get: vi.fn() },
    heroApi: { ...mod.heroApi, get: vi.fn() },
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
const hero: HeroData = {
  stage: 1, stage_name: 'x', learned_count: 0, almost_count: 0, words_to_next_stage: 10, born_at: '', age_days: 3,
  birthday_today: false, mood: 'happy', phrase: { de: 'Hallo', translation: 'Привет' }, stage_up: false, intro: false,
}

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
  await i18n.changeLanguage('en')
  localStorage.clear()
  takeHandedOffPhoto()
  vi.mocked(meApi.get).mockResolvedValue(me())
  vi.mocked(foldersApi.list).mockResolvedValue(list(40, 12, [folder('f1', 'Tiere', 5)]))
  vi.mocked(statsApi.get).mockResolvedValue({ totals: { current_streak_days: 3, longest_streak_days: 9 } } as never)
  vi.mocked(heroApi.get).mockRejectedValue({ response: { status: 404 } })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Home: today card', () => {
  it('words due → the count, the time estimate and a start button', async () => {
    renderHome()
    expect(await screen.findByText('12 words')).toBeTruthy()
    expect(screen.getByText('to review today · about 3 minutes')).toBeTruthy() // 12 × 15 s
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Time to review')
    expect(screen.getByText(/^Today, /)).toBeTruthy()
  })

  it('the estimate is at least one minute, and singular for one', async () => {
    vi.mocked(foldersApi.list).mockResolvedValue(list(3, 1))
    renderHome()
    expect(await screen.findByText('1 word')).toBeTruthy()
    expect(screen.getByText('to review today · about 1 minute')).toBeTruthy()
  })

  it('Start training reviews ALL words (review-folder is cleared) and opens the session at once: /cards?start=1', async () => {
    localStorage.setItem('review-folder', 'f1')
    renderHome()
    fireEvent.click(await screen.findByRole('button', { name: /Start training/ }))
    expect(localStorage.getItem('review-folder')).toBe('')
    expect(where()).toBe('/cards?start=1')
  })

  it('nothing due, but words → "All done", and Practice more opens the practice picker', async () => {
    vi.mocked(foldersApi.list).mockResolvedValue(list(40, 0, [folder('f1', 'Tiere')]))
    renderHome()
    expect(await screen.findByText(/Your next review is tomorrow/)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('All done for today')
    expect(screen.queryByRole('button', { name: /Start training/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Practice more' }))
    expect(where()).toBe('/cards?practice=1')
  })

  it('no words → the empty text, a welcome title, no button, no folder list', async () => {
    vi.mocked(foldersApi.list).mockResolvedValue(list(0, 0))
    renderHome()
    expect(await screen.findByText(/Nothing here yet\. Add your first German phrase!/)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome!')
    expect(screen.queryByRole('button', { name: /Start training|Practice more/ })).toBeNull()
    expect(screen.queryByText('My folders')).toBeNull()
  })

  it('while the folders load the card is a same-size placeholder', () => {
    vi.mocked(foldersApi.list).mockReturnValue(new Promise(() => undefined))
    renderHome()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByText(/^\d+ words?$/)).toBeNull()
  })

  it('the hero stands in the card when the user has one', async () => {
    vi.mocked(heroApi.get).mockResolvedValue(hero)
    renderHome()
    // the API counts stages from 1, the app from 0: stage 1 is "Little Mozart"
    expect(await screen.findByRole('img', { name: 'Little Mozart' })).toBeTruthy()
  })
})

describe('Home: streak and heading', () => {
  it('the streak chip reads "3 days"; with no streak it still shows, calmly', async () => {
    renderHome()
    expect(await screen.findByText('3 days')).toBeTruthy()
    cleanup()
    vi.mocked(statsApi.get).mockResolvedValue({ totals: { current_streak_days: 0 } } as never)
    renderHome()
    expect(await screen.findByText('0 days')).toBeTruthy()
  })

  it('the chip is hidden while the stats load', async () => {
    vi.mocked(statsApi.get).mockReturnValue(new Promise(() => undefined))
    renderHome()
    await screen.findByText('12 words')
    expect(screen.queryByText(/days?$/)).toBeNull()
  })

  it('the logo in the top row is invisible from md (the desktop header has it)', async () => {
    renderHome()
    await screen.findByText('12 words')
    expect(screen.getByText('yodla').parentElement!.className).toContain('md:invisible')
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
