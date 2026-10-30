import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { adminApi, meApi, type AdminUser } from '../api/endpoints'
import { AdminPage } from './AdminPage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    adminApi: {
      users: vi.fn(), stats: vi.fn(), feedback: vi.fn(), wordCheckStatus: vi.fn(), startWordCheck: vi.fn(),
      pushStats: vi.fn(), sendPush: vi.fn(),
    },
  }
})

const user = (id: string, email: string, push_devices?: number): AdminUser => ({
  id, email, role: 'user', is_banned: false, created_at: '2026-01-01T00:00:00Z', words_count: 0, last_activity_at: null, push_devices,
})
const USERS = [user('u1', 'anna@x.co', 2), user('u2', 'bob@x.co', 1), user('u3', 'carol@x.co', 0), user('u4', 'dave@x.co')]
const RESULT = { sent: 2, failed: 1, removed: 1, users: 2 }

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(meApi.get).mockResolvedValue({ id: 'me-id', email: 'admin@x.co', role: 'admin' })
  vi.mocked(adminApi.users).mockResolvedValue(USERS)
  vi.mocked(adminApi.stats).mockResolvedValue({
    total_users: 3, banned_users: 0, new_users_7d: 1, active_users_7d: 2, total_words: 10,
    total_reviews: 20, training_sessions: 4, total_stories: 1, stories_30d: 1,
  })
  vi.mocked(adminApi.feedback).mockResolvedValue({ average: 0, count: 0, items: [] })
  vi.mocked(adminApi.wordCheckStatus).mockResolvedValue({ running: false, total: 0, processed: 0, suggestions: 0, confirmed: 0, unknown: 0, failed: 0, started_at: null, finished_at: null })
  vi.mocked(adminApi.pushStats).mockResolvedValue({ devices: 3, users: 2 })
  vi.mocked(adminApi.sendPush).mockResolvedValue(RESULT)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter><AdminPage /></MemoryRouter></QueryClientProvider>)
}
const titleField = () => screen.findByLabelText('Title') as Promise<HTMLInputElement>
const bodyField = () => screen.getByLabelText('Text') as HTMLTextAreaElement
const sendButton = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
const RESULT_LINE = 'Sent: 2, failed: 1, expired removed: 1'

async function fill(title = 'Hello', body = 'World') {
  fireEvent.change(await titleField(), { target: { value: title } })
  fireEvent.change(bodyField(), { target: { value: body } })
}
/** The panel's list of users (the users table below has the same emails). */
const picker = () => screen.getByTestId('push-picker')

describe('AdminPage: push notifications', () => {
  it('shows the number of subscribed devices and has no link field', async () => {
    renderPage()
    expect(await screen.findByText('Subscribed devices: 3')).toBeTruthy()
    expect(screen.queryByLabelText('Link on tap')).toBeNull()
    expect(screen.queryByDisplayValue('/cards')).toBeNull()
    expect((screen.getByLabelText('Only me (test)') as HTMLInputElement).checked).toBe(true)
  })

  it('both texts are needed and capped at 60 and 200 characters', async () => {
    renderPage()
    const title = await titleField()
    expect(sendButton().disabled).toBe(true)
    fireEvent.change(title, { target: { value: 'x'.repeat(80) } })
    expect(title.value).toHaveLength(60)
    expect(screen.getByText('60/60')).toBeTruthy()
    expect(sendButton().disabled).toBe(true) // no text yet
    fireEvent.change(bodyField(), { target: { value: 'y'.repeat(300) } })
    expect(bodyField().value).toHaveLength(200)
    expect(sendButton().disabled).toBe(false)
  })

  it('"only me" sends {target: "me"} with no confirmation and no url, and shows the result line', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    renderPage()
    await fill(' Hello ', ' Test ')
    fireEvent.click(sendButton())
    await waitFor(() => expect(adminApi.sendPush).toHaveBeenCalledWith({ target: 'me', title: 'Hello', body: 'Test' }))
    expect(confirm).not.toHaveBeenCalled()
    expect(await screen.findByText(RESULT_LINE)).toBeTruthy()
  })

  it('"all subscribers" asks for confirmation with the device count; No sends nothing, Yes sends {target: "all"}', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()
    await fill('News', 'Something new')
    fireEvent.click(screen.getByLabelText('All subscribers'))
    await screen.findByText('Subscribed devices: 3')

    fireEvent.click(sendButton())
    expect(confirm).toHaveBeenCalledWith('Send to all devices (3)?')
    expect(adminApi.sendPush).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    fireEvent.click(sendButton())
    await waitFor(() => expect(adminApi.sendPush).toHaveBeenCalledWith({ target: 'all', title: 'News', body: 'Something new' }))
    expect(await screen.findByText(RESULT_LINE)).toBeTruthy()
  })

  it('a server error is shown', async () => {
    vi.mocked(adminApi.sendPush).mockRejectedValue(new Error('push is down'))
    renderPage()
    await fill('T', 'B')
    fireEvent.click(sendButton())
    expect(await screen.findByText('push is down')).toBeTruthy()
  })
})

