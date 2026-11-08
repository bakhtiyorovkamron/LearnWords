import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { profileApi, telegramApi } from '../api/endpoints'
import * as toaster from '../components/Toaster'
import { ProfilePage } from './ProfilePage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, profileApi: { get: vi.fn(), update: vi.fn() }, telegramApi: { link: vi.fn(), unlink: vi.fn() } }
})

const empty = { full_name: null, phone: null, telegram: { connected: false, username: null } }
const apiError = (code: string, status = 400) => Object.assign(new Error(code), { isAxiosError: true, response: { status, data: { error: code, code } } })

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><ProfilePage /></QueryClientProvider>)
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(profileApi.get).mockResolvedValue(empty)
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

  it('a connected Telegram shows "Connected · @username" (or just "Connected") and no connect button', async () => {
    vi.mocked(profileApi.get).mockResolvedValue({ ...empty, telegram: { connected: true, username: 'anna_k' } })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('profile-telegram').textContent).toBe('Connected · @anna_k'))
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy()
    cleanup()
    vi.mocked(profileApi.get).mockResolvedValue({ ...empty, telegram: { connected: true, username: null } })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('profile-telegram').textContent).toBe('Connected'))
  })
})

describe('ProfilePage: connecting Telegram', () => {
  const URL = 'https://t.me/yodla_bot?start=YL-ABC234'
  const connectedProfile = { ...empty, telegram: { connected: true, username: 'anna_k' } }
  let open: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    open = vi.fn()
    vi.stubGlobal('open', open)
    vi.mocked(telegramApi.link).mockResolvedValue({ url: URL, expires_at: '2026-11-08T12:10:00Z' })
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  const connect = async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    await screen.findByTestId('telegram-waiting')
  }

  it('Connect → opens the bot → waits, polling every 3 s → connected', async () => {
    await connect()
    expect(telegramApi.link).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(URL, '_blank', 'noopener')
    expect(screen.getByTestId('telegram-waiting').textContent).toContain('Open the bot and press Start')
    expect(screen.getByRole('link', { name: 'Open the bot' }).getAttribute('href')).toBe(URL)
    const calls = vi.mocked(profileApi.get).mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(vi.mocked(profileApi.get).mock.calls.length).toBe(calls + 1)
    vi.mocked(profileApi.get).mockResolvedValue(connectedProfile) // the user pressed Start in the bot
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    await waitFor(() => expect(screen.getByTestId('profile-telegram').textContent).toBe('Connected · @anna_k'))
    expect(screen.queryByTestId('telegram-waiting')).toBeNull()
    const after = vi.mocked(profileApi.get).mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(9_000))
    expect(vi.mocked(profileApi.get).mock.calls.length).toBe(after) // no more polling
  })

  it('polling stops after 60 s; "Check" looks again (and waits another minute)', async () => {
    await connect()
    await act(() => vi.advanceTimersByTimeAsync(61_000))
    const stopped = vi.mocked(profileApi.get).mock.calls.length
    expect(stopped).toBeGreaterThanOrEqual(19) // ~every 3 s for a minute
    await act(() => vi.advanceTimersByTimeAsync(15_000))
    expect(vi.mocked(profileApi.get).mock.calls.length).toBe(stopped)
    expect(screen.getByTestId('telegram-waiting')).toBeTruthy() // the banner stays, with Check

    vi.mocked(profileApi.get).mockResolvedValue(connectedProfile)
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    await waitFor(() => expect(screen.getByTestId('profile-telegram').textContent).toBe('Connected · @anna_k'))
  })

  it('503 telegram_unavailable: the button is disabled and says Telegram is not available yet', async () => {
    vi.mocked(telegramApi.link).mockRejectedValue(apiError('telegram_unavailable', 503))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    expect(await screen.findByText('Telegram is not available yet')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(true)
    expect(open).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('Disconnect asks first; confirmed, it unlinks and shows Not connected', async () => {
    vi.mocked(profileApi.get).mockResolvedValue(connectedProfile)
    vi.mocked(telegramApi.unlink).mockResolvedValue({} as never)
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    vi.stubGlobal('confirm', confirm)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    expect(confirm).toHaveBeenCalledWith('Disconnect Telegram from your account?')
    expect(telegramApi.unlink).not.toHaveBeenCalled()
    vi.mocked(profileApi.get).mockResolvedValue(empty)
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(screen.getByTestId('profile-telegram').textContent).toBe('Not connected'))
    expect(telegramApi.unlink).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy()
  })
})
