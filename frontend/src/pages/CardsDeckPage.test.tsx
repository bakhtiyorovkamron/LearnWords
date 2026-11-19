import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { collectionApi, foldersApi, meApi } from '../api/endpoints'
import { CardsDeckPage } from './CardsDeckPage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    collectionApi: { list: vi.fn() },
    foldersApi: { list: vi.fn() },
  }
})

const row = (n: number) => ({
  id: `c${n}`, context_id: 'x', word: `Wort${n}`, translation: `слово${n}`, transcription: '', language: 'de', created_at: '',
  example_sentence: '', example_translation: '', translation_language: 'ru',
  box_level: 1, is_learned: false, next_review_at: new Date().toISOString(), reviewed_today: false,
})
const folder = (id: string, name: string, total: number) => ({ id, name, color: 'sky', created_at: '', total, new_count: 0, learning_count: 0, learned_count: 0, due_today: 0 })
const folderList = (allTotal: number) => ({
  all: { total: allTotal, new_count: 0, learning_count: 0, learned_count: 0, due_today: 0 },
  folders: [folder('f1', 'Tiere', 3), folder('f2', 'Essen', 2)],
})

const Where = () => <div data-testid="where">{useLocation().pathname + useLocation().search}</div>
function renderDeck(url: string | string[]) {
  const entries = Array.isArray(url) ? url : [url]
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Where />
        <Routes>
          <Route path="/cards" element={<CardsDeckPage />} />
          <Route path="/words" element={<div>WORDS LIST</div>} />
          <Route path="/words/:folder" element={<div>WORDS LIST</div>} />
          <Route path="/train" element={<div>TRAIN SCREEN</div>} />
          <Route path="/contexts/new" element={<div>ADD SCREEN</div>} />
          <Route path="/" element={<div>HOME SCREEN</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const where = () => screen.getByTestId('where').textContent

beforeEach(async () => {
  await i18n.changeLanguage('en')
  localStorage.clear()
  vi.mocked(meApi.get).mockResolvedValue({ id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de' })
  vi.mocked(collectionApi.list).mockResolvedValue({ items: [row(1), row(2)], total: 2 } as never)
  vi.mocked(foldersApi.list).mockResolvedValue(folderList(8) as never) // 3 + 2 in folders, 3 without
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

// jsdom has no PointerEvent: a MouseEvent carries the clientX / clientY the deck reads.
class TestPointerEvent extends MouseEvent {
  pointerId = 1
  pointerType = 'touch'
}
const pointerEvents = () => vi.stubGlobal('PointerEvent', TestPointerEvent)
const reducedMotion = () =>
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }))
const counter = () => screen.getByTestId('deck-counter').textContent
const scrubber = () => screen.getByRole('slider', { name: 'Go to card' }) as HTMLInputElement
/** A drag on the scrubber: down, moved to n (1-based), released. */
function scrub(n: number, release = true) {
  const range = scrubber()
  fireEvent.pointerDown(range)
  fireEvent.change(range, { target: { value: String(n) } })
  if (release) fireEvent.pointerUp(range)
}
const many = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1))
// jsdom cannot evaluate env(): the deck page's height is checked by its classes.
const classes = () => screen.getByTestId('deck-page').className.split(/\s+/)
const NORMAL_HEIGHT = 'h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)]'
const FOCUS_HEIGHT = 'h-[calc(100dvh-env(safe-area-inset-top))]'

describe('CardsDeckPage: full screen', () => {
  it('fits the screen without the shell: no --nav-h / --header-h terms, the stage takes what is left (≤ 720 px)', async () => {
    renderDeck('/cards')
    const page = screen.getByTestId('deck-page')
    expect(page.className).toContain('flex-col')
    expect(page.className).toContain('overflow-hidden')
    expect(page.className).toContain('max-w-3xl')
    // Both safe areas on phones: the scrubber stays above the home indicator.
    expect(classes()).toContain(NORMAL_HEIGHT)
    expect(classes()).toContain('md:h-[calc(100dvh-5rem)]')
    expect(classes()).not.toContain('-my-4')
    expect(page.className).not.toMatch(/--nav-h|--header-h/)
    const stage = await screen.findByTestId('deck-stage')
    expect(stage.className).toMatch(/\bflex-1\b/)
    expect(stage.className).toContain('min-h-[320px]')
    expect(stage.className).toContain('max-h-[720px]')
    expect(stage.style.touchAction).toBe('pan-y')
  })

  it('sets the training flag while it is open, so the shell steps aside', async () => {
    const { isTrainingOpen } = await import('../lib/trainingState')
    renderDeck('/cards')
    expect(isTrainingOpen()).toBe(true)
    cleanup()
    expect(isTrainingOpen()).toBe(false)
  })

  it('asks for the deck with the collection query (all words, 48 a page) and shows the first card', async () => {
    renderDeck('/cards')
    expect(await screen.findByTestId('deck-card')).toBeTruthy()
    expect(collectionApi.list).toHaveBeenCalledWith({ status: 'all', period: 'all', sort: 'repeat', q: '', folder: '', limit: 48, offset: 0, marksBefore: expect.any(String) })
    expect(counter()).toBe('1 / 2')
  })

  it('?folder=<id|none> narrows the deck', async () => {
    renderDeck('/cards?folder=f2')
    await screen.findByTestId('deck-card')
    expect(vi.mocked(collectionApi.list).mock.calls[0][0]).toMatchObject({ folder: 'f2' })
    cleanup(); vi.clearAllMocks()
    renderDeck('/cards?folder=none')
    await screen.findByTestId('deck-card')
    expect(vi.mocked(collectionApi.list).mock.calls[0][0]).toMatchObject({ folder: 'none' })
  })
})

describe('the top bar', () => {
  it('X on the left, the counter in the centre (tabular, muted), "⋯" on the right; the old pills are gone', async () => {
    renderDeck('/cards')
    await screen.findByTestId('deck-card')
    const bar = screen.getByTestId('deck-topbar')
    const buttons = within(bar).getAllByRole('button')
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Close cards', 'Deck options'])
    for (const b of buttons) expect(b.className).toMatch(/\bh-11\b.*\bw-11\b.*rounded-full/)
    expect(buttons[1].getAttribute('aria-haspopup')).toBe('menu')
    const c = within(bar).getByTestId('deck-counter')
    expect(c.className).toContain('tabular-nums')
    expect(c.className).toContain('text-muted')
    expect(screen.getAllByTestId('deck-counter')).toHaveLength(1) // none under the controls any more
    expect(screen.queryByRole('button', { name: /All words|DE → EN/ })).toBeNull()
  })

  it('while loading and on an empty deck: only X and "⋯", no counter', async () => {
    vi.mocked(collectionApi.list).mockReturnValue(new Promise(() => undefined))
    renderDeck('/cards')
    expect(screen.getByRole('button', { name: 'Close cards' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Deck options' })).toBeTruthy()
    expect(screen.queryByTestId('deck-counter')).toBeNull()
    cleanup()
    vi.mocked(collectionApi.list).mockResolvedValue({ items: [], total: 0 })
    renderDeck('/cards')
    await screen.findByText('The collection is empty')
    expect(screen.queryByTestId('deck-counter')).toBeNull()
    expect(screen.getByRole('button', { name: 'Deck options' })).toBeTruthy()
  })

  it('X goes back where the user came from inside the app', async () => {
    renderDeck(['/words', '/cards'])
    fireEvent.click(await screen.findByRole('button', { name: 'Close cards' }))
    expect(await screen.findByText('WORDS LIST')).toBeTruthy()
  })

  it('X goes Home when the deck was opened directly (no history)', async () => {
    renderDeck('/cards')
    fireEvent.click(await screen.findByRole('button', { name: 'Close cards' }))
    expect(await screen.findByText('HOME SCREEN')).toBeTruthy()
  })

  it('Esc closes the deck the same way', async () => {
    renderDeck(['/words', '/cards'])
    await screen.findByTestId('deck-card')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(await screen.findByText('WORDS LIST')).toBeTruthy()
  })

  it('the counter follows swipes and the arrow keys', async () => {
    reducedMotion()
    pointerEvents()
    vi.mocked(collectionApi.list).mockResolvedValue({ items: many(5), total: 5 } as never)
    renderDeck('/cards')
    await screen.findByTestId('deck-card')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(counter()).toBe('2 / 5')
    expect(scrubber().value).toBe('2')
    const track = screen.getByTestId('deck-track')
    Object.defineProperty(screen.getByTestId('deck-stage'), 'clientWidth', { configurable: true, value: 508 })
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    fireEvent.pointerDown(track, { clientX: 300 })
    fireEvent.pointerMove(window, { clientX: 50 })
    now.mockReturnValue(1300) // the finger rested: a slow drag, not a flick
    fireEvent.pointerUp(window, { clientX: 50 })
    now.mockRestore()
    expect(counter()).toBe('3 / 5')
    expect(scrubber().value).toBe('3')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(counter()).toBe('2 / 5')
    vi.unstubAllGlobals()
  })
})

describe('the "⋯" menu', () => {
  const openMenu = async (url = '/cards') => {
    renderDeck(url)
    fireEvent.click(await screen.findByRole('button', { name: 'Deck options' }))
    return screen.getByRole('menu')
  }

  it('has the folder (name and count) and the direction rows', async () => {
    const menu = await openMenu('/cards?folder=f1')
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((r) => r.textContent)).toEqual(['FolderTiere3', 'DirectionDE → EN'])
    expect(screen.getByRole('button', { name: 'Deck options' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('"All words 8" without a folder', async () => {
    const menu = await openMenu()
    await waitFor(() => expect(within(menu).getAllByRole('menuitem')[0].textContent).toBe('FolderAll words8'))
  })

  it('the folder row opens the folder sheet; picking sets ?folder= (replace)', async () => {
    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Folder/ }))
    expect(screen.queryByRole('menu')).toBeNull()
    const dialog = screen.getByRole('dialog', { name: 'Which folder?' })
    expect(within(dialog).getAllByRole('radio').map((r) => r.textContent)).toEqual(['All words8', 'Tiere3', 'Essen2', 'No folder3'])
    fireEvent.click(within(dialog).getByRole('radio', { name: /Essen/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(where()).toBe('/cards?folder=f2')
  })

  it('Esc in the folder sheet closes only the sheet, not the deck', async () => {
    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Folder/ }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(where()).toBe('/cards')
  })

  it('the direction row toggles de_ru ↔ ru_de, remembers it and stays open', async () => {
    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Direction/ }))
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: /Direction/ }).textContent).toBe('DirectionEN → DE')
    expect(localStorage.getItem('flip-direction')).toBe('ru_de')
    expect(document.querySelector('[data-testid="deck-card"] [data-side][aria-hidden="false"]')!.getAttribute('data-side')).toBe('native')
  })

  it('starts from the saved direction', async () => {
    localStorage.setItem('flip-direction', 'ru_de')
    const menu = await openMenu()
    expect(within(menu).getByRole('menuitem', { name: /Direction/ }).textContent).toBe('DirectionEN → DE')
  })

  it('an outside tap and Esc close it, the focus goes back to "⋯", and Esc does not close the deck', async () => {
    await openMenu()
    fireEvent.click(screen.getByTestId('deck-menu-scrim'))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Deck options' }))
    fireEvent.click(screen.getByRole('button', { name: 'Deck options' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Deck options' }))
    expect(where()).toBe('/cards')
  })
})

describe('the scrubber', () => {
  it('1 … total over the whole deck, not only the loaded cards; a 4 px track, labelled', async () => {
    vi.mocked(collectionApi.list).mockResolvedValue({ items: many(48), total: 120 } as never)
    renderDeck('/cards')
    await screen.findByTestId('deck-card')
    const range = scrubber()
    expect([range.min, range.max, range.value]).toEqual(['1', '120', '1'])
    expect(range.getAttribute('aria-valuetext')).toBe('1 of 120')
    expect(range.className).toContain('deck-range')
    expect(screen.getByTestId('deck-scrubber').textContent).toContain('120')
  })

  it('while dragging a bubble names the card (number · word), only the number when it is not loaded', async () => {
    vi.mocked(collectionApi.list).mockResolvedValue({ items: [...many(17), { ...row(18), word: 'das Bett', article: 'das' }], total: 60 } as never)
    renderDeck('/cards')
    await screen.findByTestId('deck-card')
    expect(screen.queryByTestId('deck-scrubber-bubble')).toBeNull()
    scrub(18, false)
    expect(screen.getByTestId('deck-scrubber-bubble').textContent).toBe('18 · das Bett')
    fireEvent.change(scrubber(), { target: { value: '55' } })
    expect(screen.getByTestId('deck-scrubber-bubble').textContent).toBe('55')
  })

  it('releasing on a loaded card jumps there, with a light vibration', async () => {
    reducedMotion()
    const vibrate = vi.fn()
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate })
    vi.mocked(collectionApi.list).mockResolvedValue({ items: many(20), total: 20 } as never)
    renderDeck('/cards')
    await screen.findByTestId('deck-card')
    scrub(12, false)
    expect(vibrate).not.toHaveBeenCalled() // on release only
    fireEvent.pointerUp(scrubber())
    expect(counter()).toBe('12 / 20')
    expect(screen.queryByTestId('deck-scrubber-bubble')).toBeNull()
    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-testid="deck-card"]')!.textContent).toContain('Wort12')
    vi.unstubAllGlobals()
  })

  it('releasing on a card not loaded yet loads the pages first (spinner, drags ignored), then jumps', async () => {
    reducedMotion()
    let release: () => void = () => {}
    vi.mocked(collectionApi.list).mockImplementation(async (q) => {
      const offset = (q as { offset: number }).offset
      if (offset > 0) await new Promise<void>((r) => { release = r })
      return { items: Array.from({ length: Math.min(48, 120 - offset) }, (_, i) => row(offset + i + 1)), total: 120 } as never
    })
    renderDeck('/cards')
    await screen.findByTestId('deck-card')
    scrub(100)
    expect(await screen.findByTestId('deck-scrubber-spinner')).toBeTruthy()
    scrub(5) // ignored while loading
    expect(counter()).toBe('1 / 120')
    release() // page 2 (49–96)
    await waitFor(() => expect(vi.mocked(collectionApi.list).mock.calls.some(([q]) => (q as { offset: number }).offset === 96)).toBe(true))
    release() // page 3 (97–120)
    await waitFor(() => expect(counter()).toBe('100 / 120'))
    expect(screen.queryByTestId('deck-scrubber-spinner')).toBeNull()
    expect(document.querySelector('[data-testid="deck-card"]')!.textContent).toContain('Wort100')
    vi.unstubAllGlobals()
  })

  it('is hidden for a one-card deck', async () => {
    vi.mocked(collectionApi.list).mockResolvedValue({ items: [row(1)], total: 1 } as never)
    renderDeck('/cards')
    await screen.findByTestId('deck-card')
    expect(screen.queryByRole('slider')).toBeNull()
  })
})

describe('focus mode on the page', () => {
  it('⤢ hides the top bar, the controls and the scrubber; Esc brings them back', async () => {
    renderDeck('/cards')
    fireEvent.click(await screen.findByRole('button', { name: 'Full-screen card' }))
    expect(screen.queryByTestId('deck-topbar')).toBeNull()
    expect(screen.queryByTestId('deck-controls')).toBeNull()
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.getByTestId('deck-stage').dataset.focus).toBe('true')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByTestId('deck-topbar')).toBeTruthy()
    expect(screen.getByRole('slider')).toBeTruthy()
    expect(where()).toBe('/cards') // the first Esc only left focus mode
  })

  it('cancels main\'s vertical padding and takes the screen below the status bar; leaving it puts the normal height back', async () => {
    renderDeck('/cards')
    fireEvent.click(await screen.findByRole('button', { name: 'Full-screen card' }))
    expect(classes()).toEqual(expect.arrayContaining(['-my-4', 'md:-my-10', FOCUS_HEIGHT, 'md:h-dvh']))
    expect(classes()).not.toContain(NORMAL_HEIGHT)
    expect(classes()).not.toContain('md:h-[calc(100dvh-5rem)]')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(classes()).toEqual(expect.arrayContaining([NORMAL_HEIGHT, 'md:h-[calc(100dvh-5rem)]']))
    for (const gone of ['-my-4', 'md:-my-10', FOCUS_HEIGHT, 'md:h-dvh']) expect(classes()).not.toContain(gone)
  })

  it('F toggles it, and so does "а" (the same key in the Russian layout); Ctrl+F does not', async () => {
    renderDeck('/cards')
    await screen.findByTestId('deck-card')
    fireEvent.keyDown(window, { key: 'f', code: 'KeyF' })
    expect(screen.queryByTestId('deck-topbar')).toBeNull()
    fireEvent.keyDown(window, { key: 'f', code: 'KeyF' })
    expect(screen.getByTestId('deck-topbar')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'а' })
    expect(screen.queryByTestId('deck-topbar')).toBeNull()
    fireEvent.keyDown(window, { key: 'а' })
    fireEvent.keyDown(window, { key: 'f', code: 'KeyF', ctrlKey: true })
    expect(screen.getByTestId('deck-topbar')).toBeTruthy()
  })

  it('is not remembered: the deck always opens in the normal view', async () => {
    renderDeck('/cards')
    fireEvent.click(await screen.findByRole('button', { name: 'Full-screen card' }))
    cleanup()
    renderDeck('/cards')
    await screen.findByTestId('deck-card')
    expect(screen.getByTestId('deck-topbar')).toBeTruthy()
  })

  it('a downward drag over 90 px leaves it', async () => {
    pointerEvents()
    renderDeck('/cards')
    fireEvent.click(await screen.findByRole('button', { name: 'Full-screen card' }))
    const track = screen.getByTestId('deck-track')
    fireEvent.pointerDown(track, { clientX: 200, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 200, clientY: 220 })
    fireEvent.pointerUp(window, { clientX: 200, clientY: 220 })
    expect(screen.getByTestId('deck-topbar')).toBeTruthy()
    vi.unstubAllGlobals()
  })
})

