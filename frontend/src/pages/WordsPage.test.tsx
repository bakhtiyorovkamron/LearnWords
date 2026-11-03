import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { collectionApi, foldersApi } from '../api/endpoints'
import { WordsPage } from './WordsPage'

vi.mock('../components/WordFixes', () => ({ WordFixes: () => <div data-testid="word-fixes" /> }))
vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    collectionApi: { list: vi.fn(), ids: vi.fn() },
    foldersApi: { list: vi.fn(), create: vi.fn() },
  }
})

const folder = (n: number, over: object = {}) => ({
  id: `f${n}`, name: `Folder ${n}`, color: 'sky', created_at: '', total: n * 2, new_count: 0, learning_count: 0,
  learned_count: n, due_today: 0, ...over,
})
const data = (folders: object[], over: object = {}) => ({
  all: { total: 40, new_count: 0, learning_count: 0, learned_count: 10, due_today: 0, ...over },
  folders,
})
const row = (n: number) => ({
  id: `c${n}`, context_id: 'x', word: `Wort${n}`, translation: `слово${n}`, transcription: '', language: 'de', created_at: '',
  box_level: 1, is_learned: false, next_review_at: new Date().toISOString(), reviewed_today: false,
})

const Where = () => <div data-testid="where">{useLocation().pathname + useLocation().search}</div>
function renderWords() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/words']}>
        <Where />
        <Routes>
          <Route path="/words" element={<WordsPage />} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const where = () => screen.getByTestId('where').textContent
const tiles = () => screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/words/'))

