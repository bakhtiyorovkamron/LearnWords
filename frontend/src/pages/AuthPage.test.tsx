import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { authApi } from '../api/endpoints'
import { AuthPage } from './AuthPage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, authApi: { login: vi.fn(), register: vi.fn() } }
})

function renderPage(mode: 'login' | 'register') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter><AuthPage mode={mode} /></MemoryRouter></QueryClientProvider>)
}

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(() => { cleanup(); vi.clearAllMocks() })

const fieldset = () => screen.getByRole('group', { name: 'Which language are you learning?' })
const tiles = () => within(fieldset()).getAllByRole('button')

describe('register: the learning language comes first', () => {
  it('the language fieldset is before the email and the passwords in the DOM (so it is on the first screen)', () => {
    renderPage('register')
    const email = screen.getByPlaceholderText('Email')
    const password = screen.getByPlaceholderText('Password')
    const repeat = screen.getByPlaceholderText('Repeat password')
    const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(fieldset(), email)).toBe(true)
    expect(follows(email, password)).toBe(true)
    expect(follows(password, repeat)).toBe(true)
    expect(follows(repeat, screen.getByRole('button', { name: 'Sign up' }))).toBe(true)
    // the hint stays under the tiles
    expect(fieldset().textContent).toContain('Chosen once — all words, stories and search will be in this language.')
  })

  it('4 tiles with SVG flags (no emoji), at least 48px high, German preselected with a check mark', () => {
    renderPage('register')
    expect(tiles()).toHaveLength(4)
    expect(tiles().map((b) => b.querySelector('svg[data-flag]')?.getAttribute('data-flag'))).toEqual(['de', 'en', 'fr', 'ko'])
    expect(tiles().every((b) => b.className.includes('min-h-12'))).toBe(true)
    expect(tiles().map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false'])
    const selected = tiles()[0]
    expect(selected.className).toContain('border-accent')
    expect(selected.className).toContain('bg-surface-2')
    expect(selected.querySelectorAll('svg')).toHaveLength(2) // flag + check
    expect(tiles()[1].querySelectorAll('svg')).toHaveLength(1)
    expect(tiles().map((b) => b.textContent)).toEqual(['Deutsch', 'English', 'Français', '한국어'])
  })

  it('a click moves the selection (aria-pressed and the check), and the choice is what registers', async () => {
    vi.mocked(authApi.register).mockResolvedValue(undefined as never)
    renderPage('register')
    fireEvent.click(tiles()[3])
    expect(tiles().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'true'])
    expect(tiles()[3].querySelectorAll('svg')).toHaveLength(2)
    expect(tiles()[0].querySelectorAll('svg')).toHaveLength(1)
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'secret123' } })
    fireEvent.change(screen.getByPlaceholderText('Repeat password'), { target: { value: 'secret123' } })
    fireEvent.submit(screen.getByPlaceholderText('Email').closest('form')!)
    await waitFor(() => expect(authApi.register).toHaveBeenCalledWith(expect.objectContaining({ learning_language: 'ko' })))
  })
})

describe('the header', () => {
  it.each(['login', 'register'] as const)('%s: the logo and the language switcher are in a <header> in the page flow', (mode) => {
    renderPage(mode)
    const header = document.querySelector('header')!
    expect(header).not.toBeNull()
    expect(within(header).getByRole('group', { name: 'Interface language' })).toBeTruthy()
    expect(within(header).getByText('yodla')).toBeTruthy()
    expect(header.className).toContain('safe-area-inset-top')
    expect(header.className).toContain('px-4')
    expect(header.className).not.toContain('absolute')
    expect(header.parentElement!.className).toContain('safe-area-inset-bottom')
  })

  it('one logo only', () => {
    renderPage('register')
    expect(screen.getAllByText('yodla')).toHaveLength(1)
  })

  it('phones show only the hero title: the text and the feature rows are md+', () => {
    renderPage('register')
    const title = screen.getByRole('heading', { level: 1 })
    expect(title.className).toContain('text-[26px]')
    expect(title.className).toContain('leading-tight')
    const text = screen.getByText(/Snap a textbook page/)
    expect(text.className).toContain('hidden')
    expect(text.className).toContain('md:block')
    const rows = screen.getByText('Textbook photo').closest('ul')!
    expect(rows.className).toContain('hidden')
    expect(rows.className).toContain('md:inline-flex')
  })
})

describe('login is unchanged except for the header', () => {
  it('no language question, email and password in the old order', () => {
    renderPage('login')
    expect(screen.queryByRole('group', { name: 'Which language are you learning?' })).toBeNull()
    expect(screen.queryByPlaceholderText('Repeat password')).toBeNull()
    const email = screen.getByPlaceholderText('Email')
    expect(email.compareDocumentPosition(screen.getByPlaceholderText('Password')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Log in' })).toBeTruthy()
  })
})
