import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { profileApi, telegramApi, type Profile } from '../api/endpoints'
import * as toaster from './Toaster'
import { WordLimitNotice, wordLimitOf } from './WordLimitNotice'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, profileApi: { get: vi.fn(), update: vi.fn() }, telegramApi: { link: vi.fn() } }
})

const tg = { connected: false, username: null, available: true, bonus_offer: 0, bonus: 0 }
const profileWith =(count: number, limit: number | null, connected = false): Profile =>
  ({ full_name: null, phone: null, telegram: { ...tg, connected }, words: { count, limit } })

let qc: QueryClient
function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><WordLimitNotice /></QueryClientProvider>)
}
const loaded = () => waitFor(() => expect(qc.getQueryData(['profile'])).toBeTruthy())

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.spyOn(toaster, 'toast').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('WordLimitNotice', () => {
  it('no limit for the user (linked, admin, rule off): nothing', async () => {
    vi.mocked(profileApi.get).mockResolvedValue(profileWith(47, null))
    const { container } = mount()
    await loaded()
    expect(container.innerHTML).toBe('')
  })

  it('far from the limit: nothing yet', async () => {
    vi.mocked(profileApi.get).mockResolvedValue(profileWith(39, 50))
    const { container } = mount()
    await loaded()
    expect(container.innerHTML).toBe('')
  })

  it('10 words before the limit: a quiet line with the words left and a link', async () => {
    vi.mocked(profileApi.get).mockResolvedValue(profileWith(45, 50))
    mount()
    const line = await screen.findByTestId('word-limit-near')
    expect(line.textContent).toContain('Without Telegram you can add 50 words. Left: 5.')
    expect(screen.getByRole('button', { name: 'Link Telegram' })).toBeTruthy()
    expect(screen.queryByTestId('telegram-required')).toBeNull()
  })

  it('at the limit: the card with the primary connect button, which opens the bot directly', async () => {
    const tab = { location: { href: '' }, opener: window, closed: false, close: vi.fn() }
    vi.stubGlobal('open', vi.fn(() => tab))
    vi.mocked(telegramApi.link).mockResolvedValue({ url: 'https://t.me/yodla_bot?start=YL-ABC234', expires_at: '2026-11-15T12:10:00Z' })
    vi.mocked(profileApi.get).mockResolvedValue(profileWith(50, 50))
    mount()
    const card = await screen.findByTestId('telegram-required')
    expect(card.textContent).toContain('You have added 50 words. Link Telegram to add without a limit.')
    const button = screen.getByRole('button', { name: 'Link Telegram' })
    expect(button.className).toContain('btn-primary')

    fireEvent.click(button)
    await waitFor(() => expect(tab.location.href).toBe('https://t.me/yodla_bot?start=YL-ABC234'))
    expect(window.open).toHaveBeenCalledTimes(1) // no question in between
    expect(await screen.findByText(/Waiting for confirmation/)).toBeTruthy()
  })

  it('goes away by itself when the profile says connected', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.stubGlobal('open', vi.fn(() => ({ location: { href: '' }, opener: window, closed: false, close: vi.fn() })))
    vi.mocked(telegramApi.link).mockResolvedValue({ url: 'https://t.me/yodla_bot?start=X', expires_at: '' })
    vi.mocked(profileApi.get).mockResolvedValue(profileWith(80, 50))
    try {
      mount()
      fireEvent.click(await screen.findByRole('button', { name: 'Link Telegram' }))
      await screen.findByText(/Waiting for confirmation/)
      vi.mocked(profileApi.get).mockResolvedValue(profileWith(80, null, true))
      await act(() => vi.advanceTimersByTimeAsync(3_000))
      await waitFor(() => expect(screen.queryByTestId('telegram-required')).toBeNull())
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('wordLimitOf', () => {
  it('over the limit (80 of 50): reached, none left', () => {
    expect(wordLimitOf(profileWith(80, 50))).toEqual({ limit: 50, count: 80, left: 0, near: true, reached: true })
  })
  it('connected wins over a limit in the same answer; an older server without words: no limit', () => {
    expect(wordLimitOf(profileWith(80, 50, true)).limit).toBeNull()
    expect(wordLimitOf({ full_name: null, phone: null, telegram: tg }).limit).toBeNull()
    expect(wordLimitOf(undefined).reached).toBe(false)
  })
})
