import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { foldersApi, meApi } from '../api/endpoints'
import { FolderGrid } from './Folders'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    foldersApi: { list: vi.fn(), share: vi.fn(), regenerateShare: vi.fn(), disableShare: vi.fn(), remove: vi.fn() },
  }
})

const stats = (total: number) => ({ total, new_count: total, learning_count: 0, learned_count: 0, due_today: 0 })
const lists = {
  all: stats(5),
  folders: [
    { id: 'f-words', name: 'Tiere', color: 'amber', created_at: '', share_token: null, import_count: 0, ...stats(5) },
    { id: 'f-shared', name: 'Reise', color: 'sky', created_at: '', share_token: 'aB3dE5gH7k', import_count: 2, ...stats(3) },
    { id: 'f-empty', name: 'Leer', color: 'lime', created_at: '', share_token: null, import_count: 0, ...stats(0) },
  ],
}

function renderGrid() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter><FolderGrid /></MemoryRouter></QueryClientProvider>)
  return qc
}
const card = (name: string) => screen.getByText(name).closest('div.group') as HTMLElement

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(meApi.get).mockResolvedValue({ id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de' })
  vi.mocked(foldersApi.list).mockResolvedValue(lists as never)
  vi.mocked(foldersApi.share).mockResolvedValue({ token: 'aB3dE5gH7k', url: 'https://yodla.fun/s/aB3dE5gH7k' })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('folder cards: sharing', () => {
  it('"Share" is the first item of the ⋯ menu, above rename and delete', async () => {
    renderGrid()
    await screen.findByText('Tiere')
    fireEvent.click(within(card('Tiere')).getByRole('button', { name: 'Folder menu' }))
    const items = within(card('Tiere')).getAllByRole('button').filter((b) => /^\S+ (Share|Edit folder|Delete folder)$/.test(b.textContent ?? ''))
    expect(items.map((b) => b.textContent?.replace(/^\S+\s/, ''))).toEqual(['Share', 'Edit folder', 'Delete folder'])
  })

  it('"All words" is locked: no menu, no share button, no shared state', async () => {
    renderGrid()
    await screen.findByText('Tiere')
    const all = screen.getByText('All words').closest('div.group') as HTMLElement
    expect(within(all).queryByRole('button', { name: 'Folder menu' })).toBeNull()
    expect(within(all).queryByRole('button', { name: 'Share' })).toBeNull()
    expect(within(all).queryByText(/Share/)).toBeNull()
    expect(within(all).queryByLabelText('Shared via link')).toBeNull()
  })

  it('an unshared folder shows a muted share button; clicking it opens the modal', async () => {
    renderGrid()
    await screen.findByText('Tiere')
    const btn = within(card('Tiere')).getByRole('button', { name: 'Share' }) as HTMLButtonElement
    expect(btn.title).toBe('Share')
    expect(btn.disabled).toBe(false)
    expect(btn.className).toContain('text-emerald-300/60')
    expect(btn.querySelector('span[aria-hidden]')).toBeNull() // no dot
    fireEvent.click(btn)
    expect(await screen.findByDisplayValue('https://yodla.fun/s/aB3dE5gH7k')).toBeTruthy()
    expect(foldersApi.share).toHaveBeenCalledWith('f-words')
  })

  it('a shared folder shows the lime "shared" state with a dot; clicking opens the same modal', async () => {
    renderGrid()
    await screen.findByText('Reise')
    const btn = within(card('Reise')).getByRole('button', { name: 'Shared via link' }) as HTMLButtonElement
    expect(btn.title).toBe('Shared via link')
    expect(btn.className).toContain('text-lime-300')
    expect(btn.querySelector('span[aria-hidden]')).not.toBeNull() // the dot
    fireEvent.click(btn)
    expect(await screen.findByDisplayValue('https://yodla.fun/s/aB3dE5gH7k')).toBeTruthy()
    expect(screen.getByText('Added by: 2')).toBeTruthy()
    expect(foldersApi.share).toHaveBeenCalledWith('f-shared')
  })

  it('an empty folder: the button is disabled, dimmed, says why, and does nothing (menu item too)', async () => {
    renderGrid()
    await screen.findByText('Leer')
    const btn = within(card('Leer')).getByTitle('The folder is empty — add words to share it') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.className).toContain('disabled:opacity-40')
    fireEvent.click(btn)
    fireEvent.click(within(card('Leer')).getByRole('button', { name: 'Folder menu' }))
    const item = within(card('Leer')).getByText(/🔗 Share/).closest('button')!
    expect(item.disabled).toBe(true)
    fireEvent.click(item)
    expect(foldersApi.share).not.toHaveBeenCalled()
  })

  it('enabling from the menu opens the modal; the folders list is re-read so the badge appears', async () => {
    renderGrid()
    await screen.findByText('Tiere')
    const before = vi.mocked(foldersApi.list).mock.calls.length
    fireEvent.click(within(card('Tiere')).getByRole('button', { name: 'Folder menu' }))
    fireEvent.click(within(card('Tiere')).getByText(/🔗 Share/))
    expect(await screen.findByDisplayValue('https://yodla.fun/s/aB3dE5gH7k')).toBeTruthy()
    await waitFor(() => expect(vi.mocked(foldersApi.list).mock.calls.length).toBeGreaterThan(before))
  })
})
