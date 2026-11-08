import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { adminApi, adminSupportApi, meApi, type ChatMessage, type SupportThread } from '../api/endpoints'
import { AdminPage } from './AdminPage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    adminApi: {
      users: vi.fn(async () => []), stats: vi.fn(), feedback: vi.fn(async () => ({ average: 0, count: 0, items: [] })),
      telegramStats: vi.fn(async () => ({ total_users: 0, connected: 0, percent: 0, connected_last_7d: 0 })),
      wordCheckStatus: vi.fn(), startWordCheck: vi.fn(), pushStats: vi.fn(async () => ({ devices: 0, users: 0 })),
      purchases: vi.fn(async () => []),
    },
    adminSupportApi: { threads: vi.fn(), messages: vi.fn(), post: vi.fn(), image: vi.fn(), read: vi.fn() },
  }
})

const thread = (over: Partial<SupportThread>): SupportThread => ({
  id: 1, user_id: 'u1', user_email: 'anna@x.co', unread: 0, preview: 'Hello', last_message_at: new Date().toISOString(),
  created_at: '2026-11-08T10:00:00Z', ...over,
})
const message = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 1, author: 'user', mine: false, body: 'Hello', has_image: false, hidden: false, hidden_reason: null, event: null,
  created_at: '2026-11-08T10:00:00Z', ...over,
})

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(meApi.get).mockResolvedValue({ id: 'a', email: 'admin@x.co', role: 'admin' })
  vi.mocked(adminApi.stats).mockResolvedValue({
    total_users: 0, banned_users: 0, new_users_7d: 0, active_users_7d: 0, total_words: 0,
    total_reviews: 0, training_sessions: 0, total_stories: 0, stories_30d: 0,
  })
  vi.mocked(adminApi.wordCheckStatus).mockResolvedValue({ running: false, total: 0, processed: 0, suggestions: 0, confirmed: 0, unknown: 0, failed: 0, started_at: null, finished_at: null })
  vi.mocked(adminSupportApi.threads).mockResolvedValue([
    thread({ id: 1, user_email: 'anna@x.co', unread: 2, preview: 'The photos do not come' }),
    thread({ id: 2, user_email: 'bob@x.co', unread: 0, preview: '[скрыто]' }),
  ])
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter><AdminPage /></MemoryRouter></QueryClientProvider>)
}
const supportTab = () => screen.getByRole('button', { name: /^Support/ })

describe('AdminPage: the Support tab', () => {
  it('the tab shows how many user messages are unread; the overview is the default', async () => {
    renderPage()
    await waitFor(() => expect(supportTab().textContent).toBe('Support · 2'))
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('region', { name: 'Support' })).toBeNull()
  })

  it('lists the threads with unread badges and the last message', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /^Support/ }))
    const anna = await screen.findByTestId('support-thread-1')
    expect(anna.textContent).toContain('anna@x.co')
    expect(anna.textContent).toContain('The photos do not come')
    expect(within(anna).getByTestId('support-unread-1').textContent).toBe('2 · New: 2')
    expect(screen.queryByTestId('support-unread-2')).toBeNull()
    expect(screen.getByTestId('support-thread-2').textContent).toContain('[скрыто]')
    expect(screen.getByText('Choose a conversation in the list.')).toBeTruthy()
  })

  it('opening a thread shows it with the admin composer and marks it read up to the newest message', async () => {
    vi.mocked(adminSupportApi.messages).mockResolvedValue({
      thread: thread({ id: 1, unread: 2 }),
      messages: [message({ id: 10, body: 'The photos do not come' }), message({ id: 11, body: 'Since yesterday' })],
    })
    // As on the server: after the read, the list reports the thread as read.
    vi.mocked(adminSupportApi.read).mockImplementation(async () => {
      vi.mocked(adminSupportApi.threads).mockResolvedValue([thread({ id: 1, unread: 0 }), thread({ id: 2, user_email: 'bob@x.co' })])
      return thread({ id: 1, unread: 0 })
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /^Support/ }))
    fireEvent.click(await screen.findByTestId('support-thread-1'))

    const log = await screen.findByRole('log')
    expect(await within(log).findByText('Since yesterday')).toBeTruthy()
    expect(within(log).getAllByText('User').length).toBe(2)
    expect(adminSupportApi.messages).toHaveBeenCalledWith(1, 0)
    expect(screen.getByRole('textbox', { name: 'Describe your question…' })).toBeTruthy()

    await waitFor(() => expect(adminSupportApi.read).toHaveBeenCalledWith(1, 11))
    await waitFor(() => expect(screen.queryByTestId('support-unread-1')).toBeNull()) // the list is re-read
    await waitFor(() => expect(supportTab().textContent).toBe('Support'))
  })

  it('a hidden message: the badge, the text behind "Show"', async () => {
    vi.mocked(adminSupportApi.messages).mockResolvedValue({
      thread: thread({ id: 2 }),
      messages: [message({ id: 20, hidden: true, hidden_reason: 'card_number', body: 'card 8600 0000 0000 0000' })],
    })
    vi.mocked(adminSupportApi.read).mockResolvedValue(thread({ id: 2 }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /^Support/ }))
    fireEvent.click(await screen.findByTestId('support-thread-2'))
    expect((await screen.findByTestId('chat-hidden-badge')).textContent).toBe('Hidden: looks like a card number')
    expect(screen.queryByText('card 8600 0000 0000 0000')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(screen.getByText('card 8600 0000 0000 0000')).toBeTruthy()
  })

  it('no conversations yet: says so', async () => {
    vi.mocked(adminSupportApi.threads).mockResolvedValue([])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /^Support/ }))
    expect(await screen.findByText('No conversations yet.')).toBeTruthy()
  })
})
