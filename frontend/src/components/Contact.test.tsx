import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { CONTACT } from '../lib/contact'
import { AuthPage } from '../pages/AuthPage'
import { ContactLinks } from './ContactLinks'
import { ErrorBoundary } from './ErrorBoundary'
import { ErrorState } from './ErrorState'
import { Layout } from './Layout'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn().mockResolvedValue({ id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de' }) },
    settingsApi: { get: vi.fn().mockResolvedValue({ sounds_enabled: true }), setLanguage: vi.fn() },
    heroApi: { get: vi.fn().mockRejectedValue({ response: { status: 404 } }) },
    authApi: { login: vi.fn(), register: vi.fn(), logout: vi.fn() },
  }
})

const savedTelegram = CONTACT.telegram
beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(() => { cleanup(); CONTACT.telegram = savedTelegram })

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

function expectInstagram(a: HTMLElement) {
  expect(a.getAttribute('href')).toBe('https://instagram.com/yodla.fun')
  expect(a.getAttribute('target')).toBe('_blank')
  expect(a.getAttribute('rel')).toBe('noopener noreferrer')
}

describe('contact links', () => {
  it('ContactLinks: Instagram handle with the right href/rel; Telegram hidden while empty', () => {
    render(<ContactLinks />)
    expectInstagram(screen.getByRole('link', { name: /@yodla\.fun/ }))
    expect(screen.queryByText(/Telegram/)).toBeNull()
  })

  it('ContactLinks: Telegram shows up once configured, also in a new tab', () => {
    CONTACT.telegram = 'https://t.me/yodla_fun'
    render(<ContactLinks />)
    const tg = screen.getByRole('link', { name: /Telegram/ })
    expect(tg.getAttribute('href')).toBe('https://t.me/yodla_fun')
    expect(tg.getAttribute('rel')).toBe('noopener noreferrer')
    expect(tg.getAttribute('target')).toBe('_blank')
  })

  it('the Layout footer says "Questions or problems? Message us:" with the Instagram link', () => {
    vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, isLoading: false }) }))
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={['/x']}><Routes><Route element={<Layout />}><Route path="/x" element={<div />} /></Route></Routes></MemoryRouter>
      </QueryClientProvider>,
    )
    const footer = document.querySelector('footer') as HTMLElement
    expect(footer.textContent).toContain('Questions or problems? Message us:')
    expectInstagram(within(footer).getByRole('link', { name: /@yodla\.fun/ }))
    expect(within(footer).queryByText(/Telegram/)).toBeNull()
  })

  it('the phone "More" sheet ends with "💬 Contact us" → Instagram', () => {
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={['/x']}><Routes><Route element={<Layout />}><Route path="/x" element={<div />} /></Route></Routes></MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /More/ }))
    const sheet = document.getElementById('more-sheet') as HTMLElement
    const last = Array.from(sheet.children).at(-1) as HTMLElement
    expect(last.textContent).toContain('Contact us')
    expectInstagram(last)
  })

  it.each(['login', 'register'] as const)('the %s page: "Can\'t log in? Message us:" under the form with the Instagram link', (mode) => {
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter><AuthPage mode={mode} /></MemoryRouter>
      </QueryClientProvider>,
    )
    const line = screen.getByText(/Can't log in\? Message us:/)
    expect(line.compareDocumentPosition(document.querySelector('form')!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy() // after the form
    expectInstagram(within(line).getByRole('link', { name: /@yodla\.fun/ }))
    expect(within(line).queryByText(/Telegram/)).toBeNull()
  })

  it('a full error state shows the message and a "Report a problem" link', () => {
    render(<ErrorState error={new Error('boom')} />)
    expect(screen.getByText('boom')).toBeTruthy()
    expectInstagram(screen.getByRole('link', { name: /Report a problem/ }))
  })
})

describe('ErrorBoundary', () => {
  function Bomb(): never { throw new Error('render crash') }

  it('a render crash shows a friendly page with Reload and the contact link; the error is logged', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    render(<ErrorBoundary><Bomb /></ErrorBoundary>)
    expect(screen.getByRole('alert').textContent).toContain('Something went wrong')
    expect(screen.queryByText(/render crash/)).toBeNull() // not shown to the user
    expectInstagram(screen.getByRole('link', { name: /Report a problem/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalled()
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
    vi.unstubAllGlobals()
  })

  it('renders children when nothing crashed', () => {
    render(<ErrorBoundary><p>fine</p></ErrorBoundary>)
    expect(screen.getByText('fine')).toBeTruthy()
  })
})
