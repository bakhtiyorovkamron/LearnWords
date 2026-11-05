import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Profiler } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import type { CollectionCard } from '../api/types'
import { FlipCards } from './FlipCards'

const card = (n: number, over: Partial<CollectionCard> = {}): CollectionCard => ({
  id: `c${n}`, context_id: 'x', word: `Wort${n}`, translation: `слово${n}`, transcription: '', language: 'de', created_at: '',
  example_sentence: `Das ist ___ ${n}.`, example_translation: `Это слово ${n}.`, translation_language: 'ru',
  box_level: 2, is_learned: false, next_review_at: new Date().toISOString(), reviewed_today: false, ...over,
} as CollectionCard)
const cards = (n = 5) => Array.from({ length: n }, (_, i) => card(i + 1))

const speakApi = { speak: vi.fn(), cancel: vi.fn(), getVoices: vi.fn(() => [] as { lang: string }[]), addEventListener: vi.fn() }
// jsdom has no PointerEvent: a MouseEvent carries the clientX the component reads.
class TestPointerEvent extends MouseEvent {
  pointerId: number
  pointerType: string
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.pointerType = init.pointerType ?? 'touch'
  }
}

// The animation runs on a clock the tests move by hand: requestAnimationFrame and performance.now
// (what the deck reads) both follow it, so nothing here waits for real time.
const clock = { now: 1000, id: 0, queue: new Map<number, FrameRequestCallback>() }
const realNow = performance.now.bind(performance)

beforeEach(async () => {
  clock.now = 1000
  clock.queue.clear()
  performance.now = () => clock.now
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { clock.queue.set(++clock.id, cb); return clock.id })
  vi.stubGlobal('cancelAnimationFrame', (n: number) => { clock.queue.delete(n) })
  vi.stubGlobal('PointerEvent', TestPointerEvent)
  await i18n.changeLanguage('en')
  localStorage.setItem('learning_language', 'de')
  speakApi.getVoices.mockReturnValue([])
  vi.stubGlobal('speechSynthesis', speakApi)
  vi.stubGlobal('SpeechSynthesisUtterance', function (this: { text: string }, text: string) { this.text = text })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); performance.now = realNow })

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
)
// jsdom has no layout: the stage is 508 px wide, so a card is 420 px and one page 420 + 14 px.
const STAGE_PX = 508
const PAGE_PX = 434
function sized() {
  Object.defineProperty(screen.getByTestId('deck-stage'), 'clientWidth', { configurable: true, value: STAGE_PX })
}
function view(props: Partial<Parameters<typeof FlipCards>[0]> = {}) {
  const list = props.cards ?? cards()
  const r = render(<FlipCards cards={list} total={props.total ?? list.length} direction="de_ru" resetKey="k" {...props} />, { wrapper })
  sized()
  return r
}
// The neighbours are whole cards too: these look into the current card only.
const track = () => screen.getByTestId('deck-track')
const cardButton = () => screen.getByTestId('deck-card')
const side = (name: 'learning' | 'native') => cardButton().querySelector(`[data-side="${name}"]`) as HTMLElement
const visible = () => cardButton().querySelector('[data-side][aria-hidden="false"]') as HTMLElement

