import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const html = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8')
const fontLinks = Array.from(html.matchAll(/<link href="(https:\/\/fonts\.googleapis\.com\/[^"]+)" rel="stylesheet"/g), (m) => m[1])

describe('index.html fonts', () => {
  it('the serif of the card words (Newsreader) is display=block: never drawn in a fallback font first', () => {
    const serif = fontLinks.filter((href) => href.includes('family=Newsreader'))
    expect(serif).toHaveLength(1)
    expect(serif[0]).toContain('display=block')
    expect(serif[0]).toMatch(/wght@[^&]*\b400;500\b/) // the example and the word
  })

  it('the interface fonts keep display=swap: ordinary text never waits for them', () => {
    const others = fontLinks.filter((href) => !href.includes('family=Newsreader'))
    expect(others.length).toBeGreaterThan(0)
    for (const href of others) expect(href).toContain('display=swap')
  })
})
