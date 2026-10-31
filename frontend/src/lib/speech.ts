import { useSyncExternalStore } from 'react'
import { LEARNING_LANGS } from '../api/endpoints'

// The only place that talks to the browser's speech synthesis.

/** The speech locale of a learning language (de-DE, en-US, fr-FR, ko-KR); null for an unknown one. */
export function localeOf(lang: string): string | null {
  return LEARNING_LANGS.find((l) => l.code === lang)?.locale ?? null
}

const synth = (): SpeechSynthesis | null =>
  typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null

const norm = (tag: string) => tag.replace('_', '-').toLowerCase() // some Android voices say "ko_KR"

/**
 * Can this device read the language? Needs speech synthesis and a known locale. Once the voice list
 * is there it must hold a voice of the language (no Korean voice → no button, instead of reading
 * Korean with a wrong one). An empty list (Chrome fills it in later) counts as "maybe".
 */
export function canSpeak(lang: string): boolean {
  const s = synth()
  const locale = localeOf(lang)
  if (!s || !locale) return false
  const voices = s.getVoices?.() ?? []
  if (voices.length === 0) return true
  return voices.some((v) => norm(v.lang).startsWith(lang))
}

// Re-render subscribers when the voices arrive (the browser fires 'voiceschanged' as it loads them).
let version = 0
let listening = false
const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  const s = synth()
  if (s && !listening && typeof s.addEventListener === 'function') {
    listening = true
    s.addEventListener('voiceschanged', () => {
      version++
      listeners.forEach((l) => l())
    })
  }
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** canSpeak(lang) that updates when the device's voices have loaded. */
export function useCanSpeak(lang: string): boolean {
  useSyncExternalStore(subscribe, () => version, () => 0)
  return canSpeak(lang)
}

function pickVoice(voices: SpeechSynthesisVoice[], locale: string): SpeechSynthesisVoice | undefined {
  const want = locale.toLowerCase()
  return voices.find((v) => norm(v.lang) === want) ?? voices.find((v) => norm(v.lang).startsWith(want.split('-')[0]))
}

/** Reads the word aloud in the language's locale. "A / B" is read as "A". Cuts off what was playing. */
export function speak(text: string, lang: string): void {
  const s = synth()
  const locale = localeOf(lang)
  if (!s || !locale) return
  const first = text.split('/')[0].trim()
  if (!first) return
  s.cancel?.()
  const u = new SpeechSynthesisUtterance(first)
  u.lang = locale
  u.rate = 0.95
  const voice = pickVoice(s.getVoices?.() ?? [], locale)
  if (voice) u.voice = voice
  s.speak(u)
}
