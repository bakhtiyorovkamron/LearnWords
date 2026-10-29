import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import type { WordCard } from '../api/types'
import { WordCardView } from './WordCard'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, foldersApi: { list: vi.fn().mockResolvedValue({ all: {}, folders: [] }) } }
})

const card: WordCard = {
  id: 'c1', context_id: 'x', word: 'der Hund', translation: 'собака', transcription: '', language: 'de', created_at: '',
}

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)

describe('WordCardView', () => {
  it('has the listen button but no regenerate-audio button', () => {
    render(<QueryClientProvider client={new QueryClient()}><WordCardView card={card} /></QueryClientProvider>)
    expect(screen.getByTitle('Listen')).toBeTruthy()
    expect(screen.queryByText('↻')).toBeNull()
    expect(screen.queryByTitle(/audio/i)).toBeNull()
    expect(screen.getByTitle('Edit')).toBeTruthy() // the other actions are still there
  })
})
