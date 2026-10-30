import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Runs public/sw.js against a fake service-worker scope and plays its push events.
type Listener = (event: unknown) => void

function loadWorker(windows: { url: string; focus: () => Promise<unknown>; navigate?: (u: string) => Promise<unknown> }[] = []) {
  const listeners: Record<string, Listener> = {}
  const self = {
    location: { origin: 'https://yodla.fun' },
    addEventListener: (type: string, fn: Listener) => { listeners[type] = fn },
    registration: { showNotification: vi.fn().mockResolvedValue(undefined) },
    clients: { matchAll: vi.fn().mockResolvedValue(windows), openWindow: vi.fn().mockResolvedValue(null), claim: vi.fn() },
    skipWaiting: vi.fn(),
  }
  const code = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8')
  new Function('self', 'caches', 'fetch', 'Request', 'Response', code)(self, {}, vi.fn(), class {}, class {})
  return { self, listeners }
}

/** An event whose waitUntil promise we can await. */
function event<T extends object>(extra: T) {
  let done: Promise<unknown> = Promise.resolve()
  return { ...extra, waitUntil: (p: Promise<unknown>) => { done = p }, finished: () => done }
}

describe('sw.js: push', () => {
  it('shows the notification with the app icon and the url in its data', async () => {
    const { self, listeners } = loadWorker()
    const e = event({ data: { json: () => ({ title: 'Time to learn', body: '5 words are waiting', url: '/stats' }) } })
    listeners.push(e)
    await e.finished()
    expect(self.registration.showNotification).toHaveBeenCalledWith('Time to learn', {
      body: '5 words are waiting', icon: '/android-chrome-192x192.png', badge: '/android-chrome-192x192.png', data: { url: '/stats' },
    })
  })

  it('falls back to "/cards" and a plain-text body when the payload is not JSON', async () => {
    const { self, listeners } = loadWorker()
    const e = event({ data: { json: () => { throw new Error('not json') }, text: () => 'Plain words' } })
    listeners.push(e)
    await e.finished()
    expect(self.registration.showNotification).toHaveBeenCalledWith('yodla', expect.objectContaining({ body: 'Plain words', data: { url: '/cards' } }))
    const empty = event({ data: null })
    listeners.push(empty)
    await empty.finished()
    expect(self.registration.showNotification).toHaveBeenLastCalledWith('yodla', expect.objectContaining({ body: '', data: { url: '/cards' } }))
  })
})

describe('sw.js: notificationclick', () => {
  const click = (url: string | undefined) => event({ notification: { close: vi.fn(), data: url === undefined ? undefined : { url } } })

  it('closes the notification, focuses an open yodla tab and navigates it to the url', async () => {
    const win = { url: 'https://yodla.fun/story', focus: vi.fn().mockResolvedValue(undefined), navigate: vi.fn().mockResolvedValue(undefined) }
    const { self, listeners } = loadWorker([{ url: 'https://other.example/', focus: vi.fn() }, win])
    const e = click('/stats')
    listeners.notificationclick(e)
    await e.finished()
    expect(e.notification.close).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
    expect(win.navigate).toHaveBeenCalledWith('https://yodla.fun/stats')
    expect(self.clients.openWindow).not.toHaveBeenCalled()
  })

  it('opens a new window when no yodla tab is open', async () => {
    const { self, listeners } = loadWorker([])
    const e = click('/cards?tab=all')
    listeners.notificationclick(e)
    await e.finished()
    expect(self.clients.openWindow).toHaveBeenCalledWith('https://yodla.fun/cards?tab=all')
  })

  it('opens a new window when the open tab cannot be navigated', async () => {
    const win = { url: 'https://yodla.fun/', focus: vi.fn().mockResolvedValue(undefined), navigate: vi.fn().mockRejectedValue(new Error('uncontrolled')) }
    const { self, listeners } = loadWorker([win])
    const e = click('/stats')
    listeners.notificationclick(e)
    await e.finished()
    expect(self.clients.openWindow).toHaveBeenCalledWith('https://yodla.fun/stats')
  })

  it('no url in the data → "/cards"; a foreign url is never opened', async () => {
    const { self, listeners } = loadWorker([])
    const none = click(undefined)
    listeners.notificationclick(none)
    await none.finished()
    expect(self.clients.openWindow).toHaveBeenCalledWith('https://yodla.fun/cards')

    self.clients.openWindow.mockClear()
    const foreign = click('https://evil.example/phish')
    listeners.notificationclick(foreign)
    await foreign.finished()
    expect(self.clients.openWindow).not.toHaveBeenCalled()
  })
})

describe('sw.js: the rest still works', () => {
  beforeEach(() => vi.clearAllMocks())
  it('registers install, activate, fetch, push and notificationclick listeners', () => {
    const { listeners } = loadWorker()
    expect(Object.keys(listeners).sort()).toEqual(['activate', 'fetch', 'install', 'notificationclick', 'push'])
  })
})
