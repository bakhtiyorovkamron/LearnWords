import { useSyncExternalStore } from 'react'
import { settingsApi } from '../api/endpoints'

// Training sounds, generated with the Web Audio API (no audio files). The AudioContext is created
// only after the first user gesture (browsers keep it suspended before that, and iOS needs it).
// Sounds never overlap: each one starts when the previous has ended, and speech waits for them.

export type SoundName = 'correct' | 'wrong' | 'sessionDone' | 'stageUp'

interface Note { freq: number; at: number; dur: number; wave: OscillatorType; peak: number }

const E5 = 659.25, A5 = 880, A3 = 220
const C5 = 523.25, G5 = 783.99, C6 = 1046.5, E6 = 1318.5, G6 = 1568

// Peak gains stay ≤ 0.2 (moderate volume); `at`/`dur` in seconds from the sound's start.
const SOUNDS: Record<SoundName, { notes: Note[]; length: number }> = {
  correct: { // two short notes up, ~250 ms
    length: 0.25,
    notes: [
      { freq: E5, at: 0, dur: 0.11, wave: 'sine', peak: 0.16 },
      { freq: A5, at: 0.11, dur: 0.14, wave: 'sine', peak: 0.16 },
    ],
  },
  wrong: { // one soft low note, ~200 ms, quiet
    length: 0.2,
    notes: [{ freq: A3, at: 0, dur: 0.2, wave: 'triangle', peak: 0.1 }],
  },
  sessionDone: { // three rising notes, ~600 ms
    length: 0.6,
    notes: [
      { freq: C5, at: 0, dur: 0.2, wave: 'sine', peak: 0.16 },
      { freq: E5, at: 0.2, dur: 0.2, wave: 'sine', peak: 0.16 },
      { freq: G5, at: 0.4, dur: 0.2, wave: 'sine', peak: 0.16 },
    ],
  },
  stageUp: { // short arpeggio, ~900 ms
    length: 0.9,
    notes: [
      { freq: C5, at: 0, dur: 0.16, wave: 'sine', peak: 0.14 },
      { freq: E5, at: 0.12, dur: 0.16, wave: 'sine', peak: 0.14 },
      { freq: G5, at: 0.24, dur: 0.16, wave: 'sine', peak: 0.14 },
      { freq: C6, at: 0.36, dur: 0.16, wave: 'sine', peak: 0.14 },
      { freq: E6, at: 0.48, dur: 0.16, wave: 'sine', peak: 0.14 },
      { freq: G6, at: 0.6, dur: 0.3, wave: 'sine', peak: 0.14 },
    ],
  },
}

/** The slice of AudioContext the engine uses — lets tests pass a fake. */
export interface AudioLike {
  currentTime: number
  state: string
  destination: unknown
  resume(): Promise<void>
  createOscillator(): {
    type: OscillatorType; frequency: { value: number }
    connect(n: unknown): void; start(t: number): void; stop(t: number): void
  }
  createGain(): {
    gain: {
      setValueAtTime(v: number, t: number): void
      linearRampToValueAtTime(v: number, t: number): void
      exponentialRampToValueAtTime(v: number, t: number): void
    }
    connect(n: unknown): void
  }
}

const ATTACK = 0.015 // soft start/stop, no clicks
const FLOOR = 0.0001

export function createSoundEngine(makeContext: () => AudioLike | null) {
  let ctx: AudioLike | null = null
  let busyUntil = 0 // AudioContext time when the last scheduled sound ends
  let enabled = true

  /** Call from a user gesture. Safe to call again and again. */
  function unlock() {
    if (!ctx) {
      try { ctx = makeContext() } catch { ctx = null }
    }
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  }

  function play(name: SoundName): number {
    if (!enabled || !ctx) return 0 // before the first gesture there is nothing to play with
    const { notes, length } = SOUNDS[name]
    const start = Math.max(ctx.currentTime, busyUntil) // never on top of another sound
    for (const n of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const t0 = start + n.at
      const t1 = t0 + n.dur
      osc.type = n.wave
      osc.frequency.value = n.freq
      gain.gain.setValueAtTime(FLOOR, t0)
      gain.gain.linearRampToValueAtTime(n.peak, t0 + ATTACK) // soft envelope: quick fade in,
      gain.gain.exponentialRampToValueAtTime(FLOOR, t1) // smooth decay to silence
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t0)
      osc.stop(t1 + 0.02)
    }
    busyUntil = start + length
    return busyUntil
  }

  /** Runs `fn` once every sound scheduled so far has finished (at once when none is playing). */
  function afterSounds(fn: () => void) {
    const wait = ctx ? Math.max(busyUntil - ctx.currentTime, 0) : 0
    if (wait <= 0) return fn()
    setTimeout(fn, Math.ceil(wait * 1000) + 20)
  }

  return {
    unlock, play, afterSounds,
    setEnabled(v: boolean) { enabled = v },
    isEnabled: () => enabled,
  }
}

const engine = createSoundEngine(() => {
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return Ctor ? (new Ctor() as unknown as AudioLike) : null
})

// --- on/off switch: localStorage first (instant), then the profile on the server -----------------

const KEY = 'sounds-enabled'
const listeners = new Set<() => void>()

function readStored(): boolean {
  try { return localStorage.getItem(KEY) !== 'false' } catch { return true } // default: on
}
let enabledState = typeof localStorage === 'undefined' ? true : readStored()
engine.setEnabled(enabledState)

function applyEnabled(v: boolean) {
  enabledState = v
  engine.setEnabled(v)
  try { localStorage.setItem(KEY, String(v)) } catch { /* private mode: keep it in memory */ }
  listeners.forEach((l) => l())
}

/** User toggled the switch: local + profile. */
export function setSoundsEnabled(v: boolean) {
  applyEnabled(v)
  if (v) engine.unlock() // the click that turned it on is a user gesture
  settingsApi.setSounds(v).catch(() => undefined) // localStorage stays in effect
}

/** Adopt the value saved in the profile (once, on login). */
export function adoptServerSounds(v: unknown) {
  if (typeof v === 'boolean' && v !== enabledState) applyEnabled(v)
}

export function useSoundsEnabled(): boolean {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => enabledState,
  )
}

// First click/tap/key anywhere creates the AudioContext.
if (typeof window !== 'undefined') {
  const unlock = () => engine.unlock()
  for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) {
    window.addEventListener(ev, unlock, { capture: true, passive: true })
  }
}

export const playSound = (name: SoundName) => { engine.play(name) }

/** Answer feedback: the sound, plus a short vibration on a mistake where the API exists (Android; iOS skips). */
export function playAnswer(correct: boolean) {
  playSound(correct ? 'correct' : 'wrong')
  if (!correct && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(30)
}

/** Speech must not talk over a sound: starts `fn` after the current sounds. */
export const afterSounds = (fn: () => void) => engine.afterSounds(fn)
