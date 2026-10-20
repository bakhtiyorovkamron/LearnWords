// UI sounds for yodla: taps, page turns between sections, toggles, flashcards (next/prev/flip).
// Synthesized with the Web Audio API (no files), like the training sounds in lib/sounds.ts.
// Deliberately separate from the training engine: never queued behind other sounds, never
// delays speech (afterSounds), and much quieter (peaks ≤ 0.12 before the master volume).

export type UiSound = 'tap' | 'toggleOn' | 'toggleOff' | 'pageForward' | 'pageBack' | 'cardNext' | 'cardPrev' | 'cardFlip'
export type Paper = 'thin' | 'normal' | 'thick'

// "Paper" presets for the page-turn: duration and the band the swish sweeps through.
const PAPER: Record<Paper, { dur: number; lo: number; hi: number; flap: number }> = {
  thin: { dur: 0.26, lo: 1800, hi: 5200, flap: 0.06 },
  normal: { dur: 0.32, lo: 1400, hi: 4200, flap: 0.1 },
  thick: { dur: 0.4, lo: 1000, hi: 3200, flap: 0.14 },
}

let ctx: AudioContext | null = null
let noiseBuf: AudioBuffer | null = null
let enabled = true
let volume = 0.6
let paper: Paper = 'normal'
let lastPageAt = 0

/** Creates/resumes the context. Call only from (or after) a user gesture — browsers require it. */
function context(): AudioContext | null {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    try { ctx = new Ctor() } catch { return null }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  return ctx
}

function noise(c: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf
  const len = Math.floor(c.sampleRate * 0.6)
  const b = c.createBuffer(1, len, c.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  noiseBuf = b
  return b
}

const F = 0.0001 // silence floor for exponential ramps

/** One enveloped noise burst through a filter. */
function burst(c: AudioContext, out: AudioNode, t: number, type: BiquadFilterType, freq: number, q: number,
  peak: number, attack: number, decay: number) {
  const s = c.createBufferSource(); s.buffer = noise(c)
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q
  const g = c.createGain()
  g.gain.setValueAtTime(F, t)
  g.gain.exponentialRampToValueAtTime(peak, t + attack)
  g.gain.exponentialRampToValueAtTime(F, t + attack + decay)
  s.connect(f).connect(g).connect(out)
  s.start(t, Math.random() * 0.4)
  s.stop(t + attack + decay + 0.02)
}

function pageTurn(c: AudioContext, out: AudioNode, t: number, dir: 1 | -1) {
  const p = PAPER[paper]
  const dur = p.dur * (0.92 + Math.random() * 0.16) // a little variation: never sounds robotic
  // 1) swish — paper sliding through the air; forward sweeps up, back sweeps down
  const s = c.createBufferSource(); s.buffer = noise(c)
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9
  const [f0, f1] = dir > 0 ? [p.lo, p.hi] : [p.hi * 0.9, p.lo]
  bp.frequency.setValueAtTime(f0, t)
  bp.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.55)
  bp.frequency.exponentialRampToValueAtTime(Math.max(400, f0 * 0.8), t + dur)
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500
  const g = c.createGain()
  g.gain.setValueAtTime(F, t)
  g.gain.exponentialRampToValueAtTime(0.09, t + dur * 0.25)
  g.gain.exponentialRampToValueAtTime(0.05, t + dur * 0.6)
  g.gain.exponentialRampToValueAtTime(F, t + dur)
  s.connect(bp).connect(hp).connect(g).connect(out)
  s.start(t, Math.random() * 0.2); s.stop(t + dur + 0.02)
  // 2) crinkle — a few tiny clicks of paper texture during the swish
  for (let i = 0; i < 5; i++) {
    burst(c, out, t + dur * (0.15 + Math.random() * 0.6), 'bandpass', 2500 + Math.random() * 3500, 3, 0.025, 0.003, 0.022)
  }
  // 3) flap — the page lands
  burst(c, out, t + dur * 0.82, 'lowpass', 380, 0.7, p.flap, 0.008, 0.06)
}

