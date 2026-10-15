import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSoundEngine, type AudioLike, type SoundName } from './sounds'

interface Osc { type: string; freq: number; start: number; stop: number; peak: number }

function fakeAudio() {
  const oscs: Osc[] = []
  const ctx = {
    currentTime: 0, state: 'running', destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    createOscillator() {
      const o: Osc = { type: '', freq: 0, start: 0, stop: 0, peak: 0 }
      oscs.push(o)
      return {
        set type(v: string) { o.type = v },
        frequency: { set value(v: number) { o.freq = v } },
        connect() {}, start(t: number) { o.start = t }, stop(t: number) { o.stop = t },
        _o: o,
      } as never
    },
    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          linearRampToValueAtTime(v: number) { oscs[oscs.length - 1].peak = v }, // the note created just before
          exponentialRampToValueAtTime() {},
        },
        connect() {},
      }
    },
  } satisfies AudioLike
  return { ctx, oscs }
}

function engineWith() {
  const f = fakeAudio()
  const make = vi.fn(() => f.ctx)
  const engine = createSoundEngine(make)
  return { ...f, engine, make }
}

afterEach(() => vi.useRealTimers())

describe('sound engine', () => {
  it('creates the AudioContext only after the first user gesture', () => {
    const { engine, make, oscs } = engineWith()
    engine.play('correct') // before any click: silent, no throw
    expect(make).not.toHaveBeenCalled()
    expect(oscs).toHaveLength(0)
    engine.unlock()
    engine.unlock()
    expect(make).toHaveBeenCalledTimes(1)
    engine.play('correct')
    expect(oscs.length).toBeGreaterThan(0)
  })

  it.each<[SoundName, number, number, string, number]>([
    // name, notes, length (s), wave, first-note freq
    ['correct', 2, 0.25, 'sine', 659.25],
    ['wrong', 1, 0.2, 'triangle', 220],
    ['sessionDone', 3, 0.6, 'sine', 523.25],
    ['stageUp', 6, 0.9, 'sine', 523.25],
  ])('%s: notes, length, wave', (name, notes, length, wave, first) => {
    const { engine, oscs } = engineWith()
    engine.unlock()
    engine.play(name)
    expect(oscs).toHaveLength(notes)
    expect(oscs[0].type).toBe(wave)
    expect(oscs[0].freq).toBeCloseTo(first, 1)
    const end = Math.max(...oscs.map((o) => o.stop))
    expect(end).toBeGreaterThanOrEqual(length)
    expect(end).toBeLessThan(length + 0.1)
    for (const o of oscs) expect(o.peak).toBeLessThanOrEqual(0.2) // moderate volume
  })

  it('correct goes up (E5 → A5); wrong is quieter than correct', () => {
    const a = engineWith(); a.engine.unlock(); a.engine.play('correct')
    expect(a.oscs[1].freq).toBeGreaterThan(a.oscs[0].freq)
    const b = engineWith(); b.engine.unlock(); b.engine.play('wrong')
    expect(b.oscs[0].peak).toBeLessThan(a.oscs[0].peak)
  })

  it('sounds never overlap: the next one starts after the previous has ended', () => {
    const { engine, oscs } = engineWith()
    engine.unlock()
    engine.play('correct')
    const firstEnd = 0.25
    engine.play('sessionDone') // requested at the same moment
    const second = oscs.slice(2)
    expect(Math.min(...second.map((o) => o.start))).toBeGreaterThanOrEqual(firstEnd)
  })

  it('plays nothing when switched off', () => {
    const { engine, oscs } = engineWith()
    engine.unlock()
    engine.setEnabled(false)
    engine.play('correct')
    expect(oscs).toHaveLength(0)
  })

  it('speech starts only after the sound has finished', () => {
    vi.useFakeTimers()
    const { engine, ctx } = engineWith()
    engine.unlock()
    const speak = vi.fn()

    engine.afterSounds(speak) // nothing playing → immediately
    expect(speak).toHaveBeenCalledTimes(1)

    engine.play('correct') // 250 ms
    engine.afterSounds(speak)
    vi.advanceTimersByTime(200)
    expect(speak).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(100)
    expect(speak).toHaveBeenCalledTimes(2)

    ctx.currentTime = 10 // long after: no waiting
    engine.afterSounds(speak)
    expect(speak).toHaveBeenCalledTimes(3)
  })
})

describe('answer feedback', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('vibrates 30 ms on a mistake only, and only where the API exists', async () => {
    const { playAnswer } = await import('./sounds')
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { ...navigator, vibrate })
    playAnswer(true)
    expect(vibrate).not.toHaveBeenCalled()
    playAnswer(false)
    expect(vibrate).toHaveBeenCalledWith(30)

    vi.stubGlobal('navigator', { userAgent: 'iOS' }) // no vibrate (iOS): must not throw
    expect(() => playAnswer(false)).not.toThrow()
  })
})

describe('on/off switch', () => {
  it('is on by default and follows the profile value', async () => {
    const { adoptServerSounds, useSoundsEnabled } = await import('./sounds')
    const { renderHook, act } = await import('@testing-library/react')
    const { result } = renderHook(() => useSoundsEnabled())
    expect(result.current).toBe(true)
    act(() => adoptServerSounds(false))
    expect(result.current).toBe(false)
    expect(localStorage.getItem('sounds-enabled')).toBe('false')
    act(() => adoptServerSounds('nonsense'))
    expect(result.current).toBe(false) // junk from the server is ignored
    act(() => adoptServerSounds(true))
    expect(result.current).toBe(true)
  })
})
