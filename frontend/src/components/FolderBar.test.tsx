import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { foldersApi } from '../api/endpoints'
import { FolderBar } from './Folders'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, foldersApi: { list: vi.fn(), create: vi.fn(), remove: vi.fn() } }
})

const folder = (id: string, name: string, total: number) =>
  ({ id, name, color: 'sky', created_at: '', total, new_count: 0, learning_count: 0, learned_count: 0, due_today: 0 })

const Where = () => <div data-testid="where">{useLocation().pathname + useLocation().search}</div>
function renderBar(value: string, onChange: (v: string) => void = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/cards?tab=all']}>
        <Where />
        <Routes><Route path="*" element={<FolderBar value={value} onChange={onChange} />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  localStorage.clear()
  vi.mocked(foldersApi.list).mockResolvedValue({
    all: { total: 8 }, folders: [folder('f1', 'Tiere', 5), folder('f2', 'Leer', 0)],
  } as never)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('FolderBar: Train', () => {
  it('trains the active folder: review-folder is set and /cards opens', async () => {
    renderBar('f1')
    fireEvent.click(await screen.findByRole('button', { name: 'Train' }))
    expect(localStorage.getItem('review-folder')).toBe('f1')
    expect(screen.getByTestId('where').textContent).toBe('/cards') // the review tab, not the collection
  })

  it('is the first action of the folder, before rename and share', async () => {
    renderBar('f1')
    const train = await screen.findByRole('button', { name: 'Train' })
    const actions = Array.from(train.parentElement!.querySelectorAll('button')).map((b) => b.textContent?.trim())
    expect(actions[0]).toBe('Train')
    expect(train.className).toContain('text-accent-text')
    expect(train.className).toContain('font-semibold')
    expect(actions.length).toBeGreaterThan(2) // rename, share, delete are still there
  })

  it('is hidden for an empty folder', async () => {
    renderBar('f2')
    await screen.findByRole('button', { name: /Rename|Edit folder/ })
    expect(screen.queryByRole('button', { name: 'Train' })).toBeNull()
  })

  it('is hidden when no real folder is active (all words / no folder)', async () => {
    renderBar('')
    await screen.findByRole('button', { name: /Tiere/ })
    expect(screen.queryByRole('button', { name: 'Train' })).toBeNull()
    cleanup()
    renderBar('none')
    await screen.findByRole('button', { name: /Tiere/ })
    expect(screen.queryByRole('button', { name: 'Train' })).toBeNull()
    await waitFor(() => expect(foldersApi.list).toHaveBeenCalled())
  })
})

describe('FolderBar: chips and actions', () => {
  it('chips switch the folder', async () => {
    const onChange = vi.fn()
    renderBar('', onChange)
    fireEvent.click(await screen.findByRole('button', { name: /Tiere/ }))
    expect(onChange).toHaveBeenCalledWith('f1')
    fireEvent.click(screen.getByRole('button', { name: 'All words' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('the active folder has Train, Share, Rename and Delete; Share is disabled for an empty one', async () => {
    renderBar('f1')
    for (const n of ['Train', 'Share', 'Edit folder', 'Delete']) expect(await screen.findByRole('button', { name: new RegExp(n) })).toBeTruthy()
    expect((screen.getByRole('button', { name: /Share/ }) as HTMLButtonElement).disabled).toBe(false)
    cleanup()
    renderBar('f2')
    const share = (await screen.findByRole('button', { name: /Share/ })) as HTMLButtonElement
    expect(share.disabled).toBe(true)
    expect(share.title).toBeTruthy()
  })

  it('Delete asks to confirm and removes the folder', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(foldersApi.remove).mockResolvedValue(undefined as never)
    const onChange = vi.fn()
    renderBar('f1', onChange)
    fireEvent.click(await screen.findByRole('button', { name: /Delete/ }))
    await waitFor(() => expect(foldersApi.remove).toHaveBeenCalledWith('f1'))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(''))
  })
})