/** One animation frame (16 ms by default) on the test clock. */
const frame = (ms = 16) => act(() => {
  clock.now += ms
  const callbacks = [...clock.queue.values()]
  clock.queue.clear()
  callbacks.forEach((cb) => cb(clock.now))
})
/** Runs frames until the spring has come to rest (at most 4 s). */
function settle() {
  for (let n = 0; n < 250 && clock.queue.size; n++) frame()
  expect(clock.queue.size).toBe(0)
}
const trackX = () => parseFloat(/translate3d\((-?[\d.e-]+)px/.exec(track().style.transform)![1])

const finger = {
  down: (x: number) => fireEvent.pointerDown(track(), { clientX: x, pointerId: 1 }),
  move: (x: number) => fireEvent.pointerMove(window, { clientX: x, pointerId: 1 }),
  up: (x: number) => fireEvent.pointerUp(window, { clientX: x, pointerId: 1 }),
  wait: (ms: number) => { clock.now += ms }, // time passes, no frame is drawn
}

/** A horizontal drag: down, move, rest for `ms`, up — a finger that has stopped (no flick). */
function swipe(dx: number, ms = 300) {
  finger.down(200)
  finger.move(200 + dx)
  finger.wait(ms)
  finger.up(200 + dx)
}
/** A drag that ends with the finger still moving: dx px in `ms`, released at once. */
function flick(dx: number, ms: number) {
  finger.down(300)
  finger.wait(ms)
  finger.move(300 + dx)
  finger.up(300 + dx)
}

const counter = () => screen.getByTestId('deck-counter').textContent

describe('FlipCards: the two sides', () => {
  it('the front: the learning label, the word and the FILLED example — and not the translation', () => {
    view()
    const front = visible()
    expect(front.dataset.side).toBe('learning')
    expect(within(front).getByText('In German')).toBeTruthy()
    expect(within(front).getAllByText('Wort1').length).toBeGreaterThan(0) // the word, and again in the example
    expect(within(front).getByTestId('gap-answer').textContent).toBe('Wort1') // the blank is filled with the word
    expect(front.textContent).toContain('Das ist Wort1 1.')
    expect(front.textContent).not.toContain('слово1')
    expect(front.textContent).not.toContain('Это слово')
    expect(within(front).getByText('Tap to see the translation')).toBeTruthy()
  })

  it('the filled example uses example_gap_answer, the word itself when there is none', () => {
    view({ cards: [card(1, { word: 'schmecken', example_sentence: 'Die Suppe ___ gut.', example_gap_answer: 'schmeckt' }), card(2)] })
    expect(within(visible()).getByTestId('gap-answer').textContent).toBe('schmeckt')
    expect(visible().textContent).toContain('Die Suppe schmeckt gut.')
  })

  it('a click flips: the back has the translation and its example, never the word or the sentence', () => {
    view()
    fireEvent.click(cardButton())
    const back = visible()
    expect(back.dataset.side).toBe('native')
    expect(within(back).getByText('Russian')).toBeTruthy()
    expect(within(back).getByText('слово1')).toBeTruthy()
    expect(within(back).getByText('Это слово 1.')).toBeTruthy()
    expect(back.textContent).not.toContain('Wort1')
    expect(back.textContent).not.toContain('Das ist')
    expect(within(back).getByText('Tap to see the word')).toBeTruthy()
    expect(back.querySelector('[data-testid="deck-box"]')).toBeNull() // no box bars on the translation side
    fireEvent.click(cardButton())
    expect(visible().dataset.side).toBe('learning')
  })

  it('the translation side is labelled with the language of the translation', () => {
    view({ cards: [card(1, { translation_language: 'uz' })] })
    fireEvent.click(cardButton())
    expect(within(visible()).getByText('Uzbek')).toBeTruthy()
  })

  it('an article gets its own coloured line above the word; the box bars follow box_level; learned = all five', () => {
    view({ cards: [card(1, { word: 'der Hund', article: 'der', box_level: 3 }), card(2, { is_learned: true })] })
    const front = visible()
    const art = within(front).getByText('der')
    expect(art.className).toContain('text-der')
    expect(art.className).toContain('text-[26px]')
    expect(within(front).getByText('Hund').className).toContain('font-serif')
    const bars = Array.from(front.querySelectorAll('[data-testid="deck-box"] span')).map((s) => s.getAttribute('data-filled'))
    expect(bars).toEqual(['true', 'true', 'true', 'false', 'false'])
    cleanup()
    view({ cards: [card(2, { is_learned: true })] })
    const learned = Array.from(visible().querySelectorAll('[data-testid="deck-box"] span')).map((s) => s.getAttribute('data-filled'))
    expect(learned).toEqual(['true', 'true', 'true', 'true', 'true'])
  })

  it('a word without a translation shows a dash; without an example there is no divider or sentence', () => {
    view({ cards: [card(1, { translation: '', example_sentence: '', example_translation: '', transcription: '[ha]' })] })
    expect(within(visible()).getByText('[ha]')).toBeTruthy()
    expect(visible().querySelector('.h-0\\.5')).toBeNull()
    fireEvent.click(cardButton())
    expect(within(visible()).getByText('—')).toBeTruthy()
  })

  it('the counter reads "n / total" with the folder total, not the loaded count', () => {
    view({ cards: cards(3), total: 120 })
    expect(counter()).toBe('1 / 120')
  })
})

describe('FlipCards: moving', () => {
  it('ArrowRight moves to the next card and turns it face up; ArrowLeft goes back', async () => {
    view()
    fireEvent.click(cardButton())
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    settle(); expect(counter()).toBe('2 / 5')
    expect(visible().dataset.side).toBe('learning') // a new card starts on its front
    expect(visible().textContent).toContain('Wort2')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    settle(); expect(counter()).toBe('1 / 5')
  })

  it('a slow drag past half a card moves to the next card, and back again', () => {
    view()
    swipe(-250) // more than half of the 434 px page
    settle(); expect(counter()).toBe('2 / 5')
    swipe(250)
    settle(); expect(counter()).toBe('1 / 5')
  })

  it('a slow drag short of half a card springs back; a drag past the ends does nothing', () => {
    view()
    swipe(-200)
    settle(); expect(counter()).toBe('1 / 5')
    expect(track().style.transform).toBe('translate3d(0px,0,0)')
    swipe(100) // there is no card before the first
    settle(); expect(counter()).toBe('1 / 5')
  })

  it('a short, fast flick moves to the next card', () => {
    view()
    flick(-40, 30) // 40 px in 30 ms: it would coast past half a card
    settle(); expect(counter()).toBe('2 / 5')
  })

  it('the neighbours are Back / Next buttons over their own card (hidden from screen readers), none before the first or after the last card', async () => {
    view()
    expect(screen.queryByTestId('deck-prev')).toBeNull()
    const next = screen.getByTestId('deck-next')
    expect(next.getAttribute('aria-label')).toBe('Next')
    const sides = Array.from(next.querySelectorAll('[data-side]'))
    expect(sides.map((s) => s.getAttribute('aria-hidden'))).toEqual(['true', 'true']) // the button is just «Next»
    fireEvent.click(next)
    settle(); expect(counter()).toBe('2 / 5')
    expect(screen.getByTestId('deck-prev').getAttribute('aria-label')).toBe('Back')
    fireEvent.click(screen.getByTestId('deck-prev'))
    settle(); expect(counter()).toBe('1 / 5')
    cleanup()
    view({ cards: cards(2) })
    fireEvent.click(screen.getByTestId('deck-next'))
    settle(); expect(counter()).toBe('2 / 2')
    expect(screen.queryByTestId('deck-next')).toBeNull()
  })

  it('from md up the stage is centred and capped at 500 px: only a thin peek of each neighbour', () => {
    view()
    const cls = screen.getByTestId('deck-stage').classList
    for (const c of ['md:mx-auto', 'md:w-full', 'md:max-w-[500px]', '-mx-4']) expect(cls.contains(c)).toBe(true)
  })

  it('a neighbour has no small UI (box bars, hints) but keeps its word for the slide', async () => {
    view()
    fireEvent.click(screen.getByTestId('deck-next'))
    settle()
    const prev = screen.getByTestId('deck-prev'), next = screen.getByTestId('deck-next')
    for (const n of [prev, next]) {
      expect(n.querySelector('[data-testid="deck-box"]')).toBeNull()
      expect(within(n).queryByText('Tap to see the translation')).toBeNull()
      expect(within(n).queryByText('Tap to see the word')).toBeNull()
      expect(n.querySelector('[data-testid="deck-word"]')?.textContent).toBeTruthy()
    }
    expect(cardButton().querySelectorAll('[data-testid="deck-box"]').length).toBe(1)
    expect(within(cardButton()).queryByText('Tap to see the translation')).not.toBeNull()
  })

  it('Space (and Enter) flip; the keys are ignored while typing', () => {
    view()
    fireEvent.keyDown(window, { key: ' ' })
    expect(visible().dataset.side).toBe('native')
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(visible().dataset.side).toBe('learning')
    const input = document.body.appendChild(document.createElement('input'))
    fireEvent.keyDown(input, { key: ' ' })
    fireEvent.keyDown(input, { key: 'ArrowRight' })
    expect(visible().dataset.side).toBe('learning')
    expect(counter()).toBe('1 / 5')
    input.remove()
  })

  it('the click that ends a drag is not a tap: the card does not flip', () => {
    view()
    swipe(-30) // a drag that was too short to move, but longer than a tap
    fireEvent.click(cardButton())
    expect(visible().dataset.side).toBe('learning')
    fireEvent.click(cardButton()) // a real tap afterwards flips
    expect(visible().dataset.side).toBe('native')
  })

  it('a new resetKey (another folder or direction) goes back to the first card, face up', async () => {
    const { rerender } = view()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    settle(); expect(counter()).toBe('2 / 5')
    fireEvent.click(cardButton())
    rerender(<FlipCards cards={cards()} total={5} direction="de_ru" resetKey="other" />)
    settle(); expect(counter()).toBe('1 / 5')
    expect(visible().dataset.side).toBe('learning')
  })

  it('reduced motion: the card changes at once, without waiting for the animation', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }))
    view()
    act(() => { fireEvent.keyDown(window, { key: 'ArrowRight' }) })
    expect(counter()).toBe('2 / 5')
  })

  it('onNearEnd fires when 3 cards are left, not before', async () => {
    const onNearEnd = vi.fn()
    view({ cards: cards(8), onNearEnd })
    expect(onNearEnd).not.toHaveBeenCalled()
    for (let n = 0; n < 4; n++) { fireEvent.keyDown(window, { key: 'ArrowRight' }); settle(); expect(counter()).toBe(`${n + 2} / 8`) }
    expect(onNearEnd).not.toHaveBeenCalled() // on the 5th of 8: 3 cards are still behind it
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    settle()
    expect(onNearEnd).toHaveBeenCalled()
  })
})

