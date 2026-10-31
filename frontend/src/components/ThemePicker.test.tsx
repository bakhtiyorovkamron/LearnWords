import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { meApi, settingsApi, heroApi, type Me } from '../api/endpoints'
import { initTheme } from '../lib/theme'
import { Layout } from './Layout'
import { ThemePicker } from './ThemePicker'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    settingsApi: { get: vi.fn(), setTheme: vi.fn(), setLanguage: vi.fn() },
    heroApi: { ...mod.heroApi, get: vi.fn() },
  }
})

const features = (picker: boolean) => ({
  photo_import: { enabled: true, daily_limit: 10, remaining: 10 },
  daily_story: { enabled: true, daily_limit: null, remaining: null },
  word_search: { enabled: true, daily_limit: null, remaining: null },
  story_autotranslate: { enabled: true, daily_limit: null, remaining: null },
  theme_picker: { enabled: picker, daily_limit: null, remaining: null },
})
const me = (picker: boolean): Me => ({ id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de', features: features(picker) })

const html = () => document.documentElement

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  localStorage.clear()
  html().removeAttribute('data-theme')
  document.head.innerHTML = '<meta name="theme-color" content="#0E1512" />'
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }))
  initTheme()
  vi.mocked(meApi.get).mockResolvedValue(me(true))
  vi.mocked(settingsApi.get).mockResolvedValue({ interface_language: '', review_session_size: '', theme: '' })
  vi.mocked(settingsApi.setTheme).mockResolvedValue({} as never)
  vi.mocked(heroApi.get).mockRejectedValue(new Error('no'))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

const options = () => screen.getAllByRole('radio') as HTMLButtonElement[]

describe('ThemePicker (row)', () => {
  it('has six swatches with a label each, night selected by default', async () => {
    wrap(<ThemePicker variant="row" />)
    const group = await screen.findByRole('radiogroup', { name: 'Theme' })
    const names = within(group).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))
    expect(names).toEqual(['System', 'Night green', 'Light', 'Graphite', 'Sand', 'Night blue'])
    expect(options().map((o) => o.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false', 'false', 'false'])
    // every swatch shows its own background with a dot
    expect(options()[2].style.background).toContain('rgb(246, 247, 243)')
    expect(options()[0].style.background).toContain('linear-gradient') // auto: half and half
  })

  it('a click switches the theme at once, and saves it in localStorage and on the server', async () => {
    wrap(<ThemePicker variant="row" />)
    fireEvent.click(await screen.findByRole('radio', { name: 'Light' }))
    expect(html().getAttribute('data-theme')).toBe('light')
    expect(localStorage.getItem('theme')).toBe('light')
    expect(settingsApi.setTheme).toHaveBeenCalledWith('light')
    expect(screen.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Night green' }).getAttribute('aria-checked')).toBe('false')

    fireEvent.click(screen.getByRole('radio', { name: 'Night green' }))
    expect(html().hasAttribute('data-theme')).toBe(false)
    expect(localStorage.getItem('theme')).toBe('night')
  })

  it('arrow keys move the choice; only the selected swatch is a tab stop', async () => {
    wrap(<ThemePicker variant="row" />)
    const group = await screen.findByRole('radiogroup')
    expect(options().map((o) => o.tabIndex)).toEqual([-1, 0, -1, -1, -1, -1])
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    expect(html().getAttribute('data-theme')).toBe('light')
    fireEvent.keyDown(group, { key: 'ArrowLeft' })
    fireEvent.keyDown(group, { key: 'ArrowLeft' })
    expect(localStorage.getItem('theme')).toBe('auto')
    fireEvent.keyDown(group, { key: 'ArrowLeft' }) // wraps around
    expect(localStorage.getItem('theme')).toBe('navy')
    expect(html().getAttribute('data-theme')).toBe('navy')
  })

  it('is hidden only when the feature is switched off for the user (enabled:false)', async () => {
    vi.mocked(meApi.get).mockResolvedValue(me(false))
    wrap(<ThemePicker variant="row" />)
    await waitFor(() => expect(meApi.get).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('radiogroup')).toBeNull())
  })

  it('is visible for enabled:true and for an old server that sends no theme_picker entry', async () => {
    wrap(<ThemePicker variant="row" />)
    expect(await screen.findByRole('radiogroup', { name: 'Theme' })).toBeTruthy()
    cleanup()
    const { theme_picker: _unused, ...rest } = features(true)
    const old = { ...me(true), features: rest } as unknown as Me
    vi.mocked(meApi.get).mockResolvedValue(old)
    wrap(<ThemePicker variant="row" />)
    expect(await screen.findByRole('radiogroup', { name: 'Theme' })).toBeTruthy()
  })
})

describe('ThemePicker (desktop menu)', () => {
  it('a 🎨 button opens a popover with the swatches; Esc closes it', async () => {
    wrap(<ThemePicker variant="menu" />)
    const button = await screen.findByRole('button', { name: 'Theme' })
    expect(screen.queryByRole('radiogroup')).toBeNull()
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'Sand' }))
    expect(html().getAttribute('data-theme')).toBe('sand')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('radiogroup')).toBeNull())
  })

  it('a click outside closes it', async () => {
    wrap(<div><span data-testid="outside">x</span><ThemePicker variant="menu" /></div>)
    fireEvent.click(await screen.findByRole('button', { name: 'Theme' }))
    expect(screen.getByRole('radiogroup')).toBeTruthy()
    fireEvent.mouseDown(screen.getByTestId('outside'))
    await waitFor(() => expect(screen.queryByRole('radiogroup')).toBeNull())
  })

  it('is not there without the feature', async () => {
    vi.mocked(meApi.get).mockResolvedValue(me(false))
    wrap(<ThemePicker variant="menu" />)
    await waitFor(() => expect(meApi.get).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('button', { name: 'Theme' })).toBeNull()
  })
})

describe('Layout', () => {
  const openMore = () => fireEvent.click(screen.getByRole('button', { name: /More/ }))

  it('with the feature: the More sheet has the theme row and the header has the 🎨 menu', async () => {
    wrap(<Layout />)
    await screen.findByRole('button', { name: 'Theme' }) // the desktop header
    openMore()
    const sheet = document.getElementById('more-sheet')!
    expect(within(sheet).getByRole('radiogroup', { name: 'Theme' })).toBeTruthy()
    expect(within(sheet).getByText('Theme')).toBeTruthy()
  })

  it('without the feature: no picker anywhere, and the app is night even if another theme was saved', async () => {
    vi.mocked(meApi.get).mockResolvedValue(me(false))
    localStorage.setItem('theme', 'sand')
    initTheme()
    expect(html().getAttribute('data-theme')).toBe('sand') // what the boot script would have put there
    wrap(<Layout />)
    await waitFor(() => expect(html().hasAttribute('data-theme')).toBe(false)) // night
    openMore()
    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Theme' })).toBeNull()
    expect(settingsApi.setTheme).not.toHaveBeenCalled()
    expect(localStorage.getItem('theme')).toBe('sand') // the choice is kept for when the feature is turned on
  })

  it('with the feature the theme saved on the server wins over this device', async () => {
    localStorage.setItem('theme', 'sand')
    initTheme()
    vi.mocked(settingsApi.get).mockResolvedValue({ interface_language: '', review_session_size: '', theme: 'navy' })
    wrap(<Layout />)
    await waitFor(() => expect(html().getAttribute('data-theme')).toBe('navy'))
    expect(localStorage.getItem('theme')).toBe('navy')
  })
})
