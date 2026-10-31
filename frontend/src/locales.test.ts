import { describe, expect, it } from 'vitest'
import ru from './locales/ru/common.json'
import en from './locales/en/common.json'
import uz from './locales/uz/common.json'

const PICTOGRAPH = /\p{Extended_Pictographic}/u

function strings(o: unknown, path = ''): [string, string][] {
  if (typeof o === 'string') return [[path, o]]
  if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k))
  return []
}

describe('locales: no emoji in the user-facing texts', () => {
  for (const [name, data] of [['ru', ru], ['en', en], ['uz', uz]] as const) {
    it(name, () => {
      const bad = strings(data)
        .filter(([, v]) => PICTOGRAPH.test(v))
        .map(([p, v]) => `${p}: ${v}`)
      expect(bad).toEqual([])
    })
  }
})
