import type { WordCard } from '../api/types'

// What "___" in the card's example stands for: the exact form that was cut out ("schmeckt",
// "den Tisch"). Old cards have none yet — the word itself is shown then.
export function gapForm(card: Pick<WordCard, 'word' | 'example_gap_answer'>): string {
  return card.example_gap_answer?.trim() || card.word
}

// The form differs from the dictionary word (ignoring case): worth a hint "schmeckt ← schmecken".
export function formDiffers(form: string, word: string): boolean {
  return form.trim().toLowerCase() !== word.trim().toLowerCase()
}

// The example as a plain sentence, with the real form in place of the gap.
export function fillGap(card: Pick<WordCard, 'word' | 'example_sentence' | 'example_gap_answer'>): string {
  return (card.example_sentence ?? '').replace('___', gapForm(card))
}
