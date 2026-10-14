// Drawing of the German hero — ported from docs/hero-prototype.html. eyes / mouth / cap / hair /
// outfit / handItem / figure are the prototype's functions unchanged (only typed, and `mood`
// passed in instead of read from a global). buildHero() is the prototype's build() returning
// markup; the only differences are what several heroes on one page need: element ids became
// classes (h-char, h-torso, …) and gradient ids get a per-instance prefix.

export type HeroMood = 'idle' | 'sleepy' | 'happy' | 'think' | 'sad'

interface StageArt {
  r: number; bh: number; bw: number; lh: number
  c1: string; c2: string; pants: string; hair: string; acc: string
}

const SKIN = '#F5CDA8', SKIN2 = '#E9B48C', HAIR = '#2A1C15', LIME = '#CFFA4D'

export const STAGE_ART: readonly StageArt[] = [
  { r: 56, bh: 64, bw: 90, lh: 22, c1: '#B8323A', c2: '#8F2530', pants: '#F1ECE0', hair: 'mozart', acc: 'mozart' },
  { r: 48, bh: 76, bw: 78, lh: 42, c1: '#2F5A45', c2: '#244636', pants: '#2A2F3A', hair: 'grimm', acc: 'grimm' },
  { r: 47, bh: 88, bw: 78, lh: 58, c1: '#7A5236', c2: '#5E3F29', pants: '#E6DFCF', hair: 'schiller', acc: 'schiller' },
  { r: 46, bh: 98, bw: 82, lh: 72, c1: '#2B303D', c2: '#20242E', pants: '#2B303D', hair: 'beethoven', acc: 'beethoven' },
  { r: 44, bh: 108, bw: 86, lh: 86, c1: '#6E7A3A', c2: '#56602C', pants: '#C9B48A', hair: 'humboldt', acc: 'humboldt' },
  { r: 44, bh: 112, bw: 90, lh: 84, c1: '#2D4373', c2: '#22335A', pants: '#E6DFCF', hair: 'goethe', acc: 'goethe' },
]

function eyes(cx: number, cy: number, r: number, m: HeroMood, frown: boolean) {
  const ex = r * .36, ey = cy + r * .1
  if (m === 'sleepy') return [-1, 1].map((s) => `<path d="M${cx + s * ex - r * .15} ${ey} q${r * .15} ${r * .12} ${r * .3} 0" stroke="${HAIR}" stroke-width="${r * .07}" fill="none" stroke-linecap="round"/>`).join('')
  if (m === 'happy') return [-1, 1].map((s) => `<path d="M${cx + s * ex - r * .14} ${ey + r * .04} q${r * .14} ${-r * .19} ${r * .28} 0" stroke="${HAIR}" stroke-width="${r * .075}" fill="none" stroke-linecap="round"/>`).join('')
  const look = m === 'think' ? [r * .05, -r * .06] : [0, 0]
  let brows = ''
  if (m === 'sad') brows = [-1, 1].map((s) => `<path d="M${cx + s * ex - r * .15} ${ey - r * .2 + (s > 0 ? -r * .06 : 0)} L${cx + s * ex + r * .15} ${ey - r * .2 + (s < 0 ? -r * .06 : 0)}" stroke="${HAIR}" stroke-width="${r * .05}" stroke-linecap="round"/>`).join('')
  else if (m === 'think') brows = `<path d="M${cx + ex - r * .15} ${ey - r * .3} q${r * .15} ${-r * .08} ${r * .3} 0" stroke="${HAIR}" stroke-width="${r * .05}" fill="none" stroke-linecap="round"/>`
  else if (frown) brows = [-1, 1].map((s) => `<path d="M${cx + s * ex - r * .16} ${ey - r * .26 + (s < 0 ? 0 : r * .06)} L${cx + s * ex + r * .16} ${ey - r * .26 + (s < 0 ? r * .06 : 0)}" stroke="#3A3A3A" stroke-width="${r * .07}" stroke-linecap="round"/>`).join('')
  return `${brows}<g class="eyes">${[-1, 1].map((s) => `<ellipse cx="${cx + s * ex}" cy="${ey}" rx="${r * .11}" ry="${r * .14}" fill="${HAIR}"/><circle cx="${cx + s * ex + look[0] + r * .035}" cy="${ey + look[1] - r * .05}" r="${r * .045}" fill="#fff"/>`).join('')}</g>`
}

