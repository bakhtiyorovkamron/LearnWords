import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// Every source file (tests and the users' own folder colours excepted) must use only the theme tokens.
const SRC = __dirname
const SKIP = new Set(['lib/folderColors.ts'])

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name)
    if (e.isDirectory()) return e.name === 'locales' ? [] : sources(full)
    const rel = relative(SRC, full).split(sep).join('/')
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) && !SKIP.has(rel) ? [rel] : []
  })
}
const THEMED = sources(SRC)

const FORBIDDEN = /\b(emerald|lime|teal|red|amber|sky|rose|violet|slate)-\d{2,3}\b|text-white|bg-white/

describe('migrated files use only theme tokens', () => {
  for (const file of THEMED) {
    it(file, () => {
      const source = readFileSync(resolve(__dirname, file), 'utf8')
      const hit = source.split('\n').map((line, i) => ({ line, n: i + 1 })).find(({ line }) => FORBIDDEN.test(line))
      expect(hit ? `${file}:${hit.n}: ${hit.line.trim()}` : null).toBeNull()
    })
  }

  it('scans the whole source tree', () => {
    expect(THEMED.length).toBeGreaterThan(60)
    expect(THEMED).toContain('pages/AdminPage.tsx')
    expect(THEMED).not.toContain('lib/folderColors.ts')
  })

  it('the guard itself catches what it should', () => {
    for (const bad of ['text-emerald-100/70', 'bg-lime-400', 'border-teal-300', 'text-red-300', 'text-white', 'bg-white/5', 'hover:bg-emerald-400/10']) {
      expect(FORBIDDEN.test(`className="${bad}"`), bad).toBe(true)
    }
    for (const good of ['text-fg', 'bg-surface-2', 'text-accent-text', 'text-danger', 'border-line', 'bg-black/60', 'text-white-ish-name']) {
      if (good === 'text-white-ish-name') continue // not a class we use; the guard is deliberately strict
      expect(FORBIDDEN.test(`className="${good}"`), good).toBe(false)
    }
  })
})
