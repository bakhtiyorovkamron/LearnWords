import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { meApi, searchApi, type WordInfo } from '../api/endpoints'
import { SearchPage } from './SearchPage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, meApi: { get: vi.fn() }, searchApi: { search: vi.fn(), add: vi.fn() } }
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
