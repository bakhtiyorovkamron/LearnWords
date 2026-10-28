import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { foldersApi, meApi, photoApi, searchApi, type Me, type PhotoWord } from '../api/endpoints'
import * as toaster from './Toaster'
import { PhotoImport } from './PhotoImport'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    photoApi: { import: vi.fn() },
    searchApi: { add: vi.fn() },
    foldersApi: { list: vi.fn() },
  }
})

const feature = (enabled: boolean, limit: number | null = null, remaining: number | null = null) =>
  ({ enabled, daily_limit: limit, remaining })
const me = (photoOn: boolean, remaining = 4): Me => ({
  id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de',
  features: {
    photo_import: feature(photoOn, 4, remaining), daily_story: feature(true),
    word_search: feature(true), story_autotranslate: feature(true),
  },
})
const word = (over: Partial<PhotoWord>): PhotoWord => ({
  word: 'Hund', article: 'der', word_type: 'noun', translation: 'собака', full_word: 'der Hund', already_added: false, ...over,
})
const words = [
  word({}),
  word({ word: 'Katze', article: 'die', full_word: 'die Katze', translation: 'кошка', already_added: true }),
  word({ word: 'laufen', article: null, word_type: 'verb', full_word: 'laufen', translation: 'бежать' }),
]

const fail = (status: number, data: unknown) =>
  new AxiosError('x', String(status), undefined, undefined, { status, data, headers: {}, statusText: '', config: {} as never } as AxiosResponse)

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><PhotoImport /></QueryClientProvider>)
}
const png = () => new File([new Uint8Array(100)], 'page.png', { type: 'image/png' })
const pick = async (file: File) => fireEvent.change(await screen.findByTestId('photo-input'), { target: { files: [file] } })

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(meApi.get).mockResolvedValue(me(true))
  vi.mocked(foldersApi.list).mockResolvedValue({ folders: [] } as never)
  vi.mocked(photoApi.import).mockResolvedValue({ words, remaining: 3 })
  vi.mocked(searchApi.add).mockResolvedValue({} as never)
  vi.spyOn(toaster, 'toast').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks() })

describe('PhotoImport', () => {
  it('is hidden when photo_import is off for the user', async () => {
    vi.mocked(meApi.get).mockResolvedValue(me(false))
    renderIt()
    await waitFor(() => expect(meApi.get).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(/Words from a photo/)).toBeNull())
  })

  it('shows the quota left, lists the found words, and adds only the chosen ones', async () => {
    renderIt()
    expect(await screen.findByText('Photos left today: 4')).toBeTruthy()
    await pick(png())
    expect(await screen.findByText('Words found: 3')).toBeTruthy()
    expect(screen.getByText('Photos left today: 3')).toBeTruthy()

    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.map((b) => b.checked)).toEqual([true, false, true]) // new ones preselected
    expect(boxes[1].disabled).toBe(true) // already in the collection
    expect(screen.getByText('✓ already added')).toBeTruthy()

    fireEvent.click(boxes[2]) // drop "laufen"
    fireEvent.click(screen.getByRole('button', { name: 'Add 1' }))
    await waitFor(() => expect(searchApi.add).toHaveBeenCalledTimes(1))
    expect(vi.mocked(searchApi.add).mock.calls[0][0]).toMatchObject({
      word: 'der Hund', translation: 'собака', translation_language: 'en', lemma: 'Hund', article: 'der', part_of_speech: 'noun',
    })
    await waitFor(() => expect(toaster.toast).toHaveBeenCalledWith('Added: 1. Already had: 0'))
  })

  it('a 409 from add counts as "already had", not as a failure', async () => {
    vi.mocked(searchApi.add).mockRejectedValueOnce(fail(409, { error: 'already exists' }))
    renderIt()
    await pick(png())
    fireEvent.click(await screen.findByRole('button', { name: 'Add 2' }))
    await waitFor(() => expect(toaster.toast).toHaveBeenCalledWith('Added: 1. Already had: 1'))
  })

  it('a used-up daily quota shows the daily-limit text, not the rate-limit one', async () => {
    vi.mocked(photoApi.import).mockRejectedValue(fail(429, { error: 'daily limit reached', code: 'daily_limit', limit: 4 }))
    renderIt()
    await pick(png())
    expect((await screen.findByRole('alert')).textContent).toBe("Today's limit is used up — tomorrow you get 4 again.")
  })

  it('refuses a file that is not an image without calling the server', async () => {
    renderIt()
    await pick(new File(['x'], 'notes.pdf', { type: 'application/pdf' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Please choose an image: JPEG, PNG, WebP or GIF.')
    expect(photoApi.import).not.toHaveBeenCalled()
  })

  it('says so when no words were found, and disables the button when no photos are left', async () => {
    vi.mocked(photoApi.import).mockResolvedValue({ words: [], remaining: 0 })
    renderIt()
    await pick(png())
    expect(await screen.findByText(/No words to learn were found/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /Another photo/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
