import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { adminApi, telegramBroadcastApi, telegramRulesApi, type TelegramBroadcast, type TelegramRule } from '../api/endpoints'
import { AdminTelegram } from './AdminTelegram'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    adminApi: { users: vi.fn(async () => []) },
    telegramBroadcastApi: { audience: vi.fn(), create: vi.fn(), list: vi.fn(), get: vi.fn() },
    telegramRulesApi: { list: vi.fn(), update: vi.fn(), preview: vi.fn(), test: vi.fn() },
  }
})

const fail = (status: number, code: string, field?: string) =>
  new AxiosError('x', String(status), undefined, undefined, { status, data: { error: 'server says no', code, field }, headers: {}, statusText: '', config: {} as never } as AxiosResponse)

const rule = (key: TelegramRule['key'], over: Partial<TelegramRule> = {}): TelegramRule => {
  const daily = key === 'review_reminder' || key === 'comeback'
  return {
    key, enabled: false, send_at: daily ? '19:00' : null, text: { ru: daily ? 'Слов: {count}' : 'Оплата {code}: {amount}', uz: null, en: null },
    button: daily ? { text: 'Открыть Yodla', url: 'https://yodla.fun' } : null,
    placeholders: daily ? ['name', 'count'] : ['name', 'code', 'amount'], last_run_on: null, last_sent: null, ...over,
  }
}

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><AdminTelegram /></QueryClientProvider>)
}
const card = async (key: string) => within(await screen.findByTestId(`rule-${key}`))

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(telegramBroadcastApi.audience).mockResolvedValue({ linked: 1, reachable: 1, opted_out: 0, blocked: 0 })
  vi.mocked(telegramBroadcastApi.list).mockResolvedValue([])
  vi.mocked(adminApi.users).mockResolvedValue([])
  vi.mocked(telegramRulesApi.list).mockResolvedValue([rule('review_reminder'), rule('comeback'), rule('purchase_paid'), rule('purchase_rejected')])
  vi.mocked(telegramRulesApi.preview).mockResolvedValue(42)
  vi.mocked(telegramRulesApi.update).mockImplementation(async (key) => rule(key as TelegramRule['key']))
  vi.mocked(telegramRulesApi.test).mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('AdminTelegram: automatic rules', () => {
  it('a card per rule with its title, who gets it, and a time field only for the daily ones', async () => {
    renderTab()
    const review = await card('review_reminder')
    expect(review.getByRole('heading', { name: 'Review reminder' })).toBeTruthy()
    expect(review.getByText(/have words due today/)).toBeTruthy()
    expect((review.getByLabelText('Send at') as HTMLInputElement).value).toBe('19:00')
    expect((await card('purchase_paid')).queryByLabelText('Send at')).toBeNull()
    expect((await card('comeback')).getByRole('heading', { name: 'Come back' })).toBeTruthy()
    expect((await card('purchase_rejected')).getByRole('heading', { name: 'Order declined' })).toBeTruthy()
  })

  it('the time field is limited to 08:00–21:59; outside it Save is off and the reason shows', async () => {
    renderTab()
    const c = await card('review_reminder')
    const time = c.getByLabelText('Send at') as HTMLInputElement
    expect(time.min).toBe('08:00')
    expect(time.max).toBe('21:59')
    for (const bad of ['22:00', '23:30', '07:59', '03:00']) {
      fireEvent.change(time, { target: { value: bad } })
      expect((c.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
      expect(c.getByTestId('rule-error-review_reminder-send_at').textContent).toBe('The time must be from 08:00 to 21:59: nothing is sent at night.')
    }
    for (const good of ['08:00', '21:59', '12:30']) {
      fireEvent.change(time, { target: { value: good } })
      expect((c.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
    }
    expect(c.queryByTestId('rule-error-review_reminder-send_at')).toBeNull()
  })

  it('the switch and Save call the API with the whole rule', async () => {
    renderTab()
    const c = await card('review_reminder')
    fireEvent.click(c.getByRole('switch'))
    fireEvent.change(c.getByLabelText('Send at'), { target: { value: '20:15' } })
    fireEvent.change(c.getByLabelText('Text (Russian)'), { target: { value: ' Повторите {count} слов ' } })
    fireEvent.click(c.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(telegramRulesApi.update).toHaveBeenCalledWith('review_reminder', {
      enabled: true, send_at: '20:15', text: { ru: 'Повторите {count} слов' }, button: { text: 'Открыть Yodla', url: 'https://yodla.fun' },
    }))
    expect(await c.findByText('Saved')).toBeTruthy()
  })

  it('an event rule sends no time, and a rule without a label sends no button', async () => {
    renderTab()
    const c = await card('purchase_paid')
    fireEvent.click(c.getByRole('switch'))
    fireEvent.click(c.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(telegramRulesApi.update).toHaveBeenCalledWith('purchase_paid', { enabled: true, text: { ru: 'Оплата {code}: {amount}' } }))
  })

  it('other languages are collapsed; their texts are saved', async () => {
    renderTab()
    const c = await card('purchase_paid')
    expect(c.queryByLabelText('Uzbek')).toBeNull()
    fireEvent.click(c.getByRole('button', { name: 'Other languages' }))
    fireEvent.change(c.getByLabelText('Uzbek'), { target: { value: ' {code} tasdiqlandi ' } })
    fireEvent.change(c.getByLabelText('English'), { target: { value: 'Order {code} confirmed' } })
    fireEvent.click(c.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(telegramRulesApi.update).toHaveBeenCalledWith('purchase_paid', {
      enabled: false, text: { ru: 'Оплата {code}: {amount}', uz: '{code} tasdiqlandi', en: 'Order {code} confirmed' },
    }))
  })

  it('a placeholder chip inserts at the cursor, and only the rule\'s own chips exist', async () => {
    renderTab()
    const review = await card('review_reminder')
    expect(within(screen.getByTestId('rule-chips-review_reminder')).getAllByRole('button').map((b) => b.textContent)).toEqual(['{name}', '{count}'])
    expect(within(screen.getByTestId('rule-chips-purchase_paid')).getAllByRole('button').map((b) => b.textContent)).toEqual(['{name}', '{code}', '{amount}'])
    const ru = review.getByLabelText('Text (Russian)') as HTMLTextAreaElement
    fireEvent.change(ru, { target: { value: 'Слов: !' } })
    ru.focus()
    ru.setSelectionRange(6, 6) // between "Слов: " and "!"
    fireEvent.click(review.getByRole('button', { name: 'Insert {count}' }))
    expect(ru.value).toBe('Слов: {count}!')
    await waitFor(() => expect(ru.selectionStart).toBe('Слов: {count}'.length)) // the cursor is behind the chip
    fireEvent.click(review.getByRole('button', { name: 'Insert {name}' }))
    expect(ru.value).toBe('Слов: {count}{name}!')
    // A selection is replaced.
    ru.setSelectionRange(0, 5)
    fireEvent.click(review.getByRole('button', { name: 'Insert {name}' }))
    expect(ru.value.startsWith('{name}')).toBe(true)
  })

  it('a chip goes into the language field that has the focus', async () => {
    renderTab()
    const c = await card('purchase_paid')
    fireEvent.click(c.getByRole('button', { name: 'Other languages' }))
    const uz = c.getByLabelText('Uzbek') as HTMLTextAreaElement
    uz.focus()
    fireEvent.click(c.getByRole('button', { name: 'Insert {code}' }))
    expect(uz.value).toBe('{code}')
    expect((c.getByLabelText('Text (Russian)') as HTMLTextAreaElement).value).toBe('Оплата {code}: {amount}')
  })

  it('server errors show on the field they belong to', async () => {
    renderTab()
    const c = await card('review_reminder')
    vi.mocked(telegramRulesApi.update).mockRejectedValueOnce(fail(400, 'invalid_placeholder', 'ru'))
    fireEvent.click(c.getByRole('button', { name: 'Save' }))
    expect((await c.findByTestId('rule-error-review_reminder-ru')).textContent).toBe('Unknown placeholder. You can use: {name} {count}')

    vi.mocked(telegramRulesApi.update).mockRejectedValueOnce(fail(400, 'invalid_placeholder', 'uz'))
    fireEvent.click(c.getByRole('button', { name: 'Save' }))
    expect((await c.findByTestId('rule-error-review_reminder-uz')).textContent).toContain('Unknown placeholder') // the block opens
    expect(c.queryByTestId('rule-error-review_reminder-ru')).toBeNull()

    vi.mocked(telegramRulesApi.update).mockRejectedValueOnce(fail(400, 'invalid_send_at', 'send_at'))
    fireEvent.click(c.getByRole('button', { name: 'Save' }))
    expect((await c.findByTestId('rule-error-review_reminder-send_at')).textContent).toContain('nothing is sent at night')

    vi.mocked(telegramRulesApi.update).mockRejectedValueOnce(fail(400, 'invalid_button', 'button'))
    fireEvent.click(c.getByRole('button', { name: 'Save' }))
    expect((await c.findByTestId('rule-error-review_reminder-button')).textContent).toBe('The link must start with https://')

    vi.mocked(telegramRulesApi.update).mockRejectedValueOnce(fail(500, 'boom'))
    fireEvent.click(c.getByRole('button', { name: 'Save' }))
    expect((await c.findByRole('alert')).textContent).toBe('server says no')
  })

  it('the button needs an https link when it has a label', async () => {
    renderTab()
    const c = await card('review_reminder')
    fireEvent.change(c.getByLabelText('Link (https)'), { target: { value: 'http://yodla.fun' } })
    expect((c.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(c.getByLabelText('Button text'), { target: { value: '' } }) // no label: no button
    expect((c.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('the preview number and the last run (daily rules only)', async () => {
    vi.mocked(telegramRulesApi.list).mockResolvedValue([
      rule('review_reminder', { last_run_on: '2026-11-10', last_sent: 38 }), rule('comeback'), rule('purchase_paid'), rule('purchase_rejected'),
    ])
    renderTab()
    const c = await card('review_reminder')
    await waitFor(() => expect(screen.getByTestId('rule-preview-review_reminder').textContent).toBe('Will reach today: 42'))
    expect(screen.getByTestId('rule-last-review_reminder').textContent).toBe('Last run: 10 November · sent 38')
    expect(screen.getByTestId('rule-last-comeback').textContent).toBe('Has not run yet')
    expect(telegramRulesApi.preview).toHaveBeenCalledWith('review_reminder')
    expect(telegramRulesApi.preview).not.toHaveBeenCalledWith('purchase_paid')
    expect(c.queryByText(/Will reach/)).toBeTruthy()
    expect(screen.queryByTestId('rule-preview-purchase_paid')).toBeNull()
  })

  it('"Send myself a sample" calls the test; without Telegram it says what to do', async () => {
    renderTab()
    const c = await card('purchase_paid')
    fireEvent.click(c.getByRole('button', { name: 'Send myself a sample' }))
    await waitFor(() => expect(telegramRulesApi.test).toHaveBeenCalledWith('purchase_paid'))
    expect(await c.findByText('The sample was sent to Telegram')).toBeTruthy()
    vi.mocked(telegramRulesApi.test).mockRejectedValueOnce(fail(400, 'telegram_not_linked'))
    fireEvent.click(c.getByRole('button', { name: 'Send myself a sample' }))
    expect((await c.findByRole('alert')).textContent).toBe('Your Telegram is not connected: connect it in your profile.')
  })

  it('the history labels an automatic run with its rule', async () => {
    const auto = (over: Partial<TelegramBroadcast>): TelegramBroadcast => ({
      id: 9, kind: 'auto:comeback', target: 'all', text: { ru: 'Давно не виделись', uz: null, en: null }, button: null, status: 'done', total: 5,
      sent: 5, failed: 0, blocked: 0, created_at: '2026-11-10T09:00:00Z', finished_at: null, ...over,
    })
    vi.mocked(telegramBroadcastApi.list).mockResolvedValue([auto({}), auto({ id: 8, kind: 'manual' })])
    renderTab()
    expect((await screen.findByTestId('broadcast-rule-9')).textContent).toBe('auto: Come back')
    expect(screen.queryByTestId('broadcast-rule-8')).toBeNull()
    expect(screen.getByTestId('broadcast-8').textContent).toContain('to everyone')
  })
})
