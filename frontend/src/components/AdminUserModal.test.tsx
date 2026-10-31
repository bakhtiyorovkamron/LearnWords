import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { adminApi, type AdminUser, type FeatureState } from '../api/endpoints'
import * as toaster from './Toaster'
import { AdminUserModal } from './AdminUserModal'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, adminApi: { userFeatures: vi.fn(), setUserFeature: vi.fn(), sendPush: vi.fn() } }
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
  feat({ feature: 'photo_import', daily_limit: 6, default_limit: 10, limit_override: 6, used_today: 2, remaining: 4 }),
  feat({ feature: 'daily_story' }),
  feat({ feature: 'word_search' }),
  feat({ feature: 'story_autotranslate', enabled: false }),
]

/** What the server answers to a PUT: the effective limit and what is left follow the override. */
function serverState(f: FeatureState, body: { enabled: boolean; daily_limit: number | null }): FeatureState {
  const limit = body.daily_limit ?? f.default_limit
  return { ...f, enabled: body.enabled, limit_override: body.daily_limit, daily_limit: limit,
    remaining: limit === null ? null : Math.max(limit - f.used_today, 0) }
}

function renderModal(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><AdminUserModal user={user} onClose={onClose} /></QueryClientProvider>)
  return onClose
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(adminApi.userFeatures).mockResolvedValue(features)
  vi.mocked(adminApi.setUserFeature).mockImplementation(async (_id, feature, body) =>
    serverState(features.find((f) => f.feature === feature)!, body))
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
    expect(screen.getByRole('switch', { name: 'Textbook photo' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'Auto-translation of own stories' }).getAttribute('aria-checked')).toBe('false')
    // only the feature with a default limit has the number input
    const limit = screen.getAllByRole('spinbutton')
    expect(limit).toHaveLength(1)
    expect((limit[0] as HTMLInputElement).value).toBe('6')
    expect(limit[0].getAttribute('placeholder')).toBe('10') // just the default number
    expect(screen.getByTestId('usage-photo_import').textContent).toBe('Today: 2 of 6 · custom')
  })

  it('shows the user\'s feedback rating when there is one', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={qc}><AdminUserModal user={{ ...user, rating: 4 }} onClose={vi.fn()} /></QueryClientProvider>)
    expect(screen.getByText('Rating: 4')).toBeTruthy()
  })

  it('toggling a feature saves at once, keeping the limit override', async () => {
    renderModal()
    fireEvent.click(await screen.findByRole('switch', { name: 'Daily story' }))
    await waitFor(() => expect(adminApi.setUserFeature).toHaveBeenCalledWith('u1', 'daily_story', { enabled: false, daily_limit: null }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Daily story' }).getAttribute('aria-checked')).toBe('false'))
    expect(toaster.toast).toHaveBeenCalledWith('Saved')

    fireEvent.click(screen.getByRole('switch', { name: 'Textbook photo' }))
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
    fireEvent.click(await screen.findByRole('switch', { name: 'Daily story' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Daily story' }).getAttribute('aria-checked')).toBe('true')
  })

  it('closes with the button and with Esc', async () => {
    const onClose = renderModal()
    await screen.findAllByRole('switch')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('AdminUserModal: the effective photo limit', () => {
  // A user without an override: the default of 10 applies, 1 photo used today.
  const plain = feat({ feature: 'photo_import', daily_limit: 10, default_limit: 10, limit_override: null, used_today: 1, remaining: 9 })
  const usage = () => screen.getByTestId('usage-photo_import').textContent
  const input = async () => (await screen.findByRole('spinbutton')) as HTMLInputElement

  beforeEach(() => {
    vi.mocked(adminApi.userFeatures).mockResolvedValue([plain, feat({ feature: 'daily_story' })])
    vi.mocked(adminApi.setUserFeature).mockImplementation(async (_id, _feature, body) => serverState(plain, body))
  })

  it('without an override: "Today: 1 of 10 · default", an empty input with the placeholder 10, no Reset', async () => {
    renderModal()
    const field = await input()
    expect(usage()).toBe('Today: 1 of 10 · default')
    expect(field.value).toBe('')
    expect(field.placeholder).toBe('10')
    expect(field.className).toContain('w-24')
    expect(screen.getByLabelText('Daily limit')).toBe(field)
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull()
  })

  it('typing 15 saves 15; the row reads "of 15 · custom" and a Reset button appears', async () => {
    renderModal()
    const field = await input()
    fireEvent.change(field, { target: { value: '15' } })
    fireEvent.blur(field)
    await waitFor(() => expect(adminApi.setUserFeature).toHaveBeenCalledWith('u1', 'photo_import', { enabled: true, daily_limit: 15 }))
    await waitFor(() => expect(usage()).toBe('Today: 1 of 15 · custom'))
    expect((await input()).value).toBe('15')
    expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy()
  })

  it('Reset sends null and the row switches back to the default', async () => {
    vi.mocked(adminApi.userFeatures).mockResolvedValue([{ ...plain, limit_override: 15, daily_limit: 15, remaining: 14 }, feat({ feature: 'daily_story' })])
    renderModal()
    await waitFor(() => expect(usage()).toBe('Today: 1 of 15 · custom'))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(adminApi.setUserFeature).toHaveBeenCalledWith('u1', 'photo_import', { enabled: true, daily_limit: null }))
    await waitFor(() => expect(usage()).toBe('Today: 1 of 10 · default'))
    expect((await input()).value).toBe('')
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull()
  })

  it('a failed save puts the old value back and shows the error', async () => {
    vi.mocked(adminApi.setUserFeature).mockRejectedValue(new Error('boom'))
    renderModal()
    const field = await input()
    fireEvent.change(field, { target: { value: '15' } })
    fireEvent.blur(field)
    expect(await screen.findByRole('alert')).toBeTruthy()
    await waitFor(() => expect(field.value).toBe(''))
    expect(usage()).toBe('Today: 1 of 10 · default')
  })

  it('the unlimited features have no usage line and no input', async () => {
    renderModal()
    await input()
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
    expect(screen.queryByTestId('usage-daily_story')).toBeNull()
  })
})

describe('AdminUserModal: push devices', () => {
  const renderWith = (push_devices: number) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={qc}><AdminUserModal user={{ ...user, push_devices }} onClose={vi.fn()} /></QueryClientProvider>)
  }

  it('shows the device count, and a test button only when there are devices', () => {
    renderWith(0)
    expect(screen.getByText('Devices with notifications: 0')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send a test' })).toBeNull()
    cleanup()
    renderWith(2)
    expect(screen.getByText('Devices with notifications: 2')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send a test' })).toBeTruthy()
  })

  it('"Send a test" sends the fixed test notification to this user only and shows the result', async () => {
    vi.mocked(adminApi.sendPush).mockResolvedValue({ sent: 2, failed: 0, removed: 0, users: 1 })
    renderWith(2)
    fireEvent.click(screen.getByRole('button', { name: 'Send a test' }))
    await waitFor(() => expect(adminApi.sendPush).toHaveBeenCalledWith({
      target: 'users', user_ids: ['u1'], title: 'yodla', body: 'Test notification',
    }))
    await waitFor(() => expect(toaster.toast).toHaveBeenCalledWith('Sent: 2, failed: 0, expired removed: 0'))
  })
})
