import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsApi } from '../api/endpoints'
import {
  adoptServerTheme, getTheme, initTheme, isTheme, readStoredTheme, resolveTheme, setTheme, setThemePickerEnabled,
  THEME_BG, THEMES, useThemeSync,
} from './theme'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, settingsApi: { get: vi.fn(), setTheme: vi.fn() } }
})

/** A controllable prefers-color-scheme: light query. */
function systemMedia(initialLight: boolean) {
  const listeners = new Set<() => void>()
  const media = {
    matches: initialLight,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }
  vi.stubGlobal('matchMedia', () => media)
  return {
    listeners,
    setLight(light: boolean) { media.matches = light; listeners.forEach((l) => l()) },
  }
}

const html = () => document.documentElement
const bar = () => document.querySelector('meta[name="theme-color"]')!.getAttribute('content')

beforeEach(() => {
  localStorage.clear()
  html().removeAttribute('data-theme')
  document.head.innerHTML = '<meta name="theme-color" content="#0E1512" />'
  vi.mocked(settingsApi.setTheme).mockResolvedValue({} as never)
  vi.mocked(settingsApi.get).mockResolvedValue({ interface_language: 'ru', review_session_size: '', theme: '' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('applying a theme', () => {
  it('night is the default: no attribute; every other theme sets data-theme and the browser bar colour', () => {
    systemMedia(false)
    initTheme()
    expect(html().hasAttribute('data-theme')).toBe(false)
    expect(getTheme()).toBe('night')
    for (const name of ['light', 'graphite', 'sand', 'navy'] as const) {
      setTheme(name)
      expect(html().getAttribute('data-theme')).toBe(name)
      expect(bar()).toBe(THEME_BG[name])
    }
    setTheme('night')
    expect(html().hasAttribute('data-theme')).toBe(false)
    expect(bar()).toBe(THEME_BG.night)
  })

  it('a choice is saved in localStorage AND on the server', () => {
    systemMedia(false)
    initTheme()
    setTheme('sand')
    expect(localStorage.getItem('theme')).toBe('sand')
    expect(settingsApi.setTheme).toHaveBeenCalledWith('sand')
    setTheme('auto')
    expect(localStorage.getItem('theme')).toBe('auto')
    expect(settingsApi.setTheme).toHaveBeenLastCalledWith('auto')
  })

  it('a failing server save does not undo the choice', async () => {
    systemMedia(false)
    initTheme()
    vi.mocked(settingsApi.setTheme).mockRejectedValue(new Error('offline'))
    setTheme('navy')
    await Promise.resolve()
    expect(html().getAttribute('data-theme')).toBe('navy')
    expect(localStorage.getItem('theme')).toBe('navy')
  })

  it('initTheme restores the saved theme; an unknown saved value means night', () => {
    systemMedia(false)
    localStorage.setItem('theme', 'graphite')
    initTheme()
    expect(html().getAttribute('data-theme')).toBe('graphite')
    localStorage.setItem('theme', 'purple')
    initTheme()
    expect(getTheme()).toBe('night')
    expect(html().hasAttribute('data-theme')).toBe(false)
  })

  it('works when localStorage throws', () => {
    systemMedia(false)
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(readStoredTheme()).toBeNull()
    initTheme()
    expect(() => setTheme('light')).not.toThrow()
    expect(html().getAttribute('data-theme')).toBe('light')
    get.mockRestore()
    set.mockRestore()
  })
})

describe('auto', () => {
  it('resolves to light for a light system, night for a dark one', () => {
    expect(resolveTheme('auto', true)).toBe('light')
    expect(resolveTheme('auto', false)).toBe('night')
    expect(resolveTheme('sand', true)).toBe('sand')
  })

  it('follows the system live, and stops following when another theme is picked', () => {
    const system = systemMedia(false)
    localStorage.setItem('theme', 'auto')
    initTheme()
    expect(html().hasAttribute('data-theme')).toBe(false) // dark system → night

    system.setLight(true)
    expect(html().getAttribute('data-theme')).toBe('light')
    expect(bar()).toBe(THEME_BG.light)
    system.setLight(false)
    expect(html().hasAttribute('data-theme')).toBe(false)
    expect(bar()).toBe(THEME_BG.night)

    setTheme('sand')
    system.setLight(true)
    system.setLight(false)
    expect(html().getAttribute('data-theme')).toBe('sand') // a fixed theme ignores the system
  })

  it('initTheme does not pile up listeners', () => {
    const system = systemMedia(false)
    initTheme()
    initTheme()
    initTheme()
    expect(system.listeners.size).toBe(1)
  })
})

describe('the server wins on login', () => {
  it('adoptServerTheme replaces the local choice, stores it, and sends nothing back', () => {
    systemMedia(false)
    localStorage.setItem('theme', 'sand')
    initTheme()
    expect(adoptServerTheme('navy')).toBe(true)
    expect(getTheme()).toBe('navy')
    expect(localStorage.getItem('theme')).toBe('navy')
    expect(html().getAttribute('data-theme')).toBe('navy')
    expect(settingsApi.setTheme).not.toHaveBeenCalled()
    for (const nothing of ['', null, undefined, 'dark', 42]) expect(adoptServerTheme(nothing)).toBe(false)
    expect(getTheme()).toBe('navy')
  })

  it('isTheme knows exactly the six names', () => {
    expect([...THEMES]).toEqual(['auto', 'night', 'light', 'graphite', 'sand', 'navy'])
    expect(THEMES.every(isTheme)).toBe(true)
    expect(isTheme('dark')).toBe(false)
  })
})

describe('without the theme picker everybody is night', () => {
  it('the saved choice is kept but not shown; it comes back when the picker is on', () => {
    systemMedia(false)
    localStorage.setItem('theme', 'sand')
    initTheme()
    expect(html().getAttribute('data-theme')).toBe('sand')
    setThemePickerEnabled(false)
    expect(html().hasAttribute('data-theme')).toBe(false)
    expect(bar()).toBe(THEME_BG.night)
    expect(localStorage.getItem('theme')).toBe('sand')
    setThemePickerEnabled(true)
    expect(html().getAttribute('data-theme')).toBe('sand')
  })

  it('the system changing does not bring a light theme back while the picker is off', () => {
    const system = systemMedia(false)
    localStorage.setItem('theme', 'auto')
    initTheme()
    setThemePickerEnabled(false)
    system.setLight(true)
    expect(html().hasAttribute('data-theme')).toBe(false)
    setThemePickerEnabled(true)
  })
})

describe('useThemeSync (Layout)', () => {
  beforeEach(() => { systemMedia(false) })

  it('does nothing until /me is known', () => {
    localStorage.setItem('theme', 'sand')
    initTheme()
    renderHook(() => useThemeSync(false, false))
    expect(html().getAttribute('data-theme')).toBe('sand')
    expect(settingsApi.get).not.toHaveBeenCalled()
  })

  it('without the feature: night, and the server is not even asked', () => {
    localStorage.setItem('theme', 'sand')
    initTheme()
    renderHook(() => useThemeSync(false, true))
    expect(html().hasAttribute('data-theme')).toBe(false)
    expect(settingsApi.get).not.toHaveBeenCalled()
  })

  it('with the feature: the server theme wins over localStorage', async () => {
    localStorage.setItem('theme', 'sand')
    initTheme()
    vi.mocked(settingsApi.get).mockResolvedValue({ interface_language: '', review_session_size: '', theme: 'navy' })
    renderHook(() => useThemeSync(true, true))
    await waitFor(() => expect(html().getAttribute('data-theme')).toBe('navy'))
    expect(localStorage.getItem('theme')).toBe('navy')
    expect(settingsApi.setTheme).not.toHaveBeenCalled()
  })

  it('with the feature and nothing saved on the server: a local choice is sent up', async () => {
    localStorage.setItem('theme', 'graphite')
    initTheme()
    renderHook(() => useThemeSync(true, true))
    await waitFor(() => expect(settingsApi.setTheme).toHaveBeenCalledWith('graphite'))
    expect(html().getAttribute('data-theme')).toBe('graphite')
  })

  it('with the feature, nothing saved anywhere: stays night and sends nothing', async () => {
    initTheme()
    renderHook(() => useThemeSync(true, true))
    await waitFor(() => expect(settingsApi.get).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(settingsApi.setTheme).not.toHaveBeenCalled()
    expect(html().hasAttribute('data-theme')).toBe(false)
  })
})
