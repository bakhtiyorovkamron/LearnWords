import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { collectionApi, foldersApi, wordsApi } from '../api/endpoints'
import { FolderPage } from './FolderPage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    collectionApi: { list: vi.fn(), ids: vi.fn() },
    foldersApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), share: vi.fn() },
    wordsApi: { ...mod.wordsApi, move: vi.fn() },
  }
})

const folder = (id: string, name: string, over: object = {}) => ({
  id, name, color: 'sky', created_at: '', total: 8, new_count: 0, learning_count: 0, learned_count: 2, due_today: 5, ...over,
})
const folderList = (over: object = {}) => ({
  all: { total: 30, new_count: 0, learning_count: 0, learned_count: 9, due_today: 12 },
  folders: [folder('f1', 'Tiere', over), folder('f2', 'Essen', { total: 4, learned_count: 4, due_today: 0 })],
})
const row = (n: number) => ({
  id: `c${n}`, context_id: 'x', word: `Wort${n}`, translation: `слово${n}`, transcription: '', language: 'de', created_at: '',
  box_level: 1, is_learned: false, next_review_at: new Date().toISOString(), reviewed_today: false,
})

const Where = () => <div data-testid="where">{useLocation().pathname + useLocation().search}</div>
function renderFolder(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/words/:folder" element={<FolderPage />} />
          <Route path="/words" element={<div>HUB</div>} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const where = () => screen.getByTestId('where').textContent
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Actions' }))

beforeEach(async () => {
  await i18n.changeLanguage('en')
  localStorage.clear()
  vi.mocked(foldersApi.list).mockResolvedValue(folderList() as never)
  vi.mocked(collectionApi.list).mockResolvedValue({ items: [row(1), row(2)], total: 8 } as never)
  vi.mocked(collectionApi.ids).mockResolvedValue({ ids: ['c1', 'c2'], total: 2 } as never)
  vi.mocked(wordsApi.move).mockResolvedValue({ moved: 2, previous: [] } as never)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('FolderPage: a folder', () => {
  it('the title, the word count, the ring with the percent, the learned/due line', async () => {
    renderFolder('/words/f1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Tiere' })).toBeTruthy()
    expect(await screen.findByText('8 words')).toBeTruthy()
    const ring = screen.getByTestId('goal-ring')
    expect(ring.textContent).toBe('25%') // 2 of 8
    expect(screen.getByText('2 learned · 5 due today')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to folders' }).getAttribute('href')).toBe('/words')
  })

  it('Train → /train?folder=f1&size=5 (capped at 20)', async () => {
    renderFolder('/words/f1')
    fireEvent.click(await screen.findByRole('button', { name: 'Train' }))
    expect(where()).toBe('/train?folder=f1&size=5')
    cleanup()
    vi.mocked(foldersApi.list).mockResolvedValue(folderList({ due_today: 90 }) as never)
    renderFolder('/words/f1')
    fireEvent.click(await screen.findByRole('button', { name: 'Train' }))
    expect(where()).toBe('/train?folder=f1&size=20')
  })

  it('nothing due → the button is ghost, disabled, and says so', async () => {
    renderFolder('/words/f2')
    const button = await screen.findByRole('button', { name: 'Nothing due today' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.className).toContain('btn-ghost')
    expect(screen.queryByRole('button', { name: 'Train' })).toBeNull()
  })

  it('the Cards button opens the deck of this folder', async () => {
    renderFolder('/words/f1')
    const cards = await screen.findByRole('link', { name: 'Cards' })
    expect(cards.getAttribute('href')).toBe('/cards?folder=f1')
    expect(cards.className).toContain('h-12')
  })

  it('Share is there for a folder, disabled when it is empty', async () => {
    renderFolder('/words/f1')
    expect((await screen.findByRole('button', { name: 'Share' }) as HTMLButtonElement).disabled).toBe(false)
    cleanup()
    vi.mocked(foldersApi.list).mockResolvedValue(folderList({ total: 0, learned_count: 0, due_today: 0 }) as never)
    renderFolder('/words/f1')
    expect((await screen.findByRole('button', { name: 'Share' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Share opens the share dialog of the folder', async () => {
    vi.mocked(foldersApi.share).mockResolvedValue({ url: 'https://yodla.fun/s/abc', token: 'abc' } as never)
    renderFolder('/words/f1')
    fireEvent.click(await screen.findByRole('button', { name: 'Share' }))
    expect(await screen.findByRole('dialog', { name: /Tiere/ })).toBeTruthy()
    await waitFor(() => expect(foldersApi.share).toHaveBeenCalledWith('f1'))
  })

  it('the word list: rows with a box indicator; the query asks for this folder', async () => {
    renderFolder('/words/f1')
    expect(await screen.findAllByTestId('word-row')).toHaveLength(2)
    expect(collectionApi.list).toHaveBeenCalledWith({ status: 'all', period: 'all', sort: 'date', q: '', folder: 'f1', limit: 48, offset: 0 })
    expect(screen.getByRole('heading', { level: 2, name: 'Words' })).toBeTruthy()
    expect(screen.getAllByTestId('box-bars')).toHaveLength(2)
  })

  it('an unknown folder id goes back to the hub once the folders have loaded', async () => {
    renderFolder('/words/nope')
    expect(await screen.findByText('HUB')).toBeTruthy()
    expect(where()).toBe('/words')
  })
})

describe('FolderPage: the More sheet', () => {
  it('rename opens the edit dialog of the folder', async () => {
    renderFolder('/words/f1')
    await screen.findByText('8 words')
    openMenu()
    const sheet = screen.getByRole('dialog', { name: 'Actions' })
    expect(within(sheet).getAllByRole('button').map((b) => b.textContent)).toEqual(['Edit folder', 'Select', 'Delete folder'])
    fireEvent.click(within(sheet).getByRole('button', { name: 'Edit folder' }))
    const edit = await screen.findByRole('dialog')
    expect((within(edit).getByRole('textbox') as HTMLInputElement).value).toBe('Tiere')
  })

  it('delete asks to confirm, removes the folder and goes to the hub', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    vi.mocked(foldersApi.remove).mockResolvedValue(undefined as never)
    renderFolder('/words/f1')
    await screen.findByText('8 words')
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Delete folder' }))
    expect(foldersApi.remove).not.toHaveBeenCalled() // declined
    openMenu()
    const del = screen.getByRole('button', { name: 'Delete folder' })
    expect(del.className).toContain('text-danger')
    fireEvent.click(del)
    await waitFor(() => expect(foldersApi.remove).toHaveBeenCalledWith('f1'))
    await waitFor(() => expect(where()).toBe('/words'))
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('"Select" turns on selection mode: checkboxes, select all, a bar to move', async () => {
    renderFolder('/words/f1')
    await screen.findAllByTestId('word-row')
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    await waitFor(() => expect(screen.getByText('Selected: 2')).toBeTruthy())
    expect((screen.getAllByRole('checkbox') as HTMLInputElement[]).every((c) => c.checked)).toBe(true)
  })

  it('selection + move still work: pick a folder in the picker, the words are moved', async () => {
    renderFolder('/words/f1')
    fireEvent.click((await screen.findAllByTestId('word-row'))[0])
    expect(screen.queryByRole('dialog')).not.toBeNull() // outside selection mode a tap opens the word sheet
    fireEvent.keyDown(window, { key: 'Escape' })
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    fireEvent.click(screen.getAllByTestId('word-row')[0])
    fireEvent.click(screen.getAllByTestId('word-row')[1])
    expect(screen.getByText('Selected: 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Move (2)' }))
    const picker = await screen.findByRole('dialog', { name: 'Move (2)' })
    fireEvent.click(await within(picker).findByRole('button', { name: /Essen/ }))
    await waitFor(() => expect(wordsApi.move).toHaveBeenCalledWith(['c1', 'c2'], 'f2'))
    await waitFor(() => expect(screen.queryByRole('checkbox')).toBeNull()) // selection mode is over
  })

  it('cancel in the bar leaves selection mode', async () => {
    renderFolder('/words/f1')
    await screen.findAllByTestId('word-row')
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})

describe('FolderPage: all words and the words without a folder', () => {
  it('/words/all: the title, a train button without a folder, the Cards link without ?folder; no share, rename or delete', async () => {
    renderFolder('/words/all')
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('All words')
    expect(await screen.findByText('30 words')).toBeTruthy()
    expect(screen.getByTestId('goal-ring').textContent).toBe('30%')
    fireEvent.click(screen.getByRole('button', { name: 'Train' }))
    expect(where()).toBe('/train?size=12')
    cleanup()
    renderFolder('/words/all')
    expect((await screen.findByRole('link', { name: 'Cards' })).getAttribute('href')).toBe('/cards')
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
    openMenu()
    expect(within(screen.getByRole('dialog', { name: 'Actions' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Select'])
    expect(collectionApi.list).toHaveBeenCalledWith(expect.objectContaining({ folder: '' }))
  })

  it('/words/none: no ring, no stats line, Train always enabled → /train?folder=none&size=20', async () => {
    renderFolder('/words/none')
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('No folder')
    expect(await screen.findByText('18 words')).toBeTruthy() // 30 − 8 − 4
    expect(screen.queryByTestId('goal-ring')).toBeNull()
    expect(screen.queryByText(/learned ·/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Train' }))
    expect(where()).toBe('/train?folder=none&size=20')
    cleanup()
    renderFolder('/words/none')
    expect((await screen.findByRole('link', { name: 'Cards' })).getAttribute('href')).toBe('/cards?folder=none')
    expect(collectionApi.list).toHaveBeenCalledWith(expect.objectContaining({ folder: 'none' }))
  })
})

describe('FolderPage: the folder sheet and the list controls', () => {
  it('the title opens the folder sheet; picking another folder navigates to it, "All words" to /words/all', async () => {
    renderFolder('/words/f1')
    fireEvent.click(await screen.findByRole('button', { name: /Tiere/ }))
    const dialog = screen.getByRole('dialog', { name: 'Choose a folder' })
    expect(within(dialog).getByRole('radio', { name: /Tiere/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(dialog).getByRole('radio', { name: /Essen/ }))
    expect(where()).toBe('/words/f2')
    await screen.findByText('4 words')
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Essen')
    fireEvent.click(screen.getByRole('button', { name: /Essen/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: /All words/ }))
    expect(where()).toBe('/words/all')
  })

  it('the filter chip shows the sort and the number of active filters; a change refetches', async () => {
    renderFolder('/words/f1')
    await screen.findAllByTestId('word-row')
    expect(screen.queryByTestId('filter-badge')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Newest first/ }))
    const dialog = screen.getByRole('dialog', { name: 'Filter' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Learned' }))
    await waitFor(() => expect(collectionApi.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'learned', folder: 'f1' })))
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Alphabetically' }))
    await waitFor(() => expect(screen.getByTestId('filter-badge').textContent).toBe('2'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('button', { name: /A–Z/ })).toBeTruthy()
    expect(await screen.findByText('Found: 8')).toBeTruthy()
  })

  it('the search icon opens the field; typing filters (debounced), the X clears', async () => {
    renderFolder('/words/f1')
    await screen.findAllByTestId('word-row')
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Search by word or translation…' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hund' } })
    await waitFor(() => expect(collectionApi.list).toHaveBeenCalledWith(expect.objectContaining({ q: 'hund', folder: 'f1' })))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('')
  })

  it('empty states: an empty folder offers to add a word; filters that hide everything say "Nothing found"', async () => {
    vi.mocked(collectionApi.list).mockResolvedValue({ items: [], total: 0 })
    renderFolder('/words/f1')
    expect(await screen.findByText('This folder has no words yet')).toBeTruthy()
    const add = screen.getByRole('link', { name: 'Add a word' })
    expect(add.getAttribute('href')).toBe('/contexts/new')
    fireEvent.click(screen.getByRole('button', { name: /Newest first/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('button', { name: 'Learned' }))
    expect(await screen.findByText('Nothing found')).toBeTruthy()
  })

  it('"Show more" loads the next page', async () => {
    const page1 = Array.from({ length: 48 }, (_, i) => row(i + 1))
    vi.mocked(collectionApi.list).mockImplementation(async (q) =>
      ({ items: (q as { offset: number }).offset === 0 ? page1 : [row(49)], total: 49 }) as never)
    renderFolder('/words/f1')
    fireEvent.click(await screen.findByRole('button', { name: /Show more/ }))
    await waitFor(() => expect(screen.getAllByTestId('word-row')).toHaveLength(49))
  })
})