describe('FlipCards: native → word', () => {
  it('the front is the translation, the listen button is disabled until the flip', () => {
    view({ direction: 'ru_de' })
    expect(visible().dataset.side).toBe('native')
    expect(within(visible()).getByText('слово1')).toBeTruthy()
    expect(visible().textContent).not.toContain('Wort1')
    const listen = screen.getByRole('button', { name: 'Listen' }) as HTMLButtonElement
    expect(listen.disabled).toBe(true)
    fireEvent.click(cardButton())
    expect(visible().dataset.side).toBe('learning')
    expect(listen.disabled).toBe(false)
  })
})

describe('FlipCards: the controls under the deck', () => {
  it('the listen button is big and accent-coloured, reads the word with its language, and is absent without a voice', () => {
    view()
    const listen = screen.getByRole('button', { name: 'Listen' })
    expect(listen.className).toContain('h-16')
    expect(listen.className).toContain('bg-accent')
    fireEvent.click(listen)
    const u = speakApi.speak.mock.calls[0][0] as { text: string; lang: string }
    expect([u.text, u.lang]).toEqual(['Wort1', 'de-DE'])
    cleanup()
    speakApi.getVoices.mockReturnValue([{ lang: 'en-US' }])
    view()
    expect(screen.queryByRole('button', { name: 'Listen' })).toBeNull()
  })

  it('an English card is read with en-US', () => {
    view({ cards: [card(1, { language: 'en', word: 'the house' })] })
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }))
    expect((speakApi.speak.mock.calls[0][0] as { lang: string }).lang).toBe('en-US')
  })

  it('under the controls the counter reads "i / total" with the folder total; there are no pager dots', async () => {
    view({ cards: cards(8), total: 403 })
    const under = screen.getByTestId('deck-counter')
    expect(under.textContent).toBe('1 / 403')
    expect(under.className).toContain('text-[13px]')
    expect(under.className).toContain('text-muted')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    settle()
    expect(under.textContent).toBe('2 / 403')
    expect(screen.queryByTestId('deck-pager')).toBeNull()
  })

  it('the row is ← 🔊 ⟳ →, 64px tall; ← and → are 52px and on every width, move, and stop at the ends', async () => {
    view({ cards: cards(2) })
    const row = screen.getByTestId('deck-controls')
    expect(row.className).toContain('h-16')
    expect(within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Back', 'Listen', 'Flip the card', 'Next'])
    const back = within(row).getByRole('button', { name: 'Back' }) as HTMLButtonElement
    const next = within(row).getByRole('button', { name: 'Next' }) as HTMLButtonElement
    for (const b of [back, next]) {
      expect(b.className).toMatch(/\bh-13\b.*\bw-13\b/)
      expect(b.className).not.toMatch(/\bhidden\b|md:grid/) // phones too
    }
    expect(back.disabled).toBe(true)
    fireEvent.click(next)
    settle(); expect(counter()).toBe('2 / 2')
    expect(next.disabled).toBe(true)
    fireEvent.click(back)
    settle(); expect(counter()).toBe('1 / 2')
  })

  it('⟳ flips the card like a tap on it', () => {
    view()
    const flipButton = screen.getByRole('button', { name: 'Flip the card' })
    expect(flipButton.className).toMatch(/\bh-13\b.*\bw-13\b/)
    fireEvent.click(flipButton)
    expect(visible().dataset.side).toBe('native')
    fireEvent.click(flipButton)
    expect(visible().dataset.side).toBe('learning')
  })

  it('the keys hint stays from md up', () => {
    view()
    expect(screen.getByText('← → to browse, Space to flip').className).toContain('md:block')
    expect(screen.getByText('Swipe to move between cards').className).toContain('md:hidden')
  })

  it('the card is a button with the flip hint as its name, and there is no pencil any more', () => {
    view()
    expect(cardButton().tagName).toBe('BUTTON')
    expect(cardButton().getAttribute('aria-label')).toBe('Click to flip')
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(cardButton().className).toContain('rounded-[32px]')
  })
})

