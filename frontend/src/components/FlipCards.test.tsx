import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
