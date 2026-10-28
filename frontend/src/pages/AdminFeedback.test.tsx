import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
    adminApi: { users: vi.fn(), stats: vi.fn(), feedback: vi.fn(), wordCheckStatus: vi.fn(), startWordCheck: vi.fn() },
  }
})

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(meApi.get).mockResolvedValue({ id: 'a', email: 'admin@x.co', role: 'admin' })
  vi.mocked(adminApi.users).mockResolvedValue([])
  vi.mocked(adminApi.stats).mockResolvedValue({
    total_users: 3, banned_users: 0, new_users_7d: 1, active_users_7d: 2, total_words: 10,
    total_reviews: 20, training_sessions: 4, total_stories: 1, stories_30d: 1,
  })
  vi.mocked(adminApi.wordCheckStatus).mockResolvedValue({ running: false, total: 0, processed: 0, suggestions: 0, confirmed: 0, unknown: 0, failed: 0, started_at: null, finished_at: null })
  vi.mocked(adminApi.feedback).mockResolvedValue({
    average: 4.5, count: 2,
    items: [
      { email: 'anna@x.co', rating: 5, comment: 'Love the stories', created_at: '2026-10-28T10:00:00Z' },
      { email: 'bob@x.co', rating: 4, comment: '', created_at: '2026-10-27T10:00:00Z' },
    ],
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('AdminPage: feedback', () => {
  it('shows the average tile and the list of ratings', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={qc}><MemoryRouter><AdminPage /></MemoryRouter></QueryClientProvider>)

    expect(await screen.findByText('4.5')).toBeTruthy()
    expect(screen.getByText('Average rating')).toBeTruthy()
    expect(screen.getByText('reviews: 2')).toBeTruthy()

    const section = (await screen.findByRole('heading', { name: /Feedback/ })).closest('section') as HTMLElement
    await waitFor(() => expect(within(section).getByText('anna@x.co')).toBeTruthy())
    expect(within(section).getByText('Love the stories')).toBeTruthy()
    expect(within(section).getByText('bob@x.co')).toBeTruthy()
    expect(within(section).getByText('no comment')).toBeTruthy()
    expect(within(section).getByLabelText('5 / 5')).toBeTruthy()
  })
})