describe('FlipCards: the spring', () => {
  it('a drag moves the track 1:1 in the DOM, with no React render per move', () => {
    const onRender = vi.fn()
    render(<Profiler id="deck" onRender={onRender}><FlipCards cards={cards()} total={5} direction="de_ru" resetKey="k" /></Profiler>, { wrapper })
    sized()
    const renders = onRender.mock.calls.length
    finger.down(200)
    for (const x of [190, 180, 165, 150]) finger.move(x)
    expect(trackX()).toBe(-50) // where the finger is, at once — not a frame later
    expect(clock.queue.size).toBe(0) // dragging runs no animation
    finger.move(140)
    expect(trackX()).toBe(-60)
    expect(onRender).toHaveBeenCalledTimes(renders)
  })

  it('a release starts the spring: the track moves frame by frame, eases to the page, and only then the card changes', () => {
    view()
    swipe(-250)
    expect(trackX()).toBe(-250)
    expect(clock.queue.size).toBe(1)
    const seen: number[] = []
    while (clock.queue.size) { frame(); seen.push(trackX()) }
    expect(counter()).toBe('2 / 5')
    expect(seen.length).toBeGreaterThan(10) // an animation, not a jump
    // Before it settles the track only heads towards -434 …
    const travel = seen.slice(0, -1)
    expect(travel.every((x) => x <= -250 && x >= -PAGE_PX - 40)).toBe(true) // at most a small overshoot
    expect(Math.min(...travel)).toBeLessThan(-PAGE_PX + 40) // … gets there …
    // … and the card change and the rebase to 0 land in the same step.
    expect(seen[seen.length - 1]).toBe(0)
    expect(track().style.transform).toBe('translate3d(0px,0,0)')
    expect(track().style.transition).toBe('') // no CSS transition any more
  })

  it('the spring settles in well under a second and stops (|x - target| < 0.5 and |v| < 0.5)', () => {
    view()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    let ms = 0
    while (clock.queue.size) { frame(); ms += 16; if (ms > 4000) break }
    expect(ms).toBeLessThan(1200)
    expect(counter()).toBe('2 / 5')
    expect(clock.queue.size).toBe(0) // no frames are requested at rest
  })

  it('a long frame is clamped to 32 ms: a stalled tab does not make the spring jump', () => {
    view()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    frame(16)
    frame(5000) // the tab was in the background
    expect(counter()).toBe('1 / 5')
    expect(trackX()).toBeGreaterThan(-PAGE_PX * 0.5) // two normal frames of travel, not the whole page
  })

  it('the buttons, the keys and a tap on a neighbour use the same spring, from velocity 0', () => {
    view()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    frame()
    const first = trackX()
    expect(first).toBeLessThan(0)
    expect(first).toBeGreaterThan(-40) // starting from rest: a small first step, not a jump
    settle(); expect(counter()).toBe('2 / 5')
    fireEvent.click(screen.getByTestId('deck-next'))
    expect(clock.queue.size).toBe(1)
    settle(); expect(counter()).toBe('3 / 5')
    fireEvent.click(screen.getByTestId('deck-prev'))
    settle(); expect(counter()).toBe('2 / 5')
  })

  it('a second arrow press during the slide retargets it: two cards on, without waiting', () => {
    view()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    frame(); frame()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    settle(); expect(counter()).toBe('3 / 5')
  })

  it('a fast flick keeps its speed: it covers more in the first frames than a slow slide', () => {
    view()
    flick(-120, 40) // 3000 px/s
    frame(); frame()
    const flicked = trackX()
    cleanup()
    clock.queue.clear()
    view()
    swipe(-250) // the finger rested: starts at 0 px/s from -250
    frame(); frame()
    expect(flicked).toBeLessThan(-120 - 60) // the flick carried on from -120 at speed …
    expect(trackX() - -250).toBeGreaterThan(-60) // … where the rested drag barely moved
  })

  it('a fast flick of the whole deck: two cards at once above 2500 px/s, one below', () => {
    view()
    flick(-200, 40) // 5000 px/s
    settle(); expect(counter()).toBe('3 / 5')
    flick(-100, 40) // 2500 px/s is not above the limit …
    settle(); expect(counter()).toBe('4 / 5')
  })

  it('a flick the other way goes back two cards just the same, and never past the first', () => {
    view({ cards: cards(6) })
    for (let n = 0; n < 4; n++) { fireEvent.keyDown(window, { key: 'ArrowRight' }); settle() }
    expect(counter()).toBe('5 / 6')
    flick(240, 40) // 6000 px/s to the right
    settle(); expect(counter()).toBe('3 / 6')
    flick(400, 30)
    settle(); expect(counter()).toBe('1 / 6')
    flick(400, 30)
    settle(); expect(counter()).toBe('1 / 6')
  })

  it('only the last 100 ms count for the speed: a fast start that rested is no flick, a slow drag with a fast end is', () => {
    view()
    finger.down(300)
    finger.wait(20)
    finger.move(240) // 3000 px/s …
    finger.wait(300) // … but the finger rested
    finger.up(240)
    settle(); expect(counter()).toBe('1 / 5') // 60 px, no speed: springs back
    finger.down(300)
    finger.wait(400)
    finger.move(285) // slow
    finger.wait(30)
    finger.move(225) // 2000 px/s at the end
    finger.up(225)
    settle(); expect(counter()).toBe('2 / 5')
  })

  it('the first card: a drag to the right follows the iOS rubber band, and a release springs back', () => {
    view()
    finger.down(200)
    finger.move(300) // 100 px beyond the end
    const w = STAGE_PX
    const expected = (1 - 1 / ((100 * 0.55) / w + 1)) * w
    expect(expected).toBeGreaterThan(40)
    expect(expected).toBeLessThan(100)
    expect(trackX()).toBeCloseTo(expected, 5)
    finger.move(700) // far beyond: never more than the view's width
    expect(trackX()).toBeLessThan(w)
    expect(trackX()).toBeGreaterThan(expected)
    finger.move(300)
    finger.wait(300)
    finger.up(300)
    const seen: number[] = []
    while (clock.queue.size) { frame(); seen.push(trackX()) }
    expect(seen.length).toBeGreaterThan(5)
    expect(seen[0]).toBeLessThan(expected) // heading back
    expect(seen[seen.length - 1]).toBe(0)
    expect(counter()).toBe('1 / 5')
  })

  it('the last card: the same band to the left, back to the last card', () => {
    view({ cards: cards(2) })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    settle()
    expect(counter()).toBe('2 / 2')
    finger.down(300)
    finger.move(200)
    expect(trackX()).toBeCloseTo(-(1 - 1 / ((100 * 0.55) / STAGE_PX + 1)) * STAGE_PX, 5)
    finger.wait(300)
    finger.up(200)
    settle(); expect(counter()).toBe('2 / 2')
    expect(track().style.transform).toBe('translate3d(0px,0,0)')
  })

  it('a touch during the slide stops it right there and the finger carries on from that position', () => {
    view()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    while (trackX() > -300) frame()
    const stopped = trackX()
    expect(counter()).toBe('1 / 5') // still on the first card
    finger.down(200)
    expect(clock.queue.size).toBe(0) // the spring is gone — no waiting …
    expect(trackX()).toBe(stopped) // … and no jump
    finger.move(180) // the finger moves 20 px: the track follows from where it was
    expect(trackX()).toBeCloseTo(stopped - 20, 5)
    finger.wait(300)
    finger.up(180)
    fireEvent.click(cardButton()) // the touch that stopped the slide is no tap: no flip
    expect(visible().dataset.side).toBe('learning')
    settle(); expect(counter()).toBe('2 / 5') // past half: on to the next card
  })

  it('… and letting go the other way sends it back to where it came from', () => {
    view()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    while (trackX() > -300) frame()
    finger.down(200)
    finger.move(320) // drags it back 120 px
    finger.wait(300)
    finger.up(320)
    settle(); expect(counter()).toBe('1 / 5')
    expect(track().style.transform).toBe('translate3d(0px,0,0)')
  })

  it('a touch on a track at rest takes over with no jump either, and a mere tap leaves it at 0 without an animation', () => {
    view()
    finger.down(200)
    expect(trackX()).toBe(0)
    finger.up(200)
    expect(clock.queue.size).toBe(0)
    expect(trackX()).toBe(0)
  })

  it('a card settles with a small vibration where the browser has one', () => {
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { vibrate }))
    view()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    settle()
    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(vibrate).toHaveBeenCalledWith(8)
    swipe(-100) // springs back to the same card: no vibration
    settle()
    expect(vibrate).toHaveBeenCalledTimes(1)
  })

  it('without vibrate (iOS) nothing breaks', () => {
    view()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(() => settle()).not.toThrow()
    expect(counter()).toBe('2 / 5')
  })

  it('reduced motion: no spring, the track jumps to the target and the card changes at once', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }))
    view()
    act(() => { fireEvent.keyDown(window, { key: 'ArrowRight' }) })
    expect(counter()).toBe('2 / 5')
    expect(clock.queue.size).toBe(0)
    expect(track().style.transform).toBe('translate3d(0px,0,0)')
    swipe(-300)
    expect(counter()).toBe('3 / 5')
    expect(clock.queue.size).toBe(0)
  })

  it('a new folder (resetKey) stops a running spring and starts at the first card', () => {
    const { rerender } = view()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    frame(); frame()
    rerender(<FlipCards cards={cards()} total={5} direction="de_ru" resetKey="other" />)
    expect(clock.queue.size).toBe(0)
    expect(trackX()).toBe(0)
    expect(counter()).toBe('1 / 5')
  })

  it('the track and the flipping card are GPU layers; both sides hide their back', () => {
    view()
    expect(track().style.willChange).toBe('transform')
    expect((cardButton().firstElementChild as HTMLElement).style.willChange).toBe('transform')
    for (const s of [side('learning'), side('native')]) expect(s.style.backfaceVisibility).toBe('hidden')
    expect(screen.getByTestId('deck-stage').style.touchAction).toBe('pan-y')
  })
})

