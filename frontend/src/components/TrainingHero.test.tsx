import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { heroApi, type Hero as HeroData } from '../api/endpoints'
import { emitHeroEvent } from '../lib/heroBus'
import { TrainingHero } from './TrainingHero'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, heroApi: { get: vi.fn(), stageSeen: vi.fn(), introSeen: vi.fn() } }
})

const hero: HeroData = {
  stage: 2, stage_name: 'Братья Гримм', learned_count: 60, almost_count: 3, words_to_next_stage: 140,
  born_at: '2026-01-01T00:00:00Z', age_days: 10, birthday_today: false, mood: 'idle',
  phrase: { de: 'Wo ist der Hund?', translation: 'Где собака?' }, stage_up: false, intro: false,
}

function renderWithClient() {
  const qc = new QueryClient()
  return render(<QueryClientProvider client={qc}><TrainingHero /></QueryClientProvider>)
}

describe('TrainingHero', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(heroApi.get).mockResolvedValue(hero)
  })
  afterEach(() => vi.useRealTimers())

  it('reacts to answers locally: Richtig! for 1.5 s, Hmm… with mood think for 2 s', async () => {
    const { container } = renderWithClient()
    await vi.waitFor(() => expect(container.querySelector('svg')).toBeTruthy())
    expect(heroApi.get).toHaveBeenCalledTimes(1)

    act(() => emitHeroEvent({ type: 'answer', correct: true, streak: 1 }))
    expect(screen.getByText(/Richtig!/)).toBeTruthy()
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('m-happy')
    act(() => vi.advanceTimersByTime(1600))
    expect(screen.queryByText(/Richtig!/)).toBeNull()

    act(() => emitHeroEvent({ type: 'answer', correct: false, streak: 0 }))
    expect(screen.getAllByText(/Hmm…/).length).toBeGreaterThan(0)
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('m-think')
    act(() => vi.advanceTimersByTime(2100))
    expect(screen.queryAllByText(/Hmm…/)).toHaveLength(0)
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('m-idle')

    expect(heroApi.get).toHaveBeenCalledTimes(1) // no server requests during training
  })

  it('renders nothing for users without the hero (404)', async () => {
    vi.mocked(heroApi.get).mockRejectedValue(new Error('404'))
    const { container } = renderWithClient()
    await act(async () => { await Promise.resolve() })
    expect(container.innerHTML).toBe('')
  })
})
