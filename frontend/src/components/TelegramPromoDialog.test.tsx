import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { profileApi, telegramApi, type Profile } from '../api/endpoints'
import * as toaster from './Toaster'
import { TelegramPromoDialog } from './TelegramPromoDialog'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, profileApi: { get: vi.fn(), update: vi.fn() }, telegramApi: { link: vi.fn() } }
})

const tgStatus = { connected: false, username: null, available: true, bonus_offer: 2, bonus: 0 }
const profile = (telegram: Partial<Profile['telegram']> = {}): Profile => ({ full_name: null, phone: null, telegram: { ...tgStatus, ...telegram } })
const apiError = (code: string, status: number) => Object.assign(new Error(code), { isAxiosError: true, response: { status, data: { error: code, code } } })

let qc: QueryClient
const newApp = () => { qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }) }
function mount(path = '/') {
  return render(
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><TelegramPromoDialog /></MemoryRouter></QueryClientProvider>,
  )
}
const dialog = () => screen.queryByRole('dialog', { name: 'Connect Telegram' })
// The profile has answered: a hidden dialog is hidden for its reason, not because it is still loading.
const loaded = () => waitFor(() => expect(qc.getQueryData(['profile'])).toBeTruthy())

beforeEach(async () => {
  await i18n.changeLanguage('en')
  newApp()
  vi.mocked(profileApi.get).mockResolvedValue(profile())
  vi.spyOn(toaster, 'toast').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('TelegramPromoDialog', () => {
  it('shows on mount while Telegram is not connected, with the gift on offer', async () => {
    mount()
    expect(await screen.findByRole('dialog', { name: 'Connect Telegram' })).toBeTruthy()
    expect(screen.getByText('Link your account to our Telegram bot and get +2 photos as a gift.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Later' })).toBeTruthy()
  })

  it('no gift on offer: the plain text', async () => {
    vi.mocked(profileApi.get).mockResolvedValue(profile({ bonus_offer: 0, bonus: 2 }))
    mount()
    expect(await screen.findByText('Link your account to our Telegram bot.')).toBeTruthy()
  })

  it('"Later" closes it for this view only; a remount (next open / reload) shows it again', async () => {
    const first = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Later' }))
    expect(dialog()).toBeNull()
    first.unmount()
    mount() // the same app, mounted again
    expect(await screen.findByRole('dialog', { name: 'Connect Telegram' })).toBeTruthy()
  })

  it('Esc closes it too, the same way', async () => {
    mount()
    await screen.findByRole('dialog', { name: 'Connect Telegram' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(dialog()).toBeNull()
  })

  it('hidden when Telegram is connected', async () => {
    vi.mocked(profileApi.get).mockResolvedValue(profile({ connected: true, username: 'anna_k', bonus_offer: 0 }))
    mount()
    await loaded()
    expect(dialog()).toBeNull()
  })

  it('hidden when Telegram is unavailable: no bot in the profile', async () => {
    vi.mocked(profileApi.get).mockResolvedValue(profile({ available: false, bonus_offer: 0 }))
    mount()
    await loaded()
    expect(dialog()).toBeNull()
  })

  it('hidden when Telegram is unavailable: the link request answers 503 telegram_unavailable', async () => {
    const tab = { location: { href: '' }, opener: window, closed: false, close: vi.fn() }
    vi.stubGlobal('open', vi.fn(() => tab))
    vi.mocked(telegramApi.link).mockRejectedValue(apiError('telegram_unavailable', 503))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(dialog()).toBeNull())
    expect(tab.close).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('never on the profile page (its Telegram row is the connect and waiting screen)', async () => {
    mount('/profile')
    await loaded()
    expect(dialog()).toBeNull()
  })

  it('Connect opens the bot and waits here; when polling says connected it closes and shows the gift toast', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const tab = { location: { href: '' }, opener: window, closed: false, close: vi.fn() }
    vi.stubGlobal('open', vi.fn(() => tab))
    vi.mocked(telegramApi.link).mockResolvedValue({ url: 'https://t.me/yodla_bot?start=YL-ABC234', expires_at: '2026-11-08T12:10:00Z' })
    try {
      mount()
      fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
      expect(await screen.findByTestId('telegram-promo-waiting')).toBeTruthy()
      expect(tab.location.href).toBe('https://t.me/yodla_bot?start=YL-ABC234')
      expect(dialog()).toBeTruthy()

      vi.mocked(profileApi.get).mockResolvedValue(profile({ connected: true, username: 'anna_k', bonus_offer: 0, bonus: 2 }))
      await act(() => vi.advanceTimersByTimeAsync(3_000))
      await waitFor(() => expect(dialog()).toBeNull())
      expect(toaster.toast).toHaveBeenCalledWith('Telegram connected · +2 photos as a gift', { ms: 5000 })
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('stores nothing: no sessionStorage or localStorage reads or writes for the dialog', async () => {
    // Spied on each storage's own prototype: here sessionStorage is not jsdom's Storage class, so a
    // spy on Storage.prototype alone would miss its writes.
    const protos = [...new Set([window.localStorage, window.sessionStorage].map((s) => Object.getPrototypeOf(s) as Storage))]
    const spies = protos.flatMap((p) => [vi.spyOn(p, 'setItem'), vi.spyOn(p, 'removeItem'), vi.spyOn(p, 'clear')])
    const reads = protos.map((p) => vi.spyOn(p, 'getItem'))
    const first = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Later' }))
    first.unmount()
    mount()
    await screen.findByRole('dialog', { name: 'Connect Telegram' })
    for (const s of spies) expect(s).not.toHaveBeenCalled()
    for (const r of reads) expect(r).not.toHaveBeenCalledWith('tg_promo_shown')
  })
})
