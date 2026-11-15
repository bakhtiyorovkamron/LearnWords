import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { contextsApi, foldersApi, meApi, profileApi, telegramApi, wordCheckApi, wordsApi, type Profile } from '../api/endpoints'
import * as toaster from '../components/Toaster'
import { NewContextPage } from './NewContextPage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    contextsApi: { create: vi.fn() },
    foldersApi: { list: vi.fn(), create: vi.fn() },
    photoApi: { import: vi.fn() },
    wordCheckApi: { check: vi.fn() },
    wordsApi: { generateExample: vi.fn() },
    profileApi: { get: vi.fn(), update: vi.fn() },
    telegramApi: { link: vi.fn() },
  }
})

// GET /me/profile: the word count and the limit without Telegram (null = none).
const profileWith = (count: number, limit: number | null, connected = false): Profile => ({
  full_name: null, phone: null, words: { count, limit },
  telegram: { connected, username: null, available: true, bonus_offer: 0, bonus: 0 },
})
const Where = () => <div data-testid="where">{useLocation().pathname + useLocation().search}</div>

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/contexts/new']}>
        <Where />
        <Routes>
          <Route path="/contexts/new" element={<NewContextPage />} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const textbox = () => screen.getAllByRole('textbox')[0] as HTMLTextAreaElement
const field = (placeholder: RegExp) => screen.getByPlaceholderText(placeholder) as HTMLInputElement

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(meApi.get).mockResolvedValue({ id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de' })
  vi.mocked(foldersApi.list).mockResolvedValue({ all: {}, folders: [{ id: 'f1', name: 'Tiere', color: 'sky' }] } as never)
  vi.mocked(wordCheckApi.check).mockRejectedValue(new Error('no check in this test'))
  vi.mocked(contextsApi.create).mockResolvedValue({
    context: { id: 'ctx1', source_text: 'Ich freue mich' },
    cards: [{ id: 'c1', word: 'Ich freue mich' }],
  } as never)
  vi.mocked(profileApi.get).mockResolvedValue(profileWith(3, null))
  vi.spyOn(toaster, 'toast').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('NewContextPage', () => {
  it('after saving it stays on the page, clears the form but keeps the folder, and offers to open it', async () => {
    renderPage()
    await screen.findByRole('option', { name: /Tiere/ })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'f1' } })
    fireEvent.change(textbox(), { target: { value: 'Ich freue mich' } })
    fireEvent.change(field(/mean/i), { target: { value: 'я радуюсь' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }))

    await waitFor(() => expect(contextsApi.create).toHaveBeenCalledTimes(1))
    expect(vi.mocked(contextsApi.create).mock.calls[0][0]).toMatchObject({ text: 'Ich freue mich', meaning: 'я радуюсь', folderId: 'f1' })
    await waitFor(() => expect(toaster.toast).toHaveBeenCalledTimes(1))

    expect(screen.getByTestId('where').textContent).toBe('/contexts/new') // no navigation
    expect(textbox().value).toBe('')
    expect(field(/mean/i).value).toBe('')
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('f1')
    expect(document.activeElement).toBe(textbox())

    const [text, opts] = vi.mocked(toaster.toast).mock.calls[0]
    expect(text).toBe('“Ich freue mich” added')
    expect(opts?.action?.label).toBe('Open')
    opts!.action!.onClick()
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/cards?tab=all&folder=f1'))
  })

  it('the Open link has no folder in it when none was chosen', async () => {
    renderPage()
    fireEvent.change(textbox(), { target: { value: 'Hund' } })
    fireEvent.change(field(/mean/i), { target: { value: 'собака' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }))
    await waitFor(() => expect(toaster.toast).toHaveBeenCalled())
    vi.mocked(toaster.toast).mock.calls[0][1]!.action!.onClick()
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/cards?tab=all'))
  })

  it('stops at 100 characters and says so', () => {
    renderPage()
    fireEvent.change(textbox(), { target: { value: 'a'.repeat(99) } })
    expect(screen.queryByText(/Up to 100 characters/)).toBeNull()
    expect(screen.getByText('99/100')).toBeTruthy()
    fireEvent.change(textbox(), { target: { value: 'a'.repeat(150) } })
    expect(textbox().value).toHaveLength(100)
    expect(screen.getByText('Up to 100 characters. For a longer text, use a textbook photo.')).toBeTruthy()
  })
})

