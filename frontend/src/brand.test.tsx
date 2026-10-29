import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from './i18n'
import { Logo } from './components/Layout'

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

afterEach(cleanup)

describe('brand: yodla', () => {
  it('the logo is a "y" badge and "yod" + accented "la"', () => {
    const { container } = render(<Logo />)
    const [badge, word] = Array.from(container.querySelectorAll('span.display > span'))
    expect(badge.textContent).toBe('y')
    expect(word.textContent).toBe('yodla')
    const accent = word.querySelector('span')!
    expect(accent.textContent).toBe('la')
    expect(accent.className).toContain('text-lime-300')
  })

  it('the tab title follows the interface language', async () => {
    await i18n.changeLanguage('ru')
    expect(document.title).toBe('yodla — немецкие слова в контексте')
    await i18n.changeLanguage('en')
    expect(document.title).toBe('yodla — German words in context')
    await i18n.changeLanguage('uz')
    expect(document.title).toBe('yodla — so‘zlarni kontekst bilan yodla')
  })

  it('install banner texts name yodla in every language', async () => {
    for (const l of ['ru', 'en', 'uz']) {
      await i18n.changeLanguage(l)
      expect(i18n.t('pwa.banner')).toContain('yodla')
    }
  })

  it('index.html: title, apple title, description and Open Graph', () => {
    const html = read('index.html')
    expect(html).toContain('<title>yodla — so‘zlarni kontekst bilan yodla</title>')
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="yodla" />')
    expect(html).toMatch(/<meta name="description" content="[^"]+yodla/)
    expect(html).toContain('<meta property="og:site_name" content="yodla" />')
    expect(html).toMatch(/<meta property="og:title" content="yodla/)
    expect(html).toMatch(/<meta property="og:description" content="[^"]+/)
  })

  it('manifest and offline page carry the new name', () => {
    const manifest = JSON.parse(read('public/site.webmanifest'))
    expect(manifest.name).toBe('yodla — nemis tili')
    expect(manifest.short_name).toBe('yodla')
    const offline = read('public/offline.html')
    expect(offline).toContain('<title>yodla</title>')
    expect(offline).toContain('<div class="logo">y</div>')
  })

  it('no "Wortkontext" is left in user-facing files', () => {
    for (const f of ['index.html', 'public/site.webmanifest', 'public/offline.html',
      'src/locales/ru/common.json', 'src/locales/en/common.json', 'src/locales/uz/common.json',
      'src/lib/heroShare.ts', 'src/components/Layout.tsx']) {
      expect(read(f), f).not.toMatch(/wortkontext/i)
    }
  })
})
