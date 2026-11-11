import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { adminApi, telegramBroadcastApi, type AdminUser, type TelegramBroadcast } from '../api/endpoints'
import { AdminTelegram, BROADCAST_POLL_MS } from './AdminTelegram'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    adminApi: { users: vi.fn() },
    telegramBroadcastApi: { audience: vi.fn(), create: vi.fn(), list: vi.fn(), get: vi.fn() },
  }
})

const fail = (status: number, code: string) =>
  new AxiosError('x', String(status), undefined, undefined, { status, data: { error: code, code }, headers: {}, statusText: '', config: {} as never } as AxiosResponse)

const user = (id: string, over: Partial<AdminUser> = {}): AdminUser => ({
  id, email: `${id}@x.co`, role: 'user', is_banned: false, created_at: '2026-01-01T00:00:00Z', words_count: 0, last_activity_at: null,
  full_name: null, phone: null, telegram: { connected: true, username: null, notifications: true, blocked: false }, ...over,
})
const broadcast = (over: Partial<TelegramBroadcast> = {}): TelegramBroadcast => ({
  id: 1, kind: 'manual', target: 'all', text: { ru: 'Привет', uz: null, en: null }, button: null, status: 'queued', total: 10,
  sent: 0, failed: 0, blocked: 0, created_at: '2026-11-10T10:00:00Z', finished_at: null, ...over,
})

function renderTab(props: { preselect?: string | null } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><AdminTelegram {...props} /></QueryClientProvider>)
}
const textarea = () => screen.getByLabelText('Text (Russian)') as HTMLTextAreaElement
const sendBtn = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
const meBtn = () => screen.getByRole('button', { name: 'Send to myself' }) as HTMLButtonElement
const type = (v: string) => fireEvent.change(textarea(), { target: { value: v } })

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(telegramBroadcastApi.audience).mockResolvedValue({ linked: 140, reachable: 131, opted_out: 6, blocked: 3 })
  vi.mocked(telegramBroadcastApi.list).mockResolvedValue([])
  vi.mocked(telegramBroadcastApi.create).mockResolvedValue({ broadcast: broadcast(), skipped: 0 })
  vi.mocked(telegramBroadcastApi.get).mockResolvedValue(broadcast())
  vi.mocked(adminApi.users).mockResolvedValue([
    user('anna', { full_name: 'Anna Petrova', phone: '+998901234567' }),
    user('nolink', { telegram: { connected: false, username: null, notifications: true, blocked: false } }),
    user('stopped', { telegram: { connected: true, username: null, notifications: false, blocked: false } }),
    user('blocked', { telegram: { connected: true, username: null, notifications: true, blocked: true } }),
  ])
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers() })

