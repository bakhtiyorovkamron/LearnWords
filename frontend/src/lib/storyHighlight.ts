import type { StoryWord } from '../api/endpoints'

// Highlighting of the day's words in a story — by lemma, not by exact spelling: "kommen" is
// found as "kommt", "Stift" as "Stifte". Sources, in order of reliability:
//   1. **bold** markers the AI put around the words;
//   2. `forms` — the exact spellings the proofreading step reported for each word;
//   3. the lemma itself plus regular German endings (conjugation / declension).

export interface Segment { text: string; hl: boolean }

const ARTICLE = /^(der|die|das)\s+/i
const VERB_ENDINGS = ['e', 'st', 't', 'en', 'et', 'est', 'te', 'test', 'ten', 'tet', 'n']
const NOMINAL_ENDINGS = ['e', 'en', 'er', 'es', 'em', 'n', 's']

function looksLikeVerb(w: StoryWord, base: string): boolean {
  if (w.part_of_speech) return w.part_of_speech === 'verb'
  // Unchecked older word: a lower-case word ending in -en/-eln/-ern is most likely an infinitive.
  return /^[a-zäöüß]+(en|ln|rn)$/.test(base)
}

/** All lower-case spellings that count as this word. */
export function wordForms(w: StoryWord): Set<string> {
  const out = new Set<string>()
  const add = (s?: string) => { if (s && s.trim()) out.add(s.trim().toLowerCase()) }
  const core = w.word.split(' / ')[0].replace(ARTICLE, '')
  const base = (w.lemma || core).replace(ARTICLE, '')
  add(base)
  add(core)
  w.forms?.forEach(add)
  if (base.includes(' ')) return out // phrases: only exact spellings
  const lower = base.toLowerCase()
  if (looksLikeVerb(w, base)) {
    const stem = lower.endsWith('en') ? lower.slice(0, -2) : lower.slice(0, -1)
    if (stem.length >= 3) {
      VERB_ENDINGS.forEach((e) => add(stem + e))
      add(`ge${stem}t`) // regular Partizip II
    }
  } else if (lower.length >= 3) {
    NOMINAL_ENDINGS.forEach((e) => add(lower + e))
  }
  return out
}

// Letters incl. umlauts/ß (and other Latin letters), hyphenated words stay one token.
const TOKEN = /([\p{L}][\p{L}\p{M}'-]*)/u

/** Splits `text` into highlighted / plain segments. */
export function highlightStory(text: string, words: StoryWord[]): Segment[] {
  const forms = new Set<string>()
  words.forEach((w) => wordForms(w).forEach((f) => forms.add(f)))
  // Multi-word forms (phrases) are matched as substrings first.
  const phrases = [...forms].filter((f) => f.includes(' ')).sort((a, b) => b.length - a.length)

  const out: Segment[] = []
  const push = (t: string, hl: boolean) => {
    if (!t) return
    const last = out[out.length - 1]
    if (last && last.hl === hl) last.text += t
    else out.push({ text: t, hl })
  }

  const plainPart = (part: string) => {
    let rest = part
    while (rest) {
      const lower = rest.toLowerCase()
      let best: { i: number; len: number } | null = null
      for (const p of phrases) {
        const i = lower.indexOf(p)
        if (i >= 0 && (!best || i < best.i)) best = { i, len: p.length }
      }
      const head = best ? rest.slice(0, best.i) : rest
      for (const tok of head.split(TOKEN)) push(tok, TOKEN.test(tok) && forms.has(tok.toLowerCase()))
      if (!best) break
      push(rest.slice(best.i, best.i + best.len), true)
      rest = rest.slice(best.i + best.len)
    }
  }

  for (const part of text.split(/(\*\*[^*]+\*\*)/g)) {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) push(part.slice(2, -2), true)
    else plainPart(part)
  }
  return out
}
