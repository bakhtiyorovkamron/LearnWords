import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { foldersApi } from '../api/endpoints'
import type { FolderList as FolderListData } from '../api/types'
import { FolderList } from './FolderList'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, foldersApi: { list: vi.fn(), create: vi.fn() } }
})

const folder = (n: number, extra: object = {}) => ({
  id: `f${n}`, name: `Folder ${n}`, color: 'sky', created_at: '', total: n, new_count: 0, learning_count: 0, learned_count: 0, due_today: 0, ...extra,
})
const data = (folders: object[], total = 13): FolderListData =>
  ({ all: { total, new_count: 0, learning_count: 0, learned_count: 0, due_today: 0 }, folders } as unknown as FolderListData)

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter><FolderList /></MemoryRouter></QueryClientProvider>)
}
const rows = () => screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.includes('&folder='))

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(foldersApi.list).mockResolvedValue(data([folder(1), folder(2), folder(3)]))
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('FolderList', () => {
  it('lists the newest folder first (the API sends the oldest first)', async () => {
    renderList()
    await screen.findByText('Folder 3')
    expect(rows().map((a) => a.querySelector('[title]')!.textContent)).toEqual(['Folder 3', 'Folder 2', 'Folder 1'])
  })

  it('a row opens the folder in the collection and shows its word count', async () => {
    renderList()
    await screen.findByText('Folder 2')
    const row = rows().find((a) => a.textContent?.includes('Folder 2'))!
    expect(row.getAttribute('href')).toBe('/cards?tab=all&folder=f2')
    expect(within(row).getByText('2')).toBeTruthy()
    expect(row.querySelector('svg')).not.toBeNull() // the chevron
  })

  it('"All · 13" opens the whole collection', async () => {
    renderList()
    expect((await screen.findByRole('link', { name: 'All · 13' })).getAttribute('href')).toBe('/cards?tab=all')
  })

  it('a long name is cut, the full name is in the title', async () => {
    const long = 'A'.repeat(40)
    vi.mocked(foldersApi.list).mockResolvedValue(data([folder(1, { name: long })]))
    renderList()
    const name = await screen.findByTitle(long)
    expect(name.textContent).toHaveLength(24)
    expect(name.textContent!.endsWith('…')).toBe(true)
  })

  it('8 folders: 6 rows and "2 more folders"; clicking it shows all of them', async () => {
    vi.mocked(foldersApi.list).mockResolvedValue(data(Array.from({ length: 8 }, (_, i) => folder(i + 1))))
    renderList()
    await screen.findByText('Folder 8')
    expect(rows()).toHaveLength(6)
    expect(screen.queryByText('Folder 1')).toBeNull() // the oldest two are folded
    fireEvent.click(screen.getByRole('button', { name: '2 more folders' }))
    expect(rows()).toHaveLength(8)
    expect(screen.getByText('Folder 1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /more folders?/ })).toBeNull()
  })

  it('exactly 6 folders need no "more" row; 7 say "1 more folder"', async () => {
    vi.mocked(foldersApi.list).mockResolvedValue(data(Array.from({ length: 6 }, (_, i) => folder(i + 1))))
    renderList()
    await screen.findByText('Folder 6')
    expect(screen.queryByRole('button', { name: /more folder/ })).toBeNull()
    cleanup()
    vi.mocked(foldersApi.list).mockResolvedValue(data(Array.from({ length: 7 }, (_, i) => folder(i + 1))))
    renderList()
    expect(await screen.findByRole('button', { name: '1 more folder' })).toBeTruthy()
  })

  it('a shared folder has the "Shared via link" icon, the others do not', async () => {
    vi.mocked(foldersApi.list).mockResolvedValue(data([folder(1), folder(2, { share_token: 'abc' })]))
    renderList()
    await screen.findByText('Folder 2')
    const icons = screen.getAllByRole('img', { name: 'Shared via link' })
    expect(icons).toHaveLength(1)
    expect(rows().find((a) => a.contains(icons[0]))!.textContent).toContain('Folder 2')
  })

  it('"+ New folder" opens the dialog', async () => {
    renderList()
    fireEvent.click(await screen.findByRole('button', { name: 'New folder' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'New folder' })).toBeTruthy()
    expect(within(dialog).getByLabelText('Close')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('no folders: only the "+ New folder" row and the hint', async () => {
    vi.mocked(foldersApi.list).mockResolvedValue(data([]))
    renderList()
    expect(await screen.findByRole('button', { name: 'New folder' })).toBeTruthy()
    expect(rows()).toHaveLength(0)
    expect(screen.getByText(/Create a folder, e\.g\./)).toBeTruthy()
  })

  it('while loading: three skeleton rows', () => {
    vi.mocked(foldersApi.list).mockReturnValue(new Promise(() => undefined))
    renderList()
    const busy = document.querySelector('[aria-busy="true"]')!
    expect(busy.children).toHaveLength(3)
    expect(busy.querySelector('.animate-pulse')).not.toBeNull()
  })
})