describe('FlipCards: the flip in iPhone Safari', () => {
  it('both faces hide their back and sit 1px out of their side; the sides and the rotor keep 3D', () => {
    view()
    for (const name of ['learning', 'native'] as const) {
      const face = side(name).querySelector<HTMLElement>('[data-face]')!
      expect(face.style.backfaceVisibility).toBe('hidden')
      expect(face.style.transform).toBe('translateZ(1px)')
      expect(side(name).style.backfaceVisibility).toBe('hidden')
      expect(side(name).style.transformStyle).toBe('preserve-3d')
    }
    const rotor = screen.getByTestId('deck-rotor')
    expect(rotor.style.transformStyle).toBe('preserve-3d')
    expect(rotor.style.willChange).toBe('transform')
  })

  it('nothing between the perspective (the card button) and a face clips, fades, filters or will-change anything but transform', () => {
    view()
    const faces = cardButton().querySelectorAll<HTMLElement>('[data-face]')
    expect(faces).toHaveLength(2)
    for (const face of faces) {
      expect(face.className).toContain('overflow-hidden') // the rounded clipping stays on the face itself
      for (let el = face.parentElement!; el !== cardButton(); el = el.parentElement!) {
        expect(el.className).not.toMatch(/\b(overflow-|opacity-|blur|brightness-|contrast-|grayscale|drop-shadow|backdrop-|filter)/)
        expect(el.style.overflow).toBe('')
        expect(['', '1']).toContain(el.style.opacity)
        expect(['', 'transform']).toContain(el.style.willChange)
      }
    }
  })

  it('a new card starts face up on a fresh rotor: the flip-back of the old card never plays on it', async () => {
    view()
    fireEvent.click(cardButton())
    const rotor = screen.getByTestId('deck-rotor')
    expect(rotor.style.transform).toBe('rotateY(180deg)')
    swipe(-250)
    settle(); expect(counter()).toBe('2 / 5')
    expect(visible().dataset.side).toBe('learning')
    const fresh = screen.getByTestId('deck-rotor')
    expect(fresh).not.toBe(rotor) // a new element: no 180° → 0° transition on the new card
    expect(fresh.style.transform).toBe('none')
  })
})

