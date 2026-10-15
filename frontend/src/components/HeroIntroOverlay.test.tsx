import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { heroApi, type Hero as HeroData } from '../api/endpoints'
import { HeroIntroOverlay } from './HeroIntroOverlay'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, heroApi: { get: vi.fn(), stageSeen: vi.fn(), introSeen: vi.fn().mockResolvedValue({}) } }
})

// 120 learned words → stage 2 («Братья Гримм»), first visit.
const hero: HeroData = {
  stage: 2, stage_name: 'Братья Гримм', learned_count: 120, almost_count: 3, words_to_next_stage: 80,
  born_at: '2026-01-01T00:00:00Z', age_days: 10, birthday_today: false, mood: 'idle',
  phrase: { de: 'Wo ist der Hund?', translation: 'Где собака?' }, stage_up: false, intro: true,
}

// jsdom has no ResizeObserver (the drawn hero measures its bubble).
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })

const renderOverlay = () =>
  render(<QueryClientProvider client={new QueryClient()}><HeroIntroOverlay /></QueryClientProvider>)

describe('HeroIntroOverlay', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('ru')
  })

  it('introduces the hero once instead of a «grew up» screen, and marks it seen', async () => {
    vi.mocked(heroApi.get).mockResolvedValue(hero)
    renderOverlay()
    expect(await screen.findByText('Знакомься — твой немецкий герой!')).toBeTruthy()
    expect(screen.queryByText(/вырос/)).toBeNull()
    fireEvent.click(screen.getByText('Понятно'))
    await vi.waitFor(() => expect(heroApi.introSeen).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Знакомься — твой немецкий герой!')).toBeNull()
  })

  it('shows nothing once seen, and nothing without a hero (404)', async () => {
    vi.mocked(heroApi.get).mockResolvedValue({ ...hero, intro: false })
    const { container, unmount } = renderOverlay()
    await vi.waitFor(() => expect(heroApi.get).toHaveBeenCalled())
    expect(container.textContent).toBe('')
    unmount()

    vi.mocked(heroApi.get).mockRejectedValue({ response: { status: 404 } })
    const second = renderOverlay()
    await vi.waitFor(() => expect(heroApi.get).toHaveBeenCalledTimes(2))
    expect(second.container.textContent).toBe('')
  })
})
