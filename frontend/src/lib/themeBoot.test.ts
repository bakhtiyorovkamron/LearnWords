import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEME_BG } from './theme'

// index.html runs a tiny inline script before the first paint: the saved theme goes on <html>.
// Here that very script is extracted from index.html and run against a fake document.
const indexHtml = readFileSync(resolve(__dirname, '../../index.html'), 'utf8')
const script = /<script id="theme-boot">([\s\S]*?)<\/script>/.exec(indexHtml)?.[1] ?? ''

function boot(opts: { stored?: string | null; light?: boolean; storageThrows?: boolean; noMeta?: boolean }) {
  const attrs: Record<string, string> = {}
  const meta = { content: '#0E1512', setAttribute(name: string, v: string) { if (name === 'content') this.content = v } }
  const document = {
    documentElement: {
      setAttribute: (k: string, v: string) => { attrs[k] = v },
      removeAttribute: (k: string) => { delete attrs[k] },
    },
    querySelector: () => (opts.noMeta ? null : meta),
  }
  const localStorage = {
    getItem: () => {
      if (opts.storageThrows) throw new Error('denied')
      return opts.stored ?? null
    },
  }
  const matchMedia = () => ({ matches: !!opts.light })
  new Function('localStorage', 'matchMedia', 'document', script)(localStorage, matchMedia, document)
  return { theme: attrs['data-theme'] as string | undefined, bar: meta.content }
}

describe('the theme script in index.html', () => {
  it('exists, and runs before the app (and before the stylesheet-loading module script)', () => {
    expect(script.length).toBeGreaterThan(50)
    expect(indexHtml.indexOf('id="theme-boot"')).toBeLessThan(indexHtml.indexOf('type="module"'))
    expect(indexHtml.indexOf('id="theme-boot"')).toBeGreaterThan(indexHtml.indexOf('name="theme-color"')) // the meta it updates is above it
  })

  it.each(['light', 'graphite', 'sand', 'navy'] as const)('%s: data-theme is set and the bar gets its colour — the same colours as lib/theme.ts', (name) => {
    const r = boot({ stored: name })
    expect(r.theme).toBe(name)
    expect(r.bar).toBe(THEME_BG[name])
  })

  it('night: no attribute', () => {
    const r = boot({ stored: 'night' })
    expect(r.theme).toBeUndefined()
    expect(r.bar).toBe(THEME_BG.night)
  })

  it('nothing saved → night', () => {
    expect(boot({ stored: null })).toEqual({ theme: undefined, bar: THEME_BG.night })
  })

  it('auto follows the system at load', () => {
    expect(boot({ stored: 'auto', light: true })).toEqual({ theme: 'light', bar: THEME_BG.light })
    expect(boot({ stored: 'auto', light: false })).toEqual({ theme: undefined, bar: THEME_BG.night })
  })

  it.each(['purple', 'Light', '', 'constructor', '__proto__', 'toString', 'hasOwnProperty'])('an unknown saved value %j → night', (bad) => {
    expect(boot({ stored: bad })).toEqual({ theme: undefined, bar: THEME_BG.night })
  })

  it('does not break the page when storage is blocked or the meta tag is missing', () => {
    expect(() => boot({ storageThrows: true })).not.toThrow()
    expect(boot({ storageThrows: true }).theme).toBeUndefined()
    expect(() => boot({ stored: 'sand', noMeta: true })).not.toThrow()
  })
})