describe('FlipCards: the hints on the first visits', () => {
  const swipeHint = () => screen.queryByText('Swipe to move between cards')
  const flipHint = () => within(cardButton()).queryByText('Tap to see the translation')

  it('the swipe hint and the flip line on the card show on the first 3 visits, then never again', () => {
    for (let visit = 1; visit <= 3; visit++) {
      view()
      expect(swipeHint()).not.toBeNull()
      expect(flipHint()).not.toBeNull()
      cleanup()
    }
    expect(localStorage.getItem('yodla.cardsHintSeen')).toBe('3')
    view()
    expect(swipeHint()).toBeNull()
    expect(flipHint()).toBeNull()
    expect(screen.queryByText('Tap to see the word')).toBeNull() // nor on the back
    expect(screen.queryByText('Tap to see the translation')).toBeNull() // nor on the neighbours
    expect(screen.getByText('← → to browse, Space to flip')).toBeTruthy() // the keys hint stays
    expect(localStorage.getItem('yodla.cardsHintSeen')).toBe('3')
  })

  it('without storage (private mode) the hints keep showing and nothing breaks', () => {
    const real = { get: Storage.prototype.getItem, set: Storage.prototype.setItem }
    const blocked = (key: string) => key === 'yodla.cardsHintSeen'
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (blocked(key)) throw new Error('denied')
      return real.get.call(this, key)
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (blocked(key)) throw new Error('denied')
      real.set.call(this, key, value)
    })
    try {
      for (let visit = 1; visit <= 4; visit++) {
        view()
        expect(swipeHint()).not.toBeNull()
        cleanup()
      }
    } finally {
      get.mockRestore()
      set.mockRestore()
    }
  })
})

