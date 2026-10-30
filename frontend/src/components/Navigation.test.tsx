import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { meApi, type Me } from '../api/endpoints'
import App from '../App'
import { Layout } from './Layout'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    settingsApi: { get: vi.fn() },
    heroApi: { ...mod.heroApi, get: vi.fn() },
  }
})
let authenticated = true
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: authenticated, isLoading: false }) }))
// The pages are stubs: these tests are about where URLs lead and what the navigation shows.
vi.mock('../pages/ContextsPage', () => ({ ContextsPage: () => <div>HOME PAGE</div> }))
vi.mock('../pages/NewContextPage', () => ({ NewContextPage: () => <div>ADD PAGE</div> }))
vi.mock('../pages/CardsPage', () => ({ CardsPage: () => <div>CARDS PAGE</div> }))
vi.mock('../pages/StatsPage', () => ({ StatsPage: () => <div>STATS PAGE</div> }))
vi.mock('../pages/StoryPage', () => ({ StoryPage: () => <div>STORY PAGE</div> }))
vi.mock('../pages/SearchPage', () => ({ SearchPage: () => <div>SEARCH PAGE</div> }))
vi.mock('../pages/AdminPage', () => ({ AdminPage: () => <div>ADMIN PAGE</div> }))
vi.mock('../pages/SharedFolderPage', () => ({ SharedFolderPage: () => <div>SHARED PAGE</div> }))
vi.mock('../pages/AuthPage', () => ({ AuthPage: () => <div>AUTH PAGE</div> }))