function tick(c: AudioContext, out: AudioNode, t: number, from: number, to: number, peak: number) {
  const o = c.createOscillator(); o.type = 'sine'
  o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + 0.03)
  const g = c.createGain()
  g.gain.setValueAtTime(F, t)
  g.gain.exponentialRampToValueAtTime(peak, t + 0.002)
  g.gain.exponentialRampToValueAtTime(F, t + 0.035)
  o.connect(g).connect(out); o.start(t); o.stop(t + 0.045)
}

/** A card sliding off the table (next: the band falls, prev: it rises) and landing softly. */
function cardSlide(c: AudioContext, out: AudioNode, t: number, dir: 1 | -1) {
  const dur = 0.14 * (0.95 + Math.random() * 0.1)
  const s = c.createBufferSource(); s.buffer = noise(c)
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1
  const [f0, f1] = dir > 0 ? [2600, 900] : [900, 2600]
  bp.frequency.setValueAtTime(f0, t)
  bp.frequency.exponentialRampToValueAtTime(f1, t + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(F, t)
  g.gain.exponentialRampToValueAtTime(0.06, t + 0.03)
  g.gain.exponentialRampToValueAtTime(F, t + dur)
  s.connect(bp).connect(g).connect(out)
  s.start(t, Math.random() * 0.3); s.stop(t + dur + 0.02)
  burst(c, out, t + dur * 0.85, 'lowpass', 700, 0.7, 0.05, 0.004, 0.035) // lands on the pile
  tick(c, out, t + dur * 0.85, 520, 420, 0.02)
}

/** Flicking a card over: two quick flaps with a breath of air between them. */
function cardFlip(c: AudioContext, out: AudioNode, t: number) {
  burst(c, out, t, 'bandpass', 1600, 1.4, 0.05, 0.003, 0.03)
  burst(c, out, t + 0.02, 'bandpass', 3000, 0.8, 0.02, 0.02, 0.07)
  burst(c, out, t + 0.075, 'bandpass', 2400, 1.6, 0.045, 0.003, 0.035)
  tick(c, out, t + 0.075, 1300, 1700, 0.02)
}

export function playUi(kind: UiSound) {
  if (!enabled || volume <= 0) return
  if (kind === 'pageForward' || kind === 'pageBack') { // two navigations in a row → one rustle
    const now = performance.now()
    if (now - lastPageAt < 250) return
    lastPageAt = now
  }
  const c = context(); if (!c) return
  const out = c.createGain(); out.gain.value = volume; out.connect(c.destination)
  const t = c.currentTime + 0.005
  switch (kind) {
    case 'tap':
      burst(c, out, t, 'bandpass', 3200, 1.2, 0.05, 0.002, 0.028)
      tick(c, out, t, 1900, 1200, 0.03)
      break
    case 'toggleOn':
      tick(c, out, t, 2200, 2000, 0.035); tick(c, out, t + 0.06, 3000, 2800, 0.035)
      break
    case 'toggleOff':
      tick(c, out, t, 3000, 2800, 0.03); tick(c, out, t + 0.06, 2000, 1800, 0.03)
      break
    case 'pageForward': pageTurn(c, out, t, 1); break
    case 'pageBack': pageTurn(c, out, t, -1); break
    case 'cardNext': cardSlide(c, out, t, 1); break
    case 'cardPrev': cardSlide(c, out, t, -1); break
    case 'cardFlip': cardFlip(c, out, t); break
  }
}

/** Call on the first pointerdown so the context exists before the first route change. */
export function unlockUiSounds() { context() }
export function setUiSoundsEnabled(v: boolean) { enabled = v }
export function setUiVolume(v: number) { volume = Math.max(0, Math.min(1, v)) }
export function setPaper(p: Paper) { paper = p }
