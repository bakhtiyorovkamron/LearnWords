import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { meApi, translationsApi } from '../api/endpoints'
import type { DueCard, Progress, WordCard } from '../api/types'
import type { QuizFormat, QuizItem } from '../lib/quiz'
import { QuizQuestion } from './QuizQuestion'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, meApi: { get: vi.fn() }, translationsApi: { batch: vi.fn() } }
})

const card = (n: number, over: Partial<DueCard> = {}): DueCard => ({
  id: `c${n}`, context_id: 'x', word: `Wort${n}`, translation: `слово${n}`, transcription: '', language: 'de',
  example_sentence: '', example_translation: '', folder_id: null, created_at: '', box_level: 1, has_example: false, ...over,
} as DueCard)
const pool = [2, 3, 4].map((n) => card(n) as unknown as WordCard)

const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
const progress = (box: number, days: number, learned = false): Progress =>
  ({ word_id: 'c1', box_level: box, correct_streak_at_max: 0, is_learned: learned, next_review_at: daysFromNow(days) })

interface Over { format?: QuizFormat; card?: DueCard; saving?: boolean; error?: string | null; progress?: Progress | null; practice?: boolean; position?: number; total?: number }

function setup(o: Over = {}) {
  const onAnswer = vi.fn(), onNext = vi.fn()
  const item: QuizItem = { card: o.card ?? card(1), format: o.format ?? 'de_ru' }
  const where: { current: string } = { current: '' }
  const Spy = () => { where.current = useLocation().pathname; return null }
  const view = (props: Over) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/cards']}>
        <Spy />
        <Routes>
          <Route path="*" element={
            <QuizQuestion item={item} pool={pool} position={props.position ?? 1} total={props.total ?? 3} saving={props.saving ?? false}
              error={props.error} onAnswer={onAnswer} onNext={onNext} practice={props.practice} progress={props.progress} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  const r = render(view(o))
  return { onAnswer, onNext, where, rerender: (props: Over) => r.rerender(view({ ...o, ...props })) }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(meApi.get).mockResolvedValue({ id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de' })
  vi.mocked(translationsApi.batch).mockImplementation(async (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, { translation: `слово ${id}`, example_translation: `Пример ${id}` }])))
})
afterEach(() => cleanup())

const sheet = () => screen.getByRole('status')
const optionButtons = () => screen.getAllByRole('button').filter((b) => b.className.includes('min-h-14'))
const optionByText = (text: string) => optionButtons().find((b) => b.textContent === text)!

describe('the question', () => {
  it('top row: close button, progress bar and the counter', async () => {
    setup({ position: 2, total: 5 })
    expect(await screen.findByText('2/5')).toBeTruthy()
    const bar = screen.getByRole('progressbar')
    expect(bar.className).toContain('bg-track')
    expect((bar.firstChild as HTMLElement).style.width).toBe('20%') // one question done out of five
    expect((bar.firstChild as HTMLElement).className).toContain('bg-accent')
    expect(screen.getByRole('button', { name: 'End training' }).className).toContain('h-11')
  })

  it('the close button leaves for the Home page', async () => {
    const { where } = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'End training' }))
    expect(where.current).toBe('/')
  })

  it('practice mode: the lock line under the progress row', async () => {
    setup({ practice: true })
    expect(await screen.findByText('This practice does not change your review schedule')).toBeTruthy()
    cleanup()
    setup({ practice: false })
    await screen.findByText('1/3')
    expect(screen.queryByText(/does not change your review schedule/)).toBeNull()
  })

  it('de_ru: the German word big and serif, options are translations, listening is offered at once', async () => {
    setup({ format: 'de_ru' })
    const word = await screen.findByText('Wort1')
    expect(word.className).toContain('font-serif')
    expect(word.className).toContain('text-[34px]')
    expect(screen.getByText('Choose the translation')).toBeTruthy()
    expect(optionButtons()).toHaveLength(3)
    expect(optionButtons().every((b) => !b.querySelector('.font-serif'))).toBe(true) // translations are sans
    expect(screen.getByRole('button', { name: 'Listen' })).toBeTruthy()
  })

  it('ru_de: the translation is the prompt, the German options are serif, no listening before the answer', async () => {
    setup({ format: 'ru_de' })
    const prompt = await screen.findByText('слово c1')
    expect(prompt.className).toContain('text-[26px]')
    expect(prompt.className).toContain('font-semibold')
    expect(optionButtons().every((b) => b.querySelector('.font-serif'))).toBe(true)
    expect(screen.queryByRole('button', { name: 'Listen' })).toBeNull()
  })

  it('the loading state is a card with muted text', () => {
    vi.mocked(translationsApi.batch).mockReturnValue(new Promise(() => undefined))
    setup({ format: 'de_ru' })
    expect(screen.getByText('Loading…').className).toContain('text-muted')
  })
})

