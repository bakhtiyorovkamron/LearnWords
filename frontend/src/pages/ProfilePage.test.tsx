import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { chatUnreadApi, profileApi, purchasesApi, telegramApi } from '../api/endpoints'
import * as toaster from '../components/Toaster'
import { ProfilePage } from './ProfilePage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, profileApi: { get: vi.fn(), update: vi.fn() }, telegramApi: { link: vi.fn(), setNotifications: vi.fn() }, purchasesApi: { overview: vi.fn(), create: vi.fn(), cancel: vi.fn() }, chatUnreadApi: { mine: vi.fn(), admin: vi.fn() } }
})
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true }) }))

const tgStatus = { connected: false, username: null, available: true, bonus_offer: 2, bonus: 0 }
const empty = { full_name: null, phone: null, telegram: tgStatus }
const apiError = (code: string, status = 400) => Object.assign(new Error(code), { isAxiosError: true, response: { status, data: { error: code, code } } })

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter><ProfilePage /></MemoryRouter></QueryClientProvider>)
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(profileApi.get).mockResolvedValue(empty)
  vi.mocked(purchasesApi.overview).mockRejectedValue(apiError('payments_unavailable', 503))
  vi.mocked(chatUnreadApi.mine).mockResolvedValue({ support: 0, purchases: [], total: 0 })
  vi.spyOn(toaster, 'toast').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('ProfilePage', () => {
  it('shows the saved name and phone, and Telegram as not connected', async () => {
    vi.mocked(profileApi.get).mockResolvedValue({ ...empty, full_name: 'Anna', phone: '+998901234567' })
    renderPage()
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Anna'))
    expect((screen.getByLabelText(/Phone/) as HTMLInputElement).value).toBe('+998 90 123 45 67')
    expect(screen.getByTestId('profile-telegram').textContent).toBe('Not connected')
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('the phone is a tel input formatted as the user types, and is sent as +998XXXXXXXXX', async () => {
    vi.mocked(profileApi.update).mockResolvedValue({ ...empty, full_name: 'Anna', phone: '+998901234567' })
    renderPage()
    const name = await screen.findByLabelText('Name')
    const phone = screen.getByLabelText(/Phone/) as HTMLInputElement
    expect(phone.type).toBe('tel')
    expect(phone.placeholder).toBe('+998 90 123 45 67')
    fireEvent.change(name, { target: { value: '  Anna ' } })
    fireEvent.change(phone, { target: { value: '901234567' } })
    expect(phone.value).toBe('+998 90 123 45 67')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(profileApi.update).toHaveBeenCalledWith({ full_name: 'Anna', phone: '+998901234567' }))
    await waitFor(() => expect(toaster.toast).toHaveBeenCalledWith('Saved'))
  })

  it('shows the server error under the field it belongs to', async () => {
    vi.mocked(profileApi.update).mockRejectedValue(apiError('invalid_phone'))
    renderPage()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Anna' } })
    fireEvent.change(screen.getByLabelText(/Phone/), { target: { value: '90123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The number must look like +998 90 123 45 67.')
    expect(screen.getByLabelText(/Phone/).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).toBeNull()
    cleanup()

    vi.mocked(profileApi.update).mockRejectedValue(apiError('invalid_name'))
    renderPage()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a name of 2 to 80 characters.')
  })

  it('a connected Telegram shows only "Connected · @username" (or just "Connected"): no buttons', async () => {
    vi.mocked(profileApi.get).mockResolvedValue({ ...empty, telegram: { ...tgStatus, connected: true, username: 'anna_k', bonus_offer: 0 } })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('profile-telegram').textContent).toBe('Connected · @anna_k'))
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
    expect(screen.queryByRole('button', { name: /disconnect/i })).toBeNull()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Save'])
    cleanup()
    vi.mocked(profileApi.get).mockResolvedValue({ ...empty, telegram: { ...tgStatus, connected: true, bonus_offer: 0 } })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('profile-telegram').textContent).toBe('Connected'))
  })
})

