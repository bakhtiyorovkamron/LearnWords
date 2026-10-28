import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { feedbackApi, heroApi, meApi, settingsApi, type Me } from '../api/endpoints'
import { setTrainingOpen } from '../lib/pageSounds'
import * as toaster from './Toaster'
import { FeedbackModal } from './FeedbackModal'
import { FEEDBACK_DELAY_MS, Layout } from './Layout'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    settingsApi: { get: vi.fn() },
    heroApi: { ...mod.heroApi, get: vi.fn() },
    feedbackApi: { submit: vi.fn(), dismiss: vi.fn() },
  }
})

const me = (ask: boolean): Me => ({ id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de', ask_feedback: ask })

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(settingsApi.get).mockRejectedValue(new Error('no'))
  vi.mocked(heroApi.get).mockRejectedValue(new Error('no'))
  vi.mocked(feedbackApi.submit).mockResolvedValue({} as never)
  vi.mocked(feedbackApi.dismiss).mockResolvedValue({} as never)
  vi.spyOn(toaster, 'toast').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.useRealTimers(); setTrainingOpen(false); vi.clearAllMocks(); vi.restoreAllMocks() })

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['me'], me(true))
  render(<QueryClientProvider client={qc}><FeedbackModal /></QueryClientProvider>)
  return qc
}
const star = (n: number) => screen.getByRole('radio', { name: `${n} of 5` })
const send = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement

describe('FeedbackModal', () => {
  it('cannot be sent without a star; the placeholder follows the stars', () => {
    renderModal()
    expect(send().disabled).toBe(true)
    const box = () => screen.getByRole('textbox') as HTMLTextAreaElement
    expect(box().placeholder).toBe('What could be better? (optional)')
    fireEvent.click(star(3))
    expect(send().disabled).toBe(false)
    expect(box().placeholder).toBe('What went wrong? (optional)')
    fireEvent.click(star(4))
    expect(box().placeholder).toBe('What did you like? (optional)')
    fireEvent.click(star(1))
    expect(box().placeholder).toBe('What went wrong? (optional)')
  })

  it('sends the rating and the comment, says thanks, hides and never comes back', async () => {
    const qc = renderModal()
    fireEvent.click(star(5))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Love it  ' } })
    fireEvent.click(send())
    await waitFor(() => expect(feedbackApi.submit).toHaveBeenCalledWith(5, 'Love it'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(qc.getQueryData<Me>(['me'])?.ask_feedback).toBe(false)
    await waitFor(() => expect(toaster.toast).toHaveBeenCalledWith('Thanks for your feedback! 💚'))
    expect(feedbackApi.dismiss).not.toHaveBeenCalled()
  })

  it('✕, Esc and a click outside all dismiss — once', async () => {
    for (const close of [
      () => fireEvent.click(screen.getByRole('button', { name: '✕' })),
      () => fireEvent.keyDown(window, { key: 'Escape' }),
      () => fireEvent.mouseDown(screen.getByRole('dialog').parentElement!),
    ]) {
      const qc = renderModal()
      close()
      await waitFor(() => expect(feedbackApi.dismiss).toHaveBeenCalledTimes(1))
      expect(feedbackApi.submit).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(qc.getQueryData<Me>(['me'])?.ask_feedback).toBe(false)
      cleanup()
      vi.mocked(feedbackApi.dismiss).mockClear()
    }
  })
})

describe('Layout: when the window appears', () => {
  const mount = async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={qc}><MemoryRouter><Layout /></MemoryRouter></QueryClientProvider>)
    await act(() => vi.advanceTimersByTimeAsync(50)) // /me arrives
  }
  const later = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }) })

  it('is not shown when ask_feedback is false', async () => {
    vi.mocked(meApi.get).mockResolvedValue(me(false))
    await mount()
    await later(FEEDBACK_DELAY_MS * 2)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('appears 3 seconds after the page loads, not before', async () => {
    vi.mocked(meApi.get).mockResolvedValue(me(true))
    await mount()
    await later(FEEDBACK_DELAY_MS - 500)
    expect(screen.queryByRole('dialog')).toBeNull()
    await later(1000)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('waits while a training session is open', async () => {
    vi.mocked(meApi.get).mockResolvedValue(me(true))
    setTrainingOpen(true)
    await mount()
    await later(FEEDBACK_DELAY_MS + 3000)
    expect(screen.queryByRole('dialog')).toBeNull()
    setTrainingOpen(false)
    await later(1500)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
