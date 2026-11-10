import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider, type UseMutationResult } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import type { ChatDraft, ChatMessage } from '../api/endpoints'
import { ChatThreadView, type ChatThreadViewProps } from './ChatThread'

const MIN = 60_000
const now = Date.now()
let seq = 0
const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: ++seq, author: 'user', mine: true, body: `m${seq}`, has_image: false, hidden: false, hidden_reason: null,
  event: null, created_at: new Date(now - 3 * 60 * MIN).toISOString(), ...over,
})
const theirs = (over: Partial<ChatMessage> = {}) => msg({ author: 'admin', mine: false, ...over })
const at = (minutesAgo: number) => new Date(now - minutesAgo * MIN).toISOString()
const dayAt = (daysAgo: number) => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - daysAgo, 12).toISOString()

const mutate = vi.fn()
const send = { mutate, reset: vi.fn(), isPending: false, error: null } as unknown as UseMutationResult<ChatMessage, Error, ChatDraft>
const load = vi.fn()
const texts = { placeholder: 'Message…', empty: 'Nothing yet', hint: 'No card numbers', hiddenCard: 'Hidden', rateLimited: 'Slow down', closed: 'Closed' }

type Props = Partial<ChatThreadViewProps>
function view(props: Props) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ChatThreadView side="user" messages={[]} send={send} open texts={texts} otherLabel="Support"
        photo={{ key: ['t'], load }} {...props} />
    </QueryClientProvider>
  )
}
const box = () => screen.getByRole('textbox', { name: 'Message…' })
const corner = (m: ChatMessage) => {
  const c = screen.getByTestId(`chat-msg-${m.id}`).className
  return c.includes('rounded-br-[6px]') ? 'br' : c.includes('rounded-bl-[6px]') ? 'bl' : 'none'
}

function pointer(fine: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: fine && q === '(pointer: fine)', media: q, addEventListener() {}, removeEventListener() {} }))
}

beforeEach(async () => { await i18n.changeLanguage('en'); seq = 0 })
afterEach(() => { cleanup(); mutate.mockReset(); vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('ChatThreadView: header and hint', () => {
  it('shows the header, the hint pill at the top of the log, and no label above messages', () => {
    const m = theirs({ created_at: at(5) })
    render(view({ messages: [m], header: { title: 'Support', subtitle: 'We reply fast', avatar: 'S' } }))
    const header = screen.getByTestId('chat-thread-header')
    expect(within(header).getByRole('heading', { name: 'Support' })).toBeTruthy()
    expect(within(header).getByText('We reply fast')).toBeTruthy()
    const log = screen.getByRole('log')
    expect(within(log).getByTestId('chat-hint').textContent).toBe('No card numbers')
    expect(within(log).queryAllByText('Support')).toHaveLength(0) // the group has it as an aria-label only
    expect(within(log).getByRole('group', { name: 'Support' })).toBeTruthy()
  })
})

describe('ChatThreadView: bubbles', () => {
  it('groups one author within 5 minutes on one day; only the last bubble of a group has the small corner', () => {
    const a = msg({ created_at: at(60) })
    const b = msg({ created_at: at(59) })
    const c = msg({ created_at: at(58) })
    const later = msg({ created_at: at(40) }) // > 5 minutes after c: a new group
    const other = theirs({ created_at: at(39) })
    const o2 = theirs({ created_at: at(38) })
    render(view({ messages: [a, b, c, later, other, o2] }))
    expect([a, b, c, later, other, o2].map(corner)).toEqual(['none', 'none', 'br', 'br', 'none', 'bl'])
    expect(screen.getAllByRole('group')).toHaveLength(1) // the other side's one group is labelled
  })

  it('time is inside the bubble', () => {
    const m = msg({ created_at: at(5) })
    render(view({ messages: [m] }))
    expect(within(screen.getByTestId(`chat-msg-${m.id}`)).getByText(/\d{2}:\d{2}/)).toBeTruthy()
  })

  it('my messages: one tick (sent) until other_read_message_id reaches them, then two (read)', () => {
    const a = msg({ created_at: at(30) })
    const b = msg({ created_at: at(29) })
    const their = theirs({ created_at: at(28) })
    render(view({ messages: [a, b, their], otherReadMarker: a.id }))
    expect(within(screen.getByTestId(`chat-msg-${a.id}`)).getByRole('img', { name: 'Read' })).toBeTruthy()
    expect(within(screen.getByTestId(`chat-msg-${b.id}`)).getByRole('img', { name: 'Sent' })).toBeTruthy()
    expect(within(screen.getByTestId(`chat-msg-${their.id}`)).queryByRole('img')).toBeNull() // no ticks on theirs
  })

  it('a system line is a centered pill with the same text', () => {
    const m = msg({ author: 'system', mine: false, body: 'Cancelled', event: 'cancelled', created_at: at(5) })
    render(view({ messages: [m] }))
    expect(screen.getByTestId('chat-system').textContent).toBe('Cancelled')
  })
})

describe('ChatThreadView: day separators', () => {
  it('a pill before the first message of each day: date, Yesterday, Today', () => {
    const old = msg({ created_at: dayAt(5) })
    const yesterday = msg({ created_at: dayAt(1) })
    const today = msg({ created_at: dayAt(0) })
    const today2 = msg({ created_at: new Date(new Date(dayAt(0)).getTime() + MIN).toISOString() })
    render(view({ messages: [old, yesterday, today, today2] }))
    const pills = screen.getAllByTestId('chat-day').map((p) => p.textContent)
    const expected = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long' }).format(new Date(dayAt(5)))
    expect(pills).toEqual([expected, 'Yesterday', 'Today'])
  })
})

describe('ChatThreadView: the new-messages divider', () => {
  it('goes before the first unread message of the other side, once; stays put as more arrive; leaves after sending', () => {
    const read = theirs({ created_at: at(50) })
    const mine = msg({ created_at: at(49) })
    const unread = theirs({ created_at: at(10) })
    const { rerender } = render(view({ messages: [read, mine, unread], readMarker: read.id }))
    const divider = screen.getByTestId('chat-new-divider')
    expect(divider.textContent).toBe('New messages')
    expect(divider.nextElementSibling).toBe(screen.getByTestId(`chat-msg-${unread.id}`).parentElement)

    const more = theirs({ created_at: at(2) })
    rerender(view({ messages: [read, mine, unread, more], readMarker: read.id }))
    expect(screen.getAllByTestId('chat-new-divider')).toHaveLength(1)
    expect(screen.getByTestId('chat-new-divider').nextElementSibling).toBe(screen.getByTestId(`chat-msg-${unread.id}`).parentElement)

    mutate.mockImplementation((_d: ChatDraft, o?: { onSuccess?: () => void }) => o?.onSuccess?.())
    fireEvent.change(box(), { target: { value: 'reply' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.queryByTestId('chat-new-divider')).toBeNull()
  })

  it('none when everything of theirs is read', () => {
    const a = theirs({ created_at: at(5) })
    render(view({ messages: [a], readMarker: a.id }))
    expect(screen.queryByTestId('chat-new-divider')).toBeNull()
  })
})

describe('ChatThreadView: the composer keys', () => {
  const type = (value: string) => fireEvent.change(box(), { target: { value } })

  it('fine pointer: Enter sends, Shift+Enter does not, Ctrl+Enter sends, IME composing does not', () => {
    pointer(true)
    render(view({}))
    type('hello')
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true })
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: true })
    fireEvent.keyDown(box(), { key: 'Enter', keyCode: 229 })
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0][0]).toEqual({ body: 'hello', image: null })
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true })
    expect(mutate).toHaveBeenCalledTimes(2)
  })

  it('touch: Enter is a new line (not sent); Ctrl/Cmd+Enter still sends', () => {
    pointer(false)
    render(view({}))
    type('hello')
    const notPrevented = fireEvent.keyDown(box(), { key: 'Enter' })
    expect(notPrevented).toBe(true) // the default (a new line) is kept
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.keyDown(box(), { key: 'Enter', metaKey: true })
    expect(mutate).toHaveBeenCalledTimes(1)
  })
})

