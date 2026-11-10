import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { adminApi, adminSupportApi, meApi, type AdminUser, type ChatMessage, type SupportThread } from '../api/endpoints'
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
    adminSupportApi: { threads: vi.fn(), messages: vi.fn(), post: vi.fn(), image: vi.fn(), read: vi.fn(), open: vi.fn() },
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
    vi.mocked(adminSupportApi.messages).mockResolvedValue({ read_message_id: 0, other_read_message_id: 0,
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
    expect(within(log).getAllByRole('group', { name: 'User' }).length).toBe(1) // one group: close in time, one author
    expect(adminSupportApi.messages).toHaveBeenCalledWith(1, 0)
    expect(screen.getByRole('textbox', { name: 'Describe your question…' })).toBeTruthy()

    await waitFor(() => expect(adminSupportApi.read).toHaveBeenCalledWith(1, 11))
    await waitFor(() => expect(screen.queryByTestId('support-unread-1')).toBeNull()) // the list is re-read
    await waitFor(() => expect(supportTab().textContent).toBe('Support'))
  })

  it('a hidden message: the badge, the text behind "Show"', async () => {
    vi.mocked(adminSupportApi.messages).mockResolvedValue({ read_message_id: 0, other_read_message_id: 0,
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

  it('a list row: the initial, bold preview when unread, the time on the right (HH:MM today, Yesterday, else day + month)', async () => {
    const y = new Date(); y.setDate(y.getDate() - 1)
    const old = new Date(2020, 2, 5, 12)
    vi.mocked(adminSupportApi.threads).mockResolvedValue([
      thread({ id: 1, user_email: 'anna@x.co', unread: 2, preview: 'New one' }),
      thread({ id: 2, user_email: 'bob@x.co', unread: 0, preview: 'Old one', last_message_at: y.toISOString() }),
      thread({ id: 3, user_email: 'cy@x.co', unread: 0, preview: 'Older', last_message_at: old.toISOString() }),
    ])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /^Support/ }))
    const anna = await screen.findByTestId('support-thread-1')
    expect(within(anna).getByText('A')).toBeTruthy()
    expect(within(anna).getByText('New one').className).toContain('font-bold')
    expect(within(screen.getByTestId('support-thread-2')).getByText('Old one').className).not.toContain('font-bold')
    expect(within(anna).getByText(/^\d{2}:\d{2}$/)).toBeTruthy()
    expect(within(screen.getByTestId('support-thread-2')).getByText('Yesterday')).toBeTruthy()
    expect(within(screen.getByTestId('support-thread-3')).getByText(/5 Mar/)).toBeTruthy()
  })

  it('the open thread has a header with the email and a back button to the list', async () => {
    vi.mocked(adminSupportApi.messages).mockResolvedValue({ read_message_id: 0, other_read_message_id: 0,
      thread: thread({ id: 1 }), messages: [message({ id: 10 })] })
    vi.mocked(adminSupportApi.read).mockResolvedValue(thread({ id: 1 }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /^Support/ }))
    fireEvent.click(await screen.findByTestId('support-thread-1'))
    const header = await screen.findByTestId('chat-thread-header')
    expect(within(header).getByRole('heading', { name: 'anna@x.co' })).toBeTruthy()
    fireEvent.click(within(header).getByRole('button', { name: 'Back to the list' }))
    expect(screen.queryByTestId('chat-thread-header')).toBeNull()
    expect(screen.getByText('Choose a conversation in the list.')).toBeTruthy()
  })

  describe('starting a conversation with any user', () => {
    const user = (over: Partial<AdminUser>): AdminUser => ({
      id: 'u9', email: 'new@x.co', role: 'user', is_banned: false, created_at: '2026-01-01T00:00:00Z', words_count: 0,
      last_activity_at: null, ...over,
    })
    const everyone = [
      user({ id: 'u1', email: 'anna@x.co', full_name: 'Anna Petrova', phone: '+998 90 123 45 67' }),
      user({ id: 'u7', email: 'zed@x.co', full_name: null, phone: null, is_banned: true }),
      user({ id: 'u8', email: 'maria@x.co', full_name: 'Maria', phone: '+998 91 555 00 11' }),
    ]
    const emptyThread = thread({ id: 77, user_id: 'u7', user_email: 'zed@x.co', unread: 0, preview: null, last_message_at: null })

    beforeEach(() => {
      vi.mocked(adminApi.users).mockResolvedValue(everyone)
      vi.mocked(adminSupportApi.open).mockResolvedValue(emptyThread)
      vi.mocked(adminSupportApi.messages).mockResolvedValue({ read_message_id: 0, other_read_message_id: 0, thread: emptyThread, messages: [] })
      vi.mocked(adminSupportApi.read).mockResolvedValue(emptyThread)
    })
    const openPicker = async () => {
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: /^Support/ }))
      fireEvent.click(await screen.findByRole('button', { name: 'Write' }))
      return screen.findByRole('dialog', { name: 'Who to write to' })
    }
    const names = (d: HTMLElement) => within(d).queryAllByTestId(/^pick-user-/).map((b) => b.getAttribute('data-testid'))

    it('the picker lists everyone, says who already has a conversation, and marks banned users', async () => {
      const dialog = await openPicker()
      expect(within(dialog).getByText('Any user, even one who has not written yet')).toBeTruthy()
      await waitFor(() => expect(names(dialog)).toEqual(['pick-user-u1', 'pick-user-u7', 'pick-user-u8']))
      expect(within(screen.getByTestId('pick-user-u7')).getByText('zed@x.co')).toBeTruthy() // no name: the email
      expect(within(screen.getByTestId('pick-user-u7')).getByText('banned')).toBeTruthy()
      expect(within(screen.getByTestId('pick-user-u1')).getByText('Anna Petrova')).toBeTruthy()
      expect(within(screen.getByTestId('pick-user-u7')).getByText('Has not written to support yet')).toBeTruthy()
    })

    it('has-a-conversation comes from the inbox', async () => {
      vi.mocked(adminSupportApi.threads).mockResolvedValue([thread({ id: 1, user_id: 'u1', unread: 1 })])
      const dialog = await openPicker()
      await waitFor(() => expect(within(screen.getByTestId('pick-user-u1')).getByText('Has a conversation')).toBeTruthy())
      expect(dialog).toBeTruthy()
    })

    it('filters by name, email and phone, case-insensitively, on the client; nothing found says so', async () => {
      const dialog = await openPicker()
      await waitFor(() => expect(names(dialog)).toHaveLength(3))
      const search = within(dialog).getByRole('searchbox', { name: 'Name, email or phone' })
      expect(search.className).toContain('text-base') // 16px: no iOS zoom
      fireEvent.change(search, { target: { value: 'PETROVA' } })
      expect(names(dialog)).toEqual(['pick-user-u1'])
      fireEvent.change(search, { target: { value: 'ZED@' } })
      expect(names(dialog)).toEqual(['pick-user-u7'])
      fireEvent.change(search, { target: { value: '91 555' } })
      expect(names(dialog)).toEqual(['pick-user-u8'])
      fireEvent.change(search, { target: { value: '998901234567' } })
      expect(names(dialog)).toEqual(['pick-user-u1'])
      fireEvent.change(search, { target: { value: 'nobody' } })
      expect(within(dialog).getByText('No one found')).toBeTruthy()
      expect(adminApi.users).toHaveBeenCalledTimes(1) // the same query, not fetched per keystroke
    })

    it('choosing a user calls open() once and shows that thread: empty text and a working composer', async () => {
      const dialog = await openPicker()
      fireEvent.click(await within(dialog).findByTestId('pick-user-u7'))
      await waitFor(() => expect(adminSupportApi.open).toHaveBeenCalledTimes(1))
      expect(vi.mocked(adminSupportApi.open).mock.calls[0][0]).toBe('u7')
      expect(await screen.findByTestId('chat-thread-header')).toBeTruthy()
      expect(within(screen.getByTestId('chat-thread-header')).getByRole('heading', { name: 'zed@x.co' })).toBeTruthy()
      expect(screen.queryByRole('dialog', { name: 'Who to write to' })).toBeNull()
      expect((await screen.findByTestId('chat-empty')).textContent).toBe('Write first. The user will see a badge and get a notification.')
      expect(adminSupportApi.messages).toHaveBeenCalledWith(77, 0)
      expect((screen.getByRole('textbox', { name: 'Describe your question…' }) as HTMLTextAreaElement).disabled).toBe(false)
    })

    it('after the first message the threads list is read again (the thread appears in the inbox)', async () => {
      const sent = message({ id: 5, author: 'admin', mine: true, body: 'Hello!' })
      vi.mocked(adminSupportApi.post).mockResolvedValue(sent)
      const dialog = await openPicker()
      fireEvent.click(await within(dialog).findByTestId('pick-user-u7'))
      await screen.findByTestId('chat-empty')
      await waitFor(() => expect(adminSupportApi.threads).toHaveBeenCalled())
      const before = vi.mocked(adminSupportApi.threads).mock.calls.length
      vi.mocked(adminSupportApi.messages).mockResolvedValue({ read_message_id: 5, other_read_message_id: 0, thread: emptyThread, messages: [sent] })
      vi.mocked(adminSupportApi.threads).mockResolvedValue([thread({ id: 77, user_id: 'u7', user_email: 'zed@x.co', preview: 'Hello!' }), ...(await adminSupportApi.threads())])
      fireEvent.change(screen.getByRole('textbox', { name: 'Describe your question…' }), { target: { value: 'Hello!' } })
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
      await waitFor(() => expect(adminSupportApi.post).toHaveBeenCalledWith(77, { body: 'Hello!', image: null }))
      await waitFor(() => expect(vi.mocked(adminSupportApi.threads).mock.calls.length).toBeGreaterThan(before + 1))
      expect(await screen.findByTestId('support-thread-77')).toBeTruthy()
    })

    it('the user card has Write: it closes the card, switches to the support tab and opens that user\'s thread', async () => {
      vi.mocked(adminApi.users).mockResolvedValue([user({ id: 'u7', email: 'zed@x.co' })])
      renderPage()
      fireEvent.click(await screen.findByText('zed@x.co'))
      const card = await screen.findByRole('dialog')
      vi.mocked(adminApi.users).mockClear()
      fireEvent.click(within(card).getByRole('button', { name: 'Write' }))
      expect(screen.queryByRole('dialog')).toBeNull() // the card closed
      expect(await screen.findByTestId('chat-thread-header')).toBeTruthy()
      expect(supportTab().getAttribute('aria-pressed')).toBe('true')
      expect(adminSupportApi.open).toHaveBeenCalledTimes(1)
      expect(vi.mocked(adminSupportApi.open).mock.calls[0][0]).toBe('u7')
      expect((await screen.findByTestId('chat-empty')).textContent).toContain('Write first.')
    })
  })
})
