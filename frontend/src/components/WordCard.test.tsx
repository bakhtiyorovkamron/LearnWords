import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { cardsApi } from '../api/endpoints'
import type { WordCard } from '../api/types'
import { splitArticle } from '../lib/article'
import { WordCardView } from './WordCard'

vi.mock('./EditWordModal', () => ({ EditWordModal: () => <div>EDIT MODAL</div> }))
vi.mock('./FolderPicker', () => ({ FolderPicker: () => <div>FOLDER PICKER</div> }))
vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, cardsApi: { remove: vi.fn().mockResolvedValue(undefined) } }
})

const card: WordCard = {
  id: 'c1', context_id: 'x', word: 'Hund', article: 'der', translation: 'собака', transcription: '[hʊnt]',
  example_sentence: 'Der Hund bellt.', example_translation: 'Собака лает.', language: 'de', created_at: '',
}
const progress = { boxLevel: 3, isLearned: false, nextReviewAt: new Date().toISOString(), reviewedToday: false }

function view(c: WordCard, props: Partial<Parameters<typeof WordCardView>[0]> = {}) {
  return render(<QueryClientProvider client={new QueryClient()}><WordCardView card={c} progress={progress} {...props} /></QueryClientProvider>)
}

const speakApi = { speak: vi.fn(), cancel: vi.fn(), getVoices: vi.fn(() => [] as { lang: string }[]), addEventListener: vi.fn() }
beforeEach(async () => {
  await i18n.changeLanguage('en')
  speakApi.getVoices.mockReturnValue([])
  vi.stubGlobal('speechSynthesis', speakApi)
  vi.stubGlobal('SpeechSynthesisUtterance', function (this: { text: string }, text: string) { this.text = text })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('splitArticle', () => {
  it('uses card.article, else a leading article of the word (any case), else none', () => {
    expect(splitArticle('Hund', 'der')).toEqual({ article: 'der', rest: 'Hund' })
    expect(splitArticle('die Katze', null)).toEqual({ article: 'die', rest: 'Katze' })
    expect(splitArticle('Das Haus')).toEqual({ article: 'das', rest: 'Haus' })
    expect(splitArticle('die Katze', 'die')).toEqual({ article: 'die', rest: 'Katze' })
    expect(splitArticle('laufen')).toEqual({ article: null, rest: 'laufen' })
  })
})

describe('WordCardView row', () => {
  it('colours the article from card.article and from a "die …" word; no article → plain', () => {
    const { container, rerender } = view(card)
    expect(container.querySelector('[data-article="der"]')?.className).toContain('text-der')
    const qc = new QueryClient()
    rerender(<QueryClientProvider client={qc}><WordCardView card={{ ...card, article: undefined, word: 'die Katze' }} progress={progress} /></QueryClientProvider>)
    expect(container.querySelector('[data-article="die"]')?.className).toContain('text-die')
    rerender(<QueryClientProvider client={qc}><WordCardView card={{ ...card, article: undefined, word: 'laufen' }} progress={progress} /></QueryClientProvider>)
    expect(container.querySelector('[data-article]')).toBeNull()
    expect(screen.getByText('laufen').className).toContain('text-fg')
  })

  it('shows the translation, 5 box bars and a listen button', () => {
    const { container } = view(card)
    expect(screen.getByText('собака')).toBeTruthy()
    expect(container.querySelectorAll('[data-testid="box-bars"] span').length).toBe(5)
    expect(screen.getByLabelText('Listen')).toBeTruthy()
  })

  it('an English card has a listen button that reads it with the English locale', () => {
    view({ ...card, language: 'en', word: 'the house', article: undefined })
    fireEvent.click(screen.getByLabelText('Listen'))
    const u = speakApi.speak.mock.calls.at(-1)![0] as { text: string; lang: string }
    expect(u.text).toBe('the house')
    expect(u.lang).toBe('en-US')
    expect(screen.queryByRole('dialog')).toBeNull() // the click did not open the word sheet
  })

  it('no listen button when the device has no voice for the language', () => {
    speakApi.getVoices.mockReturnValue([{ lang: 'en-US' }])
    view({ ...card, language: 'ko', word: '집' })
    expect(screen.queryByLabelText('Listen')).toBeNull()
  })

  it('a click opens the sheet with the example; Edit and Move open their dialogs', () => {
    view(card)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByTestId('word-row'))
    const sheet = screen.getByRole('dialog')
    expect(sheet.textContent).toContain('Der Hund bellt.')
    expect(sheet.textContent).toContain('Собака лает.')
    expect(sheet.textContent).toContain('[hʊnt]')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByText('EDIT MODAL')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Move to folder opens the picker', () => {
    view(card)
    fireEvent.click(screen.getByTestId('word-row'))
    fireEvent.click(screen.getByRole('button', { name: 'Move to folder' }))
    expect(screen.getByText('FOLDER PICKER')).toBeTruthy()
  })

  it('Delete asks to confirm, then deletes; cancel does nothing', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    view(card)
    fireEvent.click(screen.getByTestId('word-row'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete word' }))
    expect(cardsApi.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('word-row'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete word' }))
    await waitFor(() => expect(cardsApi.remove).toHaveBeenCalledWith('c1'))
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('Esc closes the sheet', () => {
    view(card)
    fireEvent.click(screen.getByTestId('word-row'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('in select mode a click toggles and no sheet opens', () => {
    const onToggle = vi.fn()
    view(card, { selection: { checked: false, onToggle } })
    fireEvent.click(screen.getByTestId('word-row'))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggle).toHaveBeenCalledTimes(2) // the checkbox itself toggles once, not twice
  })
})
