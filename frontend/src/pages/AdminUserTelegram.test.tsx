import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { adminApi, adminSupportApi, meApi, telegramBroadcastApi, type AdminUser } from '../api/endpoints'
import { AdminPage } from './AdminPage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    adminApi: {
      users: vi.fn(), stats: vi.fn(), feedback: vi.fn(async () => ({ average: 0, count: 0, items: [] })),
      telegramStats: vi.fn(async () => ({ total_users: 0, connected: 0, percent: 0, connected_last_7d: 0 })),
      wordCheckStatus: vi.fn(), startWordCheck: vi.fn(), pushStats: vi.fn(async () => ({ devices: 0, users: 0 })),
      purchases: vi.fn(async () => []), userFeatures: vi.fn(async () => []),
    },
    adminSupportApi: { threads: vi.fn(async () => []), messages: vi.fn(), post: vi.fn(), image: vi.fn(), read: vi.fn(), open: vi.fn() },
    telegramBroadcastApi: { audience: vi.fn(), create: vi.fn(), list: vi.fn(), get: vi.fn() },
    telegramRulesApi: { list: vi.fn(async () => []), update: vi.fn(), preview: vi.fn(), test: vi.fn() },
  }
})

const user = (id: string, tg: AdminUser['telegram']): AdminUser => ({
  id, email: `${id}@x.co`, role: 'user', is_banned: false, created_at: '2026-01-01T00:00:00Z', words_count: 0, last_activity_at: null,
  full_name: null, phone: null, telegram: tg,
})
const linked = { connected: true, username: 'anna', notifications: true, blocked: false }

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(meApi.get).mockResolvedValue({ id: 'a', email: 'admin@x.co', role: 'admin' })
  vi.mocked(adminApi.stats).mockResolvedValue({
    total_users: 0, banned_users: 0, new_users_7d: 0, active_users_7d: 0, total_words: 0, total_reviews: 0, training_sessions: 0, total_stories: 0, stories_30d: 0,
  })
  vi.mocked(adminApi.wordCheckStatus).mockResolvedValue({ running: false, total: 0, processed: 0, suggestions: 0, confirmed: 0, unknown: 0, failed: 0, started_at: null, finished_at: null })
  vi.mocked(adminApi.users).mockResolvedValue([
    user('anna', linked),
    user('plain', { connected: false, username: null }),
    user('blocked', { connected: true, username: null, notifications: true, blocked: true }),
    user('stopped', { connected: true, username: null, notifications: false, blocked: false }),
  ])
  vi.mocked(telegramBroadcastApi.audience).mockResolvedValue({ linked: 3, reachable: 1, opted_out: 1, blocked: 1 })
  vi.mocked(telegramBroadcastApi.list).mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter><AdminPage /></MemoryRouter></QueryClientProvider>)
}
const openCard = async (email: string) => {
  fireEvent.click(await screen.findByText(email))
  return screen.findByRole('dialog')
}

describe('AdminPage: the Telegram tab and the user card', () => {
  it('has a third tab, Telegram', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Telegram' }))
    expect(await screen.findByTestId('telegram-audience')).toBeTruthy()
  })

  it('the card button opens the Telegram tab with that user chosen', async () => {
    renderPage()
    const card = await openCard('anna@x.co')
    fireEvent.click(within(card).getByRole('button', { name: 'Write on Telegram' }))
    expect(screen.queryByRole('dialog')).toBeNull() // the card closed
    expect(screen.getByRole('button', { name: 'Telegram' }).getAttribute('aria-pressed')).toBe('true')
    expect((await screen.findByRole('radio', { name: 'Chosen users' }) as HTMLInputElement).checked).toBe(true)
    await waitFor(() => expect(within(screen.getByTestId('telegram-chips')).getByText('anna@x.co')).toBeTruthy())
  })

  it('hidden for a user without Telegram', async () => {
    renderPage()
    const card = await openCard('plain@x.co')
    expect(within(card).queryByRole('button', { name: 'Write on Telegram' })).toBeNull()
  })

  it('disabled with a hint for a user who blocked the bot or turned notifications off', async () => {
    renderPage()
    let card = await openCard('blocked@x.co')
    const b = within(card).getByRole('button', { name: 'Write on Telegram' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    expect(within(card).getByText('The user blocked the bot')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: /Close/ }))
    card = await openCard('stopped@x.co')
    expect((within(card).getByRole('button', { name: 'Write on Telegram' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(card).getByText('The user turned notifications off')).toBeTruthy()
    expect(adminSupportApi.open).not.toHaveBeenCalled()
  })
})
