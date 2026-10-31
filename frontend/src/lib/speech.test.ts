import { afterEach, describe, expect, it, vi } from 'vitest'
import { canSpeak, localeOf, speak } from './speech'

type Voice = { lang: string; name: string }
const voice = (lang: string): Voice => ({ lang, name: lang })

function stubSynth(voices: Voice[] = []) {
  const api = { speak: vi.fn(), cancel: vi.fn(), getVoices: vi.fn(() => voices), addEventListener: vi.fn() }
  vi.stubGlobal('speechSynthesis', api)
  vi.stubGlobal('SpeechSynthesisUtterance', function (this: { text: string; lang?: string; rate?: number; voice?: unknown }, text: string) { this.text = text })
  return api
}
const spoken = (api: ReturnType<typeof stubSynth>) => api.speak.mock.calls.at(-1)![0] as { text: string; lang: string; rate: number; voice?: Voice }

afterEach(() => vi.unstubAllGlobals())

describe('localeOf', () => {
  it('knows the four learning languages; anything else is null', () => {
    expect([localeOf('de'), localeOf('en'), localeOf('fr'), localeOf('ko')]).toEqual(['de-DE', 'en-US', 'fr-FR', 'ko-KR'])
    expect(localeOf('xx')).toBeNull()
    expect(localeOf('')).toBeNull()
  })
})

describe('speak', () => {
  it.each([['the house', 'en', 'en-US'], ['la maison', 'fr', 'fr-FR'], ['집', 'ko', 'ko-KR'], ['das Haus', 'de', 'de-DE']])(
    '%s in %s is read with %s', (text, lang, locale) => {
      const api = stubSynth()
      speak(text, lang)
      expect(spoken(api).text).toBe(text)
      expect(spoken(api).lang).toBe(locale)
      expect(spoken(api).rate).toBe(0.95)
    })

  it('speaks only the first variant', () => {
    const api = stubSynth()
    speak('der Samstag / der Sonnabend', 'de')
    expect(spoken(api).text).toBe('der Samstag')
  })

  it('cancels what is playing first', () => {
    const api = stubSynth()
    speak('Haus', 'de')
    expect(api.cancel).toHaveBeenCalledTimes(1)
    expect(api.cancel.mock.invocationCallOrder[0]).toBeLessThan(api.speak.mock.invocationCallOrder[0])
  })

  it('picks the exact locale voice first, then any voice of the language', () => {
    const api = stubSynth([voice('en-GB'), voice('en-US'), voice('de-DE')])
    speak('house', 'en')
    expect(spoken(api).voice).toEqual(voice('en-US'))
    speak('house', 'en')
    api.getVoices.mockReturnValue([voice('en-GB'), voice('de-DE')])
    speak('house', 'en')
    expect(spoken(api).voice).toEqual(voice('en-GB'))
    api.getVoices.mockReturnValue([voice('ko_KR')]) // Android writes the tag with an underscore
    speak('집', 'ko')
    expect(spoken(api).voice).toEqual(voice('ko_KR'))
  })

  it('does nothing for an unknown language, empty text, or without speech synthesis', () => {
    const api = stubSynth()
    speak('x', 'xx')
    speak('  ', 'en')
    expect(api.speak).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
    expect(() => speak('house', 'en')).not.toThrow()
  })
})

describe('canSpeak', () => {
  it('no voices yet (Chrome loads them later) → maybe, so true', () => {
    stubSynth([])
    expect(canSpeak('ko')).toBe(true)
    expect(canSpeak('en')).toBe(true)
  })

  it('voices without Korean → false for ko, true for en', () => {
    stubSynth([voice('en-US'), voice('de-DE')])
    expect(canSpeak('ko')).toBe(false)
    expect(canSpeak('en')).toBe(true)
    expect(canSpeak('fr')).toBe(false)
  })

  it('an unknown language → false', () => {
    stubSynth([])
    expect(canSpeak('xx')).toBe(false)
  })

  it('no speechSynthesis → false', () => {
    vi.unstubAllGlobals()
    delete (window as { speechSynthesis?: unknown }).speechSynthesis
    expect(canSpeak('en')).toBe(false)
  })
})
