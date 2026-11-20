import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { adminApi, chatUnreadApi, meApi, profileApi, purchasesApi, type AdminUser } from '../api/endpoints'
import { isTelegramEmail } from '../lib/telegramEmail'
import { AdminUserModal } from './AdminUserModal'
import { UserEmail } from './UserEmail'
import { ProfilePage } from '../pages/ProfilePage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn(), setLearningLanguage: vi.fn() },
    profileApi: { get: vi.fn(), update: vi.fn() },
    telegramApi: { link: vi.fn(), setNotifications: vi.fn() },
    purchasesApi: { overview: vi.fn(), create: vi.fn(), cancel: vi.fn() },
    chatUnreadApi: { mine: vi.fn(), admin: vi.fn() },
    adminApi: { userFeatures: vi.fn(), setUserFeature: vi.fn(), sendPush: vi.fn(), grantCredits: vi.fn() },
  }
})
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true }) }))

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(purchasesApi.overview).mockRejectedValue({ isAxiosError: true, response: { status: 503, data: { code: 'payments_unavailable' } } })
  vi.mocked(chatUnreadApi.mine).mockResolvedValue({ support: 0, purchases: [], total: 0 })
  vi.mocked(adminApi.userFeatures).mockResolvedValue([])
  vi.mocked(profileApi.get).mockResolvedValue({
    full_name: 'Anna', phone: null,
    telegram: { connected: true, username: 'anna_k', available: true, bonus_offer: 0, bonus: 0, notifications: true },
    words: { count: 0, limit: null },
  } as never)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('accounts created by Telegram', () => {
  it('isTelegramEmail', () => {
    expect(isTelegramEmail('tg777@telegram.yodla.fun')).toBe(true)
    expect(isTelegramEmail(' TG777@Telegram.Yodla.Fun')).toBe(true)
    expect(isTelegramEmail('anna@yodla.fun')).toBe(false)
    expect(isTelegramEmail(undefined)).toBe(false)
  })

  it('the admin sees "Telegram" instead of the made-up email (the real value in the title)', () => {
    wrap(<><UserEmail email="tg777@telegram.yodla.fun" /><UserEmail email="anna@example.com" /></>)
    expect(screen.getByText('Telegram').getAttribute('title')).toBe('tg777@telegram.yodla.fun')
    expect(screen.queryByText('tg777@telegram.yodla.fun')).toBeNull()
    expect(screen.getByText('anna@example.com').getAttribute('title')).toBeNull()
  })

  it('the admin user card heading says Telegram', () => {
    const user: AdminUser = { id: 'u1', email: 'tg777@telegram.yodla.fun', role: 'user', is_banned: false,
      created_at: '2026-01-05T10:00:00Z', words_count: 3, last_activity_at: null }
    wrap(<AdminUserModal user={user} onClose={vi.fn()} />)
    const heading = screen.getByRole('heading', { level: 2, name: 'Telegram' })
    expect(heading.querySelector('[title="tg777@telegram.yodla.fun"]')).not.toBeNull()
  })

  it('the profile says Telegram sign-in works', async () => {
    vi.mocked(meApi.get).mockResolvedValue({ id: 'u', email: 'tg777@telegram.yodla.fun', role: 'user' })
    wrap(<ProfilePage />)
    await waitFor(() => expect(screen.getByTestId('profile-telegram').textContent).toBe('Connected · Telegram sign-in works'))
    expect(screen.queryByText(/telegram\.yodla\.fun/)).toBeNull()
  })

  it('an email account connected to Telegram still shows the username', async () => {
    vi.mocked(meApi.get).mockResolvedValue({ id: 'u', email: 'anna@example.com', role: 'user' })
    wrap(<ProfilePage />)
    await waitFor(() => expect(meApi.get).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('profile-telegram').textContent).toBe('Connected · @anna_k'))
  })
})
