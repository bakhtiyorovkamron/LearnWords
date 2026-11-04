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

beforeEach(async () => {
  vi.stubGlobal('PointerEvent', TestPointerEvent)
  await i18n.changeLanguage('en')
  localStorage.setItem('learning_language', 'de')
  speakApi.getVoices.mockReturnValue([])
  vi.stubGlobal('speechSynthesis', speakApi)
  vi.stubGlobal('SpeechSynthesisUtterance', function (this: { text: string }, text: string) { this.text = text })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
)
function view(props: Partial<Parameters<typeof FlipCards>[0]> = {}) {
  const list = props.cards ?? cards()
  return render(<FlipCards cards={list} total={props.total ?? list.length} direction="de_ru" resetKey="k" {...props} />, { wrapper })
}
// The neighbours are whole cards too: these look into the current card only.
const track = () => screen.getByTestId('deck-track')
const cardButton = () => screen.getByTestId('deck-card')
const side = (name: 'learning' | 'native') => cardButton().querySelector(`[data-side="${name}"]`) as HTMLElement
const visible = () => cardButton().querySelector('[data-side][aria-hidden="false"]') as HTMLElement

/** A horizontal drag with the pointer: down on the track, move, up. */
function swipe(dx: number, ms = 300) {
  const now = vi.spyOn(Date, 'now')
  now.mockReturnValue(1000)
  fireEvent.pointerDown(track(), { clientX: 200, pointerId: 1 })
  fireEvent.pointerMove(window, { clientX: 200 + dx, pointerId: 1 })
  now.mockReturnValue(1000 + ms)
  fireEvent.pointerUp(window, { clientX: 200 + dx, pointerId: 1 })
  now.mockRestore()
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
    await waitFor(() => expect(counter()).toBe('2 / 5'))
    expect(visible().dataset.side).toBe('learning') // a new card starts on its front
    expect(visible().textContent).toContain('Wort2')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    await waitFor(() => expect(counter()).toBe('1 / 5'))
  })

  it('a swipe of -100px moves to the next card, +100px back', async () => {
    view()
    swipe(-100)
    await waitFor(() => expect(counter()).toBe('2 / 5'))
    swipe(100)
    await waitFor(() => expect(counter()).toBe('1 / 5'))
  })

  it('a short drag springs back and a swipe past the ends does nothing', async () => {
    view()
    swipe(-30)
    await new Promise((r) => setTimeout(r, 300))
    expect(counter()).toBe('1 / 5')
    swipe(100) // there is no card before the first
    await new Promise((r) => setTimeout(r, 300))
    expect(counter()).toBe('1 / 5')
  })

  it('a fast short flick moves too', async () => {
    view()
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1000)
    fireEvent.pointerDown(track(), { clientX: 200, pointerId: 1 })
    now.mockReturnValue(1030)
    fireEvent.pointerMove(window, { clientX: 160, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 160, pointerId: 1 })
    await waitFor(() => expect(counter()).toBe('2 / 5'))
    now.mockRestore()
  })

  it('the neighbours are Back / Next buttons over their own card (hidden from screen readers), none before the first or after the last card', async () => {
    view()
    expect(screen.queryByTestId('deck-prev')).toBeNull()
    const next = screen.getByTestId('deck-next')
    expect(next.getAttribute('aria-label')).toBe('Next')
    const sides = Array.from(next.querySelectorAll('[data-side]'))
    expect(sides.map((s) => s.getAttribute('aria-hidden'))).toEqual(['true', 'true']) // the button is just «Next»
    fireEvent.click(next)
    await waitFor(() => expect(counter()).toBe('2 / 5'))
    expect(screen.getByTestId('deck-prev').getAttribute('aria-label')).toBe('Back')
    fireEvent.click(screen.getByTestId('deck-prev'))
    await waitFor(() => expect(counter()).toBe('1 / 5'))
    cleanup()
    view({ cards: cards(2) })
    fireEvent.click(screen.getByTestId('deck-next'))
    await waitFor(() => expect(counter()).toBe('2 / 2'))
    expect(screen.queryByTestId('deck-next')).toBeNull()
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
    await waitFor(() => expect(counter()).toBe('2 / 5'))
    fireEvent.click(cardButton())
    rerender(<FlipCards cards={cards()} total={5} direction="de_ru" resetKey="other" />)
    await waitFor(() => expect(counter()).toBe('1 / 5'))
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
    for (let n = 0; n < 4; n++) fireEvent.keyDown(window, { key: 'ArrowRight' }), await waitFor(() => expect(counter()).toBe(`${n + 2} / 8`))
    expect(onNearEnd).not.toHaveBeenCalled() // on the 5th of 8: 3 cards are still behind it
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(onNearEnd).toHaveBeenCalled())
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
    await waitFor(() => expect(under.textContent).toBe('2 / 403'))
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
    await waitFor(() => expect(counter()).toBe('2 / 2'))
    expect(next.disabled).toBe(true)
    fireEvent.click(back)
    await waitFor(() => expect(counter()).toBe('1 / 2'))
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

/** requestAnimationFrame by hand: a frame runs only when the test flushes it. */
function manualFrames() {
  let id = 0
  const queue = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { queue.set(++id, cb); return id })
  vi.stubGlobal('cancelAnimationFrame', (n: number) => { queue.delete(n) })
  return {
    pending: () => queue.size,
    flush: () => { const cbs = [...queue.values()]; queue.clear(); cbs.forEach((cb) => cb(0)) },
  }
}
const SLIDE = 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)'
const transitionEnd = (el: Element) => act(() => { el.dispatchEvent(new Event('transitionend', { bubbles: true })) })

