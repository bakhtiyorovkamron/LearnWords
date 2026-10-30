import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { collectionApi, foldersApi, heroApi, meApi, settingsApi } from '../api/endpoints'
import { setTrainingOpen } from '../lib/trainingState'
import { CardsPage } from '../pages/CardsPage'
import { Layout } from './Layout'

vi.mock('./ReviewSession', () => ({ ReviewSession: () => <div>REVIEW SCREEN</div> }))
vi.mock('./WordFixes', () => ({ WordFixes: () => null }))
vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    settingsApi: { get: vi.fn(), setTheme: vi.fn(), setLanguage: vi.fn() },
    heroApi: { ...mod.heroApi, get: vi.fn() },
    collectionApi: { list: vi.fn(), ids: vi.fn() },
    foldersApi: { list: vi.fn(), create: vi.fn() },
  }
})

function renderApp(path = '/cards') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route element={<Layout />}><Route path="/cards" element={<CardsPage />} /></Route></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const navs = () => screen.queryAllByRole('navigation')
const header = () => document.querySelector('header')
const footer = () => document.querySelector('footer')

beforeEach(async () => {
  await i18n.changeLanguage('en')
  setTrainingOpen(false)
  vi.mocked(meApi.get).mockResolvedValue({ id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de' })
  vi.mocked(settingsApi.get).mockRejectedValue(new Error('no'))
  vi.mocked(heroApi.get).mockRejectedValue(new Error('no'))
  vi.mocked(collectionApi.list).mockResolvedValue({ items: [], total: 0 })
  vi.mocked(foldersApi.list).mockResolvedValue({ all: { total: 0 }, folders: [] } as never)
})
afterEach(() => { cleanup(); setTrainingOpen(false); vi.clearAllMocks() })

describe('focus mode: during a training session the shell steps aside', () => {
  it('normally there is a header, a bottom nav (2 navigation landmarks), a footer and the tabs', () => {
    renderApp()
    expect(navs()).toHaveLength(2)
    expect(header()).not.toBeNull()
    expect(footer()).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Collection' })).toBeTruthy()
  })

  it('while a session is open: no header, no bottom nav, no footer, no tabs', () => {
    renderApp()
    act(() => setTrainingOpen(true))
    expect(navs()).toHaveLength(0)
    expect(header()).toBeNull()
    expect(footer()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Collection' })).toBeNull()
    expect(screen.getByText('REVIEW SCREEN')).toBeTruthy() // the session itself stays
  })

  it('the nav padding goes too: --nav-h is 0 on the root, so toasts and the sheet sit at the very bottom', () => {
    const { container } = renderApp()
    const root = container.firstChild as HTMLElement
    expect(root.style.getPropertyValue('--nav-h')).toBe('')
    act(() => setTrainingOpen(true))
    expect(root.style.getPropertyValue('--nav-h')).toBe('0px')
    act(() => setTrainingOpen(false))
    expect(root.style.getPropertyValue('--nav-h')).toBe('')
  })

  it('everything comes back after leaving the session', () => {
    renderApp()
    act(() => setTrainingOpen(true))
    act(() => setTrainingOpen(false))
    expect(navs()).toHaveLength(2)
    expect(header()).not.toBeNull()
    expect(footer()).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy()
  })

  it('the More sheet cannot be open during a session', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: /More/ }))
    expect(document.getElementById('more-sheet')).not.toBeNull()
    act(() => setTrainingOpen(true))
    expect(document.getElementById('more-sheet')).toBeNull()
  })

  it('setting the same state twice does not notify twice', async () => {
    const { isTrainingOpen } = await import('../lib/trainingState')
    renderApp()
    act(() => setTrainingOpen(true))
    act(() => setTrainingOpen(true))
    expect(isTrainingOpen()).toBe(true)
    expect(navs()).toHaveLength(0)
  })
})
