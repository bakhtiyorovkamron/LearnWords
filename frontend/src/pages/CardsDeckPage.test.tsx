import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { collectionApi, foldersApi, meApi } from '../api/endpoints'
import { CardsDeckPage } from './CardsDeckPage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    collectionApi: { list: vi.fn() },
    foldersApi: { list: vi.fn() },
  }
})

const row = (n: number) => ({
  id: `c${n}`, context_id: 'x', word: `Wort${n}`, translation: `слово${n}`, transcription: '', language: 'de', created_at: '',
  example_sentence: '', example_translation: '', translation_language: 'ru',
  box_level: 1, is_learned: false, next_review_at: new Date().toISOString(), reviewed_today: false,
})
const folder = (id: string, name: string, total: number) => ({ id, name, color: 'sky', created_at: '', total, new_count: 0, learning_count: 0, learned_count: 0, due_today: 0 })
const folderList = (allTotal: number) => ({
  all: { total: allTotal, new_count: 0, learning_count: 0, learned_count: 0, due_today: 0 },
  folders: [folder('f1', 'Tiere', 3), folder('f2', 'Essen', 2)],
})

const Where = () => <div data-testid="where">{useLocation().pathname + useLocation().search}</div>
function renderDeck(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Where />
        <Routes>
          <Route path="/cards" element={<CardsDeckPage />} />
          <Route path="/words" element={<div>WORDS LIST</div>} />
          <Route path="/words/:folder" element={<div>WORDS LIST</div>} />
          <Route path="/train" element={<div>TRAIN SCREEN</div>} />
          <Route path="/contexts/new" element={<div>ADD SCREEN</div>} />
          <Route path="/" element={<div>HOME SCREEN</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const where = () => screen.getByTestId('where').textContent

beforeEach(async () => {
  await i18n.changeLanguage('en')
  localStorage.clear()
  vi.mocked(meApi.get).mockResolvedValue({ id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de' })
  vi.mocked(collectionApi.list).mockResolvedValue({ items: [row(1), row(2)], total: 2 } as never)
  vi.mocked(foldersApi.list).mockResolvedValue(folderList(8) as never) // 3 + 2 in folders, 3 without
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('CardsDeckPage', () => {
  it('asks for the deck with the collection query (all words, 48 a page) and shows the first card', async () => {
    renderDeck('/cards')
    expect(await screen.findByTestId('deck-card')).toBeTruthy()
    expect(collectionApi.list).toHaveBeenCalledWith({ status: 'all', period: 'all', sort: 'date', q: '', folder: '', limit: 48, offset: 0 })
    expect(screen.getAllByText('1 / 2').length).toBeGreaterThan(0) // the counter, on both faces
  })

  it('?folder=<id|none> narrows the deck', async () => {
    renderDeck('/cards?folder=f2')
    await screen.findByTestId('deck-card')
    expect(vi.mocked(collectionApi.list).mock.calls[0][0]).toMatchObject({ folder: 'f2' })
    cleanup(); vi.clearAllMocks()
    renderDeck('/cards?folder=none')
    await screen.findByTestId('deck-card')
    expect(vi.mocked(collectionApi.list).mock.calls[0][0]).toMatchObject({ folder: 'none' })
  })

  it('the folder pill shows a dot, the name and the count; the sheet opens from it', async () => {
    renderDeck('/cards?folder=f1')
    const pill = await screen.findByRole('button', { name: /Tiere/ })
    expect(pill.textContent).toContain('3')
    expect(pill.getAttribute('aria-haspopup')).toBe('dialog')
    expect(pill.className).toContain('rounded-full')
    expect(pill.className).toContain('h-10')
  })

  it('the pill says "All words 8" without a folder', async () => {
    renderDeck('/cards')
    const pill = await screen.findByRole('button', { name: /All words/ })
    await waitFor(() => expect(pill.textContent).toContain('8'))
  })
})

describe('the folder sheet', () => {
  const open = async (url = '/cards') => {
    renderDeck(url)
    fireEvent.click(await screen.findByRole('button', { name: /All words|Tiere|No folder/ }))
    return screen.getByRole('dialog', { name: 'Which folder?' })
  }

  it('lists All words, every folder with its count, and "No folder" when some words have none', async () => {
    const dialog = await open()
    const rows = within(dialog).getAllByRole('radio')
    expect(rows.map((r) => r.textContent)).toEqual(['All words8', 'Tiere3', 'Essen2', 'No folder3'])
    expect(rows.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false'])
    expect(rows[0].querySelector('svg')).not.toBeNull() // the check of the current one
    expect(rows[1].querySelector('svg')).toBeNull()
    expect(rows.every((r) => r.className.includes('min-h-[52px]'))).toBe(true)
  })

  it('no "No folder" row when every word is in a folder', async () => {
    vi.mocked(foldersApi.list).mockResolvedValue(folderList(5) as never)
    const dialog = await open()
    expect(within(dialog).getAllByRole('radio').map((r) => r.textContent)).toEqual(['All words5', 'Tiere3', 'Essen2'])
  })

  it('picking a folder closes the sheet and sets ?folder= (replace); "All words" removes it', async () => {
    const dialog = await open()
    fireEvent.click(within(dialog).getByRole('radio', { name: /Essen/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(where()).toBe('/cards?folder=f2')
    await waitFor(() => expect(vi.mocked(collectionApi.list).mock.calls.some(([q]) => (q as { folder?: string }).folder === 'f2')).toBe(true))
    fireEvent.click(await screen.findByRole('button', { name: /Essen/ }))
    const second = screen.getByRole('dialog')
    expect(within(second).getByRole('radio', { name: /Essen/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(second).getByRole('radio', { name: /No folder/ }))
    expect(where()).toBe('/cards?folder=none')
    fireEvent.click(await screen.findByRole('button', { name: /No folder/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: /All words/ }))
    expect(where()).toBe('/cards')
  })

  it('Esc closes it without a change', async () => {
    await open()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(where()).toBe('/cards')
  })
})

describe('the direction pill', () => {
  it('shows the current direction, a tap switches de_ru ↔ ru_de and remembers it (flip-direction)', async () => {
    renderDeck('/cards')
    const pill = await screen.findByRole('button', { name: 'DE → EN' })
    expect(pill.className).toContain('h-10')
    expect(pill.querySelector('svg')).not.toBeNull()
    fireEvent.click(pill)
    expect(screen.getByRole('button', { name: 'EN → DE' })).toBeTruthy()
    expect(localStorage.getItem('flip-direction')).toBe('ru_de')
    // the deck now shows the translation first
    expect(document.querySelector('[data-side][aria-hidden="false"]')!.getAttribute('data-side')).toBe('native')
    fireEvent.click(screen.getByRole('button', { name: 'EN → DE' }))
    expect(localStorage.getItem('flip-direction')).toBe('de_ru')
  })

  it('starts from the saved direction', async () => {
    localStorage.setItem('flip-direction', 'ru_de')
    renderDeck('/cards')
    expect(await screen.findByRole('button', { name: 'EN → DE' })).toBeTruthy()
  })
})

describe('loading and empty', () => {
  it('while loading: one skeleton card', () => {
    vi.mocked(collectionApi.list).mockReturnValue(new Promise(() => undefined))
    renderDeck('/cards')
    const skeleton = document.querySelector('[aria-busy="true"]') as HTMLElement
    expect(skeleton.className).toContain('animate-pulse')
    expect(skeleton.className).toContain('rounded-[32px]')
    expect(screen.queryByTestId('deck-card')).toBeNull()
  })

  it('an empty folder: the text and a link to add a word', async () => {
    vi.mocked(collectionApi.list).mockResolvedValue({ items: [], total: 0 })
    renderDeck('/cards?folder=f1')
    expect(await screen.findByText('This folder has no words yet')).toBeTruthy()
    const add = screen.getByRole('link', { name: 'Add a word' })
    expect(add.getAttribute('href')).toBe('/contexts/new')
    expect(add.className).toContain('btn-primary')
  })

  it('an empty collection says so', async () => {
    vi.mocked(collectionApi.list).mockResolvedValue({ items: [], total: 0 })
    renderDeck('/cards')
    expect(await screen.findByText('The collection is empty')).toBeTruthy()
  })
})

describe('the legacy links of the old Cards tab', () => {
  it('?start=1&size=12 → /train?size=12; a size nobody accepts, or none → /train', async () => {
    renderDeck('/cards?start=1&size=12')
    expect(await screen.findByText('TRAIN SCREEN')).toBeTruthy()
    expect(where()).toBe('/train?size=12')
    cleanup()
    renderDeck('/cards?start=1&size=99')
    expect(await screen.findByText('TRAIN SCREEN')).toBeTruthy()
    expect(where()).toBe('/train')
    cleanup()
    renderDeck('/cards?start=1')
    expect(await screen.findByText('TRAIN SCREEN')).toBeTruthy()
    expect(where()).toBe('/train')
  })

  it('?practice=1 → Home', async () => {
    renderDeck('/cards?practice=1')
    expect(await screen.findByText('HOME SCREEN')).toBeTruthy()
    expect(where()).toBe('/')
  })

  it('?tab=all → /words, and with &folder=X → /words/X', async () => {
    renderDeck('/cards?tab=all')
    expect(await screen.findByText('WORDS LIST')).toBeTruthy()
    expect(where()).toBe('/words')
    cleanup()
    renderDeck('/cards?tab=all&folder=f1')
    expect(await screen.findByText('WORDS LIST')).toBeTruthy()
    expect(where()).toBe('/words/f1')
  })
})

describe('the next page', () => {
  it('is loaded when the deck is near its end', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined })) // no animation: a step is one event
    const page1 = Array.from({ length: 48 }, (_, i) => row(i + 1))
    vi.mocked(collectionApi.list).mockImplementation(async (q) =>
      ({ items: (q as { offset: number }).offset === 0 ? page1 : [row(49), row(50)], total: 50 }) as never)
    renderDeck('/cards')
    await screen.findByTestId('deck-card')
    const asked = (offset: number) => vi.mocked(collectionApi.list).mock.calls.some(([q]) => (q as { offset: number }).offset === offset)
    const counter = () => document.querySelector('[data-side="learning"] .tabular-nums')!.textContent
    for (let n = 0; n < 44; n++) fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(counter()).toBe('45 / 50'))
    expect(asked(48)).toBe(false) // 3 cards are still behind the 45th of 48 loaded
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(asked(48)).toBe(true))
    vi.unstubAllGlobals()
  })
})
