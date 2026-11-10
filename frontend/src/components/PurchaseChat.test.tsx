import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { adminChatApi, buyerChatApi, type AdminPurchaseRequest, type ChatMessage, type ChatPage, type PurchaseRequest } from '../api/endpoints'
import { formatUZS } from '../lib/money'
import { CHAT_POLL_MS } from '../lib/purchaseChat'
import { PurchaseChat } from './PurchaseChat'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    buyerChatApi: { messages: vi.fn(), post: vi.fn(), image: vi.fn(), read: vi.fn() },
    adminChatApi: { messages: vi.fn(), post: vi.fn(), image: vi.fn() },
  }
})

const request = (status: PurchaseRequest['status'] = 'pending'): PurchaseRequest => ({
  id: 'r1', code: 'YD-1234', pack_id: 'photo_35', amount: 35, price_uzs: 25000, status, created_at: '2026-11-08T10:00:00Z',
})
let seq = 0
const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: ++seq, author: 'user', mine: true, body: 'hello', has_image: false, hidden: false, hidden_reason: null,
  event: null, created_at: '2026-11-08T10:00:00Z', ...over,
})
const page = (messages: ChatMessage[], status: PurchaseRequest['status'] = 'pending'): ChatPage => ({ request: request(status), messages, read_message_id: 0, other_read_message_id: 0 })
const fail = (status: number, data: unknown = {}) =>
  new AxiosError('x', String(status), undefined, undefined, { status, data, headers: {}, statusText: '', config: {} as never } as AxiosResponse)

function renderChat(side: 'user' | 'admin' = 'user') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><PurchaseChat side={side} requestId="r1" /></QueryClientProvider>)
}
const box = () => screen.getByRole('textbox', { name: 'Message…' }) as HTMLTextAreaElement
const sendBtn = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
const log = () => screen.getByRole('log', { name: 'Request chat' })

beforeEach(async () => {
  await i18n.changeLanguage('en')
  seq = 0
  vi.mocked(buyerChatApi.messages).mockResolvedValue(page([]))
  vi.mocked(buyerChatApi.read).mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers() })

