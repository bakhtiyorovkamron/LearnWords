import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { foldersApi, meApi, settingsApi, statsApi, type Me } from '../api/endpoints'
import { isMoreMenuOpen, setMoreMenuOpen } from '../lib/moreMenu'
import { ContextsPage } from '../pages/ContextsPage'
import { Layout } from './Layout'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    foldersApi: { list: vi.fn(), create: vi.fn() },
    statsApi: { get: vi.fn() },
    settingsApi: { get: vi.fn(), setDailyGoal: vi.fn(), setTheme: vi.fn() },
    heroApi: { ...mod.heroApi, get: vi.fn() },
  }
})

const me: Me = {
  id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de',
  features: {
    photo_import: { enabled: true, daily_limit: 5, remaining: 5 },
    daily_story: { enabled: true, daily_limit: null, remaining: null },
    word_search: { enabled: true, daily_limit: null, remaining: null },
    story_autotranslate: { enabled: true, daily_limit: null, remaining: null },
    theme_picker: { enabled: false, daily_limit: null, remaining: null },
  },
}

function renderApp(path = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<ContextsPage />} />
            <Route path="/stats" element={<div>STATS PAGE</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  setMoreMenuOpen(false)
  vi.mocked(meApi.get).mockResolvedValue(me)
  vi.mocked(foldersApi.list).mockResolvedValue({
    all: { total: 0, new_count: 0, learning_count: 0, learned_count: 0, due_today: 0 }, folders: [],
  } as never)
  vi.mocked(statsApi.get).mockResolvedValue({ daily: [], totals: { current_streak_days: 0 } } as never)
  vi.mocked(settingsApi.get).mockRejectedValue(new Error('no'))
  const { heroApi } = await import('../api/endpoints')
  vi.mocked(heroApi.get).mockRejectedValue(new Error('no'))
})
afterEach(() => { cleanup(); setMoreMenuOpen(false); vi.clearAllMocks() })

describe('the ☰ button in the Home header', () => {
  it('is phones only, labelled, and wired to the sheet', () => {
    renderApp()
    const button = screen.getByRole('button', { name: 'More' })
    expect(button.className).toContain('md:hidden')
    expect(button.className).toContain('ml-auto')
    expect(button.getAttribute('aria-haspopup')).toBe('dialog')
    expect(button.getAttribute('aria-controls')).toBe('more-sheet')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('opens #more-sheet with Search and Statistics', async () => {
    renderApp()
    expect(document.getElementById('more-sheet')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    const sheet = document.getElementById('more-sheet')!
    expect(sheet).not.toBeNull()
    expect(within(sheet).getByRole('link', { name: 'Search' })).toBeTruthy()
    expect(within(sheet).getByRole('link', { name: 'Statistics' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'More' }).getAttribute('aria-expanded')).toBe('true')
    expect(isMoreMenuOpen()).toBe(true)
  })

  it('the sheet closes after navigating, on Escape and on the scrim', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(within(document.getElementById('more-sheet')!).getByRole('link', { name: 'Statistics' }))
    expect(screen.getByText('STATS PAGE')).toBeTruthy()
    expect(document.getElementById('more-sheet')).toBeNull()
    expect(isMoreMenuOpen()).toBe(false)

    act(() => setMoreMenuOpen(true))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.getElementById('more-sheet')).toBeNull()

    act(() => setMoreMenuOpen(true))
    fireEvent.click(document.getElementById('more-sheet')!.parentElement!) // the scrim
    expect(document.getElementById('more-sheet')).toBeNull()
  })

  it('is only on the Home page: the other pages have no such button', async () => {
    renderApp('/stats')
    await waitFor(() => expect(meApi.get).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
  })
})