describe('answering a choice question', () => {
  it('a right pick: marked with a check, the others dimmed, the sheet says "Correct!" with the word and its translation', async () => {
    const { onAnswer } = setup({ format: 'de_ru', progress: progress(4, 7) })
    const right = await screen.findByRole('button', { name: 'слово c1' })
    fireEvent.click(right)
    expect(onAnswer).toHaveBeenCalledWith(true)
    expect(right.className).toContain('border-accent')
    expect(right.querySelector('svg')).not.toBeNull() // the check
    for (const other of optionButtons().filter((b) => b !== right)) {
      expect(other.className).toContain('border-divider')
      expect(other.className).toContain('text-faint')
      expect((other as HTMLButtonElement).disabled).toBe(true)
    }
    const s = sheet()
    expect(within(s).getByText('Correct!')).toBeTruthy()
    expect(s.textContent).toContain('Wort1 — слово c1')
    expect(within(s).getByText('Wort1').className).toContain('font-serif')
  })

  it('shows the box: "Box 4 · next review in 7 days" and 4 filled segments of 5', async () => {
    setup({ format: 'de_ru', progress: progress(4, 7) })
    fireEvent.click(await screen.findByRole('button', { name: 'слово c1' }))
    expect(within(sheet()).getByText('Box 4 · next review in 7 days')).toBeTruthy()
    const segments = Array.from(screen.getByTestId('box-bar').children)
    expect(segments).toHaveLength(5)
    expect(segments.map((s) => s.className.includes('bg-accent'))).toEqual([true, true, true, true, false])
    expect(segments[4].className).toContain('bg-dot-off')
  })

  it('a learned word says so instead of the box', async () => {
    setup({ format: 'de_ru', progress: progress(5, 14, true) })
    fireEvent.click(await screen.findByRole('button', { name: 'слово c1' }))
    expect(within(sheet()).getByText(/Word learned\. We'll check it again/)).toBeTruthy()
    expect(within(sheet()).queryByText(/^Box /)).toBeNull()
  })

  it('a wrong pick: "Not quite", the pick has a cross and a danger border, the right option is marked', async () => {
    const { onAnswer } = setup({ format: 'de_ru', progress: progress(1, 1) })
    await screen.findByText('Wort1')
    const wrong = optionButtons().find((b) => b.textContent !== 'слово c1')!
    fireEvent.click(wrong)
    expect(onAnswer).toHaveBeenCalledWith(false)
    expect(wrong.className).toContain('border-danger')
    expect(wrong.querySelector('svg')!.getAttribute('class')).toContain('text-danger')
    const right = optionByText('слово c1')
    expect(right.className).toContain('border-accent')
    expect(right.querySelector('svg')!.getAttribute('class')).toContain('text-accent-text')
    expect(within(sheet()).getByText('Not quite')).toBeTruthy()
    expect(sheet().textContent).toContain('Wort1 — слово c1')
  })

  it('options cannot be answered twice', async () => {
    const { onAnswer } = setup({ format: 'de_ru' })
    await screen.findByText('Wort1')
    fireEvent.click(optionButtons()[0])
    fireEvent.click(optionButtons()[1])
    expect(onAnswer).toHaveBeenCalledTimes(1)
  })

  it('the transcription is under the word in the sheet', async () => {
    setup({ format: 'de_ru', card: card(1, { transcription: '[ʃtɪl]' }) })
    fireEvent.click(await screen.findByRole('button', { name: 'слово c1' }))
    expect(within(sheet()).getByText('[ʃtɪl]').className).toContain('text-muted')
  })

  it('the bottom of the page is padded so the sheet never covers the options', async () => {
    const { rerender } = setup({ format: 'de_ru' })
    await screen.findByText('Wort1')
    expect(screen.getByText('1/3').closest('.max-w-xl')!.className).not.toContain('pb-72')
    fireEvent.click(optionButtons()[0])
    expect(screen.getByText('1/3').closest('.max-w-xl')!.className).toContain('pb-72')
    rerender({})
  })
})

describe('the answer sheet', () => {
  const answerRight = async (o: Over = {}) => {
    const t = setup({ format: 'de_ru', ...o })
    fireEvent.click(await screen.findByRole('button', { name: 'слово c1' }))
    return t
  }

  it('is a polite live region pinned to the bottom, with Continue', async () => {
    await answerRight({ progress: progress(2, 3) })
    const s = sheet()
    expect(s.getAttribute('aria-live')).toBe('polite')
    for (const c of ['fixed', 'bottom-0', 'inset-x-0', 'bg-surface', 'border-t', 'rounded-t-[22px]', 'z-30']) expect(s.className, c).toContain(c)
    const next = within(s).getByRole('button', { name: 'Continue' })
    expect(next.className).toContain('btn-primary')
    expect(next.className).toContain('h-[52px]')
  })

  it('"Continue" calls onNext; the last question says "Finish"', async () => {
    const { onNext } = await answerRight({ progress: progress(2, 3) })
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Continue' }))
    expect(onNext).toHaveBeenCalledTimes(1)
    cleanup()
    await answerRight({ position: 3, total: 3, progress: progress(2, 3) })
    expect(within(sheet()).getByRole('button', { name: 'Finish' })).toBeTruthy()
    expect(within(sheet()).queryByRole('button', { name: 'Continue' })).toBeNull()
  })

  it('"Continue" is disabled while the answer is being saved, and a pulsing block stands in for the box line', async () => {
    await answerRight({ saving: true, progress: null })
    expect((within(sheet()).getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
    const block = screen.getByTestId('box-saving')
    expect(block.className).toContain('animate-pulse')
    expect(block.className).toContain('bg-surface-2')
    expect(screen.queryByTestId('box-bar')).toBeNull()
  })

  it('once saved the box line replaces the pulse and Continue works', async () => {
    const t = await answerRight({ saving: true, progress: null })
    t.rerender({ saving: false, progress: progress(3, 3) })
    await waitFor(() => expect(screen.queryByTestId('box-saving')).toBeNull())
    expect(within(sheet()).getByText('Box 3 · next review in 3 days')).toBeTruthy()
    expect((within(sheet()).getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('practice mode: the "boxes do not change" line, no box bar, no pulse', async () => {
    await answerRight({ practice: true, saving: true, progress: null })
    expect(within(sheet()).getByText("Boxes don't change: this is extra practice")).toBeTruthy()
    expect(screen.queryByTestId('box-bar')).toBeNull()
    expect(screen.queryByTestId('box-saving')).toBeNull()
  })

  it('a save error is shown in the sheet', async () => {
    await answerRight({ error: 'Could not save the answer: offline' })
    expect(within(sheet()).getByText('Could not save the answer: offline').className).toContain('text-danger')
  })
})

describe('the typed format', () => {
  const type = async (value: string, o: Over = {}) => {
    const t = setup({ format: 'ru_de_type', card: card(1, { word: 'der Hund' }), ...o })
    const input = (await screen.findByPlaceholderText(/word/i)) as HTMLInputElement
    fireEvent.change(input, { target: { value } })
    act(() => { fireEvent.submit(input.closest('form')!) })
    return { ...t, input }
  }

  it('the field is serif and tall; Check is disabled until something is typed', async () => {
    setup({ format: 'ru_de_type', card: card(1, { word: 'der Hund' }) })
    const input = await screen.findByPlaceholderText(/word/i)
    expect(input.className).toContain('font-serif')
    expect(input.className).toContain('!h-14')
    const check = screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement
    expect(check.disabled).toBe(true)
    expect(check.className).toContain('h-14')
    fireEvent.change(input, { target: { value: 'x' } })
    expect(check.disabled).toBe(false)
  })

  it('right: the field border is the accent, "Correct!"', async () => {
    const { input, onAnswer } = await type('der Hund', { progress: progress(3, 3) })
    expect(onAnswer).toHaveBeenCalledWith(true)
    expect(input.className).toContain('!border-accent')
    expect(within(sheet()).getByText('Correct!')).toBeTruthy()
  })

  it('almost (the article is missing): "Almost", the streak colour and the article hint; it counts as right', async () => {
    const { input, onAnswer } = await type('Hund', { progress: progress(3, 3) })
    expect(onAnswer).toHaveBeenCalledWith(true)
    expect(input.className).toContain('!border-streak')
    const s = sheet()
    expect(within(s).getByText('Almost')).toBeTruthy()
    const hint = within(s).getByText('Counted, mind the article: der Hund')
    expect(hint.className).toContain('text-streak')
  })

  it('almost (a typo): the spelling hint', async () => {
    const { input } = await type('der Hunt', { progress: progress(3, 3) })
    expect(input.className).toContain('!border-streak')
    expect(within(sheet()).getByText('Counted, check the spelling: der Hund')).toBeTruthy()
  })

  it('wrong: the danger border, "Not quite", and the right word in the sheet', async () => {
    const { input, onAnswer } = await type('die Katze', { progress: progress(1, 1) })
    expect(onAnswer).toHaveBeenCalledWith(false)
    expect(input.className).toContain('!border-danger')
    expect(within(sheet()).getByText('Not quite')).toBeTruthy()
    expect(sheet().textContent).toContain('der Hund — слово c1')
  })
})

describe('the gap format', () => {
  const gapCard = card(1, { word: 'Hund', example_sentence: 'Der ___ bellt laut.', has_example: true })

  it('before the answer the blank is empty; after it the correct option fills the blank', async () => {
    setup({ format: 'gap', card: gapCard, progress: progress(2, 3) })
    const blank = await screen.findByTestId('gap-blank')
    expect(blank.className).toContain('border-b-2')
    expect(blank.className).toContain('border-faint')
    expect(blank.className).toContain('min-w-[4ch]')
    expect(blank.parentElement!.className).toContain('font-serif')
    expect(blank.parentElement!.textContent!.replace(/\s/g, '')).toBe('Derbelltlaut.') // the sentence around an empty blank
    expect(screen.queryByTestId('gap-answer')).toBeNull()

    fireEvent.click(optionByText('Hund'))
    const answer = screen.getByTestId('gap-answer')
    expect(answer.textContent).toBe('Hund')
    expect(answer.className).toContain('text-accent-text')
    expect(answer.className).toContain('underline')
    expect(answer.className).toContain('decoration-accent')
    expect(screen.queryByTestId('gap-blank')).toBeNull()
  })

  it('the translation of the sentence is a muted line under it; German options are serif', async () => {
    setup({ format: 'gap', card: gapCard })
    const translation = await screen.findByText('Пример c1')
    expect(translation.className).toContain('text-muted')
    expect(optionButtons().every((b) => b.querySelector('.font-serif'))).toBe(true)
  })

  it('a wrong pick still fills the blank with the RIGHT word', async () => {
    setup({ format: 'gap', card: gapCard })
    await screen.findByTestId('gap-blank')
    fireEvent.click(optionButtons().find((b) => b.textContent !== 'Hund')!)
    expect(screen.getByTestId('gap-answer').textContent).toBe('Hund')
  })
})

describe('listening', () => {
  it('is offered after answering in every format, with an icon button', async () => {
    const speak = vi.fn()
    vi.stubGlobal('speechSynthesis', { speak })
    vi.stubGlobal('SpeechSynthesisUtterance', function (this: { text: string }, text: string) { this.text = text })
    setup({ format: 'ru_de' })
    await screen.findByText('слово c1')
    expect(screen.queryByRole('button', { name: 'Listen' })).toBeNull()
    fireEvent.click(optionByText('Wort1'))
    const listen = screen.getByRole('button', { name: 'Listen' })
    expect(listen.className).toContain('h-11')
    expect(listen.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    fireEvent.click(listen)
    expect(speak).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
