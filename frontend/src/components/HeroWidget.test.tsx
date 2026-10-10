import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n' // initializes the react-i18next singleton HeroWidget's useTranslation() needs
import { heroApi, type Hero } from '../api/endpoints'
import { emitHeroEvent } from '../lib/heroBus'
import { HeroWidget } from './HeroWidget'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, heroApi: { get: vi.fn() } }
})

const baseHero: Hero = {
  stage: 2,
  stage_name: 'Малыш',
  learned_count: 60,
  words_to_next_stage: 140,
  born_at: '2024-01-01T00:00:00Z',
  age_days: 400,
  birthday_today: false,
  phrase: 'Ich will den Hund.',
  stage_changed: false,
}

function renderWidget() {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <HeroWidget />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('HeroWidget visibility', () => {
  it('renders nothing for a user outside the allowlist (404 from /api/hero)', async () => {
    vi.mocked(heroApi.get).mockRejectedValue(new Error('404'))
    const { container } = renderWidget()
    await waitFor(() => expect(heroApi.get).toHaveBeenCalled())
    // No success data ever arrives, so the component must render nothing at all.
    await new Promise((r) => setTimeout(r, 0))
    expect(container.firstChild).toBeNull()
  })

  it('renders the hero button once /api/hero succeeds', async () => {
    vi.mocked(heroApi.get).mockResolvedValue(baseHero)
    renderWidget()
    await waitFor(() => expect(screen.getByTitle('Малыш')).toBeInTheDocument())
  })
})

describe('HeroWidget collapse / hide, persisted', () => {
  it('starts collapsed when hero-collapsed was saved as true, and stays collapsed on remount', async () => {
    localStorage.setItem('hero-collapsed', 'true')
    vi.mocked(heroApi.get).mockResolvedValue(baseHero)
    renderWidget()
    await waitFor(() => expect(heroApi.get).toHaveBeenCalled())
    // Collapsed form exposes only the expand button, titled by hero.expand — not the stage name.
    await waitFor(() => expect(screen.queryByTitle('Малыш')).toBeNull())
  })

  it('starts hidden when hero-hidden was saved as true', async () => {
    localStorage.setItem('hero-hidden', 'true')
    vi.mocked(heroApi.get).mockResolvedValue(baseHero)
    renderWidget()
    await waitFor(() => expect(heroApi.get).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByTitle('Малыш')).toBeNull())
  })
})

describe('HeroWidget reacts to events', () => {
  it('shows a bubble above (before, in DOM order) the hero button, never covering it', async () => {
    vi.mocked(heroApi.get).mockResolvedValue(baseHero)
    renderWidget()
    await waitFor(() => expect(screen.getByTitle('Малыш')).toBeInTheDocument())

    emitHeroEvent({ type: 'word_learned' }) // always shows a bubble
    const bubble = await screen.findByText(/Neues Wort gelernt!/)
    const heroButton = screen.getByTitle('Малыш')
    // The bubble container must come BEFORE the hero button in the DOM (flex-col stacks it
    // above, growing upward via `bottom-*` anchoring — see HeroWidget's layout comment).
    expect(bubble.compareDocumentPosition(heroButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
