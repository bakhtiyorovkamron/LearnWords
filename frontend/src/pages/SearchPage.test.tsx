import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { meApi, profileApi, searchApi, type WordInfo } from '../api/endpoints'
import { SearchPage } from './SearchPage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod, meApi: { get: vi.fn() }, searchApi: { search: vi.fn(), add: vi.fn() },
    profileApi: { get: vi.fn(), update: vi.fn() }, telegramApi: { link: vi.fn() },
  }
})

// The connect prompt's flow reads the profile; no limit, not connected.
const tgProfile = { full_name: null, phone: null, words: { count: 50, limit: 50 },
  telegram: { connected: false, username: null, available: true, bonus_offer: 0, bonus: 0 } }
const telegramRequired = (limit: number, words: number) => Object.assign(new Error('403'), {
  isAxiosError: true,
  response: { status: 403, data: { error: 'link Telegram to add more words', code: 'telegram_required', limit, words } },
})

const info: WordInfo = {
  word: 'house', word_type: 'noun', article: null, plural: 'houses', translation: 'дом', pronunciation: 'haʊs',
  verb_type: null, conjugation_present: null, perfekt: null, praeteritum: null, comparative: null, superlative: null,
  example_sentence: '', example_translation: '', already_added: false, translation_language: 'ru',
} as unknown as WordInfo

const api = { speak: vi.fn(), cancel: vi.fn(), getVoices: vi.fn(() => [] as { lang: string }[]), addEventListener: vi.fn() }
beforeEach(async () => {
  await i18n.changeLanguage('en')
  localStorage.setItem('learning_language', 'en')
  api.getVoices.mockReturnValue([])
  vi.stubGlobal('speechSynthesis', api)
  vi.stubGlobal('SpeechSynthesisUtterance', function (this: { text: string }, text: string) { this.text = text })
  vi.mocked(meApi.get).mockResolvedValue({ id: 'u', email: 'a@b.co', role: 'user', learning_language: 'en' })
  vi.mocked(searchApi.search).mockResolvedValue(info)
  vi.mocked(profileApi.get).mockResolvedValue(tgProfile)
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

async function search() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SearchPage /></QueryClientProvider>)
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'house' } })
  fireEvent.submit(screen.getByRole('textbox').closest('form')!)
}

describe('SearchPage: listening', () => {
  it('a result in English has a listen button that reads with en-US', async () => {
    await search()
    fireEvent.click(await screen.findByRole('button', { name: 'Listen' }))
    const u = api.speak.mock.calls[0][0] as { text: string; lang: string }
    expect([u.text, u.lang]).toEqual(['house', 'en-US'])
  })

  it('hidden when the device has no voice for the language', async () => {
    api.getVoices.mockReturnValue([{ lang: 'de-DE' }])
    await search()
    await screen.findByText('дом')
    expect(screen.queryByRole('button', { name: 'Listen' })).toBeNull()
  })
})

describe('SearchPage: the word limit without Telegram', () => {
  it('telegram_required on "Add": the connect prompt instead of a raw error', async () => {
    vi.mocked(searchApi.add).mockRejectedValue(telegramRequired(50, 50))
    await search()
    fireEvent.click(await screen.findByRole('button', { name: /Add to my collection/ }))
    expect((await screen.findByRole('alert')).textContent).toBe('You have added 50 words. Link Telegram to add without a limit.')
    expect(within(screen.getByTestId('telegram-required')).getByRole('button', { name: 'Link Telegram' })).toBeTruthy()
    expect(screen.queryByText(/Could not add/)).toBeNull()
  })
})
