import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { chatUnreadApi, meApi, type ChatUnread, type Me } from '../api/endpoints'
import { CHAT_UNREAD_KEY } from '../lib/chatUnread'
import { setMoreMenuOpen } from '../lib/moreMenu'
import { Layout } from './Layout'

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true }) }))
vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    chatUnreadApi: { mine: vi.fn(), admin: vi.fn() },
    settingsApi: { get: vi.fn().mockRejectedValue(new Error('no')) },
    heroApi: { ...mod.heroApi, get: vi.fn().mockRejectedValue(new Error('no')) },
  }
})

const feature = { enabled: true, daily_limit: null, remaining: null, credits: 0 }
const me = (role: 'user' | 'admin'): Me => ({
  id: 'u', email: 'a@b.co', role, learning_language: 'de',
  features: { photo_import: feature, daily_story: feature, word_search: feature, story_autotranslate: feature, theme_picker: { ...feature, enabled: false } },
})
const unread = (support: number, purchases: ChatUnread['purchases'] = []): ChatUnread =>
  ({ support, purchases, total: support + purchases.reduce((n, p) => n + p.unread, 0) })
const order = { id: 'r1', code: 'YD-4821', unread: 1 }

const Where = () => <p data-testid="where">{useLocation().pathname}</p>
let qc: QueryClient
function renderLayout(path = '/', role: 'user' | 'admin' = 'user') {
  vi.mocked(meApi.get).mockResolvedValue(me(role))
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route element={<Layout />}><Route path="*" element={<Where />} /></Route></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
/** The first answer is in the cache and shown (the toast hook has seen it). */
const firstLoad = () => waitFor(() => expect(qc.getQueryData(CHAT_UNREAD_KEY)).toBeTruthy()).then(() => act(async () => undefined))
/** The next read of the badges answers with `next` (through the same cache key the app uses). */
async function grow(next: ChatUnread) {
  vi.mocked(chatUnreadApi.mine).mockResolvedValue(next)
  await act(async () => { await qc.invalidateQueries({ queryKey: CHAT_UNREAD_KEY }) })
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(chatUnreadApi.mine).mockResolvedValue(unread(0))
  vi.mocked(chatUnreadApi.admin).mockResolvedValue({ support: 4, purchases: 1, total: 5 })
})
afterEach(() => { cleanup(); setMoreMenuOpen(false); vi.clearAllMocks() })

describe('Layout: unread badges', () => {
  it('no badges without unread messages', async () => {
    renderLayout()
    await waitFor(() => expect(chatUnreadApi.mine).toHaveBeenCalled())
    act(() => setMoreMenuOpen(true))
    expect(screen.queryAllByRole('img', { name: /Unread messages/ })).toHaveLength(0)
  })

  it('the total sits on the Home tab icon (phone nav) and on the Profile link (desktop menu)', async () => {
    vi.mocked(chatUnreadApi.mine).mockResolvedValue(unread(2, [order]))
    renderLayout()
    expect((await screen.findByTestId('badge-home')).textContent).toBe('3')
    expect(screen.getByTestId('badge-home').getAttribute('aria-label')).toBe('Unread messages: 3')
    expect(screen.getByTestId('badge-profile').textContent).toBe('3')
    expect(screen.queryByTestId('badge-admin')).toBeNull() // not an admin
  })

  it('the More sheet: support count on Support, purchases count on Profile', async () => {
    vi.mocked(chatUnreadApi.mine).mockResolvedValue(unread(2, [order, { id: 'r2', code: 'YD-1', unread: 3 }]))
    renderLayout()
    await screen.findByTestId('badge-home')
    expect(screen.queryByTestId('badge-sheet-support')).toBeNull() // the sheet is closed
    act(() => setMoreMenuOpen(true))
    expect(screen.getByTestId('badge-sheet-support').textContent).toBe('2')
    expect(screen.getByTestId('badge-sheet-profile').textContent).toBe('4')
    expect(within(screen.getByRole('link', { name: /Support/ })).getByTestId('badge-sheet-support')).toBeTruthy()
  })

  it('a row without its own unread has no badge', async () => {
    vi.mocked(chatUnreadApi.mine).mockResolvedValue(unread(0, [order]))
    renderLayout()
    await screen.findByTestId('badge-home')
    act(() => setMoreMenuOpen(true))
    expect(screen.queryByTestId('badge-sheet-support')).toBeNull()
    expect(screen.getByTestId('badge-sheet-profile').textContent).toBe('1')
  })

  it('shows "9+" above nine', async () => {
    vi.mocked(chatUnreadApi.mine).mockResolvedValue(unread(12))
    renderLayout()
    expect((await screen.findByTestId('badge-home')).textContent).toBe('9+')
    expect(screen.getByTestId('badge-home').getAttribute('aria-label')).toBe('Unread messages: 12')
  })

  it('an admin sees the admin total on the Admin link in both menus', async () => {
    renderLayout('/', 'admin')
    expect((await screen.findByTestId('badge-admin')).textContent).toBe('5')
    act(() => setMoreMenuOpen(true))
    expect(screen.getByTestId('badge-sheet-admin').textContent).toBe('5')
    expect(chatUnreadApi.admin).toHaveBeenCalled()
  })

  it('a user never asks for the admin total', async () => {
    renderLayout()
    await waitFor(() => expect(meApi.get).toHaveBeenCalled())
    await waitFor(() => expect(chatUnreadApi.mine).toHaveBeenCalled())
    expect(chatUnreadApi.admin).not.toHaveBeenCalled()
  })
})

describe('Layout: new-message toast', () => {
  it('not on the first load, even with unread messages', async () => {
    vi.mocked(chatUnreadApi.mine).mockResolvedValue(unread(3))
    renderLayout()
    await screen.findByTestId('badge-home')
    expect(screen.queryByText('Support wrote to you')).toBeNull()
  })

  it('support grows: one toast; its button opens /support', async () => {
    renderLayout('/words')
    await firstLoad()
    await grow(unread(1))
    expect(await screen.findByText('Support wrote to you')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))
    expect(screen.getByTestId('where').textContent).toBe('/support')
  })

  it('an order chat grows: the toast has its code, the button opens that chat', async () => {
    renderLayout('/words')
    await firstLoad()
    await grow(unread(0, [order]))
    expect(await screen.findByText('New message about order YD-4821')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))
    expect(screen.getByTestId('where').textContent).toBe('/purchases/r1')
  })

  it('no toast while the user is on that chat\'s screen, nor when the number only falls or stays', async () => {
    renderLayout('/support')
    await firstLoad()
    await grow(unread(1))
    await screen.findByTestId('badge-home')
    expect(screen.queryByText('Support wrote to you')).toBeNull()
    await grow(unread(1))
    await grow(unread(0))
    expect(screen.queryByText('Support wrote to you')).toBeNull()
  })

  it('one toast for one growth, not again while the number stays', async () => {
    renderLayout('/words')
    await firstLoad()
    await grow(unread(1))
    expect(await screen.findAllByText('Support wrote to you')).toHaveLength(1)
    await grow(unread(1))
    expect(screen.getAllByText('Support wrote to you')).toHaveLength(1)
  })
})
