import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { adminApi, meApi } from '../api/endpoints'
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

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(meApi.get).mockResolvedValue({ id: 'me-id', email: 'admin@x.co', role: 'admin' })
  vi.mocked(adminApi.users).mockResolvedValue([])
  vi.mocked(adminApi.stats).mockResolvedValue({
    total_users: 3, banned_users: 0, new_users_7d: 1, active_users_7d: 2, total_words: 10,
    total_reviews: 20, training_sessions: 4, total_stories: 1, stories_30d: 1,
  })
  vi.mocked(adminApi.feedback).mockResolvedValue({ average: 0, count: 0, items: [] })
  vi.mocked(adminApi.wordCheckStatus).mockResolvedValue({ running: false, total: 0, processed: 0, suggestions: 0, confirmed: 0, unknown: 0, failed: 0, started_at: null, finished_at: null })
  vi.mocked(adminApi.pushStats).mockResolvedValue({ devices: 3, users: 2 })
  vi.mocked(adminApi.sendPush).mockResolvedValue({ sent: 2, failed: 1, removed: 1 })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter><AdminPage /></MemoryRouter></QueryClientProvider>)
}
const titleField = () => screen.findByLabelText('Title') as Promise<HTMLInputElement>
const bodyField = () => screen.getByLabelText('Text') as HTMLTextAreaElement
const urlField = () => screen.getByLabelText('Link on tap') as HTMLInputElement
const sendButton = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement

describe('AdminPage: push notifications', () => {
  it('shows the number of subscribed devices and a form with "/cards" as the default link', async () => {
    renderPage()
    expect(await screen.findByText('Subscribed devices: 3')).toBeTruthy()
    expect((await titleField()).value).toBe('')
    expect(urlField().value).toBe('/cards')
    expect((screen.getByLabelText('Only me (test)') as HTMLInputElement).checked).toBe(true)
  })

  it('validates: both fields are needed, lengths are capped at 60 and 200, the link must be a path', async () => {
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

    for (const bad of ['https://evil', '//evil', 'cards']) {
      fireEvent.change(urlField(), { target: { value: bad } })
      expect(sendButton().disabled).toBe(true)
      expect(screen.getByRole('alert')).toBeTruthy()
    }
    fireEvent.change(urlField(), { target: { value: '/stats' } })
    expect(sendButton().disabled).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('"only me" sends to my own id, with no confirmation, and shows the result line', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    renderPage()
    fireEvent.change(await titleField(), { target: { value: ' Hello ' } })
    fireEvent.change(bodyField(), { target: { value: ' Test ' } })
    fireEvent.click(sendButton())
    await waitFor(() => expect(adminApi.sendPush).toHaveBeenCalledWith({ target: 'me-id', title: 'Hello', body: 'Test', url: '/cards' }))
    expect(confirm).not.toHaveBeenCalled()
    expect(await screen.findByText('Sent: 2, failed: 1, expired removed: 1')).toBeTruthy()
  })

  it('"all subscribers" asks for confirmation with the device count; No sends nothing, Yes sends to "all"', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()
    fireEvent.change(await titleField(), { target: { value: 'News' } })
    fireEvent.change(bodyField(), { target: { value: 'Something new' } })
    fireEvent.click(screen.getByLabelText('All subscribers'))
    await screen.findByText('Subscribed devices: 3')

    fireEvent.click(sendButton())
    expect(confirm).toHaveBeenCalledWith('Send to all devices (3)?')
    expect(adminApi.sendPush).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    fireEvent.click(sendButton())
    await waitFor(() => expect(adminApi.sendPush).toHaveBeenCalledWith({ target: 'all', title: 'News', body: 'Something new', url: '/cards' }))
    expect(await screen.findByText('Sent: 2, failed: 1, expired removed: 1')).toBeTruthy()
  })

  it('a server error is shown', async () => {
    vi.mocked(adminApi.sendPush).mockRejectedValue(new Error('push is down'))
    renderPage()
    fireEvent.change(await titleField(), { target: { value: 'T' } })
    fireEvent.change(bodyField(), { target: { value: 'B' } })
    fireEvent.click(sendButton())
    expect(await screen.findByText('push is down')).toBeTruthy()
  })
})