describe('FlipCards: rendering the movement', () => {
  it('a drag moves the track in the DOM: one write per animation frame, no React render per move', () => {
    const frames = manualFrames()
    const onRender = vi.fn()
    render(<Profiler id="deck" onRender={onRender}><FlipCards cards={cards()} total={5} direction="de_ru" resetKey="k" /></Profiler>, { wrapper })
    const renders = onRender.mock.calls.length
    fireEvent.pointerDown(track(), { clientX: 200, pointerId: 1 })
    for (const x of [190, 180, 165, 150]) fireEvent.pointerMove(window, { clientX: x, pointerId: 1 })
    expect(frames.pending()).toBe(1) // four moves, one frame
    frames.flush()
    expect(track().style.transform).toBe('translate3d(-50px,0,0)') // where the finger is now
    expect(track().style.transition).toBe('none')
    fireEvent.pointerMove(window, { clientX: 140, pointerId: 1 })
    frames.flush()
    expect(track().style.transform).toBe('translate3d(-60px,0,0)')
    expect(onRender).toHaveBeenCalledTimes(renders) // nothing re-rendered while the finger moved
  })

  it('a release cancels the frame still waiting; a short drag springs back with the deck easing', () => {
    const frames = manualFrames()
    view()
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    fireEvent.pointerDown(track(), { clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 185, pointerId: 1 })
    frames.flush() // drawn at -15 px
    fireEvent.pointerMove(window, { clientX: 170, pointerId: 1 })
    expect(frames.pending()).toBe(1) // -30 px waits for the next frame
    now.mockReturnValue(1300) // the finger rested before the release: no flick
    fireEvent.pointerUp(window, { clientX: 170, pointerId: 1 })
    now.mockRestore()
    expect(frames.pending()).toBe(0) // cancelled: the stale -30 px cannot overwrite the spring-back
    expect(track().style.transform).toBe('translate3d(0px,0,0)')
    expect(track().style.transition).toBe(SLIDE)
    expect(counter()).toBe('1 / 5')
  })

  it('a release before any frame was drawn needs no spring-back: the track never left 0', () => {
    const frames = manualFrames()
    view()
    fireEvent.pointerDown(track(), { clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 197, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 197, pointerId: 1 })
    expect(frames.pending()).toBe(0)
    expect(track().style.transform).toBe('translate3d(0px,0,0)')
    expect(track().style.transition).toBe('none')
    fireEvent.pointerDown(track(), { clientX: 200, pointerId: 1 }) // and a new drag is not held back
    fireEvent.pointerMove(window, { clientX: 180, pointerId: 1 })
    expect(frames.pending()).toBe(1)
  })

  it('a finger that comes back before the next frame still springs the track back from where it was drawn', () => {
    const frames = manualFrames()
    view()
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    fireEvent.pointerDown(track(), { clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 170, pointerId: 1 })
    frames.flush() // the track is drawn at -30 px
    fireEvent.pointerMove(window, { clientX: 200, pointerId: 1 }) // back at the start; its frame never runs
    now.mockReturnValue(1300)
    fireEvent.pointerUp(window, { clientX: 200, pointerId: 1 })
    now.mockRestore()
    expect(track().style.transform).toBe('translate3d(0px,0,0)')
    expect(track().style.transition).toBe(SLIDE) // a spring-back, not left at -30 px
  })

  it("a slide ends on the track's transitionend: the new card and the track back at 0 in the same step", () => {
    view()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(track().style.transform).toBe('translate3d(-14px,0,0)') // jsdom has no layout: one card = the 14 px gap
    expect(track().style.transition).toBe(SLIDE)
    fireEvent.keyDown(window, { key: ' ' }) // a render mid-slide (the flip) leaves the track where it is
    expect(track().style.transform).toBe('translate3d(-14px,0,0)')
    transitionEnd(cardButton().firstElementChild!) // the flip's own transitionend bubbles up: not the slide's
    expect(counter()).toBe('1 / 5')

    let seen = ''
    track().addEventListener('transitionend', () => { seen = `${counter()} at ${track().style.transform}` })
    transitionEnd(track())
    expect(seen).toBe('2 / 5 at translate3d(0px,0,0)') // already true inside the event: one synchronous step
    expect(track().style.transition).toBe('none')
    expect(visible().dataset.side).toBe('learning') // the new card starts face up
  })

  it('without a transitionend a fallback timer ends the slide; a late transitionend moves nothing more', () => {
    vi.useFakeTimers()
    try {
      view()
      fireEvent.keyDown(window, { key: 'ArrowRight' })
      act(() => { vi.advanceTimersByTime(220 + 49) })
      expect(counter()).toBe('1 / 5')
      act(() => { vi.advanceTimersByTime(1) })
      expect(counter()).toBe('2 / 5')
      expect(track().style.transform).toBe('translate3d(0px,0,0)')
      transitionEnd(track())
      expect(counter()).toBe('2 / 5')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a flick is measured over the last ~80 ms: a slow drag with a fast end moves on, a fast start with a slow end springs back', async () => {
    const frames = manualFrames()
    const now = vi.spyOn(Date, 'now')
    const drag = ([[t0, x0], ...moves]: [t: number, x: number][]) => {
      now.mockReturnValue(t0)
      fireEvent.pointerDown(track(), { clientX: x0, pointerId: 1 })
      for (const [t, x] of moves) {
        now.mockReturnValue(t)
        fireEvent.pointerMove(window, { clientX: x, pointerId: 1 })
        frames.flush()
      }
      fireEvent.pointerUp(window, { clientX: moves[moves.length - 1][1], pointerId: 1 })
    }
    // 50 px in all — less than the 60 px of a swipe, so only a flick can move on.
    view()
    drag([[1000, 200], [1050, 165], [1950, 150]]) // 35 px in 50 ms, then 15 px in 900 ms
    expect(track().style.transform).toBe('translate3d(0px,0,0)') // springs back
    expect(track().style.transition).toBe(SLIDE)
    cleanup()
    view()
    drag([[1000, 200], [1500, 192], [1900, 185], [1950, 150]]) // 15 px in 900 ms, then 35 px in 50 ms
    now.mockRestore()
    expect(track().style.transform).toBe('translate3d(-14px,0,0)') // slides on
    await waitFor(() => expect(counter()).toBe('2 / 5'))
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
    swipe(-100)
    await waitFor(() => expect(counter()).toBe('2 / 5'))
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
    await waitFor(() => expect(counter()).toBe('2 / 5'))
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
      await waitFor(() => expect(counter()).toBe(`${n} / 5`))
    }
    expect(offsets()).toEqual([-2, -1, 0, 1, 2])
    expect(Array.from(track().querySelectorAll<HTMLElement>('[data-offset]')).map((c) => wordOf(c).textContent)).toEqual(['Wort1', 'Wort2', 'Wort3', 'Wort4', 'Wort5'])
  })

  it('after a slide the card that slid in is the very same DOM node: its word is not drawn anew', async () => {
    view()
    const next = screen.getByTestId('deck-next')
    const word = wordOf(next)
    const old = cardButton()
    swipe(-100)
    await waitFor(() => expect(counter()).toBe('2 / 5'))
    expect(cardButton()).toBe(next) // the same button…
    expect(wordOf(cardButton())).toBe(word) // …and the same word node: nothing re-mounted
    expect(screen.getByTestId('deck-prev')).toBe(old) // the old card stays, now on the left
  })

  it('after moving, the new card shows its front at once; only the current card animates a flip', async () => {
    view()
    fireEvent.click(cardButton())
    expect(facing(cardButton())).toBe('native')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(counter()).toBe('2 / 5'))
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
    await waitFor(() => expect(counter()).toBe('2 / 5'))
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
    await waitFor(() => expect(counter()).toBe('2 / 2'))
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
