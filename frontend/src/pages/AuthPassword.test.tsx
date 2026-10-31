import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  render(<QueryClientProvider client={qc}><MemoryRouter><AuthPage mode={mode} /></MemoryRouter></QueryClientProvider>)
}
const password = () => screen.getByPlaceholderText('Password') as HTMLInputElement
const confirm = () => screen.getByPlaceholderText('Repeat password') as HTMLInputElement
const eyes = () => screen.getAllByRole('button', { name: /password$/i })

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('password visibility', () => {
  it('the eye shows the password and its label flips; a second click hides it again', () => {
    renderPage('login')
    fireEvent.change(password(), { target: { value: 'secret123' } })
    expect(password().type).toBe('password')
    const eye = screen.getByRole('button', { name: 'Show password' })
    expect(eye.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(eye)
    expect(password().type).toBe('text')
    expect(password().value).toBe('secret123') // the value stays
    const hide = screen.getByRole('button', { name: 'Hide password' })
    expect(hide.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(hide)
    expect(password().type).toBe('password')
    expect(screen.getByRole('button', { name: 'Show password' })).toBeTruthy()
  })

  it('keeps autoComplete, and on the login form it is the current password', () => {
    renderPage('login')
    expect(password().autocomplete).toBe('current-password')
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password().autocomplete).toBe('current-password')
  })

  it('on register the two fields toggle independently', () => {
    renderPage('register')
    const [firstEye, secondEye] = eyes()
    expect(eyes()).toHaveLength(2)

    fireEvent.click(firstEye)
    expect(password().type).toBe('text')
    expect(confirm().type).toBe('password')

    fireEvent.click(secondEye)
    expect(password().type).toBe('text')
    expect(confirm().type).toBe('text')

    fireEvent.click(eyes()[0]) // hide the first again; the second stays shown
    expect(password().type).toBe('password')
    expect(confirm().type).toBe('text')
    expect(confirm().autocomplete).toBe('new-password')
  })

  it('the button does not submit the form', () => {
    renderPage('register')
    fireEvent.change(password(), { target: { value: 'secret123' } })
    fireEvent.change(confirm(), { target: { value: 'secret123' } })
    for (const eye of eyes()) {
      expect(eye.getAttribute('type')).toBe('button')
      fireEvent.click(eye)
    }
    expect(authApi.register).not.toHaveBeenCalled()
    expect(authApi.login).not.toHaveBeenCalled()
  })

  it('each eye comes right after its own input in the tab order', () => {
    renderPage('register')
    const order = Array.from(document.querySelectorAll('input, button')).filter((el) =>
      el === password() || el === confirm() || /password$/i.test(el.getAttribute('aria-label') ?? ''))
    expect(order[0]).toBe(password())
    expect(order[1].getAttribute('aria-label')).toMatch(/password/i)
    expect(order[2]).toBe(confirm())
  })
})

describe('landing text', () => {
  it('no longer promises phrase splitting or audio', async () => {
    renderPage('register')
    expect(screen.getByText(/Snap a textbook page or type a word/)).toBeTruthy()
    for (const badge of ['Textbook photo', 'Article & translation', 'Spaced repetition']) {
      expect(screen.getByText(badge)).toBeTruthy()
    }
    expect(screen.queryByText(/transcription|Audio is available/i)).toBeNull()
  })
})