function mouth(cx: number, cy: number, r: number, m: HeroMood) {
  const my = cy + r * .48
  if (m === 'happy') return `<path d="M${cx - r * .22} ${my - r * .05} q${r * .22} ${r * .32} ${r * .44} 0 z" fill="#8A2F33"/><path d="M${cx - r * .1} ${my + r * .1} q${r * .1} ${r * .06} ${r * .2} 0" fill="#F27C86"/>`
  if (m === 'sad') return `<path d="M${cx - r * .16} ${my + r * .08} q${r * .16} ${-r * .15} ${r * .32} 0" stroke="${HAIR}" stroke-width="${r * .055}" fill="none" stroke-linecap="round"/>`
  if (m === 'sleepy') return `<ellipse cx="${cx + r * .04}" cy="${my}" rx="${r * .06}" ry="${r * .08}" fill="#8A2F33"/>`
  if (m === 'think') return `<path d="M${cx - r * .12} ${my + r * .02} q${r * .12} ${-r * .05} ${r * .26} ${r * .02}" stroke="${HAIR}" stroke-width="${r * .055}" fill="none" stroke-linecap="round"/>`
  return `<path d="M${cx - r * .17} ${my - r * .02} q${r * .17} ${r * .18} ${r * .34} 0" stroke="${HAIR}" stroke-width="${r * .055}" fill="none" stroke-linecap="round"/>`
}

const cap = (cx: number, cy: number, r: number, col: string, depth: number) => `<path d="M${cx - r * 1.02} ${cy + r * .1} C${cx - r * 1.12} ${cy - r * .95} ${cx - r * .55} ${cy - r * 1.13} ${cx} ${cy - r * 1.1} C${cx + r * .55} ${cy - r * 1.13} ${cx + r * 1.12} ${cy - r * .95} ${cx + r * 1.02} ${cy + r * .1} C${cx + r * .9} ${cy - r * .35} ${cx + r * .55} ${cy - depth * r} ${cx} ${cy - depth * r - r * .04} C${cx - r * .55} ${cy - depth * r} ${cx - r * .9} ${cy - r * .35} ${cx - r * 1.02} ${cy + r * .1}Z" fill="${col}"/>`