/** Which side of a card faces the viewer: the rotor's turn plus that side's own turn make 0° or 360°. */
const facing = (cardEl: HTMLElement) => {
  const turned = (cardEl.firstElementChild as HTMLElement).style.transform === 'rotateY(180deg)'
  const sides = Array.from(cardEl.querySelectorAll<HTMLElement>('[data-side]'))
  return sides.find((s) => (s.style.transform === 'rotateY(180deg)') === turned)!.dataset.side
}
const offsets = () => Array.from(track().querySelectorAll<HTMLElement>('[data-offset]')).map((c) => Number(c.dataset.offset))
const wordOf = (cardEl: HTMLElement) => within(cardEl).getByTestId('deck-word')

describe('FlipCards: the neighbours are real cards', () => {
  it('the next and previous neighbours show their words, front side up, before they slide in', async () => {
    view()
    const next = screen.getByTestId('deck-next')
    expect(wordOf(next).textContent).toBe('Wort2')
    expect(facing(next)).toBe('learning')
    expect(next.querySelector('[data-face]')!.className).toBe(cardButton().querySelector('[data-face]')!.className) // the same face
    fireEvent.click(cardButton()) // the current card flipped…
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    settle(); expect(counter()).toBe('2 / 5')
    const prev = screen.getByTestId('deck-prev')
    expect(wordOf(prev).textContent).toBe('Wort1')
    expect(facing(prev)).toBe('learning') // …is on its front again as the neighbour
    expect(wordOf(screen.getByTestId('deck-next')).textContent).toBe('Wort3')
  })

  it('native → word: a neighbour shows its front, the translation', () => {
    view({ direction: 'ru_de' })
    const next = screen.getByTestId('deck-next')
    expect(facing(next)).toBe('native')
    expect(within(next.querySelector<HTMLElement>('[data-side="native"]')!).getByText('слово2')).toBeTruthy()
  })

  it('two cards wait on each side, rendered but out of sight and out of reach', async () => {
    view()
    expect(offsets()).toEqual([0, 1, 2])
    const farther = track().querySelector<HTMLElement>('[data-offset="2"]')!
    expect(farther.getAttribute('aria-hidden')).toBe('true')
    expect(farther.tabIndex).toBe(-1)
    expect(wordOf(farther).textContent).toBe('Wort3')
    for (const n of [2, 3]) {
      fireEvent.keyDown(window, { key: 'ArrowRight' })
      settle(); expect(counter()).toBe(`${n} / 5`)
    }
    expect(offsets()).toEqual([-2, -1, 0, 1, 2])
    expect(Array.from(track().querySelectorAll<HTMLElement>('[data-offset]')).map((c) => wordOf(c).textContent)).toEqual(['Wort1', 'Wort2', 'Wort3', 'Wort4', 'Wort5'])
  })

  it('after a slide the card that slid in is the very same DOM node: its word is not drawn anew', async () => {
    view()
    const next = screen.getByTestId('deck-next')
    const word = wordOf(next)
    const old = cardButton()
    swipe(-250)
    settle(); expect(counter()).toBe('2 / 5')
    expect(cardButton()).toBe(next) // the same button…
    expect(wordOf(cardButton())).toBe(word) // …and the same word node: nothing re-mounted
    expect(screen.getByTestId('deck-prev')).toBe(old) // the old card stays, now on the left
  })

  it('after moving, the new card shows its front at once; only the current card animates a flip', async () => {
    view()
    fireEvent.click(cardButton())
    expect(facing(cardButton())).toBe('native')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    settle(); expect(counter()).toBe('2 / 5')
    expect(facing(cardButton())).toBe('learning')
    expect(visible().dataset.side).toBe('learning')
    expect((cardButton().firstElementChild as HTMLElement).className).toContain('transition-transform')
    const prev = screen.getByTestId('deck-prev').firstElementChild as HTMLElement
    expect(prev.style.transform).toBe('none') // the old card is back on its front…
    expect(prev.className).not.toContain('transition-transform') // …at once, without a flip animation
  })
})

