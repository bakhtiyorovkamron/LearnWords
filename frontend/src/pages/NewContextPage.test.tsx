import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { contextsApi, foldersApi, meApi, wordCheckApi, wordsApi } from '../api/endpoints'
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
  }
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
  vi.spyOn(toaster, 'toast').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks() })

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