function hair(cx: number, cy: number, r: number, style: string, alt: boolean) {
  if (style === 'goethe' || style === 'mozart') {
    const G = style === 'mozart' ? '#F6F3EC' : '#D9D5CC', G2 = style === 'mozart' ? '#D8D2C4' : '#B9B4A9'
    return (style === 'mozart' ? `<path d="M${cx + r * .85} ${cy + r * .15} l${r * .35} ${r * .25} l${-r * .05} ${-r * .3} l${r * .12} ${-r * .12}z" fill="#1E1E2A"/>` : '')
      + cap(cx, cy, r, G, .66)
      + [-1, 1].map((s) => `<ellipse cx="${cx + s * r * .98}" cy="${cy - r * .12}" rx="${r * .2}" ry="${r * .13}" fill="${G}" stroke="${G2}" stroke-width="2"/><ellipse cx="${cx + s * r * 1.0}" cy="${cy + r * .12}" rx="${r * .18}" ry="${r * .12}" fill="${G}" stroke="${G2}" stroke-width="2"/>`).join('')
      + `<path d="M${cx - r * .5} ${cy - r * .86} q${r * .5} ${-r * .18} ${r * 1.0} 0" stroke="${G2}" stroke-width="2.5" fill="none"/>`
  }
  if (style === 'grimm') {
    const c = alt ? '#4A3426' : '#2E2019'
    return cap(cx, cy, r, c, alt ? .5 : .42) + [-1, 1].map((s) => `<path d="M${cx + s * r * .96} ${cy - r * .2} q${s * r * .12} ${r * .35} ${s * r * .02} ${r * .62} q${-s * r * .1} ${-r * .1} ${-s * r * .12} ${-r * .5}z" fill="${c}"/>`).join('')
      + `<path d="M${cx + (alt ? -r * .3 : r * .1)} ${cy - r * .98} q${r * .2} ${r * .25} ${r * .45} ${r * .32}" stroke="${alt ? '#5B4232' : '#45302A'}" stroke-width="3" fill="none"/>`
  }
  if (style === 'schiller') {
    const c = '#A3603A'
    return `<path d="M${cx - r * .9} ${cy - r * .3} q${-r * .25} ${r * .7} ${r * .05} ${r * 1.0} l${r * .12} ${-r * .4}z M${cx + r * .9} ${cy - r * .3} q${r * .25} ${r * .7} ${-r * .05} ${r * 1.0} l${-r * .12} ${-r * .4}z" fill="${c}"/>` + cap(cx, cy, r, c, .62)
      + `<path d="M${cx - r * .2} ${cy - r * .9} q${r * .35} ${r * .1} ${r * .55} ${r * .3}" stroke="#7E4528" stroke-width="3" fill="none"/>`
  }
  if (style === 'beethoven') {
    const c = '#3B3B40', pts: string[] = []
    for (let i = 0; i <= 14; i++) { const a = Math.PI * (1.05 + i * 0.9 / 14) - 0.0, rr = r * (i % 2 ? 1.12 : 1.32); pts.push(`${cx + Math.cos(a) * rr * 1.0} ${cy - r * .05 + Math.sin(a) * rr}`) }
    return `<path d="M${cx - r * 1.1} ${cy + r * .35} L${pts.join(' L')} L${cx + r * 1.1} ${cy + r * .35} Q${cx + r * .95} ${cy - r * .45} ${cx} ${cy - r * .62} Q${cx - r * .95} ${cy - r * .45} ${cx - r * 1.1} ${cy + r * .35}Z" fill="${c}"/>`
      + `<path d="M${cx - r * .6} ${cy - r * .95} l${r * .15} ${r * .3} M${cx + r * .3} ${cy - r * 1.05} l${-r * .08} ${r * .32}" stroke="#55555C" stroke-width="3"/>`
  }
  if (style === 'humboldt') {
    const c = '#6B4426'
    return cap(cx, cy, r, c, .5) + `<path d="M${cx - r * .7} ${cy - r * .75} q${r * .3} ${r * .35} ${r * .15} ${r * .55} M${cx + r * .05} ${cy - r * .95} q${r * .25} ${r * .3} ${r * .05} ${r * .5} M${cx + r * .55} ${cy - r * .8} q${r * .2} ${r * .25} ${r * .08} ${r * .45}" stroke="#8A5A36" stroke-width="3" fill="none" stroke-linecap="round"/>`
  }
  return ''
}

