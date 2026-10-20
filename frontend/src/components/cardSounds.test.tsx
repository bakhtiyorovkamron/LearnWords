import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { meApi, translationsApi } from '../api/endpoints'
import type { CollectionCard, DueCard } from '../api/types'
import { installUiSounds, resetUiSoundEventsForTests } from '../lib/uiSoundEvents'
import { playUi } from '../lib/uiSounds'
import { FlipCards } from './FlipCards'
import { QuizQuestion } from './QuizQuestion'

vi.mock('../lib/uiSounds', () => ({ playUi: vi.fn(), unlockUiSounds: vi.fn(), setUiSoundsEnabled: vi.fn() }))
vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    translationsApi: { batch: vi.fn() },
    foldersApi: { list: vi.fn().mockResolvedValue({ all: {}, folders: [] }) },
  }
})

const sounds = () => vi.mocked(playUi).mock.calls.map((c) => c[0])
/** A real click on a control: pointerdown (the generic tap listener sees it) then click. */
const click = (el: Element) => { fireEvent.pointerDown(el); fireEvent.click(el) }
const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
)

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(playUi).mockClear()
  vi.mocked(meApi.get).mockResolvedValue({ id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de' })
  vi.mocked(translationsApi.batch).mockResolvedValue({ c1: { translation: 'юг', example_translation: '' } })
  resetUiSoundEventsForTests()
  installUiSounds() // the real generic listener: a stray 'tap' would show up
})
afterEach(cleanup)

// --- flip cards ------------------------------------------------------------------------------

const card = (n: number): CollectionCard => ({
  id: `w${n}`, context_id: 'c', word: `Wort${n}`, translation: `слово${n}`, transcription: '', language: 'de',
  example_sentence: '', example_translation: '', folder_id: null, created_at: '', box_level: 1, is_learned: false,
  next_review_at: '2026-10-17T00:00:00Z', reviewed_today: false,
} as CollectionCard)

function renderFlip(n = 3) {
  render(wrap(<FlipCards cards={Array.from({ length: n }, (_, i) => card(i + 1))} resetKey="k" />))
}
const nextBtn = () => screen.getByRole('button', { name: /Next/ })
const prevBtn = () => screen.getByRole('button', { name: /Back|Prev/ })
const flipBtn = () => screen.getByRole('button', { name: /flip|Flip|Tap|tap/i })

describe('flip cards: sounds', () => {
  it('Next → exactly one cardNext, Prev → exactly one cardPrev (no extra tap)', () => {
    renderFlip()
    click(nextBtn())
    expect(sounds()).toEqual(['cardNext'])
    click(prevBtn())
    expect(sounds()).toEqual(['cardNext', 'cardPrev'])
  })

  it('flipping by click → exactly one cardFlip', () => {
    renderFlip()
    click(flipBtn())
    expect(sounds()).toEqual(['cardFlip'])
  })

  it('keys make the same sounds: → ← Space Enter', () => {
    renderFlip()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: ' ' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(sounds()).toEqual(['cardNext', 'cardPrev', 'cardFlip', 'cardFlip'])
  })

  it('silent at the first and at the last card (keys and the disabled buttons)', () => {
    renderFlip(2)
    fireEvent.keyDown(window, { key: 'ArrowLeft' }) // already the first card
    click(prevBtn()) // disabled
    expect(sounds()).toEqual([])
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(sounds()).toEqual(['cardNext'])
    fireEvent.keyDown(window, { key: 'ArrowRight' }) // already the last card
    click(nextBtn()) // disabled
    expect(sounds()).toEqual(['cardNext'])
  })

  it('a single card: arrows never make a sound', () => {
    renderFlip(1)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(sounds()).toEqual([])
  })
})

// --- training ------------------------------------------------------------------------------------

const due = { id: 'c1', context_id: 'ctx', word: 'Süden', translation: 'юг', transcription: '', language: 'de',
  example_sentence: '', example_translation: '', folder_id: null, created_at: '', box_level: 2, has_example: false } as DueCard

async function answered(isLast: boolean) {
  const onNext = vi.fn()
  render(wrap(
    <QuizQuestion item={{ card: due, format: 'ru_de_type' }} pool={[]} position={1} total={2} saving={false}
      onAnswer={vi.fn()} onNext={onNext} isLast={isLast} />,
  ))
  const input = await screen.findByPlaceholderText(/./)
  fireEvent.change(input, { target: { value: 'Süden' } })
  act(() => { fireEvent.submit(input.closest('form')!) })
  await waitFor(() => expect(screen.getByRole('button', { name: /Next|Finish/ })).toBeTruthy())
  vi.mocked(playUi).mockClear() // only the click on "Next" matters here
  return { onNext, next: screen.getByRole('button', { name: /Next|Finish/ }) }
}

describe('training "Next"', () => {
  it('plays cardNext (and only that — no generic tap), then goes on', async () => {
    const { onNext, next } = await answered(false)
    click(next)
    expect(sounds()).toEqual(['cardNext'])
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('on the last card nothing plays here (the result screen has its own sound)', async () => {
    const { onNext, next } = await answered(true)
    click(next)
    expect(sounds()).toEqual([])
    expect(onNext).toHaveBeenCalledTimes(1)
  })
})
