// heroPhrases.ts: every line the hero can say, in one place so it's easy to edit. The hero
// always speaks German; `translation(lang)` below picks the interface-language line shown when
// the user taps the speech bubble. No AI involved — fixed, friendly lines only.

export type HeroPhraseKey =
  | 'correct'
  | 'wrong'
  | 'streak5'
  | 'streak10'
  | 'streak20'
  | 'wordLearned'
  | 'sessionFinished'
  | 'returnAfterAbsence'
  | 'grown'
  | 'sleepy'

export type HeroLang = 'ru' | 'en' | 'uz'

interface Phrase {
  de: string
  ru: string
  en: string
  uz: string
}

// One or more lines per key; HeroWidget picks one at random when there's a choice. All lines
// are warm and encouraging on purpose — never teasing, even for a wrong answer.
const PHRASES: Record<HeroPhraseKey, Phrase[]> = {
  correct: [
    { de: 'Super!', ru: 'Супер!', en: 'Super!', uz: 'Ajoyib!' },
    { de: 'Richtig!', ru: 'Верно!', en: 'Correct!', uz: 'Toʻgʻri!' },
    { de: 'Toll!', ru: 'Здорово!', en: 'Great!', uz: 'Zoʻr!' },
  ],
  wrong: [
    { de: 'Ach nein!', ru: 'Ох, нет!', en: 'Oh no!', uz: 'Voy, yoʻq!' },
    { de: 'Schade!', ru: 'Жаль!', en: 'Too bad!', uz: 'Afsus!' },
    { de: 'Nicht schlimm!', ru: 'Не страшно!', en: 'No worries!', uz: 'Zarari yoʻq!' },
  ],
  streak5: [
    { de: 'Fünf richtig!', ru: 'Пять верно подряд!', en: 'Five in a row!', uz: 'Beshta ketma-ket toʻgʻri!' },
  ],
  streak10: [
    { de: 'Zehn richtig!', ru: 'Десять верно подряд!', en: 'Ten in a row!', uz: 'Oʻnta ketma-ket toʻgʻri!' },
  ],
  streak20: [
    { de: 'Zwanzig richtig!', ru: 'Двадцать верно подряд!', en: 'Twenty in a row!', uz: 'Yigirmata ketma-ket toʻgʻri!' },
  ],
  wordLearned: [
    { de: 'Neues Wort gelernt!', ru: 'Новое слово выучено!', en: 'New word learned!', uz: 'Yangi soʻz oʻrganildi!' },
  ],
  sessionFinished: [
    { de: 'Gut gemacht!', ru: 'Молодец!', en: 'Well done!', uz: 'Barakalla!' },
  ],
  returnAfterAbsence: [
    { de: 'Da bist du ja wieder!', ru: 'А вот и ты!', en: 'There you are again!', uz: 'Qaytib kelganingiz yaxshi boʻldi!' },
  ],
  grown: [
    { de: 'Ich bin gewachsen!', ru: 'Я вырос!', en: 'I have grown!', uz: 'Men oʻsdim!' },
  ],
  sleepy: [
    { de: 'Zzz...', ru: 'Zzz...', en: 'Zzz...', uz: 'Zzz...' },
  ],
}

// Stage 1 ("Младенец"/"Newborn"): only correct/wrong have an explicitly shortened, one-word
// form in the spec — the other keys are already short enough or have no natural one-word form.
const STAGE1_OVERRIDES: Partial<Record<HeroPhraseKey, Phrase[]>> = {
  correct: [{ de: 'Super!', ru: 'Супер!', en: 'Super!', uz: 'Ajoyib!' }],
  wrong: [{ de: 'Oh!', ru: 'Ой!', en: 'Oh!', uz: 'Voy!' }],
}

/** Picks one line for `key`, shortened for stage 1. `pick(n)` must return 0 <= x < n (injectable for tests). */
export function pickHeroPhrase(
  key: HeroPhraseKey,
  stage: number,
  pick: (n: number) => number = (n) => Math.floor(Math.random() * n),
): Phrase {
  const pool = (stage <= 1 && STAGE1_OVERRIDES[key]) || PHRASES[key]
  return pool[pick(pool.length)]
}

export function heroTranslation(phrase: Phrase, lang: HeroLang): string {
  return phrase[lang] ?? phrase.ru
}
