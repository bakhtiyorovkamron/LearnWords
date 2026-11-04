import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { wordsApi } from '../api/endpoints'
import type { WordCard } from '../api/types'
import { splitArticle } from '../lib/article'
import { UNDO_MS, resetDeleteWords } from '../lib/deleteWords'
import { Toaster } from './Toaster'
import { WordCardView } from './WordCard'

vi.mock('./EditWordModal', () => ({ EditWordModal: () => <div>EDIT MODAL</div> }))
vi.mock('./FolderPicker', () => ({ FolderPicker: () => <div>FOLDER PICKER</div> }))
vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, wordsApi: { ...mod.wordsApi, remove: vi.fn().mockResolvedValue({ deleted: 1 }) } }
})

const card: WordCard = {
  id: 'c1', context_id: 'x', word: 'Hund', article: 'der', translation: 'собака', transcription: '[hʊnt]',
  example_sentence: 'Der Hund bellt.', example_translation: 'Собака лает.', language: 'de', created_at: '',
}
const progress = { boxLevel: 3, isLearned: false, nextReviewAt: new Date().toISOString(), reviewedToday: false }

function view(c: WordCard, props: Partial<Parameters<typeof WordCardView>[0]> = {}) {
  return render(<QueryClientProvider client={new QueryClient()}><WordCardView card={c} progress={progress} {...props} /></QueryClientProvider>)
}

