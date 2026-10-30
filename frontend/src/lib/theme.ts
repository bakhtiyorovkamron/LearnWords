import { useEffect, useSyncExternalStore } from 'react'
import { settingsApi } from '../api/endpoints'

// Colour themes. The colours themselves are CSS variables on <html data-theme="…"> (index.css);
// this file decides WHICH theme is on: the user's choice ('auto' follows the system), saved in
// localStorage and on the server. index.html applies the saved one before the first paint.

export const THEMES = ['auto', 'night', 'light', 'graphite', 'sand', 'navy'] as const
export type Theme = (typeof THEMES)[number]
export type ResolvedTheme = Exclude<Theme, 'auto'>

export const DEFAULT_THEME: ResolvedTheme = 'night'

/** The page background of each theme — also the browser bar colour (<meta name="theme-color">). */
export const THEME_BG: Record<ResolvedTheme, string> = {
  night: '#0E1512', light: '#F6F7F3', graphite: '#121314', sand: '#F4EFE6', navy: '#0D1220',
}
/** The accent of each theme (the dot in its picker swatch). */
export const THEME_ACCENT: Record<ResolvedTheme, string> = {
  night: '#C8F25C', light: '#0E8A5F', graphite: '#5EE0A8', sand: '#1F5A3A', navy: '#C8F25C',
}

export const isTheme = (v: unknown): v is Theme => typeof v === 'string' && (THEMES as readonly string[]).includes(v)

const STORAGE_KEY = 'theme'
const LIGHT_QUERY = '(prefers-color-scheme: light)'

export function readStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return isTheme(v) ? v : null
  } catch {
    return null
  }
}

function storeTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch { /* private mode: the choice lives on the server */ }
}

const prefersLight = () => window.matchMedia?.(LIGHT_QUERY).matches ?? false

/** 'auto' → light when the system is light, night otherwise. */
export function resolveTheme(theme: Theme, systemIsLight: boolean): ResolvedTheme {
  if (theme === 'auto') return systemIsLight ? 'light' : 'night'
  return theme
}

// ---- state --------------------------------------------------------------------------------

let current: Theme = readStoredTheme() ?? DEFAULT_THEME
let enabled = true // false: the user does not have the theme picker — night, whatever is saved
const listeners = new Set<() => void>()

/** Puts the theme on <html> and in the browser bar colour. */
function paint() {
  const resolved = enabled ? resolveTheme(current, prefersLight()) : DEFAULT_THEME
  const root = document.documentElement
  if (resolved === DEFAULT_THEME) root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', resolved)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BG[resolved])
}

function change(next: Theme) {
  current = next
  paint()
  listeners.forEach((l) => l())
}

export const getTheme = (): Theme => current

/** The user picked a theme: applied now, saved in localStorage and on the server. */
export function setTheme(theme: Theme) {
  storeTheme(theme)
  change(theme)
  settingsApi.setTheme(theme).catch(() => undefined) // localStorage keeps it for this device
}

/** The server's saved theme wins over localStorage (on login). Nothing is sent back. */
export function adoptServerTheme(value: unknown): boolean {
  if (!isTheme(value)) return false
  storeTheme(value)
  change(value)
  return true
}

/** Without the theme_picker feature everybody sees the default (night); the saved choice is kept. */
export function setThemePickerEnabled(on: boolean) {
  if (enabled === on) return
  enabled = on
  paint()
}

let stopSystemWatch: (() => void) | undefined

/** Call once at startup: reads the saved theme and follows the system while the theme is 'auto'. */
export function initTheme() {
  stopSystemWatch?.()
  current = readStoredTheme() ?? DEFAULT_THEME
  enabled = true
  paint()
  const media = window.matchMedia?.(LIGHT_QUERY)
  const onSystemChange = () => { if (current === 'auto') { paint(); listeners.forEach((l) => l()) } }
  media?.addEventListener?.('change', onSystemChange)
  stopSystemWatch = () => media?.removeEventListener?.('change', onSystemChange)
  return stopSystemWatch
}

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void } {
  const theme = useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => current,
  )
  return { theme, setTheme }
}

/**
 * Keeps the theme in step with the account once /me is known (`ready`): without the picker feature
 * the app is night; with it, the theme saved on the server wins over this device's localStorage
 * (and a choice made before it was ever saved is sent up).
 */
export function useThemeSync(pickerOn: boolean, ready: boolean) {
  useEffect(() => {
    if (!ready) return
    setThemePickerEnabled(pickerOn)
    if (!pickerOn) return
    let alive = true
    settingsApi.get()
      .then((s) => {
        if (!alive) return
        if (!adoptServerTheme(s.theme) && current !== DEFAULT_THEME) settingsApi.setTheme(current).catch(() => undefined)
      })
      .catch(() => undefined)
    return () => { alive = false }
  }, [pickerOn, ready])
}
