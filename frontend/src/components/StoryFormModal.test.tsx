import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { meApi, storiesApi, type DailyStory } from '../api/endpoints'
import { StoryFormModal } from './StoryFormModal'
import * as toaster from './Toaster'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    storiesApi: { createOwn: vi.fn(), updateOwn: vi.fn() },
  }
})

const GERMAN = 'Der Hund läuft durch den Park.\nDie Sonne scheint.'
const saved = (over: Partial<DailyStory> = {}): DailyStory => ({
  id: 's1', date: '2026-10-16', genre: '', title: 'Der Hund läuft durch den Park.', story_de: GERMAN,
  story_translation: 'Собака бежит.', language: 'en', words_used: [], created_at: '', source: 'user', translation_source: 'ai', ...over,
})

function setup(props: Partial<React.ComponentProps<typeof StoryFormModal>> = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><StoryFormModal onClose={onClose} onSaved={onSaved} {...props} /></QueryClientProvider>)
  return { onClose, onSaved, qc }
}
const text = () => screen.getByLabelText(/German text/) as HTMLTextAreaElement
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } })
const submit = () => fireEvent.click(screen.getByRole('button', { name: /^(Save|⏳)/ }))
const httpError = (status: number) => Object.assign(new Error('x'), { isAxiosError: true, response: { status, data: { error: 'nope' } } })

