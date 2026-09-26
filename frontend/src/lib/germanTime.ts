// Parses German clock-time expressions into hours/minutes.
// Examples: "halb acht" → 7:30, "Viertel nach drei" → 3:15, "fünf vor halb neun" → 8:25,
// "acht Uhr" → 8:00, "14:30" → 14:30, "um 7 Uhr abends" → 19:00.

export interface ClockTime {
  h: number // 0–23
  m: number // 0–59
  /** true when the phrase fixes AM/PM (24h digits or morgens/abends…) */
  exact: boolean
}

const NUM: Record<string, number> = {
  null: 0, ein: 1, eins: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8,
  neun: 9, zehn: 10, elf: 11, zwölf: 12, dreizehn: 13, vierzehn: 14, fünfzehn: 15,
  sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19, zwanzig: 20,
  einundzwanzig: 21, zweiundzwanzig: 22, dreiundzwanzig: 23, vierundzwanzig: 24,
  fünfundzwanzig: 25, sechsundzwanzig: 26, siebenundzwanzig: 27, achtundzwanzig: 28,
  neunundzwanzig: 29, dreißig: 30, fünfunddreißig: 35, vierzig: 40, fünfundvierzig: 45,
  fünfzig: 50, fünfundfünfzig: 55,
}

const W = '(\\d{1,2}|[\\p{L}]+)'
const L = '(?<![\\p{L}\\d])'
const R = '(?![\\p{L}\\d])'
const re = (s: string) => new RegExp(L + s + R, 'iu')

const num = (s: string): number | undefined => (/^\d+$/.test(s) ? Number(s) : NUM[s.toLowerCase()])

// In German "halb acht" means half *before* eight, so the hour is the previous one.
const prev = (h: number) => (h === 1 ? 12 : h === 13 ? 12 : h - 1)

function applyPeriod(t: ClockTime, text: string): ClockTime {
  if (t.exact || t.h > 12) return { ...t, exact: true }
  const s = text.toLowerCase()
  if (/(abends|nachmittags|am abend|am nachmittag)/.test(s)) return { h: t.h === 12 ? 12 : t.h + 12, m: t.m, exact: true }
  if (/nachts|in der nacht/.test(s)) return { h: t.h >= 9 && t.h < 12 ? t.h + 12 : t.h === 12 ? 0 : t.h, m: t.m, exact: true }
  if (/(morgens|früh|vormittags|am morgen|am vormittag)/.test(s)) return { h: t.h === 12 ? 0 : t.h, m: t.m, exact: true }
  if (/mittags/.test(s)) return { h: t.h < 6 ? t.h + 12 : t.h, m: t.m, exact: true }
  return t
}

const ok = (h?: number, m?: number) => h !== undefined && m !== undefined && h >= 0 && h <= 24 && m >= 0 && m < 60

export function parseGermanTime(text: string): ClockTime | null {
  let x: RegExpExecArray | null
  const mk = (h: number | undefined, m: number | undefined, exact = false): ClockTime | null =>
    ok(h, m) ? applyPeriod({ h: h! % 24, m: m!, exact }, text) : null

  // 14:30, 8.15 Uhr
  if ((x = re('(\\d{1,2})[:.](\\d{2})').exec(text))) {
    const h = Number(x[1])
    return mk(h, Number(x[2]), h > 12 || h === 0 || x[1].startsWith('0'))
  }
  // fünf nach/vor halb acht
  if ((x = re(`${W}\\s+(nach|vor)\\s+halb\\s+${W}`).exec(text))) {
    const n = num(x[1]), H = num(x[3])
    if (n !== undefined && H !== undefined) return mk(prev(H), x[2].toLowerCase() === 'nach' ? 30 + n : 30 - n)
  }
  // Viertel nach/vor drei
  if ((x = re(`viertel\\s+(nach|vor)\\s+${W}`).exec(text))) {
    const H = num(x[2])
    if (H !== undefined) return x[1].toLowerCase() === 'nach' ? mk(H, 15) : mk(prev(H), 45)
  }
  // dreiviertel acht (= 7:45), viertel acht (= 7:15, regional)
  if ((x = re(`(dreiviertel|drei\\s+viertel)\\s+${W}`).exec(text))) {
    const H = num(x[2])
    if (H !== undefined) return mk(prev(H), 45)
  }
  if ((x = re(`viertel\\s+${W}`).exec(text))) {
    const H = num(x[1])
    if (H !== undefined) return mk(prev(H), 15)
  }
  // halb acht
  if ((x = re(`halb\\s+${W}`).exec(text))) {
    const H = num(x[1])
    if (H !== undefined) return mk(prev(H), 30)
  }
  // zehn nach acht, fünf vor neun
  if ((x = re(`${W}\\s+(nach|vor)\\s+${W}`).exec(text))) {
    const n = num(x[1]), H = num(x[3])
    if (n !== undefined && H !== undefined && n > 0 && n < 30 && H >= 1 && H <= 24)
      return x[2].toLowerCase() === 'nach' ? mk(H, n) : mk(prev(H), 60 - n)
  }
  // acht Uhr, 8 Uhr dreißig
  if ((x = re(`${W}\\s*uhr(?:\\s+${W})?`).exec(text))) {
    const h = num(x[1])
    const m = x[2] ? num(x[2]) ?? 0 : 0
    if (h !== undefined) return mk(h, m, h > 12)
  }
  return null
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "19:30", or "07:30 / 19:30" when AM/PM is ambiguous. */
export function formatClock(t: ClockTime): string {
  const main = `${pad(t.h)}:${pad(t.m)}`
  if (t.exact) return main
  const other = t.h === 12 ? `00:${pad(t.m)}` : `${pad(t.h + 12)}:${pad(t.m)}`
  return `${main} / ${other}`
}
