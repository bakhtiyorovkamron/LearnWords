import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { supportApi, type ChatMessage } from '../api/endpoints'
import { SUPPORT_POLL_MS } from '../lib/supportChat'
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

  it('a new admin reply appears after one poll tick (5 s), asked for after the newest id in the list', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const mine = msg({ body: 'my question' })
    vi.mocked(supportApi.messages).mockResolvedValueOnce(page([mine])).mockResolvedValue(page([]))
    renderPage()
    expect(await within(await screen.findByRole('log')).findByText('my question')).toBeTruthy()
    vi.mocked(supportApi.messages).mockResolvedValueOnce(page([msg({ author: 'admin', mine: false, body: 'We are on it' })]))
    await act(() => vi.advanceTimersByTimeAsync(SUPPORT_POLL_MS))
    expect(supportApi.messages).toHaveBeenLastCalledWith(mine.id)
    expect(await within(screen.getByRole('log')).findByText('We are on it')).toBeTruthy()
    expect(within(screen.getByRole('log')).getByText('my question')).toBeTruthy() // merged, not replaced
  })

  it('the same message twice (the server repeats an id) is shown once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const first = msg({ body: 'only once' })
    vi.mocked(supportApi.messages).mockResolvedValue(page([first]))
    renderPage()
    expect(await within(await screen.findByRole('log')).findByText('only once')).toBeTruthy()
    vi.mocked(supportApi.messages).mockResolvedValue(page([first, msg({ author: 'admin', mine: false, body: 'reply' })]))
    await act(() => vi.advanceTimersByTimeAsync(SUPPORT_POLL_MS))
    await act(() => vi.advanceTimersByTimeAsync(SUPPORT_POLL_MS))
    expect(await within(screen.getByRole('log')).findByText('reply')).toBeTruthy()
    expect(within(screen.getByRole('log')).getAllByText('only once')).toHaveLength(1)
    expect(within(screen.getByRole('log')).getAllByText('reply')).toHaveLength(1)
  })

  it('after sending: the message shows at once, and the re-read (after the newest read id) brings a reply that came meanwhile', async () => {
    const q = msg({ body: 'question' }) // id 1
    const reply = msg({ author: 'admin', mine: false, body: 'reply in between' }) // id 2, not read yet
    const sent = msg({ body: 'one more thing' }) // id 3
    vi.mocked(supportApi.messages).mockResolvedValueOnce(page([q]))
    let answer!: (m: ChatMessage) => void
    vi.mocked(supportApi.post).mockReturnValue(new Promise((resolve) => { answer = resolve }))
    renderPage()
    expect(await within(await screen.findByRole('log')).findByText('question')).toBeTruthy()
    vi.mocked(supportApi.messages).mockResolvedValue(page([reply, sent]))
    fireEvent.change(box(), { target: { value: 'one more thing' } })
    fireEvent.click(sendBtn())
    await act(async () => answer(sent))
    expect(await within(screen.getByRole('log')).findByText('one more thing')).toBeTruthy()
    await waitFor(() => expect(supportApi.messages).toHaveBeenLastCalledWith(q.id)) // not after the sent id 3
    expect(await within(screen.getByRole('log')).findByText('reply in between')).toBeTruthy()
    expect(within(screen.getByRole('log')).getAllByText('one more thing')).toHaveLength(1)
  })

  it('polls every 5 s while visible; paused while hidden; reads at once when the page or the window comes back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderPage()
    await screen.findByTestId('chat-empty')
    const calls = () => vi.mocked(supportApi.messages).mock.calls.length
    expect(calls()).toBe(1)
    await act(() => vi.advanceTimersByTimeAsync(SUPPORT_POLL_MS))
    expect(calls()).toBe(2)

    act(() => setVisibility('hidden'))
    await act(() => vi.advanceTimersByTimeAsync(SUPPORT_POLL_MS * 6))
    expect(calls()).toBe(2) // paused

    act(() => setVisibility('visible'))
    await waitFor(() => expect(calls()).toBe(3)) // at once
    await act(() => vi.advanceTimersByTimeAsync(SUPPORT_POLL_MS))
    expect(calls()).toBe(4) // and the interval goes on

    act(() => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(calls()).toBe(5)) // the window got the focus back
  })

  it('polling stops when the screen is left', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(<QueryClientProvider client={qc}><SupportPage /></QueryClientProvider>)
    await screen.findByTestId('chat-empty')
    await act(() => vi.advanceTimersByTimeAsync(SUPPORT_POLL_MS))
    const before = vi.mocked(supportApi.messages).mock.calls.length
    view.unmount()
    await act(() => vi.advanceTimersByTimeAsync(SUPPORT_POLL_MS * 10))
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(vi.mocked(supportApi.messages).mock.calls.length).toBe(before)
  })

  it('new messages scroll into view only when the reader is at the bottom (or wrote it)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    vi.mocked(supportApi.messages).mockResolvedValueOnce(page([msg({ body: 'first' })])).mockResolvedValue(page([]))
    renderPage()
    const log = await screen.findByRole('log')
    await within(log).findByText('first')
    expect(scroll).toHaveBeenCalledTimes(1) // the first load goes to the bottom

    // The reader scrolled up: 1000 px of messages, a 300 px window at the top.
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 })
    Object.defineProperty(log, 'scrollTop', { configurable: true, writable: true, value: 0 })
    fireEvent.scroll(log)
    vi.mocked(supportApi.messages).mockResolvedValueOnce(page([msg({ author: 'admin', mine: false, body: 'reply 1' })]))
    await act(() => vi.advanceTimersByTimeAsync(SUPPORT_POLL_MS))
    await within(log).findByText('reply 1')
    expect(scroll).toHaveBeenCalledTimes(1) // not pulled down while reading above

    // Back at the bottom: the next reply scrolls into view.
    log.scrollTop = 650
    fireEvent.scroll(log)
    vi.mocked(supportApi.messages).mockResolvedValueOnce(page([msg({ author: 'admin', mine: false, body: 'reply 2' })]))
    await act(() => vi.advanceTimersByTimeAsync(SUPPORT_POLL_MS))
    await within(log).findByText('reply 2')
    expect(scroll).toHaveBeenCalledTimes(2)
  })
})
