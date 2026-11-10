import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { AxiosError, type AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { adminApi, adminChatApi, meApi, type AdminPurchaseRequest } from '../api/endpoints'
import { AdminPage } from './AdminPage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    adminApi: {
      users: vi.fn(), stats: vi.fn(), telegramStats: vi.fn(async () => ({ total_users: 0, connected: 0, percent: 0, connected_last_7d: 0 })), feedback: vi.fn(), wordCheckStatus: vi.fn(), startWordCheck: vi.fn(),
      pushStats: vi.fn(), sendPush: vi.fn(), purchases: vi.fn(), approvePurchase: vi.fn(), rejectPurchase: vi.fn(),
    },
    adminChatApi: { messages: vi.fn(), post: vi.fn(), image: vi.fn() },
  }
})

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
const purchase = (over: Partial<AdminPurchaseRequest>): AdminPurchaseRequest => ({
  id: 'p1', code: 'YD-1234', pack_id: 'photo_35', amount: 35, price_uzs: 25000, status: 'pending',
  created_at: minutesAgo(5), user_id: 'u1', user_email: 'anna@x.co', decided_at: null, decided_by: null, unread: 0, ...over,
})
const PENDING = [
  purchase({}),
  purchase({ id: 'p2', code: 'YD-0042', pack_id: 'photo_100', amount: 100, price_uzs: 59000, user_email: 'bob@x.co', created_at: minutesAgo(120) }),
]
const fail = (status: number, data: unknown) =>
  new AxiosError('x', String(status), undefined, undefined, { status, data, headers: {}, statusText: '', config: {} as never } as AxiosResponse)

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(meApi.get).mockResolvedValue({ id: 'me-id', email: 'admin@x.co', role: 'admin' })
  vi.mocked(adminApi.users).mockResolvedValue([])
  vi.mocked(adminApi.stats).mockResolvedValue({
    total_users: 0, banned_users: 0, new_users_7d: 0, active_users_7d: 0, total_words: 0,
    total_reviews: 0, training_sessions: 0, total_stories: 0, stories_30d: 0,
  })
  vi.mocked(adminApi.feedback).mockResolvedValue({ average: 0, count: 0, items: [] })
  vi.mocked(adminApi.wordCheckStatus).mockResolvedValue({ running: false, total: 0, processed: 0, suggestions: 0, confirmed: 0, unknown: 0, failed: 0, started_at: null, finished_at: null })
  vi.mocked(adminApi.pushStats).mockResolvedValue({ devices: 0, users: 0 })
  vi.mocked(adminApi.purchases).mockResolvedValue(PENDING)
  vi.mocked(adminApi.approvePurchase).mockResolvedValue(purchase({ status: 'paid' }))
  vi.mocked(adminApi.rejectPurchase).mockResolvedValue(purchase({ id: 'p2', status: 'rejected' }))
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.useRealTimers() })

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter><AdminPage /></MemoryRouter></QueryClientProvider>)
}
const block = () => screen.getByRole('region', { name: /Purchase requests/ })
const row = (id: string) => screen.getByTestId(`purchase-${id}`)
const text = (el: Element) => (el.textContent ?? '').replace(/\s/g, ' ')

