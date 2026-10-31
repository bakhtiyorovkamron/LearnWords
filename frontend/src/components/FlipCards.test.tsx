import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import type { CollectionCard } from '../api/types'
import { FlipCards } from './FlipCards'

const card = (over: Partial<CollectionCard> = {}): CollectionCard => ({
  id: 'c1', context_id: 'x', word: 'the house', translation: 'дом', transcription: '', language: 'en', created_at: '',
  box_level: 1, is_learned: false, next_review_at: new Date().toISOString(), reviewed_today: false, ...over,
} as CollectionCard)

const api = { speak: vi.fn(), cancel: vi.fn(), getVoices: vi.fn(() => [] as { lang: string }[]), addEventListener: vi.fn() }
beforeEach(async () => {
  await i18n.changeLanguage('en')
  api.getVoices.mockReturnValue([])
  vi.stubGlobal('speechSynthesis', api)
  vi.stubGlobal('SpeechSynthesisUtterance', function (this: { text: string }, text: string) { this.text = text })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

const view = (direction: 'de_ru' | 'ru_de' = 'de_ru', c = card()) =>
  render(<QueryClientProvider client={new QueryClient()}><FlipCards cards={[c]} resetKey="k" direction={direction} /></QueryClientProvider>)

describe('FlipCards: listening', () => {
  it('an English card has a listen button that reads with en-US', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }))
    const u = api.speak.mock.calls[0][0] as { text: string; lang: string }
    expect([u.text, u.lang]).toEqual(['the house', 'en-US'])
  })

  it('hidden when the device has no voice for the language', () => {
    api.getVoices.mockReturnValue([{ lang: 'de-DE' }])
    view()
    expect(screen.queryByRole('button', { name: 'Listen' })).toBeNull()
  })

  it('RU → DE: not before the card is flipped (it would give the answer away)', () => {
    view('ru_de')
    expect(screen.queryByRole('button', { name: 'Listen' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Click to flip' }))
    expect(screen.getByRole('button', { name: 'Listen' })).toBeTruthy()
  })
})
