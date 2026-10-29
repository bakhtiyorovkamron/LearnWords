import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { meApi, type Me } from '../api/endpoints'
import { Layout } from './Layout'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    settingsApi: { get: vi.fn().mockRejectedValue(new Error('no')) },
    heroApi: { ...mod.heroApi, get: vi.fn().mockRejectedValue(new Error('no')) },
  }
})

const feature = (enabled: boolean) => ({ enabled, daily_limit: null, remaining: null })
const me = (wordSearch: boolean): Me => ({
  id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de',
  features: {
    photo_import: feature(true), daily_story: feature(true),
    word_search: feature(wordSearch), story_autotranslate: feature(true),
  },
})

function renderLayout() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter><Layout /></MemoryRouter></QueryClientProvider>)
}

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Layout: word_search', () => {
  it('shows the Search link (desktop menu; the phone sheet after tapping More) while the feature is on — and while /me loads', async () => {
    vi.mocked(meApi.get).mockResolvedValue(me(true))
    renderLayout()
    expect(screen.getAllByRole('link', { name: /Search/ })).toHaveLength(1) // the header
    await waitFor(() => expect(meApi.get).toHaveBeenCalled())
    expect(screen.getAllByRole('link', { name: /Search/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /More/ }))
    expect(screen.getAllByRole('link', { name: /Search/ })).toHaveLength(2) // + the More sheet
  })

  it('hides every Search link when it is off', async () => {
    vi.mocked(meApi.get).mockResolvedValue(me(false))
    renderLayout()
    await waitFor(() => expect(screen.queryAllByRole('link', { name: /Search/ })).toHaveLength(0))
    fireEvent.click(screen.getByRole('button', { name: /More/ }))
    expect(screen.queryAllByRole('link', { name: /Search/ })).toHaveLength(0)
    expect(screen.getAllByRole('link', { name: /Cards/ }).length).toBeGreaterThan(0)
  })
})