describe('AdminPage: push to chosen users', () => {
  async function choose() {
    renderPage()
    await fill()
    fireEvent.click(screen.getByLabelText('Choose users'))
    return within(await screen.findByTestId('push-picker'))
  }

  it('lists only users that have devices, with their device counts', async () => {
    const list = await choose()
    expect(list.getByText('anna@x.co')).toBeTruthy()
    expect(list.getByText('bob@x.co')).toBeTruthy()
    expect(list.queryByText('carol@x.co')).toBeNull() // 0 devices
    expect(list.queryByText('dave@x.co')).toBeNull() // no count at all
    expect(list.getByText('📱 2')).toBeTruthy()
    expect(list.getByText('📱 1')).toBeTruthy()
  })

  it('Send is disabled until someone is selected', async () => {
    const list = await choose()
    expect(screen.getByText('Selected: 0')).toBeTruthy()
    expect(sendButton().disabled).toBe(true)
    fireEvent.click(list.getByLabelText(/anna@x.co/))
    expect(sendButton().disabled).toBe(false)
    fireEvent.click(list.getByLabelText(/anna@x.co/))
    expect(sendButton().disabled).toBe(true)
  })

  it('the search filters by email', async () => {
    const list = await choose()
    fireEvent.change(screen.getByLabelText('Search by email'), { target: { value: 'BO' } })
    expect(list.queryByText('anna@x.co')).toBeNull()
    expect(list.getByText('bob@x.co')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search by email'), { target: { value: 'nobody' } })
    expect(list.getByText('No users found')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search by email'), { target: { value: '' } })
    expect(list.getByText('anna@x.co')).toBeTruthy()
  })

  it('chips appear for the selected users and removing one deselects it; the count follows', async () => {
    const list = await choose()
    fireEvent.click(list.getByLabelText(/anna@x.co/))
    fireEvent.click(list.getByLabelText(/bob@x.co/))
    const chips = within(screen.getByTestId('push-chips'))
    expect(chips.getByRole('button', { name: /anna@x.co/ })).toBeTruthy()
    expect(chips.getByRole('button', { name: /bob@x.co/ })).toBeTruthy()
    expect(screen.getByText('Selected: 2')).toBeTruthy()

    fireEvent.click(chips.getByRole('button', { name: /anna@x.co/ }))
    expect(chips.queryByRole('button', { name: /anna@x.co/ })).toBeNull()
    expect((list.getByLabelText(/anna@x.co/) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText('Selected: 1')).toBeTruthy()
  })

  it('a chip stays while the search hides its user from the list', async () => {
    const list = await choose()
    fireEvent.click(list.getByLabelText(/anna@x.co/))
    fireEvent.change(screen.getByLabelText('Search by email'), { target: { value: 'bob' } })
    expect(list.queryByText('anna@x.co')).toBeNull()
    expect(within(screen.getByTestId('push-chips')).getByRole('button', { name: /anna@x.co/ })).toBeTruthy()
  })

  it('sends {target: "users", user_ids} with no confirmation and shows the result', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const list = await choose()
    fireEvent.click(list.getByLabelText(/bob@x.co/))
    fireEvent.click(list.getByLabelText(/anna@x.co/))
    fireEvent.click(sendButton())
    await waitFor(() => expect(adminApi.sendPush).toHaveBeenCalledWith({
      target: 'users', user_ids: ['u2', 'u1'], title: 'Hello', body: 'World',
    }))
    expect(confirm).not.toHaveBeenCalled()
    expect(await screen.findByText(RESULT_LINE)).toBeTruthy()
  })

  it('nobody has devices → the "nobody yet" text instead of the list', async () => {
    vi.mocked(adminApi.users).mockResolvedValue([user('u3', 'carol@x.co', 0), user('u4', 'dave@x.co')])
    renderPage()
    await fill()
    fireEvent.click(screen.getByLabelText('Choose users'))
    expect(await screen.findByText('Nobody has turned on notifications yet.')).toBeTruthy()
    expect(screen.queryByTestId('push-picker')).toBeNull()
    expect(screen.queryByLabelText('Search by email')).toBeNull()
    expect(sendButton().disabled).toBe(true)
  })
})
