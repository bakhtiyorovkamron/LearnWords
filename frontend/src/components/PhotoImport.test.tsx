import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { AxiosError, type AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { foldersApi, meApi, photoApi, searchApi, type Me, type PhotoWord } from '../api/endpoints'
import * as photoLib from '../lib/photo'
import * as toaster from './Toaster'
import { PhotoImport } from './PhotoImport'

vi.mock('../lib/photo', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lib/photo')>()
  return { ...mod, preparePhoto: vi.fn(mod.preparePhoto) }
})

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    photoApi: { import: vi.fn() },
    searchApi: { add: vi.fn() },
    foldersApi: { list: vi.fn(), create: vi.fn() },
  }
})

const feature = (enabled: boolean, limit: number | null = null, remaining: number | null = null) =>
  ({ enabled, daily_limit: limit, remaining })
const LIMIT = 10 // the default daily photo limit
const me = (photoOn: boolean, remaining = LIMIT, limit = LIMIT): Me => ({
  id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de',
  features: {
    photo_import: feature(photoOn, limit, remaining), daily_story: feature(true),
    word_search: feature(true), story_autotranslate: feature(true), theme_picker: feature(false),
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
  render(<QueryClientProvider client={qc}><MemoryRouter><PhotoImport /></MemoryRouter></QueryClientProvider>)
}
const png = () => new File([new Uint8Array(100)], 'page.png', { type: 'image/png' })
const pick = async (file: File) => fireEvent.change(await screen.findByTestId('photo-input'), { target: { files: [file] } })

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(meApi.get).mockResolvedValue(me(true))
  vi.mocked(foldersApi.list).mockResolvedValue({ folders: [] } as never)
  vi.mocked(foldersApi.create).mockImplementation(async (name) => ({ id: 'new-id', name, color: 'lime' }) as never)
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
    expect(await screen.findByText('Left today: 10 of 10')).toBeTruthy()
    await pick(png())
    expect(await screen.findByText('Words found: 3')).toBeTruthy()
    expect(screen.getByText('Left today: 3 of 10')).toBeTruthy()

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
    await waitFor(() => expect(toaster.toast).toHaveBeenCalledTimes(1))
  })

  it('a 409 from add counts as "already had", not as a failure', async () => {
    vi.mocked(searchApi.add).mockRejectedValueOnce(fail(409, { error: 'already exists' }))
    renderIt()
    await pick(png())
    fireEvent.click(await screen.findByRole('button', { name: 'Add 2' }))
    await waitFor(() => expect(vi.mocked(toaster.toast).mock.calls[0][0]).toMatch(/: 1\. Already there: 1$/))
  })

  it('a used-up daily quota shows the daily-limit text, not the rate-limit one', async () => {
    vi.mocked(photoApi.import).mockRejectedValue(fail(429, { error: 'daily limit reached', code: 'daily_limit', limit: 10 }))
    renderIt()
    await pick(png())
    expect((await screen.findByRole('alert')).textContent).toBe("Today's limit is used up — tomorrow you get 10 again.")
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

const dd = () => {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
}
const folder = (id: string, name: string) => ({ id, name, color: 'sky' })

describe('PhotoImport: quota pill', () => {
  it('shows "3 of 10" with 10 small dots, 3 of them filled', async () => {
    vi.mocked(meApi.get).mockResolvedValue(me(true, 3))
    renderIt()
    const pill = await screen.findByTestId('photo-quota')
    expect(pill.textContent).toBe('Left today: 3 of 10')
    const dots = screen.getAllByTestId('photo-dot')
    expect(dots).toHaveLength(10)
    expect(dots.map((d) => d.getAttribute('data-filled'))).toEqual(
      ['true', 'true', 'true', ...Array(7).fill('false')])
    // above 5 the dots are small and tight, so 10 of them fit a 360 px screen
    for (const d of dots) { expect(d.className).toContain('h-1.5'); expect(d.className).toContain('w-1.5') }
    expect(dots[0].parentElement!.className).toContain('gap-1')
    expect(dots[0].parentElement!.className).not.toContain('gap-1.5')
  })

  it.each([
    [4, 4, 'h-2', 4],   // up to 5: roomy dots
    [5, 2, 'h-2', 5],
    [6, 6, 'h-1.5', 6], // above 5: small ones
    [12, 7, 'h-1.5', 12],
    [13, 7, null, 0],   // above 12: the text only
    [50, 50, null, 0],
  ])('limit %i (%i left): dot size %s, %i dots', async (limit, left, size, count) => {
    vi.mocked(meApi.get).mockResolvedValue(me(true, left, limit))
    renderIt()
    const pill = await screen.findByTestId('photo-quota')
    expect(pill.textContent).toBe(`Left today: ${left} of ${limit}`)
    const dots = screen.queryAllByTestId('photo-dot')
    expect(dots).toHaveLength(count)
    if (size) for (const d of dots) expect(d.className).toContain(size)
  })

  it('with none left the button is disabled and a muted line replaces the pill', async () => {
    vi.mocked(meApi.get).mockResolvedValue(me(true, 0))
    renderIt()
    expect(await screen.findByText('No photos left today — 10 again tomorrow')).toBeTruthy()
    expect(screen.queryByTestId('photo-quota')).toBeNull()
    expect((screen.getByRole('button', { name: /Choose a photo/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows no pill for an unlimited feature', async () => {
    vi.mocked(meApi.get).mockResolvedValue({ ...me(true), features: { ...me(true).features!, photo_import: feature(true) } })
    renderIt()
    await waitFor(() => expect(meApi.get).toHaveBeenCalled())
    expect(screen.queryByTestId('photo-quota')).toBeNull()
  })
})

describe('PhotoImport: folder', () => {
  const readPhoto = async () => {
    await pick(png())
    await screen.findByText('Words found: 3')
  }

  it('creates "Lesson — dd.MM" once, before the first word, and every word goes into it', async () => {
    const order: string[] = []
    vi.mocked(foldersApi.create).mockImplementation(async (name) => { order.push('create'); return folder('new-id', name) as never })
    vi.mocked(searchApi.add).mockImplementation(async () => { order.push('add'); return {} as never })
    renderIt()
    await readPhoto()
    expect((screen.getByLabelText('Folder name') as HTMLInputElement).value).toBe(`Lesson — ${dd()}`)
    fireEvent.click(screen.getByRole('button', { name: 'Add 2' }))
    await waitFor(() => expect(searchApi.add).toHaveBeenCalledTimes(2))
    expect(foldersApi.create).toHaveBeenCalledTimes(1)
    expect(foldersApi.create).toHaveBeenCalledWith(`Lesson — ${dd()}`, 'lime')
    expect(order).toEqual(['create', 'add', 'add'])
    for (const c of vi.mocked(searchApi.add).mock.calls) expect(c[0].folder_id).toBe('new-id')
  })

  it('an empty name falls back to the default; a typed name is used', async () => {
    renderIt()
    await readPhoto()
    const input = screen.getByLabelText('Folder name')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add 2' }))
    await waitFor(() => expect(foldersApi.create).toHaveBeenCalledWith(`Lesson — ${dd()}`, 'lime'))
  })

  it('reuses a folder with the same name (case-insensitive) instead of creating one', async () => {
    vi.mocked(foldersApi.list).mockResolvedValue({ folders: [folder('f1', `  LESSON — ${dd()} `)] } as never)
    renderIt()
    await readPhoto()
    fireEvent.click(screen.getByRole('button', { name: 'Add 2' }))
    await waitFor(() => expect(searchApi.add).toHaveBeenCalledTimes(2))
    expect(foldersApi.create).not.toHaveBeenCalled()
    for (const c of vi.mocked(searchApi.add).mock.calls) expect(c[0].folder_id).toBe('f1')
  })

  it('"Existing folder" sends the selected id and creates nothing', async () => {
    vi.mocked(foldersApi.list).mockResolvedValue({ folders: [folder('f1', 'Tiere'), folder('f2', 'Essen')] } as never)
    renderIt()
    await readPhoto()
    fireEvent.click(await screen.findByRole('radio', { name: 'Existing folder' }))
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('f1') // the first folder by default, no "without folder" option
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['f1', 'f2'])
    fireEvent.change(select, { target: { value: 'f2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add 2' }))
    await waitFor(() => expect(searchApi.add).toHaveBeenCalledTimes(2))
    expect(foldersApi.create).not.toHaveBeenCalled()
    for (const c of vi.mocked(searchApi.add).mock.calls) expect(c[0].folder_id).toBe('f2')
    await waitFor(() => expect(toaster.toast).toHaveBeenCalledWith(
      'Added to “Essen”: 2. Already there: 0', expect.objectContaining({ action: expect.objectContaining({ label: 'Open folder' }) })))
  })

  it('the toast offers to open the new folder on the Cards page', async () => {
    renderIt()
    await readPhoto()
    fireEvent.click(screen.getByRole('button', { name: 'Add 2' }))
    await waitFor(() => expect(toaster.toast).toHaveBeenCalledTimes(1))
    const [text, opts] = vi.mocked(toaster.toast).mock.calls[0]
    expect(text).toBe(`Added to “Lesson — ${dd()}”: 2. Already there: 0`)
    expect(opts?.action?.label).toBe('Open folder')
  })

  it('hides "Existing folder" when the user has no folders', async () => {
    renderIt()
    await readPhoto()
    expect(screen.queryByRole('radio', { name: 'Existing folder' })).toBeNull()
  })
})

describe('PhotoImport: rejected photos', () => {
  const NOT_CHARGED = 'Your daily limit was not used.'

  it.each([
    ['too_small', 'The photo is too small — take it closer to the page.'],
    ['too_dark', 'Too dark — take the photo in good light.'],
    ['blurry', 'The photo is blurry — hold the phone steady and try again.'],
  ] as const)('a %s photo is stopped on the device: message, "not charged", no request', async (reason, text) => {
    vi.mocked(photoLib.preparePhoto).mockRejectedValueOnce(new photoLib.PhotoQualityError(reason))
    renderIt()
    await pick(png())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(text)
    expect(alert.textContent).toContain(NOT_CHARGED)
    expect(photoApi.import).not.toHaveBeenCalled()
  })

  it.each([
    ['photo_not_document', 'No study text in this photo — take a picture of a textbook page or a word list.'],
    ['photo_unreadable', "The text can't be read — take the photo closer and straighter."],
  ])('the server\'s 422 %s gets its text, "not charged", and refreshes the quota', async (code, text) => {
    vi.mocked(photoApi.import).mockRejectedValue(fail(422, { error: 'x', code }))
    renderIt()
    await screen.findByText('Left today: 10 of 10')
    vi.mocked(meApi.get).mockClear()
    await pick(png())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(text)
    expect(alert.textContent).toContain(NOT_CHARGED)
    await waitFor(() => expect(meApi.get).toHaveBeenCalled()) // /me re-read: the shown quota stays right
  })

  it('a device-side rejection does not re-read /me (nothing was used)', async () => {
    vi.mocked(photoLib.preparePhoto).mockRejectedValueOnce(new photoLib.PhotoQualityError('blurry'))
    renderIt()
    await screen.findByText('Left today: 10 of 10')
    vi.mocked(meApi.get).mockClear()
    await pick(png())
    await screen.findByRole('alert')
    expect(meApi.get).not.toHaveBeenCalled()
  })

  it('other errors do not say the limit was not used', async () => {
    vi.mocked(photoApi.import).mockRejectedValue(fail(502, { error: 'upstream' }))
    renderIt()
    await pick(png())
    expect((await screen.findByRole('alert')).textContent).not.toContain(NOT_CHARGED)
  })
})
