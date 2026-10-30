import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { meApi, translationsApi } from '../api/endpoints'
import type { CollectionCard, DueCard } from '../api/types'
import { FlipCards } from './FlipCards'
import { QuizQuestion } from './QuizQuestion'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    translationsApi: { batch: vi.fn() },
    foldersApi: { list: vi.fn().mockResolvedValue({ all: {}, folders: [] }) },
  }
})

// The app makes no sound effects: nothing may ever create an audio context. Word pronunciation
// is the browser's speech synthesis and keeps working.
const audioContext = vi.fn()
// The name is assembled so that a search for the removed sound code finds only real leftovers.
const CONTEXT_NAMES = [['Audio', 'Context'].join(''), ['webkit', 'Audio', 'Context'].join('')]
const speak = vi.fn()

beforeEach(async () => {
  await i18n.changeLanguage('en')
  audioContext.mockClear()
  speak.mockClear()
  for (const name of CONTEXT_NAMES) vi.stubGlobal(name, audioContext)
  vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() })
  vi.stubGlobal('SpeechSynthesisUtterance', function (this: { text: string; lang: string }, text: string) { this.text = text })
  vi.mocked(meApi.get).mockResolvedValue({ id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de' })
  vi.mocked(translationsApi.batch).mockResolvedValue({ c1: { translation: 'юг', example_translation: '' } })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
)
/** A real click: pointerdown, then click. */
const click = (el: Element) => { fireEvent.pointerDown(el); fireEvent.click(el) }

const card = (n: number): CollectionCard => ({
  id: `w${n}`, context_id: 'c', word: `Wort${n}`, translation: `слово${n}`, transcription: '', language: 'de',
  example_sentence: '', example_translation: '', folder_id: null, created_at: '', box_level: 1, is_learned: false,
  next_review_at: '2026-10-17T00:00:00Z', reviewed_today: false,
} as CollectionCard)

describe('flip cards', () => {
  it('turning, flipping and the keys make no sound; ▶ still speaks the word', () => {
    render(wrap(<FlipCards cards={[card(1), card(2), card(3)]} resetKey="k" />))
    click(screen.getByRole('button', { name: /Next/ }))
    click(screen.getByRole('button', { name: /Back|Prev/ }))
    click(screen.getByRole('button', { name: /flip|Flip|Tap|tap/i }))
    for (const key of ['ArrowRight', 'ArrowLeft', ' ', 'Enter']) fireEvent.keyDown(window, { key })
    expect(audioContext).not.toHaveBeenCalled()

    expect(speak).not.toHaveBeenCalled()
    const listen = screen.getByTitle(/listen/i)
    click(listen)
    expect(speak).toHaveBeenCalledTimes(1)
    expect(speak.mock.calls[0][0]).toMatchObject({ lang: 'de-DE' })
  })
})

describe('training question', () => {
  const due = { id: 'c1', context_id: 'ctx', word: 'Süden', translation: 'юг', transcription: '', language: 'de',
    example_sentence: '', example_translation: '', folder_id: null, created_at: '', box_level: 2, has_example: false } as DueCard

  async function answerTyped(value: string) {
    const onNext = vi.fn()
    render(wrap(
      <QuizQuestion item={{ card: due, format: 'ru_de_type' }} pool={[]} position={1} total={2} saving={false}
        onAnswer={vi.fn()} onNext={onNext} />,
    ))
    const input = await screen.findByPlaceholderText(/./)
    fireEvent.change(input, { target: { value } })
    act(() => { fireEvent.submit(input.closest('form')!) })
    const next = await screen.findByRole('button', { name: /Next|Finish/ })
    return { onNext, next }
  }

  it.each([['a right answer', 'Süden'], ['a wrong answer', 'Norden']])('%s, and "Next", make no sound', async (_n, value) => {
    const { onNext, next } = await answerTyped(value)
    click(next)
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(audioContext).not.toHaveBeenCalled()
  })

  it('▶ Listen speaks the word at once (no sound queue in front of it)', async () => {
    await answerTyped('Süden') // the reverse formats offer listening after the answer
    click(await screen.findByRole('button', { name: /Listen/ }))
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1))
    expect(speak.mock.calls[0][0]).toMatchObject({ text: 'Süden', lang: 'de-DE' })
    expect(audioContext).not.toHaveBeenCalled()
  })
})
