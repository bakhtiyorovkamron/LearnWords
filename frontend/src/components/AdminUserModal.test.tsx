import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { adminApi, type AdminUser, type FeatureState } from '../api/endpoints'
import * as toaster from './Toaster'
import { AdminUserModal } from './AdminUserModal'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, adminApi: { userFeatures: vi.fn(), setUserFeature: vi.fn() } }
})

const user: AdminUser = {
  id: 'u1', email: 'anna@example.com', role: 'user', is_banned: false,
  created_at: '2026-01-05T10:00:00Z', words_count: 42, last_activity_at: null,
}
const feat = (over: Partial<FeatureState>): FeatureState => ({
  feature: 'daily_story', enabled: true, daily_limit: null, default_limit: null, limit_override: null,
  used_today: 0, remaining: null, ...over,
})
const features: FeatureState[] = [
  feat({ feature: 'photo_import', daily_limit: 4, default_limit: 4, limit_override: 6, used_today: 2, remaining: 2 }),
  feat({ feature: 'daily_story' }),
  feat({ feature: 'word_search' }),
  feat({ feature: 'story_autotranslate', enabled: false }),
]

function renderModal(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><AdminUserModal user={user} onClose={onClose} /></QueryClientProvider>)
  return onClose
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(adminApi.userFeatures).mockResolvedValue(features)
  vi.mocked(adminApi.setUserFeature).mockImplementation(async (_id, feature, body) =>
    ({ ...features.find((f) => f.feature === feature)!, enabled: body.enabled, limit_override: body.daily_limit }))
  vi.spyOn(toaster, 'toast').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('AdminUserModal', () => {
  it('shows the account facts and one row per feature', async () => {
    renderModal()
    expect(screen.getByText('anna@example.com')).toBeTruthy()
    expect(screen.getByText('Words: 42')).toBeTruthy()
    expect(screen.getByText('Last active: never')).toBeTruthy()
    expect(screen.getByText(/^Registered: /)).toBeTruthy()
    expect(await screen.findAllByRole('switch')).toHaveLength(4)
    expect(screen.getByRole('switch', { name: '📷 Textbook photo' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: '✍️ Auto-translation of own stories' }).getAttribute('aria-checked')).toBe('false')
    // only the feature with a default limit has the number input
    const limit = screen.getAllByRole('spinbutton')
    expect(limit).toHaveLength(1)
    expect((limit[0] as HTMLInputElement).value).toBe('6')
    expect(limit[0].getAttribute('placeholder')).toBe('default: 4')
    expect(screen.getByText('today: 2')).toBeTruthy()
  })

  it('shows the user\'s feedback rating when there is one', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={qc}><AdminUserModal user={{ ...user, rating: 4 }} onClose={vi.fn()} /></QueryClientProvider>)
    expect(screen.getByText('Rating: 4 ⭐')).toBeTruthy()
  })

  it('toggling a feature saves at once, keeping the limit override', async () => {
    renderModal()
    fireEvent.click(await screen.findByRole('switch', { name: '📖 Daily story' }))
    await waitFor(() => expect(adminApi.setUserFeature).toHaveBeenCalledWith('u1', 'daily_story', { enabled: false, daily_limit: null }))
    await waitFor(() => expect(screen.getByRole('switch', { name: '📖 Daily story' }).getAttribute('aria-checked')).toBe('false'))
    expect(toaster.toast).toHaveBeenCalledWith('Saved')

    fireEvent.click(screen.getByRole('switch', { name: '📷 Textbook photo' }))
    await waitFor(() => expect(adminApi.setUserFeature).toHaveBeenCalledWith('u1', 'photo_import', { enabled: false, daily_limit: 6 }))
  })

  it('an empty limit is sent as null (= the default); a number as a number', async () => {
    renderModal()
    const input = (await screen.findByRole('spinbutton')) as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    await waitFor(() => expect(adminApi.setUserFeature).toHaveBeenCalledWith('u1', 'photo_import', { enabled: true, daily_limit: null }))

    fireEvent.change(input, { target: { value: '9' } })
    fireEvent.blur(input)
    await waitFor(() => expect(adminApi.setUserFeature).toHaveBeenCalledWith('u1', 'photo_import', { enabled: true, daily_limit: 9 }))
  })

  it('a failed save shows the error and keeps the old state', async () => {
    vi.mocked(adminApi.setUserFeature).mockRejectedValue(new Error('boom'))
    renderModal()
    fireEvent.click(await screen.findByRole('switch', { name: '📖 Daily story' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('switch', { name: '📖 Daily story' }).getAttribute('aria-checked')).toBe('true')
  })

  it('closes with the button and with Esc', async () => {
    const onClose = renderModal()
    await screen.findAllByRole('switch')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