function outfit(s: StageArt, cx: number, bodyTop: number, bw: number) {
  const bh = s.bh; let f = ''
  const lapels = (col: string) => `<path d="M${cx - bw / 2 + 2} ${bodyTop + 22} l${bw * .28} -24 l10 ${bh * .6}z M${cx + bw / 2 - 2} ${bodyTop + 22} l${-bw * .28} -24 l-10 ${bh * .6}z" fill="${col}"/>`
  const jabot = `<path d="M${cx - 14} ${bodyTop + 2} q14 10 28 0 q-4 16 -6 28 q-8 8 -16 0 q-2 -14 -6 -28z" fill="#FBF8F1"/><path d="M${cx - 8} ${bodyTop + 15} q8 6 16 0 M${cx - 7} ${bodyTop + 24} q7 5 14 0" stroke="#D9D2C2" stroke-width="2" fill="none"/>`
  const buttons = (col: string, n: number) => [...Array(n)].map((_, i) => `<circle cx="${cx + bw * .16}" cy="${bodyTop + bh * .42 + i * 15}" r="3.3" fill="${col}"/>`).join('')
  if (s.acc === 'mozart') f = `<path d="M${cx - bw * .18} ${bodyTop + 4} v${bh - 8} M${cx + bw * .18} ${bodyTop + 4} v${bh - 8}" stroke="#E2C46A" stroke-width="3"/>` + jabot + buttons('#E2C46A', 2)
  if (s.acc === 'grimm') f = lapels('#3C7258') + `<path d="M${cx - 16} ${bodyTop - 2} h32 l-4 20 h-24z" fill="#FBF8F1"/><path d="M${cx - 9} ${bodyTop + 14} h18 l-9 12z" fill="#2A2F3A"/>`
  if (s.acc === 'schiller') f = lapels('#93653F') + `<path d="M${cx - 18} ${bodyTop - 2} l18 30 l18 -30 l-6 -2 l-12 18 l-12 -18z" fill="#FBF8F1"/>` + buttons('#C9A65A', 2)
  if (s.acc === 'beethoven') f = lapels('#3A4152') + `<path d="M${cx - 20} ${bodyTop} q20 14 40 0 q-2 10 -8 14 l6 26 l-12 -4 l-6 -18 q-10 -4 -20 -18z" fill="#C8323A"/>`
  if (s.acc === 'humboldt') f = lapels('#808C46') + `<path d="M${cx - bw / 2 + 8} ${bodyTop + 8} L${cx + bw / 2 - 4} ${bodyTop + bh * .78}" stroke="#7A4E2A" stroke-width="7" stroke-linecap="round"/><g transform="translate(${cx + bw / 2 - 12} ${bodyTop + bh * .72})"><rect x="-8" y="-12" width="30" height="24" rx="10" fill="#3F7A55"/><rect x="-8" y="-3" width="30" height="5" fill="#2F5E41"/></g>` + jabot.replace(/FBF8F1/, 'F3EEE2')
  if (s.acc === 'goethe') f = lapels('#3B5694') + `<path d="M${cx - bw * .2} ${bodyTop - 4} q${bw * .2} 14 ${bw * .4} 0 l-6 16 q-${bw * .14} 8 -${bw * .28} 0z" fill="#3B5694"/>` + jabot + buttons('#E2C46A', 3)
  return f
}

function handItem(acc: string) {
  if (acc === 'mozart') return `<g transform="rotate(-35)"><ellipse cx="0" cy="6" rx="9" ry="12" fill="#B5652E"/><ellipse cx="0" cy="-6" rx="7" ry="8" fill="#B5652E"/><rect x="-2" y="-30" width="4" height="22" fill="#5A3418"/><path d="M-1 -10 v28" stroke="#F2E6C9" stroke-width="1"/></g>`
  if (acc === 'grimm') return `<g transform="rotate(-8)"><rect x="-18" y="-16" width="34" height="42" rx="3" fill="#7A2E2E"/><rect x="-14" y="-12" width="26" height="34" rx="2" fill="none" stroke="#E2C46A" stroke-width="1.5"/><text x="-1" y="8" text-anchor="middle" font-family="Georgia,serif" font-size="7" fill="#E2C46A">Märchen</text></g>`
  if (acc === 'schiller') return `<g transform="rotate(-12)"><rect x="-6" y="-20" width="14" height="44" rx="7" fill="#F2E8CF" stroke="#CDBE98" stroke-width="1.5"/><path d="M-2 -10 h8 M-2 -2 h8 M-2 6 h6" stroke="#9C8F80" stroke-width="1.2"/></g>`
  if (acc === 'beethoven') return `<g transform="rotate(-10)"><rect x="-14" y="-18" width="28" height="36" rx="2" fill="#FBF8F1"/><path d="M-10 -10 h20 M-10 -5 h20 M-10 0 h20 M-10 5 h20 M-10 10 h20" stroke="#B9B4A9" stroke-width="1"/><circle cx="-5" cy="2" r="2.2" fill="#2A2F3A"/><circle cx="3" cy="-3" r="2.2" fill="#2A2F3A"/><path d="M-3 2 v-10 M5 -3 v-10" stroke="#2A2F3A" stroke-width="1.2"/></g>`
  if (acc === 'humboldt') return `<g><path d="M0 18 q-2 -20 4 -34" stroke="#3F7A55" stroke-width="3" fill="none"/><ellipse cx="-6" cy="-6" rx="8" ry="4" fill="#5FB36F" transform="rotate(-30 -6 -6)"/><ellipse cx="10" cy="-12" rx="8" ry="4" fill="#5FB36F" transform="rotate(25 10 -12)"/><circle cx="4" cy="-18" r="4" fill="#FF8F7A"/></g>`
  if (acc === 'goethe') return `<g transform="rotate(-25)"><path d="M0 18 L2 -40 Q16 -30 10 -6 Q8 6 0 18Z" fill="#FBF8F1" stroke="#C9C1B0" stroke-width="1.5"/><path d="M0 18 L3 -36" stroke="#9C8F80" stroke-width="1.5"/></g>`
  return ''
}