describe('NewContextPage: generate the example sentence', () => {
  const generateButton = () => screen.getByRole('button', { name: /Generate automatically/ }) as HTMLButtonElement
  const hint = () => screen.queryByText('Word and translation are required')

  it('is enabled for a noun with its article and a translation — not only for a single word', async () => {
    vi.mocked(wordsApi.generateExample).mockResolvedValue({
      example_sentence: 'Ich sehe ___.', example_translation: 'Men stolni ko‘ryapman.', full_sentence: 'Ich sehe den Tisch.',
    } as never)
    renderPage()
    fireEvent.change(textbox(), { target: { value: 'der Tisch' } })
    fireEvent.change(field(/mean/i), { target: { value: 'stol' } })
    expect(generateButton().disabled).toBe(false)
    expect(hint()).toBeNull()

    fireEvent.click(generateButton())
    await waitFor(() => expect(wordsApi.generateExample).toHaveBeenCalledWith('der Tisch', 'stol'))
    await waitFor(() => expect(screen.getByDisplayValue('Ich sehe ___.')).toBeTruthy())
    expect(screen.getByDisplayValue('Men stolni ko‘ryapman.')).toBeTruthy()
  })

  it('is enabled for a phrase of several words as well', () => {
    renderPage()
    fireEvent.change(textbox(), { target: { value: 'sich freuen auf' } })
    fireEvent.change(field(/mean/i), { target: { value: 'радоваться' } })
    expect(generateButton().disabled).toBe(false)
  })

  it('without a translation it is disabled and says why in plain sight', () => {
    renderPage()
    fireEvent.change(textbox(), { target: { value: 'der Tisch' } })
    expect(generateButton().disabled).toBe(true)
    expect(hint()).toBeTruthy() // a visible line, not only a title tooltip
    expect(generateButton().getAttribute('title')).toBeNull()
  })

  it('without a text it is disabled with the hint too', () => {
    renderPage()
    fireEvent.change(field(/mean/i), { target: { value: 'stol' } })
    expect(generateButton().disabled).toBe(true)
    expect(hint()).toBeTruthy()
  })
})

describe('NewContextPage: the generate button on phones', () => {
  it.each(['ru', 'en', 'uz'])('%s: label above, full-width button on phones; one row from sm', async (lng) => {
    await i18n.changeLanguage(lng)
    renderPage()
    const button = screen.getByRole('button', { name: i18n.t('newContext.generate') })
    // jsdom cannot measure a layout: the responsive classes are what is checked.
    expect(button.className).toContain('w-full')
    expect(button.className).toContain('sm:w-auto')
    expect(button.className).toContain('sm:shrink-0')
    const row = button.parentElement!
    expect(row.className).toContain('flex-col')
    expect(row.className).toContain('sm:flex-row')
    expect(row.className).toContain('sm:justify-between')
    expect(row.querySelector('label')).toBeTruthy() // the label is its own line, not inside the button
  })
})

describe('NewContextPage: the word limit without Telegram', () => {
  const fields = () => screen.getByTestId('new-word-fields') as HTMLFieldSetElement
  const choosePhoto = () => screen.getByRole('button', { name: /Choose a photo/ }) as HTMLButtonElement

  it('at the limit the form and the photo import are disabled; once the profile says connected they work again, no reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const tab = { location: { href: '' }, opener: window, closed: false, close: vi.fn() }
    vi.stubGlobal('open', vi.fn(() => tab))
    vi.mocked(telegramApi.link).mockResolvedValue({ url: 'https://t.me/yodla_bot?start=YL-1', expires_at: '' })
    vi.mocked(profileApi.get).mockResolvedValue(profileWith(50, 50))
    try {
      renderPage()
      expect((await screen.findByTestId('telegram-required')).textContent).toContain('You have added 50 words.')
      expect(fields().disabled).toBe(true)
      expect(textbox()).toBeDisabled()
      expect(screen.getByRole('button', { name: /^Add$/ })).toBeDisabled()
      expect(choosePhoto()).toBeDisabled()

      fireEvent.click(screen.getByRole('button', { name: 'Link Telegram' }))
      await waitFor(() => expect(tab.location.href).toBe('https://t.me/yodla_bot?start=YL-1'))
      vi.mocked(profileApi.get).mockResolvedValue(profileWith(50, null, true))
      await act(() => vi.advanceTimersByTimeAsync(3_000)) // the connect flow polls the profile

      await waitFor(() => expect(screen.queryByTestId('telegram-required')).toBeNull())
      expect(fields().disabled).toBe(false)
      expect(textbox()).not.toBeDisabled()
      expect(choosePhoto()).not.toBeDisabled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a few words before the limit: the quiet line, the form still works', async () => {
    vi.mocked(profileApi.get).mockResolvedValue(profileWith(42, 50))
    renderPage()
    expect((await screen.findByTestId('word-limit-near')).textContent).toContain('Left: 8.')
    expect(fields().disabled).toBe(false)
  })

  it('telegram_required on save: the connect prompt instead of a raw error', async () => {
    vi.mocked(profileApi.get).mockResolvedValue(profileWith(49, 50)) // the cache did not know yet
    vi.mocked(contextsApi.create).mockRejectedValue(Object.assign(new Error('403'), {
      isAxiosError: true,
      response: { status: 403, data: { error: 'link Telegram to add more words', code: 'telegram_required', limit: 50, words: 50 } },
    }))
    renderPage()
    await screen.findByTestId('word-limit-near')
    fireEvent.change(textbox(), { target: { value: 'Hund' } })
    fireEvent.change(field(/mean/i), { target: { value: 'собака' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }))

    expect((await screen.findByRole('alert')).textContent).toBe('You have added 50 words. Link Telegram to add without a limit.')
    expect(within(screen.getByTestId('telegram-required')).getByRole('button', { name: 'Link Telegram' })).toBeTruthy()
    expect(screen.queryByText('link Telegram to add more words')).toBeNull()
  })
})