describe('ProfilePage: connecting Telegram', () => {
  const URL = 'https://t.me/yodla_bot?start=YL-ABC234'
  const connectedProfile = { ...empty, telegram: { ...tgStatus, connected: true, username: 'anna_k', bonus_offer: 0, bonus: 2 } }
  const linkResult = { url: URL, expires_at: '2026-11-08T12:10:00Z' }
  type FakeWindow = { location: { href: string }; opener: unknown; closed: boolean; close: ReturnType<typeof vi.fn> }
  let tab: FakeWindow
  let open: ReturnType<typeof vi.fn>
  let confirm: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    tab = { location: { href: '' }, opener: window, closed: false, close: vi.fn() }
    open = vi.fn(() => tab)
    confirm = vi.fn(() => true)
    vi.stubGlobal('open', open)
    vi.stubGlobal('confirm', confirm)
    vi.mocked(telegramApi.link).mockResolvedValue(linkResult)
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  const polls = () => vi.mocked(profileApi.get).mock.calls.length
  const connect = async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    await screen.findByTestId('telegram-waiting')
  }

  it('the click opens a tab at once, before the link request answers; then the tab gets the bot', async () => {
    let answer!: (v: typeof linkResult) => void
    vi.mocked(telegramApi.link).mockReturnValue(new Promise((resolve) => { answer = resolve }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    // The tab opens inside the click itself; the request goes out after it and has not answered yet.
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('', '_blank')
    await waitFor(() => expect(telegramApi.link).toHaveBeenCalledTimes(1))
    expect(tab.location.href).toBe('')
    expect(tab.opener).toBeNull()

    await act(async () => answer(linkResult))
    await waitFor(() => expect(tab.location.href).toBe(URL))
    expect(screen.getByTestId('telegram-waiting').textContent).toBe('Waiting for confirmation…')
    expect(screen.queryByRole('link', { name: /bot/i })).toBeNull() // no "Open the bot", no "Check": polling covers it
    expect(screen.queryByRole('button', { name: 'Check' })).toBeNull()
    expect(open).toHaveBeenCalledTimes(1)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('waits, polling every 3 s, and stops polling once connected', async () => {
    await connect()
    const before = polls()
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(polls()).toBe(before + 1)
    vi.mocked(profileApi.get).mockResolvedValue(connectedProfile) // the user pressed Start in the bot
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    await waitFor(() => expect(screen.getByTestId('profile-telegram').textContent).toBe('Connected · @anna_k'))
    expect(screen.queryByTestId('telegram-waiting')).toBeNull()
    expect(screen.queryByRole('button', { name: /disconnect/i })).toBeNull()
    expect(toaster.toast).toHaveBeenCalledWith('Telegram connected · +2 photos as a gift', { ms: 5000 })
    const after = polls()
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(polls()).toBe(after) // no more polling
    expect(confirm).not.toHaveBeenCalled()
  })

  it('polling stops after 60 s; the status line goes and Connect can start again', async () => {
    await connect()
    await act(() => vi.advanceTimersByTimeAsync(61_000))
    const stopped = polls()
    expect(stopped).toBeGreaterThanOrEqual(19) // ~every 3 s for a minute
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(polls()).toBe(stopped)
    expect(screen.queryByTestId('telegram-waiting')).toBeNull()
    expect(screen.getByTestId('profile-telegram').textContent).toBe('Not connected')

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await screen.findByTestId('telegram-waiting')
    expect(telegramApi.link).toHaveBeenCalledTimes(2)
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(polls()).toBe(stopped + 1)
  })

  it('a failed link request closes the blank tab and shows the error inline', async () => {
    vi.mocked(telegramApi.link).mockRejectedValue(apiError('rate_limited', 429))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(tab.close).toHaveBeenCalledTimes(1)
    expect(tab.location.href).toBe('')
    expect(screen.queryByTestId('telegram-waiting')).toBeNull()
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('no bot (profile says unavailable): the button is off and says so before any click', async () => {
    vi.mocked(profileApi.get).mockResolvedValue({ ...empty, telegram: { ...tgStatus, available: false, bonus_offer: 0 } })
    renderPage()
    expect(await screen.findByText('Telegram is not available yet')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('503 telegram_unavailable: closes the tab; the button is disabled and says Telegram is not available yet', async () => {
    vi.mocked(telegramApi.link).mockRejectedValue(apiError('telegram_unavailable', 503))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    expect(await screen.findByText('Telegram is not available yet')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(true)
    expect(tab.close).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('ProfilePage: my purchase requests', () => {
  const req = (id: string, code: string, status: 'pending' | 'paid' | 'cancelled' | 'rejected') =>
    ({ id, code, pack_id: 'photo_35', amount: 35, price_uzs: 25000, status, created_at: '2026-11-08T10:00:00Z' })

  it('lists them (code, pack, price, status), each opening its chat', async () => {
    vi.mocked(purchasesApi.overview).mockResolvedValue({
      packs: [], payment: { card_number: '', card_holder: '', telegram: 'yodla' },
      requests: [req('r2', 'YD-0002', 'pending'), req('r1', 'YD-0001', 'paid')],
    })
    renderPage()
    const list = await screen.findByRole('region', { name: 'My requests' })
    const first = await within(list).findByTestId('my-request-r2')
    expect(first.getAttribute('href')).toBe('/purchases/r2')
    expect(first.textContent).toContain('YD-0002')
    expect(first.textContent).toContain('Awaiting payment')
    expect(within(list).getByTestId('my-request-r1').textContent).toContain('Paid')
  })

  it('no requests, or buying is off: no block', async () => {
    renderPage()
    await screen.findByLabelText('Name')
    expect(screen.queryByRole('region', { name: 'My requests' })).toBeNull()
  })
})

describe('ProfilePage: support', () => {
  it('has the way to support (no purchase needed)', async () => {
    renderPage()
    const entry = await screen.findByTestId('support-entry')
    expect(entry.getAttribute('href')).toBe('/support')
    expect(entry.textContent).toContain('Contact support')
  })

  it('unread badges: the support entry, and only the purchase request rows that have unread messages', async () => {
    const req = (id: string, code: string) => ({ id, code, pack_id: 'photo_35', feature: 'photo_import', amount: 35, price_uzs: 1000, status: 'pending', created_at: '' })
    vi.mocked(purchasesApi.overview).mockResolvedValue({ requests: [req('r1', 'YD-1'), req('r2', 'YD-2')] } as never)
    vi.mocked(chatUnreadApi.mine).mockResolvedValue({ support: 12, purchases: [{ id: 'r2', code: 'YD-2', unread: 2 }], total: 14 })
    renderPage()
    expect((await screen.findByTestId('badge-support')).textContent).toBe('9+')
    expect((await screen.findByTestId('badge-request-r2')).textContent).toBe('2')
    expect(screen.queryByTestId('badge-request-r1')).toBeNull()
  })

  describe('Telegram notifications switch', () => {
    const connected = { ...empty, telegram: { ...tgStatus, connected: true, username: 'anna', bonus_offer: 0, notifications: true } }
    const sw = () => screen.findByRole('switch', { name: 'News and reminders in Telegram' }) as Promise<HTMLInputElement>

    it('only for a connected user', async () => {
      renderPage()
      await screen.findByLabelText('Name')
      expect(screen.queryByRole('switch')).toBeNull()
    })

    it('shows the saved state; turning it off calls the API at once (optimistic)', async () => {
      vi.mocked(profileApi.get).mockResolvedValue(connected)
      let done!: () => void
      vi.mocked(telegramApi.setNotifications).mockReturnValue(new Promise((r) => { done = () => r(undefined) }))
      renderPage()
      const s = await sw()
      expect(s.checked).toBe(true)
      fireEvent.click(s)
      await waitFor(() => expect(telegramApi.setNotifications).toHaveBeenCalledWith(false))
      await waitFor(() => expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false)) // before the answer
      await act(async () => done())
      expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false)
    })

    it('goes back and says why when the call fails', async () => {
      vi.mocked(profileApi.get).mockResolvedValue(connected)
      vi.mocked(telegramApi.setNotifications).mockRejectedValue(apiError('boom', 500))
      renderPage()
      fireEvent.click(await sw())
      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('boom'))
      expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(true) // rolled back
    })

    it('an off switch can be turned on', async () => {
      vi.mocked(profileApi.get).mockResolvedValue({ ...connected, telegram: { ...connected.telegram, notifications: false } })
      vi.mocked(telegramApi.setNotifications).mockResolvedValue(undefined)
      renderPage()
      const s = await sw()
      expect(s.checked).toBe(false)
      fireEvent.click(s)
      await waitFor(() => expect(telegramApi.setNotifications).toHaveBeenCalledWith(true))
    })
  })
})
