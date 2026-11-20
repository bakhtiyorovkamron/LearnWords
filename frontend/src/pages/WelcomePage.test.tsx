import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { meApi, profileApi, type Me, type Profile } from '../api/endpoints'
import { WelcomePage } from './WelcomePage'
import { Layout } from '../components/Layout'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn(), setLearningLanguage: vi.fn() },
    profileApi: { get: vi.fn(), update: vi.fn() },
    settingsApi: { get: vi.fn().mockRejectedValue(new Error('no')) },
    heroApi: { ...mod.heroApi, get: vi.fn().mockRejectedValue(new Error('no')) },
  }
})

const tgMe = (needs: boolean): Me => ({ id: 'u', email: 'tg777@telegram.yodla.fun', role: 'user', learning_language: 'de', needs_language: needs })
const profile = (fullName: string | null): Profile => ({
  full_name: fullName, phone: null, words: { count: 0, limit: null },
  telegram: { connected: true, notifications: true, username: 'anna_k', available: true, bonus_offer: 0, bonus: 0 },
} as Profile)

function renderApp(at: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="/welcome" element={<WelcomePage />} />
          <Route element={<Layout />}>
            <Route path="/" element={<div>home page</div>} />
            <Route path="/words" element={<div>words page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(profileApi.get).mockResolvedValue(profile('Anna Karimova'))
})
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear() })

describe('WelcomePage', () => {
  it('greets by the Telegram name and asks only for the learning language', async () => {
    vi.mocked(meApi.get).mockResolvedValue(tgMe(true))
    renderApp('/welcome')
    expect(await screen.findByRole('heading', { name: 'Hi, Anna Karimova!' })).toBeTruthy()
    expect(screen.getByText('Your account was created with Telegram. One last question:')).toBeTruthy()
    expect(screen.getByTestId('welcome-badge').querySelector('svg')).not.toBeNull()
    const tiles = within(screen.getByRole('group', { name: 'Which language are you learning?' })).getAllByRole('button')
    expect(tiles.map((b) => b.textContent)).toEqual(['Deutsch', 'English', 'Français', '한국어'])
    expect(screen.queryByPlaceholderText('Email')).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull() // no app shell
  })

  it('saves the chosen language, refreshes /me and goes home', async () => {
    vi.mocked(meApi.get).mockResolvedValue(tgMe(true))
    vi.mocked(meApi.setLearningLanguage).mockImplementation(async () => {
      vi.mocked(meApi.get).mockResolvedValue({ ...tgMe(false), learning_language: 'fr' })
    })
    renderApp('/welcome')
    await screen.findByRole('heading', { name: 'Hi, Anna Karimova!' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Français' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(meApi.setLearningLanguage).toHaveBeenCalledWith('fr'))
    expect(await screen.findByText('home page')).toBeTruthy()
    expect(meApi.get).toHaveBeenCalledTimes(2) // refreshed after saving
  })

  it('answered already (409 language_chosen): just goes home', async () => {
    vi.mocked(meApi.get).mockResolvedValue(tgMe(true))
    vi.mocked(meApi.setLearningLanguage).mockImplementation(async () => {
      vi.mocked(meApi.get).mockResolvedValue(tgMe(false))
      throw { isAxiosError: true, response: { status: 409, data: { code: 'language_chosen' } } }
    })
    renderApp('/welcome')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(await screen.findByText('home page')).toBeTruthy()
  })

  it('an account that does not need it is sent home', async () => {
    vi.mocked(meApi.get).mockResolvedValue({ ...tgMe(false), email: 'a@b.co' })
    renderApp('/welcome')
    expect(await screen.findByText('home page')).toBeTruthy()
  })
})

describe('Layout: needs_language', () => {
  it('sends every protected page to /welcome while the language is not chosen', async () => {
    vi.mocked(meApi.get).mockResolvedValue(tgMe(true))
    renderApp('/words')
    expect(await screen.findByRole('heading', { name: 'Hi, Anna Karimova!' })).toBeTruthy()
    expect(screen.queryByText('words page')).toBeNull()
  })

  it('leaves the page alone otherwise', async () => {
    vi.mocked(meApi.get).mockResolvedValue({ ...tgMe(false), email: 'a@b.co' })
    renderApp('/words')
    await waitFor(() => expect(meApi.get).toHaveBeenCalled())
    expect(await screen.findByText('words page')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /Hi,/ })).toBeNull()
  })
})