const features = (wordSearch: boolean) => ({
  photo_import: { enabled: true, daily_limit: 10, remaining: 10 },
  daily_story: { enabled: true, daily_limit: null, remaining: null },
  word_search: { enabled: wordSearch, daily_limit: null, remaining: null },
  story_autotranslate: { enabled: true, daily_limit: null, remaining: null },
  theme_picker: { enabled: false, daily_limit: null, remaining: null },
})
const me = (wordSearch = true): Me => ({ id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de', features: features(wordSearch) })

const Where = () => <div data-testid="where">{useLocation().pathname}</div>

function renderApp(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><Where /><App /></MemoryRouter></QueryClientProvider>)
}
function renderLayout(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route element={<Layout />}><Route path="*" element={<div>page</div>} /></Route></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const bottomBar = () => screen.getAllByRole('navigation')[1] // [0] is the desktop header
const moreTab = () => within(bottomBar()).getByRole('button', { name: /More/ })
const isActive = (el: Element) => el.className.includes('text-accent-text')

beforeEach(async () => {
  authenticated = true
  await i18n.changeLanguage('en')
  vi.mocked(meApi.get).mockResolvedValue(me())
  const { settingsApi, heroApi } = await import('../api/endpoints')
  vi.mocked(settingsApi.get).mockRejectedValue(new Error('no'))
  vi.mocked(heroApi.get).mockRejectedValue(new Error('no'))
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('bottom navigation', () => {
  it('shows exactly Home, Cards, Add, Story, More — in that order, Home first at "/"', async () => {
    renderLayout('/')
    const items = Array.from(bottomBar().children)
    expect(items.map((el) => el.textContent)).toEqual(['Home', 'Cards', 'Add', 'Daily Story', 'More'])
    expect(items.slice(0, 4).map((el) => el.getAttribute('href'))).toEqual(['/', '/cards', '/contexts/new', '/story'])
    expect(isActive(items[0])).toBe(true)
    await waitFor(() => expect(meApi.get).toHaveBeenCalled())
  })

  it('Home is active only at "/", not on every page', () => {
    renderLayout('/cards')
    const [home, cards] = Array.from(bottomBar().children)
    expect(isActive(home)).toBe(false)
    expect(isActive(cards)).toBe(true)
  })

  it('Search is not in the bar: it is the first entry of More (when word_search is on)', async () => {
    renderLayout('/')
    expect(within(bottomBar()).queryByRole('link', { name: /Search/ })).toBeNull()
    fireEvent.click(moreTab())
    const sheet = document.getElementById('more-sheet')!
    const links = within(sheet).getAllByRole('link').map((a) => a.textContent)
    expect(links[0]).toBe('Search')
    expect(links[1]).toBe('Statistics')
    expect(links.some((l) => /Contexts/.test(l ?? ''))).toBe(false) // the old entry is gone
  })

  it('Search is not in More when word_search is off', async () => {
    vi.mocked(meApi.get).mockResolvedValue(me(false))
    renderLayout('/')
    await waitFor(() => expect(screen.queryAllByRole('link', { name: /Search/ })).toHaveLength(0))
    fireEvent.click(moreTab())
    const sheet = document.getElementById('more-sheet')!
    expect(within(sheet).queryByRole('link', { name: /Search/ })).toBeNull()
    expect(within(sheet).getByRole('link', { name: /Statistics/ })).toBeTruthy()
  })

  it.each(['/search', '/stats', '/admin'])('More is the active tab on %s', (path) => {
    renderLayout(path)
    expect(isActive(moreTab())).toBe(true)
    for (const el of Array.from(bottomBar().children).slice(0, 4)) expect(isActive(el)).toBe(false)
  })

  it('More is not active on the bottom tabs\' own pages', () => {
    for (const path of ['/', '/cards', '/contexts/new', '/story']) {
      cleanup()
      renderLayout(path)
      expect(isActive(moreTab())).toBe(false)
    }
  })

  it('the desktop header lists Home · Cards · Add · Search · Daily story · Statistics', () => {
    renderLayout('/')
    const header = screen.getAllByRole('navigation')[0]
    const names = within(header).getAllByRole('link').map((a) => a.textContent)
    expect(names).toEqual(['yodla' /* the logo */, 'Home', 'Cards', 'Add', 'Search', 'Daily Story', 'Statistics'])
    expect(within(header).getAllByRole('link')[0].getAttribute('href')).toBe('/') // the logo
  })
})

describe('routes', () => {
  it('"/" is the home page', async () => {
    renderApp('/')
    expect(await screen.findByText('HOME PAGE')).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/')
  })

  it('"/contexts" redirects to "/"', async () => {
    renderApp('/contexts')
    expect(await screen.findByText('HOME PAGE')).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/')
  })

  it('"/contexts/new" stays the Add page; an unknown path goes home', async () => {
    renderApp('/contexts/new')
    expect(await screen.findByText('ADD PAGE')).toBeTruthy()
    cleanup()
    renderApp('/nothing/here')
    expect(await screen.findByText('HOME PAGE')).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/')
  })

  it('a logged-in user opening /login lands on "/"', async () => {
    renderApp('/login')
    expect(await screen.findByText('HOME PAGE')).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/')
  })
})

describe('the shell has icons, not emoji', () => {
  it('every nav item has an svg icon (hidden from screen readers) and no emoji in its name', () => {
    renderLayout('/')
    const bar = Array.from(bottomBar().children)
    expect(bar).toHaveLength(5)
    for (const item of bar) {
      const icon = item.querySelector('svg')!
      expect(icon, item.textContent ?? '').not.toBeNull()
      expect(icon.getAttribute('aria-hidden')).toBe('true')
      expect(item.textContent).toMatch(/^[A-Za-z ]+$/)
    }
    const header = screen.getAllByRole('navigation')[0]
    for (const a of Array.from(within(header).getAllByRole('link')).slice(1)) {
      expect(a.querySelector('svg'), a.textContent ?? '').not.toBeNull()
      expect(a.textContent).toMatch(/^[A-Za-z ]+$/)
    }
  })

  it('the active bottom tab has the accent colour, the others are muted', () => {
    renderLayout('/story')
    const [home, cards, add, story, more] = Array.from(bottomBar().children)
    expect(story.className).toContain('text-accent-text')
    for (const other of [home, cards, add, more]) {
      expect(other.className).toContain('text-muted')
      expect(other.className).not.toContain('text-accent-text')
    }
  })

  it('the More sheet rows are icon + label, and the active row is highlighted', () => {
    renderLayout('/stats')
    fireEvent.click(moreTab())
    const sheet = document.getElementById('more-sheet')!
    const stats = within(sheet).getByRole('link', { name: 'Statistics' })
    expect(stats.className).toContain('bg-surface-2')
    expect(stats.className).toContain('text-accent-text')
    expect(stats.querySelector('svg')).not.toBeNull()
    expect(within(sheet).getByRole('link', { name: 'Search' }).className).not.toContain('bg-surface-2 text-accent-text')
    expect(within(sheet).getByRole('button', { name: 'Log out' }).querySelector('svg')).not.toBeNull()
    expect(within(sheet).getByRole('link', { name: 'Contact us' }).querySelector('svg')).not.toBeNull()
  })

  it('the logo has one gradient per copy — the desktop header copy is hidden on phones', () => {
    renderLayout('/')
    const ids = Array.from(document.querySelectorAll('linearGradient')).map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