let toast: ReturnType<typeof vi.spyOn>
beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(meApi.get).mockResolvedValue({ id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de' })
  vi.mocked(storiesApi.createOwn).mockReset().mockResolvedValue(saved())
  vi.mocked(storiesApi.updateOwn).mockReset().mockResolvedValue(saved())
  toast = vi.spyOn(toaster, 'toast').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('StoryFormModal: create', () => {
  it('manual mode sends the translation the user wrote', async () => {
    const { onSaved, onClose, qc } = setup()
    type(text(), GERMAN)
    fireEvent.click(screen.getByRole('radio', { name: /My own translation/ }))
    type(screen.getByLabelText(/Your translation into English/), 'The dog runs through the park.')
    submit()
    await waitFor(() => expect(storiesApi.createOwn).toHaveBeenCalledTimes(1))
    expect(storiesApi.createOwn).toHaveBeenCalledWith({
      title: '', text: GERMAN, translation_mode: 'manual', translation: 'The dog runs through the park.',
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }))
    expect(toast).toHaveBeenCalledWith('Story saved')
    expect(qc.getQueryData(['stories', 'by-id', 's1', 'en'])).toBeTruthy() // opens without another request
  })

  it('auto mode (the default) hides the translation field and sends translation_mode auto', async () => {
    setup()
    expect(screen.getByRole('radio', { name: /Translate automatically/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByLabelText(/Your translation into English/)).toBeNull()
    expect(screen.getByText(/up to a minute/)).toBeTruthy()
    type(screen.getByLabelText(/Title/), '  Lesson 3  ')
    type(text(), GERMAN)
    submit()
    await waitFor(() => expect(storiesApi.createOwn).toHaveBeenCalledWith({
      title: 'Lesson 3', text: GERMAN, translation_mode: 'auto', translation: '',
    }))
  })

  it('switching to auto after typing a translation does not send it', async () => {
    setup()
    type(text(), GERMAN)
    fireEvent.click(screen.getByRole('radio', { name: /My own translation/ }))
    type(screen.getByLabelText(/Your translation into English/), 'something')
    fireEvent.click(screen.getByRole('radio', { name: /Translate automatically/ }))
    submit()
    await waitFor(() => expect(storiesApi.createOwn).toHaveBeenCalledWith(expect.objectContaining({ translation_mode: 'auto', translation: '' })))
  })

  it('Cyrillic text → the Cyrillic error, nothing is sent', async () => {
    setup()
    type(text(), 'Это русский текст, а не немецкий.')
    submit()
    expect(await screen.findByText(/This text is in Cyrillic\. Put the German text here/)).toBeTruthy()
    expect(storiesApi.createOwn).not.toHaveBeenCalled()
  })

  it('the other client checks: length, title, missing translation — all without a request', async () => {
    setup()
    type(text(), 'kurz')
    submit()
    expect(await screen.findByText('The text must be 10–4000 characters long.')).toBeTruthy()

    type(text(), 'a'.repeat(4001))
    submit()
    expect(await screen.findByText('The text must be 10–4000 characters long.')).toBeTruthy()
    expect(screen.getByText('4001 / 4000')).toBeTruthy() // counted like the server

    type(text(), GERMAN)
    type(screen.getByLabelText(/Title/), 't'.repeat(121))
    submit()
    expect(await screen.findByText('The title can be up to 120 characters.')).toBeTruthy()

    type(screen.getByLabelText(/Title/), '')
    fireEvent.click(screen.getByRole('radio', { name: /My own translation/ }))
    submit()
    expect(await screen.findByText(/Write a translation or choose/)).toBeTruthy()
    expect(storiesApi.createOwn).not.toHaveBeenCalled()
  })

  it('the counter counts code points, not UTF-16 units', () => {
    setup()
    type(text(), '😀😀😀')
    expect(screen.getByText('3 / 4000')).toBeTruthy()
  })
})

describe('StoryFormModal: server errors keep everything typed', () => {
  it('503 → "automatic translation is unavailable", the text stays, the form stays open', async () => {
    vi.mocked(storiesApi.createOwn).mockRejectedValue(httpError(503))
    const { onClose } = setup()
    type(screen.getByLabelText(/Title/), 'Lesson 3')
    type(text(), GERMAN)
    submit()
    expect(await screen.findByText('Automatic translation is unavailable right now — write the translation yourself.')).toBeTruthy()
    expect(text().value).toBe(GERMAN)
    expect((screen.getByLabelText(/Title/) as HTMLInputElement).value).toBe('Lesson 3')
    expect(onClose).not.toHaveBeenCalled()
    // ... and the user can switch to a manual translation and send the same text.
    fireEvent.click(screen.getByRole('radio', { name: /My own translation/ }))
    type(screen.getByLabelText(/Your translation into English/), 'My translation')
    vi.mocked(storiesApi.createOwn).mockResolvedValue(saved())
    submit()
    await waitFor(() => expect(storiesApi.createOwn).toHaveBeenLastCalledWith(expect.objectContaining({ translation_mode: 'manual', text: GERMAN })))
  })

  it('429 → the rate-limit text; anything else → "Could not save: …"', async () => {
    vi.mocked(storiesApi.createOwn).mockRejectedValueOnce(Object.assign(httpError(429), { response: { status: 429, data: { retry_after_seconds: 30 }, headers: {} } }))
    setup()
    type(text(), GERMAN)
    submit()
    expect(await screen.findByText(/30/)).toBeTruthy()

    vi.mocked(storiesApi.createOwn).mockRejectedValueOnce(httpError(500))
    submit()
    expect(await screen.findByText('Could not save: nope')).toBeTruthy()
    expect(text().value).toBe(GERMAN)
  })

  it('shows "Translating…" while an automatic translation is running', async () => {
    let finish: (s: DailyStory) => void = () => undefined
    vi.mocked(storiesApi.createOwn).mockReturnValue(new Promise((r) => { finish = r }))
    setup()
    type(text(), GERMAN)
    submit()
    expect(await screen.findByRole('button', { name: '⏳ Translating…' })).toBeTruthy()
    finish(saved())
  })
})

describe('StoryFormModal: edit', () => {
  it("prefills the story and calls updateOwn(id, …); a user's translation means manual mode", async () => {
    const story = saved({ title: 'Mein Tag', story_translation: 'Мой день', translation_source: 'user' })
    const { onSaved } = setup({ story })
    expect((screen.getByLabelText(/Title/) as HTMLInputElement).value).toBe('Mein Tag')
    expect(text().value).toBe(GERMAN)
    expect(screen.getByRole('radio', { name: /My own translation/ }).getAttribute('aria-checked')).toBe('true')
    expect((screen.getByLabelText(/Your translation into English/) as HTMLTextAreaElement).value).toBe('Мой день')

    type(screen.getByLabelText(/Title/), 'Mein neuer Tag')
    submit()
    await waitFor(() => expect(storiesApi.updateOwn).toHaveBeenCalledWith('s1', {
      title: 'Mein neuer Tag', text: GERMAN, translation_mode: 'manual', translation: 'Мой день',
    }))
    expect(storiesApi.createOwn).not.toHaveBeenCalled()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('an automatic translation starts in auto mode, but can be corrected by hand (field prefilled)', () => {
    setup({ story: saved({ story_translation: 'Auto text', translation_source: 'ai' }) })
    expect(screen.getByRole('radio', { name: /Translate automatically/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: /My own translation/ }))
    expect((screen.getByLabelText(/Your translation into English/) as HTMLTextAreaElement).value).toBe('Auto text')
  })

  it('initialMode "manual" (the "add a translation" button) opens in manual mode', () => {
    setup({ story: saved({ story_translation: '', translation_source: '' }), initialMode: 'manual' })
    expect(screen.getByRole('radio', { name: /My own translation/ }).getAttribute('aria-checked')).toBe('true')
    expect((screen.getByLabelText(/Your translation into English/) as HTMLTextAreaElement).value).toBe('')
  })

  it('Esc and Cancel close it without saving', () => {
    const { onClose } = setup()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(storiesApi.createOwn).not.toHaveBeenCalled()
  })
})
