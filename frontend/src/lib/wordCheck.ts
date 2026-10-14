import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { useTranslation } from 'react-i18next'
import { wordCheckApi, type WordCheck, type WordGrammar } from '../api/endpoints'

// Word check on the "Add" screen: debounced while typing (600 ms, the previous request is
// cancelled), forced on save. The server caches results, so repeated checks are cheap.

export const CHECK_DEBOUNCE_MS = 600
const MAX_CHECK_LEN = 100
const MAX_CHECK_WORDS = 6

export const collapseSpaces = (s: string) => s.trim().split(/\s+/).filter(Boolean).join(' ')

/** A single word or a short phrase in one line — longer texts are split into many cards, not checked. */
export function isCheckable(text: string): boolean {
  const t = text.trim()
  if (!t || t.includes('\n') || t.length > MAX_CHECK_LEN) return false
  return collapseSpaces(t).split(' ').length <= MAX_CHECK_WORDS
}

/** "der Stift" for nouns, otherwise the lemma. */
export function suggestionOf(r: WordCheck): string {
  return r.article ? `${r.article} ${r.lemma}` : r.lemma
}

export function grammarOf(r: WordCheck): WordGrammar | null {
  if (r.status === 'unknown' || !r.lemma) return null
  return { lemma: r.lemma, article: r.article, plural: r.plural, part_of_speech: r.part_of_speech }
}

/** Shows "Base form: …" only when it adds something to the suggestion (not for phrases). */
export function showBaseForm(r: WordCheck): boolean {
  if (r.part_of_speech === 'phrase') return false
  const input = collapseSpaces(r.input).replace(/^(der|die|das)\s+/i, '')
  return input !== r.lemma
}

export type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'done'; result: WordCheck }
  | { status: 'error' } // network / 503 / 429 — the word is simply saved unchecked

export function useWordCheck(text: string, enabled: boolean) {
  const { i18n } = useTranslation()
  const lang = i18n.language
  const normalized = collapseSpaces(text)
  const key = `${lang}\n${normalized}`
  const active = enabled && isCheckable(text)

  const cache = useRef(new Map<string, WordCheck>())
  const inflight = useRef<{ key: string; ctrl: AbortController; promise: Promise<WordCheck | null> } | null>(null)
  const [state, setState] = useState<{ key: string; state: CheckState }>({ key: '', state: { status: 'idle' } })

  const run = useCallback((k: string, input: string, nativeLang: string): Promise<WordCheck | null> => {
    const cached = cache.current.get(k)
    if (cached) {
      setState({ key: k, state: { status: 'done', result: cached } })
      return Promise.resolve(cached)
    }
    if (inflight.current?.key === k) return inflight.current.promise
    inflight.current?.ctrl.abort()
    const ctrl = new AbortController()
    setState({ key: k, state: { status: 'checking' } })
    const promise = wordCheckApi.check(input, nativeLang, ctrl.signal)
      .then((r) => {
        cache.current.set(k, r)
        setState((s) => (s.key === k ? { key: k, state: { status: 'done', result: r } } : s))
        return r
      })
      .catch((e) => {
        if (!axios.isCancel(e)) setState((s) => (s.key === k ? { key: k, state: { status: 'error' } } : s))
        return null
      })
      .finally(() => {
        if (inflight.current?.ctrl === ctrl) inflight.current = null
      })
    inflight.current = { key: k, ctrl, promise }
    return promise
  }, [])

  useEffect(() => {
    if (!active) {
      inflight.current?.ctrl.abort()
      return
    }
    if (cache.current.has(key)) {
      void run(key, normalized, lang)
      return
    }
    const id = setTimeout(() => void run(key, normalized, lang), CHECK_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [active, key, normalized, lang, run])

  useEffect(() => () => inflight.current?.ctrl.abort(), [])

  /** Checks right now (on save); resolves to null when the check is unavailable. */
  const ensure = useCallback(
    () => (active ? run(key, normalized, lang) : Promise.resolve(null)),
    [active, key, normalized, lang, run],
  )

  /** Marks `forText` as checked with `result` — used after "Use this" so the new text isn't re-checked. */
  const seed = useCallback((forText: string, result: WordCheck) => {
    cache.current.set(`${lang}\n${collapseSpaces(forText)}`, result)
  }, [lang])

  const current: CheckState = !active ? { status: 'idle' } : state.key === key ? state.state : { status: 'idle' }
  return { state: current, ensure, seed, active }
}
