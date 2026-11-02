import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { collectionApi, foldersApi } from '../api/endpoints'
import { CardsPage } from './CardsPage'

vi.mock('../components/WordFixes', () => ({ WordFixes: () => null }))
vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    collectionApi: { list: vi.fn(), ids: vi.fn() },
    foldersApi: { list: vi.fn(), create: vi.fn() },
  }
})

const Where = () => <div data-testid="where">{useLocation().pathname + useLocation().search}</div>
function renderCards(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Where />
        <Link to="/cards">to cards</Link>
        <Routes>
          <Route path="/cards" element={<CardsPage view="flip" />} />
          <Route path="/words" element={<CardsPage view="list" />} />
          <Route path="/words/:folder" element={<CardsPage view="list" />} />
          <Route path="/train" element={<div>TRAIN SCREEN</div>} />
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
  vi.mocked(collectionApi.list).mockResolvedValue({ items: [], total: 0 })
  vi.mocked(foldersApi.list).mockResolvedValue({ all: { total: 0, due_today: 0 }, folders: [{ id: 'f1', name: 'Tiere', color: 'sky', total: 3 }] } as never)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

const cardRow = (id: string, word: string) => ({
  id, context_id: 'x', word, translation: 'перевод', transcription: '', language: 'de', created_at: '',
  box_level: 1, is_learned: false, next_review_at: new Date().toISOString(), reviewed_today: false,
})

describe('CardsPage: two tabs on one collection', () => {
  beforeEach(() => {
    vi.mocked(collectionApi.list).mockResolvedValue({ items: [cardRow('c1', 'Hund')], total: 1 } as never)
  })

  it('/words is the list: word rows, a "My words" title and no list/flashcards toggle', async () => {
    renderCards('/words')
    expect(await screen.findByTestId('word-row')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('My words')
    expect(screen.queryByRole('button', { name: 'Flashcards' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'List' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Click to flip' })).toBeNull()
    expect(screen.getByRole('button', { name: /Select/ })).toBeTruthy() // select & move is a list feature
    expect(localStorage.getItem('collection-view')).toBeNull() // the view is the route now
  })

  it('/cards shows flip cards, titled "Cards", with the direction toggle and no word rows', async () => {
    renderCards('/cards')
    expect(await screen.findByRole('button', { name: 'Click to flip' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Cards')
    expect(screen.queryByTestId('word-row')).toBeNull()
    expect(screen.getByRole('radiogroup', { name: 'Direction' })).toBeTruthy()
    expect(where()).toBe('/cards')
  })

  it('/words/:folder is the initial folder of the list: an id, "all" or "none"', async () => {
    renderCards('/words/f1')
    await waitFor(() => expect(collectionApi.list).toHaveBeenCalled())
    expect(vi.mocked(collectionApi.list).mock.calls[0][0]).toMatchObject({ folder: 'f1' })
    cleanup(); vi.clearAllMocks()
    renderCards('/words/none')
    await waitFor(() => expect(collectionApi.list).toHaveBeenCalled())
    expect(vi.mocked(collectionApi.list).mock.calls[0][0]).toMatchObject({ folder: 'none' })
    cleanup(); vi.clearAllMocks()
    renderCards('/words/all')
    await waitFor(() => expect(collectionApi.list).toHaveBeenCalled())
    expect(vi.mocked(collectionApi.list).mock.calls[0][0]).toMatchObject({ folder: '' })
    cleanup(); vi.clearAllMocks()
    renderCards('/words')
    await waitFor(() => expect(collectionApi.list).toHaveBeenCalled())
    expect(vi.mocked(collectionApi.list).mock.calls[0][0]).toMatchObject({ folder: '' })
  })

  it('/cards?folder=<id> is the initial folder of the flashcards', async () => {
    renderCards('/cards?folder=f1')
    await waitFor(() => expect(collectionApi.list).toHaveBeenCalled())
    expect(vi.mocked(collectionApi.list).mock.calls[0][0]).toMatchObject({ folder: 'f1' })
  })
})

describe('CardsPage: old links', () => {
  it('/cards?tab=all → /words, and with &folder=X → /words/X', async () => {
    renderCards('/cards?tab=all')
    await waitFor(() => expect(where()).toBe('/words'))
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy()
    cleanup()
    renderCards('/cards?tab=all&folder=f1')
    await waitFor(() => expect(where()).toBe('/words/f1'))
    await waitFor(() => expect(vi.mocked(collectionApi.list).mock.calls.some(([q]) => (q as { folder?: string }).folder === 'f1')).toBe(true))
  })

  it('an old /cards?start=1&size=12 link opens the training: /train?size=12', async () => {
    renderCards('/cards?start=1&size=12')
    expect(await screen.findByText('TRAIN SCREEN')).toBeTruthy()
    expect(where()).toBe('/train?size=12')
    expect(collectionApi.list).not.toHaveBeenCalled()
  })

  it('?start=1 with a size nobody accepts (or none) opens /train without a size', async () => {
    renderCards('/cards?start=1&size=99')
    expect(await screen.findByText('TRAIN SCREEN')).toBeTruthy()
    expect(where()).toBe('/train')
    cleanup()
    renderCards('/cards?start=1')
    expect(await screen.findByText('TRAIN SCREEN')).toBeTruthy()
    expect(where()).toBe('/train')
  })

  it('an old /cards?practice=1 link goes Home (extra practice is gone)', async () => {
    renderCards('/cards?practice=1')
    expect(await screen.findByText('HOME SCREEN')).toBeTruthy()
    expect(where()).toBe('/')
  })
})

describe('Collection: filter sheet and search', () => {
  const lastParams = () => vi.mocked(collectionApi.list).mock.calls.at(-1)![0]
  const open = async () => {
    renderCards('/words')
    fireEvent.click(await screen.findByRole('button', { name: /Filter/ }))
    return screen.getByRole('dialog')
  }

  it('changing status/period/sort refetches with the new params and the badge counts them', async () => {
    await open()
    expect(screen.queryByTestId('filter-badge')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Learned' }))
    await waitFor(() => expect(lastParams().status).toBe('learned'))
    fireEvent.click(screen.getByRole('button', { name: 'This week' }))
    await waitFor(() => expect(lastParams().period).toBe('week'))
    fireEvent.click(screen.getByRole('radio', { name: 'Alphabetically' }))
    await waitFor(() => expect(lastParams().sort).toBe('alpha'))
    expect(screen.getByTestId('filter-badge').textContent).toBe('3')
  })

  it('Reset puts all three back; Esc closes', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Learned' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Alphabetically' }))
    await waitFor(() => expect(screen.getByTestId('filter-badge').textContent).toBe('2'))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(lastParams()).toMatchObject({ status: 'all', period: 'all', sort: 'date' }))
    expect(screen.queryByTestId('filter-badge')).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the search icon opens the field; typing filters (debounced); clear empties it', async () => {
    renderCards('/cards?tab=all')
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Search by word or translation…' }))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'hund' } })
    await waitFor(() => expect(lastParams().q).toBe('hund'))
    fireEvent.click(screen.getByRole('button', { name: /Close|×|Закрыть/ }))
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('')
    await waitFor(() => expect(lastParams().q).toBe(''))
  })
})

