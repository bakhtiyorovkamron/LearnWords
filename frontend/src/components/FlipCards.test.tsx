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
const side = (name: 'learning' | 'native') => document.querySelector(`[data-side="${name}"]`) as HTMLElement
const visible = () => document.querySelector('[data-side][aria-hidden="false"]') as HTMLElement
const track = () => screen.getByTestId('deck-track')
const cardButton = () => screen.getByTestId('deck-card')

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
const counter = () => document.querySelector('[data-side="learning"] .tabular-nums')!.textContent

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

  it('the neighbours peek in: surface-only buttons labelled Back / Next, none before the first or after the last card', async () => {
    view()
    expect(screen.queryByTestId('deck-prev')).toBeNull()
    const next = screen.getByTestId('deck-next')
    expect(next.getAttribute('aria-label')).toBe('Next')
    expect(next.className).toContain('opacity-60')
    expect(next.textContent).toBe('') // surface only, no text
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

  it('the pager has up to 5 dots; the active one is wide: first, middle, last', async () => {
    view({ cards: cards(8), total: 8 })
    const dots = () => Array.from(screen.getByTestId('deck-pager').children)
    expect(dots()).toHaveLength(5)
    const active = () => dots().findIndex((d) => d.className.includes('w-5'))
    expect(active()).toBe(0)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(counter()).toBe('2 / 8'))
    expect(active()).toBe(2)
    cleanup()
    view({ cards: cards(2), total: 2 })
    expect(dots()).toHaveLength(2) // fewer than 5 cards: a dot per card
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(counter()).toBe('2 / 2'))
    expect(active()).toBe(1)
  })

  it('swipe hint on phones, the keys hint and the ‹ › buttons from md up', async () => {
    view()
    expect(screen.getByText('Swipe to move between cards').className).toContain('md:hidden')
    expect(screen.getByText('← → to browse, Space to flip').className).toContain('md:block')
    const next = screen.getAllByRole('button', { name: 'Next' }).find((b) => b.className.includes('md:grid'))!
    expect(next.className).toContain('hidden')
    fireEvent.click(next)
    await waitFor(() => expect(counter()).toBe('2 / 5'))
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