beforeEach(async () => {
  await i18n.changeLanguage('en')
  localStorage.clear()
  vi.mocked(foldersApi.list).mockResolvedValue(data([folder(1), folder(2), folder(3)]) as never)
  vi.mocked(collectionApi.list).mockResolvedValue({ items: [], total: 0 })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('WordsPage: the hub', () => {
  it('the header: "My words" and a summary of words and folders; word fixes sit under it', async () => {
    renderWords()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('My words')
    expect(await screen.findByText('40 words · 3 folders')).toBeTruthy()
    expect(screen.getByTestId('word-fixes')).toBeTruthy()
  })

  it('tiles: All words first, then the folders newest first, then "No folder" and "New folder"', async () => {
    renderWords()
    await screen.findByText('Folder 3')
    expect(tiles().map((a) => a.getAttribute('href'))).toEqual(['/words/all', '/words/f3', '/words/f2', '/words/f1', '/words/none'])
    expect(screen.getByRole('button', { name: 'New folder' }).className).toContain('border-dashed')
  })

  it('"All words": the count and learned line, a bar filled to learned/total, an accent border', async () => {
    renderWords()
    const all = (await screen.findByRole('link', { name: /All words/ })).parentElement!
    expect(all.className).toContain('border-accent')
    expect(within(all).getByText('10 of 40 learned')).toBeTruthy()
    expect(within(all).getByTestId('learned-bar').style.width).toBe('25%')
  })

  it('a folder tile: the name, the word count and its own progress bar', async () => {
    renderWords()
    const tile = (await screen.findByRole('link', { name: /Folder 2/ })).parentElement!
    expect(within(tile).getByText('4 words')).toBeTruthy()
    expect(within(tile).getByTestId('learned-bar').style.width).toBe('50%') // 2 of 4
    expect(within(tile).getByText('Folder 2').className).toContain('line-clamp-2')
  })

  it('"No folder" only when some words have none (40 − Σ folders)', async () => {
    vi.mocked(foldersApi.list).mockResolvedValue(data([folder(1), folder(2), folder(3)], { total: 12 }) as never) // 2+4+6 = 12 in folders
    renderWords()
    await screen.findByText('Folder 3')
    expect(screen.queryByRole('link', { name: /No folder/ })).toBeNull()
    cleanup()
    vi.mocked(foldersApi.list).mockResolvedValue(data([folder(1)], { total: 5 }) as never) // 3 without a folder
    renderWords()
    const none = await screen.findByRole('link', { name: /No folder/ })
    expect(none.getAttribute('href')).toBe('/words/none')
    expect(within(none).getByText('3 words')).toBeTruthy()
  })

  it('▶ only on folders with words due, as a sibling of the link, to /train?folder=<id>&size=<n>', async () => {
    vi.mocked(foldersApi.list).mockResolvedValue(data([folder(1), folder(2, { due_today: 7 }), folder(3, { due_today: 35 })]) as never)
    renderWords()
    await screen.findByText('Folder 3')
    const play = screen.getAllByRole('button', { name: /^Train “/ })
    expect(play.map((b) => b.getAttribute('aria-label'))).toEqual(['Train “Folder 3”', 'Train “Folder 2”'])
    expect(play[0].className).toContain('absolute')
    expect(play[0].className).toContain('h-10')
    expect(play[0].querySelector('svg')!.getAttribute('fill')).toBe('currentColor')
    expect(tiles().some((a) => a.contains(play[0]))).toBe(false)
    // the bar leaves room for the button only on those tiles
    const withButton = play[1].parentElement!.querySelector('[data-testid="learned-bar"]')!.parentElement!
    expect(withButton.className).toContain('mr-12')
    const plain = (screen.getByRole('link', { name: /Folder 1/ })).parentElement!.querySelector('[data-testid="learned-bar"]')!.parentElement!
    expect(plain.className).not.toContain('mr-12')
    fireEvent.click(play[1])
    expect(where()).toBe('/train?folder=f2&size=7')
  })

  it('the ▶ size is capped at 20', async () => {
    vi.mocked(foldersApi.list).mockResolvedValue(data([folder(3, { due_today: 35 })]) as never)
    renderWords()
    fireEvent.click(await screen.findByRole('button', { name: 'Train “Folder 3”' }))
    expect(where()).toBe('/train?folder=f3&size=20')
  })

  it('a new folder is created from the tile and opened afterwards', async () => {
    vi.mocked(foldersApi.create).mockResolvedValue({ id: 'new1', name: 'Neu', color: 'sky', created_at: '', total: 0 } as never)
    renderWords()
    fireEvent.click(await screen.findByRole('button', { name: 'New folder' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Neu' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Create|Save/ }))
    await waitFor(() => expect(foldersApi.create).toHaveBeenCalled())
    await waitFor(() => expect(where()).toBe('/words/new1'))
  })

  it('while loading: 4 skeleton tiles; a failure: the error state', async () => {
    vi.mocked(foldersApi.list).mockReturnValue(new Promise(() => undefined))
    renderWords()
    expect(document.querySelector('[aria-busy="true"]')!.children).toHaveLength(4)
    cleanup()
    vi.mocked(foldersApi.list).mockRejectedValue(new Error('boom'))
    renderWords()
    await waitFor(() => expect(screen.queryByRole('alert') ?? screen.queryByText(/boom|wrong|failed/i)).toBeTruthy())
  })
})

describe('WordsPage: search', () => {
  it('the field is always there; typing replaces the tiles with word rows (debounced)', async () => {
    vi.mocked(collectionApi.list).mockResolvedValue({ items: [row(1), row(2)], total: 2 } as never)
    renderWords()
    await screen.findByText('Folder 3')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hund' } })
    await waitFor(() => expect(collectionApi.list).toHaveBeenCalledWith(expect.objectContaining({ q: 'hund', folder: '', limit: 48, offset: 0 })))
    expect(await screen.findAllByTestId('word-row')).toHaveLength(2)
    expect(screen.getByText('Found: 2')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Folder 3/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull()
  })

  it('nothing found says so; clearing brings the tiles back', async () => {
    renderWords()
    await screen.findByText('Folder 3')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'zzz' } })
    expect(await screen.findByText('Nothing found')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(await screen.findByText('Folder 3')).toBeTruthy()
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('')
  })

  it('no request for an empty query', async () => {
    renderWords()
    await screen.findByText('Folder 3')
    await new Promise((r) => setTimeout(r, 50))
    expect(collectionApi.list).not.toHaveBeenCalled()
  })
})
