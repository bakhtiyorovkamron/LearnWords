import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { authApi, type TelegramLoginPoll, type TelegramLoginStart } from '../api/endpoints'
import { AuthPage } from './AuthPage'
import { botOf, refreshIn, TG_LINK_MS, TG_POLL_MS, TG_REFRESH_EARLY_MS } from '../lib/telegramLogin'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, authApi: { login: vi.fn(), register: vi.fn(), telegramStart: vi.fn(), telegramPoll: vi.fn() } }
})

let starts = 0
const login = (): TelegramLoginStart => {
  starts++
  return { url: `https://t.me/yodlafun_bot?start=login_${starts}`, secret: `secret-${starts}`, expires_at: new Date(Date.now() + TG_LINK_MS).toISOString() }
}

function renderAt(mode: 'login' | 'register', from?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const entry = { pathname: `/${mode}`, state: from ? { from: { pathname: from } } : null }
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
          <Route path="/welcome" element={<div>welcome page</div>} />
          <Route path="/s/:token" element={<div>shared folder</div>} />
          <Route path="/" element={<div>home page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const tgLink = () => screen.findByRole('link', { name: 'Continue with Telegram' })
const pollWith = (r: TelegramLoginPoll) => vi.mocked(authApi.telegramPoll).mockResolvedValue(r)
const tick = () => act(() => vi.advanceTimersByTimeAsync(TG_POLL_MS))

async function tapTelegram() {
  fireEvent.click(await tgLink())
  await screen.findByTestId('telegram-waiting')
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  await i18n.changeLanguage('en')
  starts = 0
  vi.mocked(authApi.telegramStart).mockImplementation(async () => login())
  pollWith({ status: 'pending' })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('the Telegram button', () => {
  it.each(['login', 'register'] as const)('%s: a real link to the started login, on top of the email form', async (mode) => {
    renderAt(mode)
    const link = await tgLink()
    expect(link.getAttribute('href')).toBe('https://t.me/yodlafun_bot?start=login_1')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener')
    for (const c of ['h-[54px]', 'w-full', 'rounded-[14px]', 'bg-telegram', 'text-on-telegram', 'text-[17px]', 'font-bold']) {
      expect(link.className).toContain(c)
    }
    expect(link.querySelector('svg[data-icon="telegram"]')?.getAttribute('width')).toBe('22')
    expect(authApi.telegramStart).toHaveBeenCalledTimes(1)
    // the divider, then the email form; the hint under everything
    const or = screen.getByText('or')
    expect(or.className).toContain('text-[13px]')
    expect(or.className).toContain('text-faint')
    const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(link, or)).toBe(true)
    expect(follows(or, screen.getByPlaceholderText('Email'))).toBe(true)
    const hint = screen.getByText('A new account is created on your first sign-in')
    expect(follows(screen.getByPlaceholderText('Password'), hint)).toBe(true)
    expect(hint.className).toContain('text-center')
  })

  it('shows a disabled spinner button while the login is being created', async () => {
    let resolve!: (l: TelegramLoginStart) => void
    vi.mocked(authApi.telegramStart).mockImplementation(() => new Promise((r) => { resolve = r }))
    renderAt('login')
    const busy = screen.getByRole('button', { name: 'Continue with Telegram' })
    expect(busy).toBeDisabled()
    expect(busy.querySelector('.animate-spin')).not.toBeNull()
    await act(async () => resolve(login()))
    expect((await tgLink()).getAttribute('href')).toBe('https://t.me/yodlafun_bot?start=login_1')
  })

  it('is hidden when the bot is not configured (503)', async () => {
    vi.mocked(authApi.telegramStart).mockRejectedValue({ isAxiosError: true, response: { status: 503, data: { code: 'telegram_unavailable' } } })
    renderAt('register')
    await waitFor(() => expect(screen.queryByText('Continue with Telegram')).toBeNull())
    expect(screen.queryByText('or')).toBeNull()
    expect(screen.queryByText('A new account is created on your first sign-in')).toBeNull()
    expect(screen.getByPlaceholderText('Email')).toBeTruthy() // the email form stays
  })

  it('makes a new login shortly before the old one expires', async () => {
    renderAt('login')
    await tgLink()
    await act(() => vi.advanceTimersByTimeAsync(TG_LINK_MS - TG_REFRESH_EARLY_MS))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Continue with Telegram' }).getAttribute('href')).toBe('https://t.me/yodlafun_bot?start=login_2'))
    expect(authApi.telegramPoll).not.toHaveBeenCalled() // nobody tapped: no polling
  })
})

describe('after the tap: waiting for Telegram', () => {
  it('shows the waiting card and polls every 2 s with the secret, and at once when the page is visible again', async () => {
    renderAt('login')
    await tapTelegram()
    const card = screen.getByTestId('telegram-waiting')
    expect(within(card).getByRole('heading', { name: 'Confirm in Telegram' })).toBeTruthy()
    expect(card.textContent).toContain('We opened @yodlafun_bot. Tap “Start” there, then “Yes, it’s me”.')
    expect(within(card).getByText('Waiting for confirmation…')).toBeTruthy()
    expect(within(card).getByText('The link works for 5 minutes')).toBeTruthy()
    expect(within(card).getByRole('link', { name: 'Open Telegram again' }).getAttribute('href')).toBe('https://t.me/yodlafun_bot?start=login_1')
    expect(card.querySelector('.h-\\[72px\\].rounded-full.bg-telegram')).not.toBeNull()
    expect(screen.queryByPlaceholderText('Email')).toBeNull()

    expect(authApi.telegramPoll).not.toHaveBeenCalled()
    await tick()
    expect(authApi.telegramPoll).toHaveBeenCalledTimes(1)
    expect(authApi.telegramPoll).toHaveBeenLastCalledWith('secret-1')
    await tick()
    expect(authApi.telegramPoll).toHaveBeenCalledTimes(2)

    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(authApi.telegramPoll).toHaveBeenCalledTimes(3)
  })

  it('the back chevron returns to the form and stops polling', async () => {
    renderAt('login')
    await tapTelegram()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByPlaceholderText('Email')).toBeTruthy()
    expect(screen.queryByTestId('telegram-waiting')).toBeNull()
    await tick()
    await tick()
    expect(authApi.telegramPoll).not.toHaveBeenCalled()
    expect((await tgLink()).getAttribute('href')).toBe('https://t.me/yodlafun_bot?start=login_1') // still the same login
  })

  it('ok for a new account → /welcome', async () => {
    renderAt('register', '/s/abc')
    await tapTelegram()
    pollWith({ status: 'ok', access_token: 'tok', access_expires_at: '2026-11-21T10:00:00Z', new_user: true })
    await tick()
    expect(await screen.findByText('welcome page')).toBeTruthy()
  })

  it('ok for an existing account → where the user was going', async () => {
    renderAt('login', '/s/abc')
    await tapTelegram()
    pollWith({ status: 'ok', access_token: 'tok', access_expires_at: '2026-11-21T10:00:00Z', new_user: false })
    await tick()
    expect(await screen.findByText('shared folder')).toBeTruthy()
  })

  it('ok without a target → home', async () => {
    renderAt('login')
    await tapTelegram()
    pollWith({ status: 'ok', access_token: 'tok', access_expires_at: '2026-11-21T10:00:00Z', new_user: false })
    await tick()
    expect(await screen.findByText('home page')).toBeTruthy()
  })

  it('denied → a toast and back to the form, with a fresh login', async () => {
    renderAt('login')
    await tapTelegram()
    pollWith({ status: 'denied' })
    await tick()
    expect(await screen.findByText('Sign-in was declined in Telegram')).toBeTruthy()
    expect(screen.queryByTestId('telegram-waiting')).toBeNull()
    expect(screen.getByPlaceholderText('Email')).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('link', { name: 'Continue with Telegram' }).getAttribute('href')).toBe('https://t.me/yodlafun_bot?start=login_2'))
    const polls = vi.mocked(authApi.telegramPoll).mock.calls.length
    await tick()
    expect(authApi.telegramPoll).toHaveBeenCalledTimes(polls) // stopped
  })

  it('expired → a new login, back on the form with a note', async () => {
    renderAt('login')
    await tapTelegram()
    pollWith({ status: 'expired' })
    await tick()
    expect(await screen.findByText('The link expired, tap again')).toBeTruthy()
    expect(authApi.telegramStart).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.getByRole('link', { name: 'Continue with Telegram' }).getAttribute('href')).toBe('https://t.me/yodlafun_bot?start=login_2'))
    // tapping the new link waits for the new login
    pollWith({ status: 'pending' })
    await tapTelegram()
    expect(screen.queryByText('The link expired, tap again')).toBeNull()
    await tick()
    expect(authApi.telegramPoll).toHaveBeenLastCalledWith('secret-2')
  })

  it('a failed poll (offline) just asks again', async () => {
    renderAt('login')
    await tapTelegram()
    vi.mocked(authApi.telegramPoll).mockRejectedValueOnce(new Error('Network Error'))
    await tick()
    expect(screen.getByTestId('telegram-waiting')).toBeTruthy()
    pollWith({ status: 'ok', access_token: 'tok', access_expires_at: '2026-11-21T10:00:00Z', new_user: false })
    await tick()
    expect(await screen.findByText('home page')).toBeTruthy()
  })
})

describe('telegramLogin helpers', () => {
  it('botOf names the bot of the deep link', () => {
    expect(botOf('https://t.me/yodlafun_bot?start=login_x')).toBe('@yodlafun_bot')
    expect(botOf('not a url')).toBe('Telegram')
  })

  it('refreshIn renews shortly before expires_at, and copes with a wrong clock', () => {
    const now = Date.parse('2026-11-21T09:30:00Z')
    expect(refreshIn('2026-11-21T09:35:00Z', now)).toBe(TG_LINK_MS - TG_REFRESH_EARLY_MS)
    expect(refreshIn('2026-11-21T09:29:00Z', now)).toBe(TG_LINK_MS - TG_REFRESH_EARLY_MS) // "expired" by this clock
    expect(refreshIn('2026-11-21T12:00:00Z', now)).toBe(TG_LINK_MS - TG_REFRESH_EARLY_MS) // too far ahead
    expect(refreshIn('garbage', now)).toBe(TG_LINK_MS - TG_REFRESH_EARLY_MS)
    expect(refreshIn('2026-11-21T09:30:05Z', now)).toBe(1_000) // never a busy loop
  })
})