function figure(s: StageArt, cx: number, main: boolean, alt: boolean, mood: HeroMood) {
  const ground = 356, legTop = ground - s.lh - 6, bodyTop = legTop - s.bh + 14, r = s.r, hy = bodyTop - r * .72, bw = s.bw, armLen = s.bh * .62 + 8, aw = bw * .2
  const arm = (side: number, id: string) => {
    const sx = cx + side * (bw / 2 - 6), sy = bodyTop + 16, item = main && side > 0 ? handItem(s.acc) : ''
    return `<g ${main ? `id="${id}"` : ''}><path d="M${sx} ${sy} q${side * 12} ${armLen * .55} ${side * 6} ${armLen}" stroke="${alt ? '#284E3C' : s.c1}" stroke-width="${aw}" fill="none" stroke-linecap="round"/>${item ? `<g transform="translate(${sx + side * 6 + 4} ${sy + armLen + 2})">${item}</g>` : ''}<circle cx="${sx + side * 6}" cy="${sy + armLen}" r="${aw * .62}" fill="${SKIN}"/></g>`
  }
  const legs = [-1, 1].map((d) => `<rect x="${cx + d * bw * .2 - bw * .13}" y="${legTop}" width="${bw * .26}" height="${s.lh + 8}" rx="${bw * .13}" fill="${s.pants}"/><ellipse cx="${cx + d * bw * .22}" cy="${ground + 2}" rx="${bw * .19}" ry="${bw * .09}" fill="#0A1A12"/>`).join('')
  return {
    hy, r, svg: `
   ${legs}
   <g ${main ? 'id="torso"' : 'class="torso2"'}>
    ${arm(-1, 'armL')}
    <rect x="${cx - bw / 2}" y="${bodyTop}" width="${bw}" height="${s.bh}" rx="${bw * .34}" fill="${alt ? '#284E3C' : 'url(#shirt)'}"/>
    ${outfit(s, cx, bodyTop, bw)}
    ${arm(1, 'armR')}
   </g>
   <g ${main ? 'id="headg"' : ''}>
    <ellipse cx="${cx - r * .98}" cy="${hy + r * .12}" rx="${r * .16}" ry="${r * .2}" fill="${SKIN2}"/>
    <ellipse cx="${cx + r * .98}" cy="${hy + r * .12}" rx="${r * .16}" ry="${r * .2}" fill="${SKIN2}"/>
    <circle cx="${cx}" cy="${hy}" r="${r}" fill="url(#skin)"/>
    ${hair(cx, hy, r, s.hair, alt)}
    <ellipse cx="${cx - r * .58}" cy="${hy + r * .38}" rx="${r * .15}" ry="${r * .09}" fill="#F59A8B" opacity=".75"/>
    <ellipse cx="${cx + r * .58}" cy="${hy + r * .38}" rx="${r * .15}" ry="${r * .09}" fill="#F59A8B" opacity=".75"/>
    ${eyes(cx, hy, r, mood, s.acc === 'beethoven')}
    ${mouth(cx, hy, r, mood)}
   </g>`,
  }
}

// Silhouette of a locked stage: every fill one colour, outlined (see buildHero).
const SIL_FILL = '#0E3324', SIL_LINE = '#1E4A35'

export interface HeroDrawing {
  markup: string // inner markup of <svg viewBox="0 0 300 380">
  hy: number // head centre y (viewBox units) — the speech bubble sits above it
  r: number // head radius
}

