import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Palette } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useFeatures } from '../lib/features'
import { THEMES, THEME_ACCENT, THEME_BG, useTheme, type Theme } from '../lib/theme'

/** The swatch of a theme: its background with an accent dot; 'auto' is half night, half light. */
function swatch(theme: Theme): { background: string; dot: string } {
  if (theme === 'auto') {
    return { background: `linear-gradient(90deg, ${THEME_BG.night} 50%, ${THEME_BG.light} 50%)`, dot: THEME_ACCENT.light }
  }
  return { background: THEME_BG[theme], dot: THEME_ACCENT[theme] }
}

function Swatches() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const group = useRef<HTMLDivElement>(null)

  // Arrow keys move the choice (a radiogroup is one tab stop).
  function onKey(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = THEMES[(THEMES.indexOf(theme) + step + THEMES.length) % THEMES.length]
    setTheme(next)
    requestAnimationFrame(() => group.current?.querySelector<HTMLElement>(`[data-theme-option="${next}"]`)?.focus())
  }

  return (
    <div ref={group} role="radiogroup" aria-label={t('theme.title')} onKeyDown={onKey} className="flex flex-wrap items-center gap-3">
      {THEMES.map((name) => {
        const selected = theme === name
        const s = swatch(name)
        return (
          <button key={name} type="button" role="radio" aria-checked={selected} aria-label={t(`theme.${name}`)} title={t(`theme.${name}`)}
            data-theme-option={name} tabIndex={selected ? 0 : -1} onClick={() => setTheme(name)}
            className={`grid h-8 w-8 place-items-center rounded-full border border-line transition ${
              selected ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : 'hover:scale-105'}`}
            style={{ background: s.background }}>
            <span className="h-3 w-3 rounded-full" style={{ background: s.dot }} />
          </button>
        )
      })}
    </div>
  )
}

/**
 * The theme picker — only for users who have the admin-enabled "theme_picker" feature.
 * `row`: a row of the phone "More" sheet. `menu`: a palette button in the desktop header with a small popover.
 */
export function ThemePicker({ variant }: { variant: 'row' | 'menu' }) {
  const { t } = useTranslation()
  const { isOn } = useFeatures()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (!isOn('theme_picker')) return null

  if (variant === 'row') {
    return (
      <div className="space-y-2 px-4 py-3">
        <p className="font-semibold text-fg">{t('theme.title')}</p>
        <Swatches />
      </div>
    )
  }
  return (
    <div ref={box} className="relative">
      <button type="button" title={t('theme.title')} aria-label={t('theme.title')} aria-haspopup="true" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-fg">
        <Palette size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="glass absolute right-0 top-full z-30 mt-2 w-max space-y-2 p-3">
          <p className="text-sm font-semibold text-fg">{t('theme.title')}</p>
          <Swatches />
        </div>
      )}
    </div>
  )
}
