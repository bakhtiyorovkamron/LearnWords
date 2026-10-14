import type { HeroPhrase } from '../api/endpoints'

// The six stages (index 0-5) — famous Germans from little Mozart to Goethe. Thresholds mirror
// heroStageMinCount on the backend (service/hero.go); the stage itself always comes from the server.
export const STAGE_MIN = [0, 50, 200, 500, 1300, 2400] as const
export const LAST_STAGE = 5

type Lang = 'ru' | 'en' | 'uz'
type Line = { de: string } & Record<Lang, string>

// Each stage's own phrases — the same as docs/hero-prototype.html and heroStageSay in
// service/hero_phrases.go (the server uses them when the user has no suitable learned noun).
export const STAGE_SAY: readonly (readonly Line[])[] = [
  [
    { de: 'Musik!', ru: 'Музыка!', en: 'Music!', uz: 'Musiqa!' },
    { de: 'Bravo!', ru: 'Браво!', en: 'Bravo!', uz: 'Barakalla!' },
    { de: 'Noch mal!', ru: 'Ещё раз!', en: 'Once more!', uz: 'Yana bir marta!' },
  ],
  [
    { de: 'Es war einmal…', ru: 'Жили-были…', en: 'Once upon a time…', uz: 'Bir bor ekan…' },
    { de: 'Ich mag Märchen.', ru: 'Я люблю сказки.', en: 'I like fairy tales.', uz: 'Men ertaklarni yaxshi koʻraman.' },
  ],
  [
    { de: 'Ich schreibe ein Gedicht.', ru: 'Я пишу стихотворение.', en: "I'm writing a poem.", uz: 'Men sheʼr yozyapman.' },
    { de: 'Freude!', ru: 'Радость!', en: 'Joy!', uz: 'Quvonch!' },
  ],
  [
    { de: 'Ich höre Musik in meinem Kopf.', ru: 'Я слышу музыку в голове.', en: 'I hear music in my head.', uz: 'Boshimda musiqa eshitaman.' },
    { de: 'Noch einmal, bitte!', ru: 'Ещё раз, пожалуйста!', en: 'Once more, please!', uz: 'Yana bir marta, iltimos!' },
  ],
  [
    { de: 'Kannst du mir bitte den Weg zeigen?', ru: 'Покажешь мне дорогу?', en: 'Can you show me the way, please?', uz: 'Menga yoʻlni koʻrsatib bera olasanmi?' },
    { de: 'Ich reise gern um die Welt.', ru: 'Я люблю путешествовать по миру.', en: 'I love travelling around the world.', uz: 'Men dunyo boʻylab sayohat qilishni yaxshi koʻraman.' },
  ],
  [
    { de: 'Ich habe es geschafft!', ru: 'У меня получилось!', en: 'I did it!', uz: 'Men uddaladim!' },
    { de: 'Mehr Licht!', ru: 'Больше света! (по легенде, последние слова Гёте)', en: "More light! (Goethe's last words, as legend has it)", uz: 'Koʻproq yorugʻlik! (rivoyatga koʻra, Gyotening soʻnggi soʻzlari)' },
    { de: 'Ich lese gern deutsche Bücher.', ru: 'Я люблю читать немецкие книги.', en: 'I like reading German books.', uz: 'Men nemischa kitoblarni oʻqishni yaxshi koʻraman.' },
  ],
]

// Training reactions (from the prototype): no server request involved.
export const REACTIONS = {
  correct: { de: 'Richtig!', ru: 'Верно!', en: 'Right!', uz: 'Toʻgʻri!' },
  wrong: { de: 'Hmm…', ru: 'Хм…', en: 'Hmm…', uz: 'Hmm…' },
} as const satisfies Record<string, Line>

const lang = (l: string): Lang => (l === 'en' || l === 'uz' ? l : 'ru')

export function linePhrase(line: Line, uiLang: string): HeroPhrase {
  return { de: line.de, translation: line[lang(uiLang)] }
}

export function stagePhrases(stage: number, uiLang: string): HeroPhrase[] {
  return STAGE_SAY[clampStage(stage)].map((l) => linePhrase(l, uiLang))
}

export const clampStage = (s: number) => Math.min(Math.max(Math.trunc(s), 0), LAST_STAGE)

/** The API counts stages 1-6; the drawing uses 0-5. */
export const stageFromApi = (apiStage: number) => clampStage(apiStage - 1)

/** Learned / almost-learned shares of the current stage's span, in % (prototype's setProgress). */
export function stageProgress(stage: number, learned: number, almost: number) {
  const s = clampStage(stage)
  if (s === LAST_STAGE) return { learnedPct: 100, almostPct: 0 }
  const base = STAGE_MIN[s], span = STAGE_MIN[s + 1] - base || 1
  const learnedPct = Math.max(0, Math.min(100, ((learned - base) / span) * 100))
  const almostPct = Math.max(0, Math.min(100 - learnedPct, (almost / span) * 100))
  return { learnedPct, almostPct }
}