/** The prototype's build(): the whole picture for stage (0-5) in mood. */
export function buildHero(stage: number, mood: HeroMood, uid: string, silhouette = false): HeroDrawing {
  const s = STAGE_ART[Math.min(Math.max(Math.trunc(stage), 0), 5)]
  const m: HeroMood = silhouette ? 'idle' : mood
  const twin = s.acc === 'grimm', cx = twin ? 178 : 150
  const main = figure(s, cx, true, false, m), { hy, r } = main
  const second = twin ? `<g transform="translate(-92 6) scale(.94)" style="transform-origin:150px 356px">${figure(s, 150, false, true, m).svg}</g>` : ''
  const fx = silhouette ? ''
    : m === 'sleepy' ? [20, 16, 13].map((fs, i) => `<text class="z ${i ? 'z' + (i + 1) : ''}" x="${cx + r * .9}" y="${hy - r * .4}" font-family="Unbounded,Inter" font-weight="800" font-size="${fs}" fill="${LIME}">z</text>`).join('')
      : m === 'think' ? `<text class="q" x="${cx + r * 1.05}" y="${hy - r * .5}" font-family="Unbounded,Inter" font-weight="800" font-size="34" fill="${LIME}">?</text>`
        : m === 'sad' ? `<path class="drop" d="M${cx + r * .42} ${hy + r * .28} q-6 12 0 16 q6 -4 0 -16z" fill="#7CC4F5"/>`
          : m === 'happy' ? ([[-1.3, -.6, ''], [1.25, -.9, 'sp2'], [1.1, .5, 'sp3']] as const).map(([dx, dy, c]) => `<path class="sp ${c}" d="M${cx + r * dx} ${hy + r * dy - 9} l3 6 l6 3 l-6 3 l-3 6 l-3 -6 l-6 -3 l6 -3z" fill="${LIME}"/>`).join('') : ''

  let body = `${second}${main.svg}${fx}`
  if (silhouette) {
    // Same drawing, every paint one colour; the outline is the dilated shape behind it.
    body = body
      .replace(/fill="(?!none)[^"]*"/g, `fill="${SIL_FILL}"`)
      .replace(/stroke="(?!none)[^"]*"/g, `stroke="${SIL_FILL}"`)
      .replace(/ opacity="[^"]*"/g, '')
  }
  const defs = `<defs>
    <radialGradient id="skin" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#FFE0C2"/><stop offset="1" stop-color="${SKIN}"/></radialGradient>
    <linearGradient id="shirt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.c1}"/><stop offset="1" stop-color="${s.c2}"/></linearGradient>
    <radialGradient id="glow" cx="50%" cy="60%" r="50%"><stop offset="0" stop-color="${LIME}" stop-opacity=".18"/><stop offset="1" stop-color="${LIME}" stop-opacity="0"/></radialGradient>
    <filter id="outline" x="-10%" y="-10%" width="120%" height="120%"><feMorphology in="SourceAlpha" operator="dilate" radius="2.5" result="d"/><feFlood flood-color="${SIL_LINE}"/><feComposite in2="d" operator="in" result="o"/><feMerge><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
   </defs>`
  const markup = `${defs}
   ${silhouette ? '' : '<circle cx="150" cy="226" r="150" fill="url(#glow)"/>'}
   <ellipse id="shadow" cx="150" cy="362" rx="${twin ? 110 : s.bw * .62}" ry="9" fill="#000" opacity="${silhouette ? '.18' : '.28'}"/>
   <g id="char"${silhouette ? ' filter="url(#outline)"' : ''}>${body}</g>`

  return { markup: scope(markup, uid), hy, r }
}

// Ids → classes for the animated parts (many heroes per page), and unique gradient/filter ids.
function scope(markup: string, uid: string): string {
  return markup
    .replace(/id="(char|torso|headg|armR|armL|shadow)"/g, 'class="h-$1"')
    .replace(/id="(skin|shirt|glow|outline)"/g, `id="${uid}-$1"`)
    .replace(/url\(#(skin|shirt|glow|outline)\)/g, `url(#${uid}-$1)`)
}

/** A standalone SVG document (for <img>/canvas — used by the share picture). */
export function heroSvgDocument(stage: number, mood: HeroMood): string {
  const { markup } = buildHero(stage, mood, 'share')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 380" width="600" height="760">${markup}</svg>`
}
