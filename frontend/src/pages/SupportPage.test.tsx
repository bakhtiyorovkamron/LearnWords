import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { supportApi, type ChatMessage } from '../api/endpoints'
import { CHAT_POLL_MS } from '../lib/chatThread'
import { SupportPage } from './SupportPage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, supportApi: { messages: vi.fn(), post: vi.fn(), image: vi.fn() } }
})

let seq = 0
const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: ++seq, author: 'user', mine: true, body: 'hello', has_image: false, hidden: false, hidden_reason: null,
  event: null, created_at: '2026-11-08T10:00:00Z', ...over,
})
const page = (messages: ChatMessage[]) => ({ thread_id: 7, messages })

let visibility: DocumentVisibilityState = 'visible'
function setVisibility(v: DocumentVisibilityState) {
  visibility = v
  document.dispatchEvent(new Event('visibilitychange'))
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><SupportPage /></QueryClientProvider>)
}
const box = () => screen.getByRole('textbox', { name: 'Describe your question…' }) as HTMLTextAreaElement
const sendBtn = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement

beforeEach(async () => {
  await i18n.changeLanguage('en')
  seq = 0
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  vi.mocked(supportApi.messages).mockResolvedValue(page([]))
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers() })

describe('SupportPage', () => {
  it('empty state: an invitation to write, and the hint about card numbers', async () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Support' })).toBeTruthy()
    expect((await screen.findByTestId('chat-empty')).textContent).toBe('Write to us — we answer here. You can attach a screenshot.')
    expect(screen.getByText('Do not send card numbers or bank details.')).toBeTruthy()
    expect(supportApi.messages).toHaveBeenCalledWith(0)
  })

  it('sending is disabled while the message is empty; text sends and shows', async () => {
    vi.mocked(supportApi.post).mockResolvedValue(msg({ body: 'The photos do not come' }))
    renderPage()
    await screen.findByTestId('chat-empty')
    expect(sendBtn().disabled).toBe(true)
    fireEvent.change(box(), { target: { value: '   ' } })
    expect(sendBtn().disabled).toBe(true)
    fireEvent.change(box(), { target: { value: ' The photos do not come ' } })
    expect(sendBtn().disabled).toBe(false)
    fireEvent.click(sendBtn())
    await waitFor(() => expect(supportApi.post).toHaveBeenCalledWith({ body: 'The photos do not come', image: null }))
    const log = screen.getByRole('log')
    expect(await within(log).findByText('The photos do not come')).toBeTruthy()
    expect(box().value).toBe('')
  })

  it('a hidden message is the warning for its author', async () => {
    vi.mocked(supportApi.messages).mockResolvedValue(page([msg({ hidden: true, hidden_reason: 'card_number', body: null })]))
    renderPage()
    expect((await screen.findByTestId('chat-hidden')).textContent).toBe('Message hidden: it looks like a card number. Do not send bank details.')
  })

  it('the team\'s replies are labelled Support; too many messages says to wait', async () => {
    vi.mocked(supportApi.messages).mockResolvedValue(page([msg({ author: 'admin', mine: false, body: 'Hi! How can we help?' })]))
    vi.mocked(supportApi.post).mockRejectedValue(new AxiosError('x', '429', undefined, undefined,
      { status: 429, data: { error: 'rate_limit_exceeded' }, headers: {}, statusText: '', config: {} as never } as AxiosResponse))
    renderPage()
    const log = await screen.findByRole('log')
    expect(await within(log).findByText('Hi! How can we help?')).toBeTruthy()
    expect(within(log).getByText('Support')).toBeTruthy()
    fireEvent.change(box(), { target: { value: 'one more' } })
    fireEvent.click(sendBtn())
    expect((await screen.findByRole('alert')).textContent).toBe('Too many messages. Please wait a few minutes.')
  })

  it('polls every 30 s while visible, pauses while the page is hidden, catches up when it is back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const first = msg({ body: 'my question' })
    vi.mocked(supportApi.messages).mockResolvedValueOnce(page([first])).mockResolvedValue(page([]))
    renderPage()
    expect(await within(await screen.findByRole('log')).findByText('my question')).toBeTruthy()
    const calls = () => vi.mocked(supportApi.messages).mock.calls.length
    expect(calls()).toBe(1)

    await act(() => vi.advanceTimersByTimeAsync(CHAT_POLL_MS))
    expect(calls()).toBe(2)
    expect(supportApi.messages).toHaveBeenLastCalledWith(first.id) // only what came after

    act(() => setVisibility('hidden'))
    await act(() => vi.advanceTimersByTimeAsync(CHAT_POLL_MS * 4))
    expect(calls()).toBe(2) // paused

    const reply = msg({ author: 'admin', mine: false, body: 'answer' })
    vi.mocked(supportApi.messages).mockResolvedValueOnce(page([reply]))
    act(() => setVisibility('visible'))
    await waitFor(() => expect(calls()).toBe(3)) // at once, not at the next tick
    expect(await within(screen.getByRole('log')).findByText('answer')).toBeTruthy()
    await act(() => vi.advanceTimersByTimeAsync(CHAT_POLL_MS))
    expect(calls()).toBe(4) // and the interval goes on
  })
})
