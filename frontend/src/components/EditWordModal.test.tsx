import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { foldersApi, wordsApi } from '../api/endpoints'
import type { CollectionCard } from '../api/types'
import { EditWordModal } from './EditWordModal'
import * as toaster from './Toaster'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    wordsApi: { ...mod.wordsApi, update: vi.fn(), generateExample: vi.fn() },
    foldersApi: { list: vi.fn() },
  }
})

type Page = { items: CollectionCard[]; total: number }

const card: CollectionCard = {
  id: 'w1', context_id: 'c1', word: 'Süden', translation: 'юг', transcription: '[ˈzyːdn̩]', language: 'de',
  example_sentence: '', example_translation: '', folder_id: 'f-old', created_at: '2026-01-01T00:00:00Z',
  box_level: 2, is_learned: false, next_review_at: '2026-10-17T00:00:00Z', reviewed_today: false,
} as CollectionCard
const other = { ...card, id: 'w2', word: 'Norden' }

const page = (items: CollectionCard[]): InfiniteData<Page> => ({
  pages: [{ items, total: items.length }], pageParams: [0],
})

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  // What a user who visited the Collection tab has cached: the TRUE-total query holds a plain
  // number, folder views hold pages, and the dictionary holds a plain array.
  qc.setQueryData(['collection', 'grand-total'], 2)
  qc.setQueryData(['collection', { folder: '', status: 'all' }], page([card, other]))
  qc.setQueryData(['collection', { folder: 'f-old', status: 'all' }], page([card, other]))
  qc.setQueryData(['collection', { folder: 'f-new', status: 'all' }], page([]))
  qc.setQueryData(['cards'], [card, other])
  const onClose = vi.fn()
  render(<QueryClientProvider client={qc}><EditWordModal card={card} onClose={onClose} /></QueryClientProvider>)
  return { qc, onClose }
}

const items = (qc: QueryClient, folder: string) =>
  qc.getQueryData<InfiniteData<Page>>(['collection', { folder, status: 'all' }])!.pages[0].items

let toast: ReturnType<typeof vi.spyOn>
let logged: ReturnType<typeof vi.spyOn>
beforeEach(async () => {
  await i18n.changeLanguage('ru')
  vi.mocked(foldersApi.list).mockResolvedValue({
    all: { total: 2 },
    folders: [
      { id: 'f-old', name: 'Старая', color: 'lime' },
      { id: 'f-new', name: 'Компос', color: 'sky' },
    ],
  } as never)
  toast = vi.spyOn(toaster, 'toast').mockImplementation(() => undefined)
  logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('EditWordModal save', () => {
  it('empty example, nothing else changed → saves, closes, toast, list updated, no crash', async () => {
    vi.mocked(wordsApi.update).mockResolvedValue({ ...card, translation: 'юг (сторона света)' } as CollectionCard)
    const { qc, onClose } = setup()
    fireEvent.change(screen.getByLabelText(/^Перевод \*/), { target: { value: 'юг (сторона света)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(wordsApi.update).toHaveBeenCalledWith('w1', { translation: 'юг (сторона света)' })
    expect(toast).toHaveBeenCalledWith('Сохранено')
    expect(screen.queryByText(/Cannot read|Не удалось сохранить/)).toBeNull()
    expect(items(qc, '')[0].translation).toBe('юг (сторона света)')
    expect(items(qc, '')[0].box_level).toBe(2) // progress fields of the cached item are kept
    expect(qc.getQueryData(['collection', 'grand-total'])).toBe(2) // untouched
  })

  it('folder change → the card leaves the old folder view at once, the new view is re-read', async () => {
    vi.mocked(wordsApi.update).mockResolvedValue({ ...card, folder_id: 'f-new' } as CollectionCard)
    const { qc, onClose } = setup()
    await screen.findByText(/Компос/) // the folder list has loaded
    fireEvent.change(screen.getByLabelText(/Папка/), { target: { value: 'f-new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(wordsApi.update).toHaveBeenCalledWith('w1', { folder_id: 'f-new' })
    expect(toast).toHaveBeenCalledWith('Сохранено')
    expect(items(qc, 'f-old').map((c) => c.id)).toEqual(['w2']) // gone from the old folder at once
    // The new folder's view is re-read (the card may match its status/search filters or not),
    // so it shows up there without a reload; folder counters are re-read too.
    expect(qc.getQueryState(['collection', { folder: 'f-new', status: 'all' }])?.isInvalidated).toBe(true)
    expect(items(qc, '').find((c) => c.id === 'w1')?.folder_id).toBe('f-new')
  })

  it('a response without a card does not crash: lists are refetched instead', async () => {
    vi.mocked(wordsApi.update).mockResolvedValue(undefined as unknown as CollectionCard)
    const { qc, onClose } = setup()
    fireEvent.change(screen.getByLabelText(/^Перевод \*/), { target: { value: 'юг!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(qc.getQueryState(['cards'])?.isInvalidated).toBe(true)
    expect(toast).toHaveBeenCalledWith('Сохранено')
  })

  it('a failed request shows the i18n text, never the raw error; the original goes to the console', async () => {
    vi.mocked(wordsApi.update).mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'map')"))
    setup()
    fireEvent.change(screen.getByLabelText(/^Перевод \*/), { target: { value: 'юг!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Не удалось сохранить. Попробуйте ещё раз.')).toBeTruthy()
    expect(screen.queryByText(/Cannot read/)).toBeNull()
    expect(logged).toHaveBeenCalled()
  })
})

describe('EditWordModal: the generate button on phones', () => {
  it.each(['ru', 'en', 'uz'])('%s: label above, full-width button on phones; one row from sm', async (lng) => {
    await i18n.changeLanguage(lng)
    setup()
    const button = screen.getAllByRole('button').find((b) => b.className.includes('btn-ghost') && b.className.includes('disabled:opacity-50'))!
    expect(button.className).toContain('w-full')
    expect(button.className).toContain('sm:w-auto')
    expect(button.className).toContain('sm:shrink-0')
    const row = button.parentElement!
    expect(row.className).toContain('flex-col')
    expect(row.className).toContain('sm:flex-row')
    expect(row.querySelector('label')).toBeTruthy()
  })
})