const fontPx = (el: HTMLElement) => parseFloat(el.style.fontSize)
const words = () => screen.getAllByTestId('deck-word')

describe('FlipCards: the text fits the card', () => {
  it('a 20-letter word gets a smaller font than a 4-letter one, and nothing goes below 26px', () => {
    view({ cards: [card(1, { word: 'Haus' }), card(2, { word: 'Lebensmittelgeschäft' }), card(3, { word: 'Geschwindigkeitsbegrenzung' })] })
    const [short, long, longest] = words().map(fontPx)
    expect(short).toBe(64)
    expect(long).toBeLessThan(short)
    expect(long).toBeGreaterThanOrEqual(26)
    expect(longest).toBe(26)
  })

  it('a phrase is sized by its longest word: "auf keinen Fall" keeps the maximum and wraps whole', () => {
    view({ cards: [card(1, { word: 'auf keinen Fall' })] })
    expect(fontPx(words()[0])).toBe(64)
    expect(words()[0].style.hyphens).toBe('manual')
  })

  it('only a word too long even at 26px may hyphenate', () => {
    view({ cards: [card(1, { word: 'Grundschule' }), card(2, { word: 'Geschwindigkeitsbegrenzung' })] })
    expect(words().map((w) => w.style.hyphens)).toEqual(['manual', 'auto'])
    for (const word of words()) {
      expect(word.className).toContain('wrap-anywhere')
      expect(word.getAttribute('lang')).toBe('de')
    }
  })

  it('the article is not part of the fit and keeps its size', () => {
    view({ cards: [card(1, { word: 'die Mathematik (Mathe) (Sg.)' })] })
    expect(words()[0].textContent).toBe('Mathematik (Mathe) (Sg.)')
    expect(fontPx(words()[0])).toBe(44) // 10 letters: 300 / (10 × 0.68)
    expect(within(side('learning')).getByText('die').className).toContain('text-[26px]')
  })

  it('the translation has its own maximum of 52px, the same minimum, and its own language', () => {
    view({ cards: [card(1, { translation: 'дом' }), card(2, { translation: 'достопримечательности и не только' })] })
    const short = within(side('native')).getByText('дом')
    expect(fontPx(short)).toBe(52)
    expect(short.getAttribute('lang')).toBe('ru')
    const long = within(screen.getByTestId('deck-next')).getByText('достопримечательности и не только')
    expect(fontPx(long)).toBeLessThan(52)
    expect(fontPx(long)).toBeGreaterThanOrEqual(26)
  })

  it('the size follows the measured face: its width without the padding', () => {
    const style = document.head.appendChild(document.createElement('style'))
    style.textContent = '[data-face] { padding-left: 28px; padding-right: 28px }'
    let resized = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { resized = cb }
      observe() {}
      disconnect() {}
    })
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(285)
    view({ cards: [card(1, { word: 'Grundschule' })] })
    expect(fontPx(words()[0])).toBe(30) // 229 / (11 × 0.68): measured before the first paint
    clientWidth.mockReturnValue(418)
    act(() => resized())
    expect(fontPx(words()[0])).toBe(48) // 362 / (11 × 0.68)
    clientWidth.mockRestore()
    style.remove()
  })

  it('an example is at most 3 lines, on both sides, and may break anywhere', () => {
    view()
    const examples = cardButton().querySelectorAll<HTMLElement>('.line-clamp-3')
    expect(Array.from(examples).map((e) => e.textContent)).toEqual(['Das ist Wort1 1.', 'Это слово 1.'])
    for (const example of examples) {
      expect(example.className).toContain('wrap-anywhere')
      expect(example.className).toContain('hyphens-auto')
      expect(example.className).not.toMatch(/\bblock\b/) // display: block would undo the clamp
      expect(example.getAttribute('lang')).toBeTruthy()
    }
  })
})

describe('FlipCards: the neighbours', () => {
  it('clip on their own rounded edge; the current card does not, or its flip would be cut', async () => {
    view()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    settle(); expect(counter()).toBe('2 / 5')
    for (const neighbour of [screen.getByTestId('deck-prev'), screen.getByTestId('deck-next')]) {
      expect(neighbour.style.overflow).toBe('hidden')
      expect(neighbour.className).toContain('rounded-[32px]')
    }
    expect(cardButton().style.overflow).toBe('')
  })

  it('a neighbour has the size it keeps as the current card', async () => {
    view({ cards: [card(1), card(2, { word: 'Lebensmittelgeschäft' })] })
    const size = wordOf(screen.getByTestId('deck-next')).style.fontSize
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    settle(); expect(counter()).toBe('2 / 2')
    expect(wordOf(cardButton()).style.fontSize).toBe(size)
    expect(cardButton().style.overflow).toBe('')
  })
})

describe('FlipCards: the counter', () => {
  it('appears once, under the controls: on no face of any card', () => {
    view()
    expect(screen.getAllByText('1 / 5')).toEqual([screen.getByTestId('deck-counter')])
    expect(screen.queryByText('2 / 5')).toBeNull() // the neighbour has none either
    expect(screen.getAllByTestId('deck-box').length).toBeGreaterThan(0) // the box bars stay
  })
})