describe('AdminPage: purchase requests', () => {
  it('lists the pending requests: email, code, pack, price, how long ago; a counter in the header', async () => {
    renderPage()
    await screen.findByTestId('purchase-p1')
    expect(adminApi.purchases).toHaveBeenCalledWith('pending')
    expect(within(block()).getByTestId('purchases-count').textContent).toBe('2')
    const first = text(row('p1'))
    for (const part of ['anna@x.co', 'YD-1234', '35 photos', '25,000 UZS', '5 minutes ago']) expect(first).toContain(part)
    const second = text(row('p2'))
    for (const part of ['bob@x.co', 'YD-0042', '100 photos', '59,000 UZS', '2 hours ago']) expect(second).toContain(part)
    // above the users table
    const users = screen.getByRole('heading', { name: /^Users/ })
    expect(block().compareDocumentPosition(users) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('approving takes two taps: the first one asks "Sure?", the second approves and refreshes', async () => {
    renderPage()
    await screen.findByTestId('purchase-p1')
    const approve = within(row('p1')).getByRole('button', { name: 'Approve' })
    fireEvent.click(approve)
    expect(approve.textContent).toBe('Sure?')
    expect(adminApi.approvePurchase).not.toHaveBeenCalled()

    vi.mocked(adminApi.purchases).mockResolvedValue([PENDING[1]])
    vi.mocked(adminApi.users).mockClear()
    fireEvent.click(approve)
    await waitFor(() => expect(adminApi.approvePurchase).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(screen.queryByTestId('purchase-p1')).toBeNull()) // the list was re-read
    expect(adminApi.users).toHaveBeenCalled() // and the users
    expect(within(block()).getByTestId('purchases-count').textContent).toBe('1')
  })

  it('"Sure?" turns back into "Approve" after 3 s; a tap then only asks again', async () => {
    renderPage()
    await screen.findByTestId('purchase-p1')
    const approve = within(row('p1')).getByRole('button', { name: 'Approve' })
    vi.useFakeTimers()
    fireEvent.click(approve)
    expect(approve.textContent).toBe('Sure?')
    act(() => { vi.advanceTimersByTime(3000) })
    expect(approve.textContent).toBe('Approve')
    fireEvent.click(approve)
    expect(approve.textContent).toBe('Sure?')
    expect(adminApi.approvePurchase).not.toHaveBeenCalled()
  })

  it('reject works with one tap', async () => {
    renderPage()
    await screen.findByTestId('purchase-p2')
    vi.mocked(adminApi.purchases).mockResolvedValue([PENDING[0]])
    fireEvent.click(within(row('p2')).getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(adminApi.rejectPurchase).toHaveBeenCalledWith('p2'))
    await waitFor(() => expect(screen.queryByTestId('purchase-p2')).toBeNull())
    expect(adminApi.approvePurchase).not.toHaveBeenCalled()
  })

  it('409 already_decided (another admin was faster): no error, the list just refreshes', async () => {
    vi.mocked(adminApi.rejectPurchase).mockRejectedValue(fail(409, { error: 'already decided', code: 'already_decided' }))
    renderPage()
    await screen.findByTestId('purchase-p2')
    vi.mocked(adminApi.purchases).mockResolvedValue([PENDING[0]])
    fireEvent.click(within(row('p2')).getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(screen.queryByTestId('purchase-p2')).toBeNull())
    expect(within(block()).queryByRole('alert')).toBeNull()
  })

  it('other failures are shown', async () => {
    vi.mocked(adminApi.rejectPurchase).mockRejectedValue(fail(500, { error: 'internal error' }))
    renderPage()
    await screen.findByTestId('purchase-p2')
    fireEvent.click(within(row('p2')).getByRole('button', { name: 'Reject' }))
    expect((await within(block()).findByRole('alert')).textContent).toContain('internal error')
  })

  it('nothing pending: says so, no counter', async () => {
    vi.mocked(adminApi.purchases).mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('No pending requests')).toBeTruthy()
    expect(screen.queryByTestId('purchases-count')).toBeNull()
  })
})

describe('AdminPage: the chat of a purchase request', () => {
  it('"Open chat" shows the unread badge (buyer messages after the last admin read)', async () => {
    vi.mocked(adminApi.purchases).mockResolvedValue([purchase({ unread: 3 }), purchase({ id: 'p2', code: 'YD-0042', user_email: 'bob@x.co' })])
    renderPage()
    await waitFor(() => expect(row('p1')).toBeTruthy())
    expect(screen.getByTestId('unread-p1').textContent).toBe('3 · New: 3')
    expect(within(row('p1')).getByRole('button', { name: /Open chat/ })).toBeTruthy()
    expect(screen.queryByTestId('unread-p2')).toBeNull() // nothing unread: no badge
    expect(within(row('p2')).getByRole('button', { name: 'Open chat' })).toBeTruthy()
  })

  it('opens the thread in a side panel with the admin composer; closing re-reads the list (the badge)', async () => {
    vi.mocked(adminApi.purchases).mockResolvedValue([purchase({ unread: 1 })])
    vi.mocked(adminChatApi.messages).mockResolvedValue({ read_message_id: 0, other_read_message_id: 0,
      request: purchase({ unread: 1 }),
      messages: [{ id: 1, author: 'user', mine: false, body: 'Paid, receipt attached', has_image: false, hidden: false,
        hidden_reason: null, event: null, created_at: minutesAgo(1) }],
    })
    renderPage()
    await waitFor(() => expect(row('p1')).toBeTruthy())
    fireEvent.click(within(row('p1')).getByRole('button', { name: /Open chat/ }))
    const panel = await screen.findByRole('dialog', { name: 'Request chat' })
    expect(within(panel).getByText('anna@x.co')).toBeTruthy()
    expect(await within(panel).findByText('Paid, receipt attached')).toBeTruthy()
    expect(adminChatApi.messages).toHaveBeenCalledWith('p1', 0)
    expect(within(panel).getByRole('textbox', { name: 'Message…' })).toBeTruthy()

    const before = vi.mocked(adminApi.purchases).mock.calls.length
    vi.mocked(adminApi.purchases).mockResolvedValue([purchase({ unread: 0 })])
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Request chat' })).toBeNull())
    await waitFor(() => expect(vi.mocked(adminApi.purchases).mock.calls.length).toBeGreaterThan(before))
    await waitFor(() => expect(screen.queryByTestId('unread-p1')).toBeNull())
  })

  it('the list re-reads itself every 30 s, so new unread messages show up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(adminApi.purchases).mockResolvedValue([purchase({ unread: 0 })])
    renderPage()
    await waitFor(() => expect(row('p1')).toBeTruthy())
    vi.mocked(adminApi.purchases).mockResolvedValue([purchase({ unread: 2 })])
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    await waitFor(() => expect(screen.getByTestId('unread-p1')).toBeTruthy())
  })
})