const speakApi = { speak: vi.fn(), cancel: vi.fn(), getVoices: vi.fn(() => [] as { lang: string }[]), addEventListener: vi.fn() }
beforeEach(async () => {
  await i18n.changeLanguage('en')
  speakApi.getVoices.mockReturnValue([])
  vi.stubGlobal('speechSynthesis', speakApi)
  vi.stubGlobal('SpeechSynthesisUtterance', function (this: { text: string }, text: string) { this.text = text })
})
afterEach(() => { cleanup(); resetDeleteWords(); vi.useRealTimers(); vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('splitArticle', () => {
  it('uses card.article, else a leading article of the word (any case), else none', () => {
    expect(splitArticle('Hund', 'der')).toEqual({ article: 'der', rest: 'Hund' })
    expect(splitArticle('die Katze', null)).toEqual({ article: 'die', rest: 'Katze' })
    expect(splitArticle('Das Haus')).toEqual({ article: 'das', rest: 'Haus' })
    expect(splitArticle('die Katze', 'die')).toEqual({ article: 'die', rest: 'Katze' })
    expect(splitArticle('laufen')).toEqual({ article: null, rest: 'laufen' })
  })
})

describe('WordCardView row', () => {
  it('colours the article from card.article and from a "die …" word; no article → plain', () => {
    const { container, rerender } = view(card)
    expect(container.querySelector('[data-article="der"]')?.className).toContain('text-der')
    const qc = new QueryClient()
    rerender(<QueryClientProvider client={qc}><WordCardView card={{ ...card, article: undefined, word: 'die Katze' }} progress={progress} /></QueryClientProvider>)
    expect(container.querySelector('[data-article="die"]')?.className).toContain('text-die')
    rerender(<QueryClientProvider client={qc}><WordCardView card={{ ...card, article: undefined, word: 'laufen' }} progress={progress} /></QueryClientProvider>)
    expect(container.querySelector('[data-article]')).toBeNull()
    expect(screen.getByText('laufen').className).toContain('text-fg')
  })

  it('shows the translation, 5 box bars and a listen button', () => {
    const { container } = view(card)
    expect(screen.getByText('собака')).toBeTruthy()
    expect(container.querySelectorAll('[data-testid="box-bars"] span').length).toBe(5)
    expect(screen.getByLabelText('Listen')).toBeTruthy()
  })

  it('an English card has a listen button that reads it with the English locale', () => {
    view({ ...card, language: 'en', word: 'the house', article: undefined })
    fireEvent.click(screen.getByLabelText('Listen'))
    const u = speakApi.speak.mock.calls.at(-1)![0] as { text: string; lang: string }
    expect(u.text).toBe('the house')
    expect(u.lang).toBe('en-US')
    expect(screen.queryByRole('dialog')).toBeNull() // the click did not open the word sheet
  })

  it('no listen button when the device has no voice for the language', () => {
    speakApi.getVoices.mockReturnValue([{ lang: 'en-US' }])
    view({ ...card, language: 'ko', word: '집' })
    expect(screen.queryByLabelText('Listen')).toBeNull()
  })

  it('the sheet fills the gap with example_gap_answer, or with the word when there is none', () => {
    const gap = { ...card, word: 'schmecken', example_sentence: 'Die Suppe ___ gut.' }
    const { unmount } = view({ ...gap, example_gap_answer: 'schmeckt' })
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(screen.getByRole('dialog').textContent).toContain('Die Suppe schmeckt gut.')
    unmount()
    view(gap)
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(screen.getByRole('dialog').textContent).toContain('Die Suppe schmecken gut.')
  })

  it('a click opens the sheet with the example; Edit and Move open their dialogs', () => {
    view(card)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByTestId('word-row'))
    const sheet = screen.getByRole('dialog')
    expect(sheet.textContent).toContain('Der Hund bellt.')
    expect(sheet.textContent).toContain('Собака лает.')
    expect(sheet.textContent).toContain('[hʊnt]')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByText('EDIT MODAL')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Move to folder opens the picker', () => {
    view(card)
    fireEvent.click(screen.getByTestId('word-row'))
    fireEvent.click(screen.getByRole('button', { name: 'Move to folder' }))
    expect(screen.getByText('FOLDER PICKER')).toBeTruthy()
  })

  it('Delete closes the sheet without a confirm dialog, shows the toast with Undo; nothing is sent before 6 s', async () => {
    vi.useFakeTimers()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<QueryClientProvider client={new QueryClient()}><Toaster /><WordCardView card={card} progress={progress} /></QueryClientProvider>)
    fireEvent.click(screen.getByTestId('word-row'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete word' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
    expect(screen.getByText('Deleted “Hund”')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
    await act(() => vi.advanceTimersByTimeAsync(UNDO_MS - 1))
    expect(wordsApi.remove).not.toHaveBeenCalled()
  })

  it('Esc closes the sheet', () => {
    view(card)
    fireEvent.click(screen.getByTestId('word-row'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('in select mode a click toggles and no sheet opens', () => {
    const onToggle = vi.fn()
    view(card, { selection: { checked: false, onToggle } })
    fireEvent.click(screen.getByTestId('word-row'))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggle).toHaveBeenCalledTimes(2) // the checkbox itself toggles once, not twice
  })
})

// jsdom has no PointerEvent: without one fireEvent.pointer* sends a plain Event with no coordinates.
class TestPointerEvent extends MouseEvent {
  pointerId: number
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
  }
}

describe('WordCardView swipe', () => {
  let now = 0
  let restore: (() => void)[] = []
  beforeEach(() => {
    now = 1_000_000
    const win = document.defaultView as unknown as { PointerEvent?: unknown }
    const prevPointerEvent = win.PointerEvent
    win.PointerEvent = TestPointerEvent
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 350 } as DOMRect)
    restore = [() => clock.mockRestore(), () => rect.mockRestore(), () => { win.PointerEvent = prevPointerEvent }]
  })
  afterEach(() => restore.forEach((r) => r()))

  const katze: WordCard = { ...card, id: 'c2', word: 'Katze', article: 'die' }
  function swipeView(cards: WordCard[] = [card]) {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Toaster />
        {cards.map((c) => <WordCardView key={c.id} card={c} progress={progress} />)}
      </QueryClientProvider>,
    )
    return screen.getAllByTestId('word-row')
  }
  // A slow drag in two steps (0.5 · dx per 200 ms: no flick), then the release.
  function drag(el: Element, dx: number, dy = 0) {
    const at = (f: number) => ({ clientX: 300 + dx * f, clientY: 100 + dy * f, pointerId: 1 })
    fireEvent.pointerDown(el, at(0))
    now += 200
    fireEvent.pointerMove(el, at(0.5))
    now += 200
    fireEvent.pointerMove(el, at(1))
    now += 50
    fireEvent.pointerUp(el, at(1))
  }
  const actions = () => screen.queryAllByRole('button', { name: /^(Move|Delete)$/ })
  const isOpen = (row: HTMLElement) => within(row).getByTestId('swipe-panel').getAttribute('aria-hidden') !== 'true'

  it('closed: the actions are hidden and not focusable', () => {
    const [row] = swipeView()
    expect(actions()).toHaveLength(0)
    const panel = within(row).getByTestId('swipe-panel')
    expect(panel.style.transform).toBe('translateX(168px)')
    expect(within(panel).getAllByRole('button', { hidden: true }).map((b) => b.tabIndex)).toEqual([-1, -1])
  })

  it('drag left 120px → the panel opens; the click that follows does not open the sheet', () => {
    const [row] = swipeView()
    drag(row, -120)
    fireEvent.click(row)
    expect(isOpen(row)).toBe(true)
    expect(within(row).getByTestId('swipe-panel').style.transform).toBe('translateX(0px)')
    expect(actions().map((b) => b.textContent)).toEqual(['Move', 'Delete'])
    expect(actions().every((b) => b.tabIndex === 0)).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('drag left 40px → snaps back closed', () => {
    const [row] = swipeView()
    drag(row, -40)
    fireEvent.click(row)
    expect(isOpen(row)).toBe(false)
    expect(within(row).getByTestId('swipe-panel').style.transform).toBe('translateX(168px)')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a fast flick left opens even a short drag', () => {
    const [row] = swipeView()
    fireEvent.pointerDown(row, { clientX: 300, clientY: 100 })
    now += 200
    fireEvent.pointerMove(row, { clientX: 270, clientY: 100 })
    now += 20
    fireEvent.pointerMove(row, { clientX: 240, clientY: 100 }) // 30px in 20 ms = 1.5 px/ms
    fireEvent.pointerUp(row, { clientX: 240, clientY: 100 })
    expect(isOpen(row)).toBe(true)
  })

  it('drag left 260px (> 60%) → deleted at once, no sheet', () => {
    const [row] = swipeView()
    drag(row, -260)
    fireEvent.click(row)
    expect(screen.getByText('Deleted “Hund”')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(wordsApi.remove).not.toHaveBeenCalled() // Undo time
  })

  it('a vertical drag (dy 40, dx 5) is a scroll: no swipe', () => {
    const [row] = swipeView()
    drag(row, -5, 40)
    expect(isOpen(row)).toBe(false)
    expect(within(row).getByTestId('swipe-panel').style.transform).toBe('translateX(168px)')
  })

  it('Delete in the open panel deletes; Move opens the folder picker', () => {
    const [row] = swipeView()
    drag(row, -120)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Deleted “Hund”')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(isOpen(row)).toBe(false)
    cleanup()
    const [again] = swipeView()
    drag(again, -120)
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    expect(screen.getByText('FOLDER PICKER')).toBeTruthy()
  })

  it('a tap on an open row closes it instead of opening the sheet', () => {
    const [row] = swipeView()
    drag(row, -120)
    fireEvent.click(row) // the click of the swipe itself
    fireEvent.click(row)
    expect(isOpen(row)).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the listen button does not start a swipe', () => {
    const [row] = swipeView()
    drag(within(row).getByLabelText('Listen'), -120)
    expect(isOpen(row)).toBe(false)
  })

  it('in select mode a horizontal drag does nothing; the tap still toggles', () => {
    const onToggle = vi.fn()
    view(card, { selection: { checked: false, onToggle } })
    const row = screen.getByTestId('word-row')
    drag(row, -120)
    expect(screen.queryByTestId('swipe-panel')).toBeNull()
    fireEvent.click(row)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('opening row B closes row A', () => {
    const [a, b] = swipeView([card, katze])
    drag(a, -120)
    expect(isOpen(a)).toBe(true)
    drag(b, -120)
    expect(isOpen(b)).toBe(true)
    expect(isOpen(a)).toBe(false)
  })

  it('a page scroll closes the open row', () => {
    const [row] = swipeView()
    drag(row, -120)
    act(() => { window.dispatchEvent(new Event('scroll')) })
    expect(isOpen(row)).toBe(false)
  })
})