describe('PurchaseChat', () => {
  it('header: code, pack, price and the status; the hint about card numbers above the composer', async () => {
    renderChat()
    const header = await screen.findByTestId('chat-header')
    expect(header.textContent).toBe(`Request YD-1234 · 35 photos · ${formatUZS(25000, 'en')}`)
    expect(screen.getByTestId('chat-status').textContent).toBe('Awaiting payment')
    expect(screen.getByText('Do not send card numbers or bank details — the receipt and the code are enough.')).toBeTruthy()
    expect(within(log()).getByText(/No messages yet/)).toBeTruthy()
  })

  it('sending is disabled while there is neither text nor a photo', async () => {
    renderChat()
    await screen.findByTestId('chat-header')
    expect(sendBtn().disabled).toBe(true)
    fireEvent.change(box(), { target: { value: '   \n ' } })
    expect(sendBtn().disabled).toBe(true)
    fireEvent.change(box(), { target: { value: 'Paid, code YD-1234' } })
    expect(sendBtn().disabled).toBe(false)
    fireEvent.change(box(), { target: { value: '' } })
    expect(sendBtn().disabled).toBe(true)
    // A photo alone is enough.
    const photo = new File(['x'], 'receipt.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('chat-file'), { target: { files: [photo] } })
    expect(screen.getByTestId('chat-attached').textContent).toBe('receipt.png')
    expect(sendBtn().disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Remove the photo' }))
    expect(sendBtn().disabled).toBe(true)
  })

  it('sends text and photo; the message shows at once and the box is cleared', async () => {
    const sent = msg({ body: 'Paid', has_image: true })
    vi.mocked(buyerChatApi.post).mockResolvedValue(sent)
    renderChat()
    await screen.findByTestId('chat-header')
    const photo = new File(['x'], 'receipt.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('chat-file'), { target: { files: [photo] } })
    fireEvent.change(box(), { target: { value: '  Paid  ' } })
    fireEvent.click(sendBtn())
    await waitFor(() => expect(buyerChatApi.post).toHaveBeenCalledWith('r1', { body: 'Paid', image: photo }))
    expect(await within(log()).findByText('Paid')).toBeTruthy()
    expect(box().value).toBe('')
    expect(screen.queryByTestId('chat-attached')).toBeNull()
  })

  it('a photo over 5 MB is refused before sending', async () => {
    renderChat()
    await screen.findByTestId('chat-header')
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByTestId('chat-file'), { target: { files: [big] } })
    expect(screen.getByRole('alert').textContent).toBe('The photo is over 5 MB — choose another one.')
    expect(screen.queryByTestId('chat-attached')).toBeNull()
    expect(sendBtn().disabled).toBe(true)
  })

  it('too many messages (429): says to wait', async () => {
    vi.mocked(buyerChatApi.post).mockRejectedValue(fail(429, { error: 'rate_limit_exceeded' }))
    renderChat()
    await screen.findByTestId('chat-header')
    fireEvent.change(box(), { target: { value: 'hi' } })
    fireEvent.click(sendBtn())
    expect((await screen.findByRole('alert')).textContent).toBe('Too many messages. Please wait a few minutes.')
  })

  it('polls every 30 s for what came after the last message, and stops once the request is paid', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const first = msg({ body: 'my question' })
    vi.mocked(buyerChatApi.messages).mockResolvedValueOnce(page([first]))
    renderChat()
    expect(await within(await screen.findByRole('log')).findByText('my question')).toBeTruthy()
    expect(buyerChatApi.messages).toHaveBeenLastCalledWith('r1', 0)

    const reply = msg({ author: 'admin', mine: false, body: 'checking' })
    vi.mocked(buyerChatApi.messages).mockResolvedValueOnce(page([reply]))
    await act(() => vi.advanceTimersByTimeAsync(CHAT_POLL_MS))
    expect(buyerChatApi.messages).toHaveBeenLastCalledWith('r1', first.id)
    expect(await within(log()).findByText('checking')).toBeTruthy()
    expect(within(log()).getByText('Support')).toBeTruthy()

    const paidLine = msg({ author: 'system', mine: false, body: 'Оплата подтверждена, +35 фото', event: 'paid' })
    vi.mocked(buyerChatApi.messages).mockResolvedValueOnce(page([paidLine], 'paid'))
    await act(() => vi.advanceTimersByTimeAsync(CHAT_POLL_MS))
    expect(await within(log()).findByText('Payment confirmed, +35 photos')).toBeTruthy()
    expect(screen.getByTestId('chat-status').textContent).toBe('Paid')
    const calls = vi.mocked(buyerChatApi.messages).mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(CHAT_POLL_MS * 4))
    expect(vi.mocked(buyerChatApi.messages).mock.calls.length).toBe(calls) // stopped
    // Paid: writing is still possible.
    expect(box()).toBeTruthy()
  })

  it('a cancelled request: no polling, history shown, no composer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(buyerChatApi.messages).mockResolvedValue(page([
      msg({ body: 'changed my mind' }),
      msg({ author: 'system', mine: false, body: 'Заявка отменена', event: 'cancelled' }),
    ], 'cancelled'))
    renderChat()
    expect(await within(await screen.findByRole('log')).findByText('Request cancelled')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('The request is cancelled — no new messages can be sent.')
    expect(screen.queryByRole('textbox')).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(CHAT_POLL_MS * 3))
    expect(buyerChatApi.messages).toHaveBeenCalledTimes(1)
  })

  it('reads page after page while they are full (50)', async () => {
    const full = Array.from({ length: 50 }, () => msg({ body: 'x' }))
    const rest = [msg({ body: 'the last one' })]
    vi.mocked(buyerChatApi.messages).mockResolvedValueOnce(page(full)).mockResolvedValueOnce(page(rest))
    renderChat()
    expect(await within(await screen.findByRole('log')).findByText('the last one')).toBeTruthy()
    expect(buyerChatApi.messages).toHaveBeenNthCalledWith(2, 'r1', 50)
  })

  it('the author sees their hidden message as the warning (no text)', async () => {
    vi.mocked(buyerChatApi.messages).mockResolvedValue(page([msg({ hidden: true, hidden_reason: 'card_number', body: null })]))
    renderChat()
    const warn = await screen.findByTestId('chat-hidden')
    expect(warn.textContent).toBe('Message hidden: it looks like a card number. Do not send bank details.')
  })

  it('a card number just sent comes back hidden: the warning shows at once', async () => {
    vi.mocked(buyerChatApi.post).mockResolvedValue(msg({ hidden: true, hidden_reason: 'card_number', body: null }))
    renderChat()
    await screen.findByTestId('chat-header')
    fireEvent.change(box(), { target: { value: '8600 0000 0000 0000' } })
    fireEvent.click(sendBtn())
    expect(await screen.findByTestId('chat-hidden')).toBeTruthy()
  })

  it('admins: a hidden message has a badge, its text behind "Show"', async () => {
    const adminReq = { ...request(), user_id: 'u1', user_email: 'anna@x.co', decided_at: null, decided_by: null, unread: 1 } as AdminPurchaseRequest
    vi.mocked(adminChatApi.messages).mockResolvedValue({ read_message_id: 0, other_read_message_id: 0,
      request: adminReq,
      messages: [msg({ mine: false, hidden: true, hidden_reason: 'card_number', body: 'card 8600 0000 0000 0000' })],
    })
    renderChat('admin')
    expect((await screen.findByTestId('chat-hidden-badge')).textContent).toBe('Hidden: looks like a card number')
    expect(screen.queryByText('card 8600 0000 0000 0000')).toBeNull()
    expect(within(log()).getByText('Buyer')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(screen.getByText('card 8600 0000 0000 0000')).toBeTruthy()
    expect(buyerChatApi.messages).not.toHaveBeenCalled()
  })

  it('photos are loaded with the login (as a Blob) and shown', async () => {
    const createObjectURL = vi.fn(() => 'blob:photo-1')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    vi.mocked(buyerChatApi.image).mockResolvedValue(new Blob(['x'], { type: 'image/png' }))
    const m = msg({ body: null, has_image: true })
    vi.mocked(buyerChatApi.messages).mockResolvedValue(page([m]))
    renderChat()
    const img = (await screen.findByRole('img', { name: 'Photo' })) as HTMLImageElement
    expect(img.src).toBe('blob:photo-1')
    expect(buyerChatApi.image).toHaveBeenCalledWith('r1', m.id)
    vi.unstubAllGlobals()
  })
})
