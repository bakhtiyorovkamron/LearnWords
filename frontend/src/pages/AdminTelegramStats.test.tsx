import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { adminApi, meApi } from '../api/endpoints'
import { AdminPage } from './AdminPage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    adminApi: {
      users: vi.fn(async () => []), stats: vi.fn(), feedback: vi.fn(async () => ({ average: 0, count: 0, items: [] })),
      telegramStats: vi.fn(), wordCheckStatus: vi.fn(), startWordCheck: vi.fn(), pushStats: vi.fn(async () => ({ devices: 0, users: 0 })),
      purchases: vi.fn(async () => []),
    },
  }
})

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(meApi.get).mockResolvedValue({ id: 'a', email: 'admin@x.co', role: 'admin' })
  vi.mocked(adminApi.stats).mockResolvedValue({
    total_users: 3, banned_users: 0, new_users_7d: 1, active_users_7d: 2, total_words: 10,
    total_reviews: 20, training_sessions: 4, total_stories: 1, stories_30d: 1,
  })
  vi.mocked(adminApi.wordCheckStatus).mockResolvedValue({ running: false, total: 0, processed: 0, suggestions: 0, confirmed: 0, unknown: 0, failed: 0, started_at: null, finished_at: null })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter><AdminPage /></MemoryRouter></QueryClientProvider>)
}
const card = async () => (await screen.findByText('Connected Telegram')).parentElement as HTMLElement

describe('AdminPage: Telegram stats card', () => {
  it('shows "{connected} of {total} ({percent}%)" and the last 7 days from the response', async () => {
    vi.mocked(adminApi.telegramStats).mockResolvedValue({ total_users: 340, connected: 12, percent: 3.5, connected_last_7d: 4 })
    renderPage()
    const c = await card()
    expect(await screen.findByText('12 of 340 (3.5%)')).toBeTruthy()
    expect(c.textContent).toContain('12 of 340 (3.5%)')
    expect(c.textContent).toContain('last 7 days: 4')
    expect(c.className).toContain('col-span-2')
    expect(adminApi.telegramStats).toHaveBeenCalledTimes(1)
  })

  it('no users: 0 of 0 (0%)', async () => {
    vi.mocked(adminApi.telegramStats).mockResolvedValue({ total_users: 0, connected: 0, percent: 0, connected_last_7d: 0 })
    renderPage()
    const c = await card()
    expect(await screen.findByText('0 of 0 (0%)')).toBeTruthy()
    expect(c.textContent).toContain('last 7 days: 0')
  })

  it('Russian and Uzbek texts', async () => {
    vi.mocked(adminApi.telegramStats).mockResolvedValue({ total_users: 340, connected: 12, percent: 3.5, connected_last_7d: 4 })
    await i18n.changeLanguage('ru')
    renderPage()
    expect(await screen.findByText('Telegram подключили')).toBeTruthy()
    expect(await screen.findByText('12 из 340 (3.5%)')).toBeTruthy()
    expect(screen.getByText('за 7 дней: 4')).toBeTruthy()
    cleanup()
    await i18n.changeLanguage('uz')
    renderPage()
    expect(await screen.findByText('Telegramni ulaganlar')).toBeTruthy()
    expect(await screen.findByText('340 tadan 12 (3.5%)')).toBeTruthy()
    expect(screen.getByText('so‘nggi 7 kunda: 4')).toBeTruthy()
  })
})
