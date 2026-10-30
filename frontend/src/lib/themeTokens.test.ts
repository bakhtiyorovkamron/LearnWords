import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEME_ACCENT, THEME_BG, type ResolvedTheme } from './theme'

// The values of the design (one row per theme), checked against what index.css really says.
const NAMES = ['bg', 'surface', 'surface-2', 'line', 'divider', 'fg', 'muted', 'faint', 'track', 'dot-off', 'accent',
  'accent-text', 'on-accent', 'danger', 'streak', 'der', 'die', 'das'] as const
const TABLE: Record<ResolvedTheme, string[]> = {
  night:    ['#0E1512', '#151F1B', '#18241C', '#26352F', '#22302A', '#EAF2EC', '#9DB0A5', '#6F847A', '#22302A', '#2C3B34', '#C8F25C', '#C8F25C', '#0E1A10', '#FF8A7A', '#F2A65A', '#7DD3FC', '#FDA4AF', '#6EE7B7'],
  light:    ['#F6F7F3', '#FFFFFF', '#EDF7F1', '#E1E6DF', '#ECEFEA', '#13201A', '#5B6B62', '#8A968F', '#E1E6DF', '#DCE3DC', '#0E8A5F', '#0B7A54', '#FFFFFF', '#C0392B', '#D9822B', '#0369A1', '#BE123C', '#047857'],
  graphite: ['#121314', '#1B1C1E', '#1C2924', '#2A2C2F', '#26282B', '#EDEEF0', '#A1A5AB', '#73777D', '#2A2C2F', '#34373B', '#5EE0A8', '#5EE0A8', '#08140F', '#FF8A7A', '#F2A65A', '#7DD3FC', '#FDA4AF', '#6EE7B7'],
  sand:     ['#F4EFE6', '#FBF8F2', '#E9F0E3', '#E3DACB', '#ECE5D8', '#1E2420', '#6B655B', '#9A9284', '#E3DACB', '#DDD3C2', '#1F5A3A', '#1F5A3A', '#FFFFFF', '#B4432A', '#C0652A', '#0369A1', '#BE123C', '#047857'],
  navy:     ['#0D1220', '#141B2D', '#18263A', '#232D45', '#1E2840', '#E8ECF5', '#9AA6BF', '#6C7893', '#232D45', '#2A3550', '#C8F25C', '#C8F25C', '#10180A', '#FF8A7A', '#F2A65A', '#7DD3FC', '#FDA4AF', '#6EE7B7'],
}
const SHADOW: Record<ResolvedTheme, string> = {
  night: 'none', graphite: 'none', navy: 'none',
  light: '0 1px 2px rgb(19 32 26 / 0.06)', sand: '0 1px 2px rgb(19 32 26 / 0.06)',
}

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8')

/** The declarations of the rule whose selector is exactly `selector`. */
function declarations(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/^\s*(--[\w-]+|color-scheme):\s*(.+?);\s*$/gm)) out[m[1]] = m[2]
  return out
}

const SELECTOR: Record<ResolvedTheme, string> = {
  night: ':root,\n:root[data-theme="night"]',
  light: ':root[data-theme="light"]', graphite: ':root[data-theme="graphite"]',
  sand: ':root[data-theme="sand"]', navy: ':root[data-theme="navy"]',
}

describe('index.css theme tokens', () => {
  for (const theme of Object.keys(TABLE) as ResolvedTheme[]) {
    it(`${theme}: all ${NAMES.length} tokens, the card shadow and the select arrow`, () => {
      const d = declarations(SELECTOR[theme])
      NAMES.forEach((name, i) => expect(d[`--${name}`], `--${name}`).toBe(TABLE[theme][i]))
      expect(d['--shadow-card']).toBe(SHADOW[theme])
      expect(d['--select-arrow']).toContain(`stroke='%23${TABLE[theme][NAMES.indexOf('accent-text')].slice(1)}'`)
      expect(d['color-scheme']).toBe(['light', 'sand'].includes(theme) ? 'light' : 'dark')
    })

    it(`${theme}: lib/theme.ts uses the same background and accent`, () => {
      expect(THEME_BG[theme]).toBe(TABLE[theme][0])
      expect(THEME_ACCENT[theme]).toBe(TABLE[theme][NAMES.indexOf('accent')])
    })
  }

  it('every token is a Tailwind colour (bg-surface, text-muted, border-line, text-der …) via @theme inline', () => {
    expect(css).toContain('@theme inline {')
    for (const name of NAMES) expect(css, name).toContain(`--color-${name}: var(--${name});`)
  })

  it('fonts: Geist for the UI, Newsreader for learning text, Unbounded only for the logo', () => {
    expect(css).toMatch(/--font-sans:\s*"Geist"/)
    expect(css).toMatch(/--font-serif:\s*"Newsreader"/)
    expect(css).toMatch(/\.display\s*\{\s*font-family:\s*var\(--font-display\)/)
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8')
    expect(html).toContain('family=Geist:wght@400;500;600;700')
    expect(html).toContain('family=Newsreader:opsz,wght@6..72,400;500;600')
    expect(html).not.toContain('family=Inter')
  })

  it('the base look is flat and made of tokens only', () => {
    expect(css).not.toContain('radial-gradient')
    expect(css).not.toMatch(/backdrop-blur/)
    expect(css).not.toMatch(/bg-gradient|from-lime|shadow-emerald|hover:scale/)
    const apply = (selector: string) => {
      const m = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{\\s*@apply ([^;]*);`).exec(css)
      expect(m, selector).not.toBeNull()
      return m![1].split(/\s+/)
    }
    expect(apply('body')).toEqual(expect.arrayContaining(['bg-bg', 'text-fg']))
    expect(apply('.glass')).toEqual(expect.arrayContaining(['bg-surface', 'border-line', 'rounded-2xl', 'shadow-[var(--shadow-card)]']))
    const primary = apply('.btn-primary')
    expect(primary).toEqual(expect.arrayContaining(['bg-accent', 'text-on-accent', 'rounded-xl', 'font-semibold', 'hover:opacity-90']))
    expect(primary.some((c) => /scale|shadow|gradient/.test(c))).toBe(false) // no gradient, no glow, no scale
    expect(apply('.btn-ghost')).toEqual(expect.arrayContaining(['border-line', 'text-fg', 'hover:bg-surface-2']))
    expect(apply('.field')).toEqual(expect.arrayContaining(['bg-surface', 'border-line', 'text-fg', 'placeholder:text-faint', 'focus:ring-accent/25']))
    expect(css).toMatch(/select\.field option\s*\{\s*background-color:\s*var\(--surface\);\s*color:\s*var\(--fg\)/)
  })

  it('the hero bubble takes its colours from the tokens', () => {
    expect(css).toMatch(/\.hero-bubble\s*\{[^}]*background:\s*var\(--surface-2\)[^}]*var\(--accent\)/)
    expect(css).not.toContain('#1E4A35')
  })
})
