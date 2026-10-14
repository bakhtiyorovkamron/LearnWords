import { describe, expect, it } from 'vitest'
import { buildHero, type HeroMood } from './heroArt'
import { stageProgress } from './heroStages'

const MOODS: HeroMood[] = ['idle', 'sleepy', 'happy', 'think', 'sad']

describe('buildHero', () => {
  it('draws every stage in every mood', () => {
    for (let s = 0; s <= 5; s++) {
      for (const m of MOODS) {
        const d = buildHero(s, m, 'x')
        expect(d.markup).toContain('class="h-char"')
        expect(d.markup).toContain('class="h-headg"')
        expect(d.r).toBeGreaterThan(0)
      }
    }
    expect(buildHero(0, 'sleepy', 'x').markup).toContain('class="z ')
    expect(buildHero(0, 'think', 'x').markup).toContain('class="q"')
    expect(buildHero(1, 'idle', 'x').markup).toContain('class="torso2"') // the second Grimm brother
  })

  it('prefixes gradient ids per instance so several heroes can share a page', () => {
    const m = buildHero(2, 'idle', 'a1').markup
    expect(m).toContain('id="a1-skin"')
    expect(m).toContain('url(#a1-shirt)')
    expect(m).not.toMatch(/id="(skin|shirt|char|torso)"/)
  })

  it('silhouette: one fill colour, outline filter, no mood effects', () => {
    const m = buildHero(5, 'happy', 's', true).markup
    const body = m.slice(m.indexOf('class="h-char"'))
    const fills = new Set([...body.matchAll(/fill="([^"]+)"/g)].map((x) => x[1]).filter((f) => f !== 'none'))
    expect([...fills]).toEqual(['#0E3324'])
    expect(m).toContain('filter="url(#s-outline)"')
    expect(m).toContain('flood-color="#1E4A35"')
    expect(body).not.toContain('class="sp')
  })
})

describe('stageProgress', () => {
  it('splits the stage span into learned and almost learned', () => {
    expect(stageProgress(0, 19, 12)).toEqual({ learnedPct: 38, almostPct: 24 })
    const p = stageProgress(1, 190, 40) // 140/150 learned → almost capped at the rest
    expect(p.learnedPct + p.almostPct).toBeCloseTo(100)
    expect(stageProgress(5, 2650, 0)).toEqual({ learnedPct: 100, almostPct: 0 })
  })
})