describe('loading and empty', () => {
  it('while loading: one skeleton card', () => {
    vi.mocked(collectionApi.list).mockReturnValue(new Promise(() => undefined))
    renderDeck('/cards')
    const skeleton = document.querySelector('[aria-busy="true"]') as HTMLElement
    expect(skeleton.className).toContain('animate-pulse')
    expect(skeleton.className).toContain('rounded-[32px]')
    expect(screen.queryByTestId('deck-card')).toBeNull()
  })

  it('an empty folder: the text and a link to add a word', async () => {
    vi.mocked(collectionApi.list).mockResolvedValue({ items: [], total: 0 })
    renderDeck('/cards?folder=f1')
    expect(await screen.findByText('This folder has no words yet')).toBeTruthy()
    const add = screen.getByRole('link', { name: 'Add a word' })
    expect(add.getAttribute('href')).toBe('/contexts/new')
    expect(add.className).toContain('btn-primary')
  })

  it('an empty collection says so', async () => {
    vi.mocked(collectionApi.list).mockResolvedValue({ items: [], total: 0 })
    renderDeck('/cards')
    expect(await screen.findByText('The collection is empty')).toBeTruthy()
  })
})

describe('the legacy links of the old Cards tab', () => {
  it('?start=1&size=12 → /train?size=12; a size nobody accepts, or none → /train', async () => {
    renderDeck('/cards?start=1&size=12')
    expect(await screen.findByText('TRAIN SCREEN')).toBeTruthy()
    expect(where()).toBe('/train?size=12')
    cleanup()
    renderDeck('/cards?start=1&size=99')
    expect(await screen.findByText('TRAIN SCREEN')).toBeTruthy()
    expect(where()).toBe('/train')
    cleanup()
    renderDeck('/cards?start=1')
    expect(await screen.findByText('TRAIN SCREEN')).toBeTruthy()
    expect(where()).toBe('/train')
  })

  it('?practice=1 → free practice (/train?mode=practice)', async () => {
    renderDeck('/cards?practice=1')
    expect(await screen.findByText('TRAIN SCREEN')).toBeTruthy()
    expect(where()).toBe('/train?mode=practice')
  })

  it('?tab=all → /words, and with &folder=X → /words/X', async () => {
    renderDeck('/cards?tab=all')
    expect(await screen.findByText('WORDS LIST')).toBeTruthy()
    expect(where()).toBe('/words')
    cleanup()
    renderDeck('/cards?tab=all&folder=f1')
    expect(await screen.findByText('WORDS LIST')).toBeTruthy()
    expect(where()).toBe('/words/f1')
  })
})

describe('the next page', () => {
  it('is loaded when the deck is near its end', async () => {
    // (counter is the top bar's)
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined })) // no animation: a step is one event
    const page1 = Array.from({ length: 48 }, (_, i) => row(i + 1))
    vi.mocked(collectionApi.list).mockImplementation(async (q) =>
      ({ items: (q as { offset: number }).offset === 0 ? page1 : [row(49), row(50)], total: 50 }) as never)
    renderDeck('/cards')
    await screen.findByTestId('deck-card')
    const asked = (offset: number) => vi.mocked(collectionApi.list).mock.calls.some(([q]) => (q as { offset: number }).offset === offset)
    for (let n = 0; n < 44; n++) fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(counter()).toBe('45 / 50'))
    expect(asked(48)).toBe(false) // 3 cards are still behind the 45th of 48 loaded
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(asked(48)).toBe(true))
    vi.unstubAllGlobals()
  })
})
