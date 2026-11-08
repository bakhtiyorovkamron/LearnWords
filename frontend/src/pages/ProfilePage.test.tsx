import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { profileApi } from '../api/endpoints'
import * as toaster from '../components/Toaster'
import { ProfilePage } from './ProfilePage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, profileApi: { get: vi.fn(), update: vi.fn() } }
})

const empty = { full_name: null, phone: null, telegram: { connected: false, username: null } }
const apiError = (code: string) => Object.assign(new Error(code), { isAxiosError: true, response: { status: 400, data: { error: code, code } } })

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><ProfilePage /></QueryClientProvider>)
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(profileApi.get).mockResolvedValue(empty)
  vi.spyOn(toaster, 'toast').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('ProfilePage', () => {
  it('shows the saved name and phone, and Telegram as not connected with a disabled button', async () => {
    vi.mocked(profileApi.get).mockResolvedValue({ ...empty, full_name: 'Anna', phone: '+998901234567' })
    renderPage()
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Anna'))
    expect((screen.getByLabelText(/Phone/) as HTMLInputElement).value).toBe('+998 90 123 45 67')
    expect(screen.getByTestId('profile-telegram').textContent).toBe('Not connected')
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('the phone is a tel input formatted as the user types, and is sent as +998XXXXXXXXX', async () => {
    vi.mocked(profileApi.update).mockResolvedValue({ ...empty, full_name: 'Anna', phone: '+998901234567' })
    renderPage()
    const name = await screen.findByLabelText('Name')
    const phone = screen.getByLabelText(/Phone/) as HTMLInputElement
    expect(phone.type).toBe('tel')
    expect(phone.placeholder).toBe('+998 90 123 45 67')
    fireEvent.change(name, { target: { value: '  Anna ' } })
    fireEvent.change(phone, { target: { value: '901234567' } })
    expect(phone.value).toBe('+998 90 123 45 67')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(profileApi.update).toHaveBeenCalledWith({ full_name: 'Anna', phone: '+998901234567' }))
    await waitFor(() => expect(toaster.toast).toHaveBeenCalledWith('Saved'))
  })

  it('shows the server error under the field it belongs to', async () => {
    vi.mocked(profileApi.update).mockRejectedValue(apiError('invalid_phone'))
    renderPage()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Anna' } })
    fireEvent.change(screen.getByLabelText(/Phone/), { target: { value: '90123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The number must look like +998 90 123 45 67.')
    expect(screen.getByLabelText(/Phone/).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).toBeNull()
    cleanup()

    vi.mocked(profileApi.update).mockRejectedValue(apiError('invalid_name'))
    renderPage()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a name of 2 to 80 characters.')
  })

  it('a connected Telegram shows the username and no connect button', async () => {
    vi.mocked(profileApi.get).mockResolvedValue({ ...empty, telegram: { connected: true, username: 'anna_k' } })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('profile-telegram').textContent).toBe('@anna_k'))
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  })
})
