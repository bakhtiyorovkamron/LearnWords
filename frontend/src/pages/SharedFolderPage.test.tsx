import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { authApi, sharedApi } from '../api/endpoints'
import * as toaster from '../components/Toaster'
import { AuthPage } from './AuthPage'
import { SharedFolderPage } from './SharedFolderPage'

let authed = false
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: authed, isLoading: false }) }))
vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    sharedApi: { get: vi.fn(), import: vi.fn() },
    authApi: { login: vi.fn(), register: vi.fn() },
    settingsApi: { get: vi.fn().mockResolvedValue({}), setLanguage: vi.fn() },
  }
})

const TOKEN = 'aB3dE5gH7k'
const shared = {
  name: 'Tiere', color: 'amber', language: 'de', word_count: 2,
  words: [
    { word: 'der Hund', article: 'der', translation: 'dog', transcription: '', example_sentence: '', example_translation: '' },
    { word: 'Katze', article: 'die', translation: 'cat', transcription: '', example_sentence: '', example_translation: '' },
  ],
}

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}

function renderApp() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/s/${TOKEN}`]}>
        <Routes>
          <Route path="/s/:token" element={<SharedFolderPage />} />
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
          <Route path="/cards" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

let toast: ReturnType<typeof vi.spyOn>
beforeEach(async () => {
  authed = false
  sessionStorage.clear()
  await i18n.changeLanguage('en')
  toast = vi.spyOn(toaster, 'toast').mockImplementation(() => undefined)
  vi.mocked(sharedApi.get).mockResolvedValue(shared)
  vi.mocked(sharedApi.import).mockResolvedValue({ folder_id: 'new-folder', added: 2, skipped: 0 })
  vi.mocked(authApi.login).mockImplementation(async () => { authed = true; return {} as never })
  vi.mocked(authApi.register).mockImplementation(async () => { authed = true; return {} as never })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const fillAndSubmit = async (button: RegExp) => {
  fireEvent.change(await screen.findByPlaceholderText('Email'), { target: { value: 'a@b.co' } })
  fireEvent.change(document.querySelector('input[type=password]')!, { target: { value: 'password123' } })
  const confirm = document.querySelectorAll('input[type=password]')[1]
  if (confirm) fireEvent.change(confirm, { target: { value: 'password123' } })
  fireEvent.click(screen.getByRole('button', { name: button }))
}

describe('/s/:token', () => {
  it('shows the folder to a logged-out visitor: name, count, words with the article coloured', async () => {
    renderApp()
    expect(await screen.findByText('Tiere')).toBeTruthy()
    expect(screen.getByText('Words: 2')).toBeTruthy()
    expect(screen.getByText('der').className).toContain('text-der') // masculine
    expect(screen.getByText('cat')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Log in to add these words' })).toBeTruthy()
    expect(sharedApi.import).not.toHaveBeenCalled()
  })

  it('logged out → login → back on /s/:token → imports by itself, once, then opens the new folder', async () => {
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Log in to add these words' }))
    expect(await screen.findByText(/Welcome back/)).toBeTruthy() // the login page
    expect(sharedApi.import).not.toHaveBeenCalled()

    await fillAndSubmit(/^Log in$/)
    await waitFor(() => expect(sharedApi.import).toHaveBeenCalledTimes(1))
    expect(sharedApi.import).toHaveBeenCalledWith(TOKEN)
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/cards?tab=all&folder=new-folder'))
    expect(toast).toHaveBeenCalledWith('Added: 2. Already had: 0')
    expect(sessionStorage.getItem('pending-shared-import')).toBeNull() // used up: no second import
  })

  it('login → register switch keeps the destination: sign up lands back on /s/:token and imports', async () => {
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Log in to add these words' }))
    await screen.findByText(/Welcome back/)
    fireEvent.click(screen.getByRole('link', { name: 'Sign up' }))
    await screen.findByText(/Create an account/)

    await fillAndSubmit(/^Sign up$/)
    await waitFor(() => expect(sharedApi.import).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('folder=new-folder'))
  })

  it('a logged-in visitor imports with one click; a visit without a click never imports', async () => {
    authed = true
    renderApp()
    await screen.findByText('Tiere')
    expect(sharedApi.import).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add to my words' }))
    await waitFor(() => expect(sharedApi.import).toHaveBeenCalledTimes(1))
  })

  it('explains the refusals: own folder (with a link to it), other language, bad link', async () => {
    authed = true
    renderApp()
    await screen.findByText('Tiere')
    const click = () => fireEvent.click(screen.getByRole('button', { name: 'Add to my words' }))
    const reject = (status: number, data: object) =>
      vi.mocked(sharedApi.import).mockRejectedValue(Object.assign(new Error('x'), { isAxiosError: true, response: { status, data } }))

    reject(409, { code: 'own_folder', folder_id: 'mine' })
    click()
    expect(await screen.findByText(/This is your folder/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/cards?tab=all&folder=mine')

    reject(422, { code: 'lang_mismatch' })
    click()
    expect(await screen.findByText('This folder is for a different learning language')).toBeTruthy()
  })

  it('a turned-off link says so', async () => {
    vi.mocked(sharedApi.get).mockRejectedValue(Object.assign(new Error('x'), { isAxiosError: true, response: { status: 404, data: {} } }))
    renderApp()
    expect(await screen.findByText('This link is invalid or was turned off')).toBeTruthy()
  })
})
