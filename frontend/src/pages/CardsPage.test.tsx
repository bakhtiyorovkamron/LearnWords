import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { collectionApi, foldersApi } from '../api/endpoints'
import { CardsPage } from './CardsPage'

vi.mock('../components/ReviewSession', () => ({ ReviewSession: () => <div>REVIEW SCREEN</div> }))
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
        <Routes><Route path="/cards" element={<CardsPage />} /></Routes>
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

describe('CardsPage: the tab lives in the URL', () => {
  it('/cards opens Review', () => {
    renderCards('/cards')
    expect(screen.getByText('REVIEW SCREEN')).toBeTruthy()
    expect(collectionApi.list).not.toHaveBeenCalled()
  })

  it('/cards?tab=all opens the collection, with the folder from the URL', async () => {
    renderCards('/cards?tab=all&folder=f1')
    expect(screen.queryByText('REVIEW SCREEN')).toBeNull()
    await waitFor(() => expect(collectionApi.list).toHaveBeenCalled())
    expect(vi.mocked(collectionApi.list).mock.calls[0][0]).toMatchObject({ folder: 'f1' })
  })

  it('the tab buttons change the URL (no new history entry)', async () => {
    renderCards('/cards')
    fireEvent.click(screen.getByRole('button', { name: 'Collection' }))
    expect(where()).toBe('/cards?tab=all')
    await waitFor(() => expect(collectionApi.list).toHaveBeenCalled())
    expect(screen.queryByText('REVIEW SCREEN')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(where()).toBe('/cards')
    expect(screen.getByText('REVIEW SCREEN')).toBeTruthy()
  })

  it('going to /cards from the collection always lands on Review', () => {
    renderCards('/cards?tab=all&folder=f1')
    fireEvent.click(screen.getByRole('link', { name: 'to cards' }))
    expect(where()).toBe('/cards')
    expect(screen.getByText('REVIEW SCREEN')).toBeTruthy()
  })

  it('the active tab is the primary button', () => {
    renderCards('/cards?tab=all')
    expect(screen.getByRole('button', { name: 'Collection' }).className).toContain('bg-accent')
    expect(screen.getByRole('button', { name: 'Review' }).className).not.toContain('bg-accent')
  })
})

describe('Collection: filter sheet and search', () => {
  const lastParams = () => vi.mocked(collectionApi.list).mock.calls.at(-1)![0]
  const open = async () => {
    renderCards('/cards?tab=all')
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