describe('ChatThreadView: jump to latest', () => {
  function scrollUp() {
    const log = screen.getByRole('log')
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 })
    Object.defineProperty(log, 'scrollTop', { configurable: true, writable: true, value: 0 })
    fireEvent.scroll(log)
    return log
  }

  it('appears when scrolled up, counts what arrives meanwhile, scrolls smoothly on click and hides at the bottom', () => {
    pointer(false)
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const a = theirs({ created_at: at(30) })
    const { rerender } = render(view({ messages: [a] }))
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull()
    const log = scrollUp()
    const button = screen.getByRole('button', { name: 'Jump to latest' })
    expect(within(button).queryByTestId('chat-missed')).toBeNull()
    rerender(view({ messages: [a, theirs({ created_at: at(2) }), theirs({ created_at: at(1) })] }))
    expect(within(screen.getByRole('button', { name: 'Jump to latest' })).getByTestId('chat-missed').textContent).toBe('2')
    scroll.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }))
    expect(scroll).toHaveBeenCalledWith({ block: 'end', behavior: 'smooth' })
    expect(screen.queryByTestId('chat-missed')).toBeNull()
    log.scrollTop = 700
    fireEvent.scroll(log)
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull()
  })

  it('instant under prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduced-motion'), media: q }))
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    render(view({ messages: [theirs({ created_at: at(3) })] }))
    scrollUp()
    scroll.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }))
    expect(scroll).toHaveBeenCalledWith({ block: 'end', behavior: 'auto' })
  })
})

describe('ChatThreadView: photos', () => {
  it('a tap opens the full-screen viewer; Esc closes it and focus returns to the photo', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:p1'), revokeObjectURL: vi.fn() }))
    load.mockResolvedValue(new Blob(['x'], { type: 'image/png' }))
    render(view({ messages: [msg({ body: null, has_image: true, created_at: at(3) })] }))
    const thumb = await screen.findByRole('img', { name: 'Photo' })
    const opener = thumb.closest('button') as HTMLButtonElement
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Close photo' })).toBe(document.activeElement)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    fireEvent.click(opener)
    fireEvent.click(screen.getByRole('button', { name: 'Close photo' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the attached photo is a thumbnail; its object URL is revoked when it is removed and on unmount', () => {
    const createObjectURL = vi.fn().mockReturnValueOnce('blob:a').mockReturnValueOnce('blob:b')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const { unmount } = render(view({}))
    const input = screen.getByTestId('chat-file')
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } })
    expect((screen.getByRole('img', { name: 'Photo attached' }) as HTMLImageElement).src).toBe('blob:a')
    expect(revokeObjectURL).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove the photo' }))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:a')
    fireEvent.change(input, { target: { files: [new File(['y'], 'b.png', { type: 'image/png' })] } })
    expect((screen.getByRole('img', { name: 'Photo attached' }) as HTMLImageElement).src).toBe('blob:b')
    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:b')
  })
})