describe('AdminTelegram', () => {
  it('shows the audience line', async () => {
    renderTab()
    expect((await screen.findByTestId('telegram-audience')).textContent)
      .toBe('Connected: 140 · will receive: 131 · opted out: 6 · blocked the bot: 3')
  })

  it('without a bot (503 telegram_unavailable): only the notice, no form', async () => {
    vi.mocked(telegramBroadcastApi.audience).mockRejectedValue(fail(503, 'telegram_unavailable'))
    renderTab()
    expect((await screen.findByTestId('telegram-unavailable')).textContent).toBe('The Telegram bot is not configured')
    expect(screen.queryByLabelText('Text (Russian)')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
  })

  it('the form needs a Russian text (counted, at most 1000); the test button needs it too', async () => {
    renderTab()
    await screen.findByTestId('telegram-audience')
    expect(sendBtn().disabled).toBe(true)
    expect(meBtn().disabled).toBe(true)
    type('   ')
    expect(sendBtn().disabled).toBe(true)
    type('Привет')
    expect(screen.getByTestId('telegram-counter').textContent).toBe('6 / 1000')
    expect(sendBtn().disabled).toBe(false)
    expect(meBtn().disabled).toBe(false)
    type('я'.repeat(1200))
    expect(textarea().value).toHaveLength(1000) // cut at the limit
  })

  it('the button: empty label = no button; a label needs an https link', async () => {
    renderTab()
    await screen.findByTestId('telegram-audience')
    type('Hello')
    const label = screen.getByLabelText('Button text') as HTMLInputElement
    const url = screen.getByLabelText('Link (https)') as HTMLInputElement
    expect(url.value).toBe('https://yodla.fun') // the default link
    expect(sendBtn().disabled).toBe(false) // no label: no button, so the link is not checked
    fireEvent.change(label, { target: { value: 'Open' } })
    expect(sendBtn().disabled).toBe(false)
    fireEvent.change(url, { target: { value: 'http://yodla.fun' } })
    expect(sendBtn().disabled).toBe(true)
    expect(screen.getByTestId('telegram-button-error').textContent).toBe('The link must start with https://')
    fireEvent.change(url, { target: { value: 'javascript:alert(1)' } })
    expect(sendBtn().disabled).toBe(true)
    fireEvent.change(url, { target: { value: 'https://yodla.fun/x' } })
    expect(sendBtn().disabled).toBe(false)
    fireEvent.click(meBtn())
    await waitFor(() => expect(telegramBroadcastApi.create).toHaveBeenCalledWith({
      target: 'me', text: { ru: 'Hello' }, button: { text: 'Open', url: 'https://yodla.fun/x' },
    }))
  })

  it('other languages are collapsed; their texts are sent when filled', async () => {
    renderTab()
    await screen.findByTestId('telegram-audience')
    expect(screen.queryByLabelText('Uzbek')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Other languages' }))
    fireEvent.change(screen.getByLabelText('Uzbek'), { target: { value: ' Salom ' } })
    type('Привет')
    fireEvent.click(meBtn())
    await waitFor(() => expect(telegramBroadcastApi.create).toHaveBeenCalledWith({ target: 'me', text: { ru: 'Привет', uz: 'Salom' } }))
  })

  it('"Everyone" asks for confirmation inside the page (not window.confirm); Cancel sends nothing', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    renderTab()
    await screen.findByTestId('telegram-audience')
    fireEvent.click(screen.getByRole('radio', { name: 'Everyone' }))
    type('Hello')
    fireEvent.click(sendBtn())
    const dialog = await screen.findByTestId('telegram-confirm')
    expect(within(dialog).getByText('Send to 131 users?')).toBeTruthy()
    expect(telegramBroadcastApi.create).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('telegram-confirm')).toBeNull()
    expect(telegramBroadcastApi.create).not.toHaveBeenCalled()

    fireEvent.click(sendBtn())
    fireEvent.click(within(await screen.findByTestId('telegram-confirm')).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(telegramBroadcastApi.create).toHaveBeenCalledTimes(1))
    expect(telegramBroadcastApi.create).toHaveBeenCalledWith({ target: 'all', text: { ru: 'Hello' } })
    expect(confirm).not.toHaveBeenCalled()
    expect(await screen.findByTestId('telegram-progress')).toBeTruthy()
  })

  it('the confirmation uses the Russian plural: 131 пользователю, 132 пользователям', async () => {
    await i18n.changeLanguage('ru')
    expect(i18n.t('admin.telegram.confirm', { count: 131 })).toBe('Отправить 131 пользователю?')
    expect(i18n.t('admin.telegram.confirm', { count: 132 })).toBe('Отправить 132 пользователям?')
    expect(i18n.t('admin.telegram.confirm', { count: 135 })).toBe('Отправить 135 пользователям?')
  })

  it('"Chosen users": only users with Telegram linked are listed; search by name, email, phone; the user ids are sent', async () => {
    renderTab()
    await screen.findByTestId('telegram-audience')
    fireEvent.click(screen.getByRole('radio', { name: 'Chosen users' }))
    const picker = await screen.findByTestId('telegram-picker')
    expect(within(picker).getAllByRole('checkbox')).toHaveLength(3) // anna, stopped, blocked — not "nolink"
    expect(within(picker).queryByText('nolink@x.co')).toBeNull()
    expect(within(picker).getByText('turned notifications off')).toBeTruthy()
    expect(within(picker).getByText('blocked the bot')).toBeTruthy()
    const search = screen.getByLabelText('Name, email or phone')
    fireEvent.change(search, { target: { value: 'PETROVA' } })
    expect(within(picker).getAllByRole('checkbox')).toHaveLength(1)
    fireEvent.change(search, { target: { value: '90 123' } })
    expect(within(picker).getAllByRole('checkbox')).toHaveLength(1)
    fireEvent.change(search, { target: { value: 'nobody' } })
    expect(within(picker).queryAllByRole('checkbox')).toHaveLength(0)

    type('Hi')
    expect(sendBtn().disabled).toBe(true) // nobody chosen
    fireEvent.change(search, { target: { value: '' } })
    fireEvent.click(within(picker).getAllByRole('checkbox')[0])
    expect(screen.getByText('Selected: 1')).toBeTruthy()
    expect(within(screen.getByTestId('telegram-chips')).getByText('Anna Petrova')).toBeTruthy()
    fireEvent.click(sendBtn())
    await waitFor(() => expect(telegramBroadcastApi.create).toHaveBeenCalledWith({ target: 'users', user_ids: ['anna'], text: { ru: 'Hi' } }))
  })

  it('a user sent from the card is preselected under "Chosen users"', async () => {
    renderTab({ preselect: 'anna' })
    await screen.findByTestId('telegram-audience')
    expect((screen.getByRole('radio', { name: 'Chosen users' }) as HTMLInputElement).checked).toBe(true)
    expect(within(await screen.findByTestId('telegram-chips')).getByText(/anna/i)).toBeTruthy()
  })

  it('progress is re-read every 2 s while queued or running and stops when done; the history is refreshed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(telegramBroadcastApi.get)
      .mockResolvedValueOnce(broadcast({ status: 'running', sent: 3 }))
      .mockResolvedValueOnce(broadcast({ status: 'running', sent: 7, failed: 1 }))
      .mockResolvedValue(broadcast({ status: 'done', sent: 9, failed: 1, blocked: 0, total: 10 }))
    renderTab()
    await screen.findByTestId('telegram-audience')
    type('Hi')
    fireEvent.click(meBtn())
    const progress = await screen.findByTestId('telegram-progress')
    await waitFor(() => expect(progress.textContent).toContain('Sent 3 of 10'))
    await act(() => vi.advanceTimersByTimeAsync(BROADCAST_POLL_MS))
    await waitFor(() => expect(screen.getByTestId('telegram-progress').textContent).toContain('Sent 7 of 10'))
    expect(screen.getByTestId('telegram-progress').textContent).toContain('Failed: 1')
    await act(() => vi.advanceTimersByTimeAsync(BROADCAST_POLL_MS))
    await waitFor(() => expect(screen.getByTestId('telegram-progress').textContent).toContain('Sent 9 of 10'))
    expect(screen.getByTestId('telegram-progress').textContent).toContain('done')
    const calls = vi.mocked(telegramBroadcastApi.get).mock.calls.length
    const lists = vi.mocked(telegramBroadcastApi.list).mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(BROADCAST_POLL_MS * 5))
    expect(vi.mocked(telegramBroadcastApi.get).mock.calls.length).toBe(calls) // no more polling
    expect(lists).toBeGreaterThan(1) // the history was read again when it finished
  })

  it('errors: a second "all" and "me" without Telegram say what to do', async () => {
    renderTab()
    await screen.findByTestId('telegram-audience')
    type('Hi')
    vi.mocked(telegramBroadcastApi.create).mockRejectedValueOnce(fail(400, 'telegram_not_linked'))
    fireEvent.click(meBtn())
    expect((await screen.findByRole('alert')).textContent).toBe('Your Telegram is not connected: connect it in your profile.')
    fireEvent.click(screen.getByRole('radio', { name: 'Everyone' }))
    vi.mocked(telegramBroadcastApi.create).mockRejectedValueOnce(fail(409, 'broadcast_running'))
    fireEvent.click(sendBtn())
    fireEvent.click(within(await screen.findByTestId('telegram-confirm')).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('A broadcast to everyone is already running — wait for it to finish.'))
    expect(screen.queryByTestId('telegram-confirm')).toBeNull()
  })

  it('the skipped count is reported', async () => {
    vi.mocked(telegramBroadcastApi.create).mockResolvedValue({ broadcast: broadcast(), skipped: 2 })
    renderTab()
    await screen.findByTestId('telegram-audience')
    type('Hi')
    fireEvent.click(meBtn())
    expect((await screen.findByText(/2 users skipped/)).textContent).toContain('notifications off')
  })

  it('history: date, target, the first 80 characters, counters and status', async () => {
    vi.mocked(telegramBroadcastApi.list).mockResolvedValue([
      broadcast({ id: 5, text: { ru: 'x'.repeat(100), uz: null, en: null }, status: 'done', sent: 8, total: 10, failed: 1, blocked: 1 }),
      broadcast({ id: 4, target: 'me', status: 'interrupted' }),
    ])
    renderTab()
    const row = await screen.findByTestId('broadcast-5')
    expect(row.textContent).toContain('x'.repeat(80) + '…')
    expect(row.textContent).not.toContain('x'.repeat(81))
    expect(row.textContent).toContain('Sent 8 of 10 · failed: 1 · blocked: 1')
    expect(row.textContent).toContain('to everyone')
    expect(row.textContent).toContain('done')
    expect(screen.getByTestId('broadcast-4').textContent).toContain('interrupted')
  })
})
