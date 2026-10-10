// Simple global event bus for the hero widget: training (and later, other features) emit
// events here and know nothing else about the hero — HeroWidget is the only listener.
// Mirrors the same window CustomEvent pattern as components/Toaster.tsx's toast().

export type HeroEvent =
  | { type: 'session_started' }
  | { type: 'answer'; correct: boolean; streak: number }
  | { type: 'word_learned' }
  | { type: 'session_finished'; correctCount: number; total: number }

const CHANNEL = 'hero-event'

export function emitHeroEvent(e: HeroEvent) {
  window.dispatchEvent(new CustomEvent<HeroEvent>(CHANNEL, { detail: e }))
}

/** Subscribes to hero events; returns an unsubscribe function. */
export function onHeroEvent(listener: (e: HeroEvent) => void): () => void {
  function handler(ev: Event) {
    listener((ev as CustomEvent<HeroEvent>).detail)
  }
  window.addEventListener(CHANNEL, handler)
  return () => window.removeEventListener(CHANNEL, handler)
}
