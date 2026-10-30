import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pushApi } from '../api/endpoints'
import { disable, enable, status, urlBase64ToUint8Array } from './push'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, pushApi: { publicKey: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() } }
})

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const KEY = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYevEyE'

const subscription = (endpoint = 'https://push.example.com/abc') => ({
  endpoint,
  toJSON: () => ({ endpoint, keys: { p256dh: 'P', auth: 'A' } }),
  unsubscribe: vi.fn().mockResolvedValue(true),
})

interface Browser { permission?: NotificationPermission; asked?: NotificationPermission; sub?: ReturnType<typeof subscription> | null
  push?: boolean; ua?: string; standalone?: boolean }

/** A fake browser: Notification, PushManager and a service worker with a push manager. */
function browser({ permission = 'default', asked = 'granted', sub = null, push = true, ua = '', standalone = false }: Browser = {}) {
  const pm = { getSubscription: vi.fn(async () => sub), subscribe: vi.fn(async (_opts?: unknown) => subscription()) }
  const reg = { pushManager: pm }
  vi.stubGlobal('Notification', Object.assign(function () {}, { permission, requestPermission: vi.fn().mockResolvedValue(asked) }))
  if (push) vi.stubGlobal('PushManager', function () {})
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve(reg), getRegistration: async () => reg },
  })
  vi.stubGlobal('matchMedia', () => ({ matches: standalone, addEventListener: () => undefined }))
  if (ua) vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  return pm
}

beforeEach(() => {
  vi.mocked(pushApi.publicKey).mockResolvedValue(KEY)
  vi.mocked(pushApi.subscribe).mockResolvedValue({} as never)
  vi.mocked(pushApi.unsubscribe).mockResolvedValue({} as never)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  // @ts-expect-error cleaning up the fake
  delete navigator.serviceWorker
})

describe('status', () => {
  it('unsupported without PushManager', async () => {
    browser({ push: false })
    expect(await status()).toBe('unsupported')
  })

  it('iPhone Safari outside the Home Screen app → ios-needs-install; inside it works as usual', async () => {
    browser({ ua: IPHONE_SAFARI, push: false })
    expect(await status()).toBe('ios-needs-install')
    vi.unstubAllGlobals()
    browser({ ua: IPHONE_SAFARI, standalone: true })
    expect(await status()).toBe('off')
  })

  it('denied / off / on', async () => {
    browser({ permission: 'denied' })
    expect(await status()).toBe('denied')
    browser({ permission: 'default' })
    expect(await status()).toBe('off')
    browser({ permission: 'granted', sub: null })
    expect(await status()).toBe('off') // allowed, but this browser is not subscribed
    browser({ permission: 'granted', sub: subscription() })
    expect(await status()).toBe('on')
  })
})

describe('enable', () => {
  it('asks permission, subscribes with the server key (userVisibleOnly) and posts the subscription', async () => {
    const pm = browser()
    expect(await enable()).toBe('on')
    expect(Notification.requestPermission).toHaveBeenCalledTimes(1)
    const opts = pm.subscribe.mock.calls[0][0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array }
    expect(opts.userVisibleOnly).toBe(true)
    expect(Array.from(opts.applicationServerKey)).toEqual(Array.from(urlBase64ToUint8Array(KEY)))
    expect(opts.applicationServerKey).toHaveLength(65) // an uncompressed P-256 point
    expect(pushApi.subscribe).toHaveBeenCalledWith({ endpoint: 'https://push.example.com/abc', keys: { p256dh: 'P', auth: 'A' } })
  })

  it('a refused permission subscribes nothing and posts nothing', async () => {
    const pm = browser({ asked: 'denied' })
    expect(await enable()).toBe('denied')
    expect(pm.subscribe).not.toHaveBeenCalled()
    expect(pushApi.subscribe).not.toHaveBeenCalled()
  })

  it('a dismissed prompt leaves it off', async () => {
    const pm = browser({ asked: 'default' })
    expect(await enable()).toBe('off')
    expect(pm.subscribe).not.toHaveBeenCalled()
  })

  it('does not even ask where it cannot work (blocked, iPhone outside the app, unsupported)', async () => {
    browser({ permission: 'denied' })
    expect(await enable()).toBe('denied')
    expect(Notification.requestPermission).not.toHaveBeenCalled()
    browser({ ua: IPHONE_SAFARI, push: false })
    expect(await enable()).toBe('ios-needs-install')
  })

  it('push not configured on the server (503) → unsupported', async () => {
    browser()
    const err = Object.assign(new Error('x'), { isAxiosError: true, response: { status: 503, data: {} } })
    vi.mocked(pushApi.publicKey).mockRejectedValue(err)
    expect(await enable()).toBe('unsupported')
  })
})

describe('disable', () => {
  it('unsubscribes the browser and tells the server', async () => {
    const sub = subscription('https://push.example.com/xyz')
    browser({ permission: 'granted', sub })
    await disable()
    expect(sub.unsubscribe).toHaveBeenCalled()
    expect(pushApi.unsubscribe).toHaveBeenCalledWith('https://push.example.com/xyz')
  })

  it('a failing server call does not leave it half-on', async () => {
    const sub = subscription()
    browser({ permission: 'granted', sub })
    vi.mocked(pushApi.unsubscribe).mockRejectedValue(new Error('offline'))
    await expect(disable()).resolves.toBeDefined()
    expect(sub.unsubscribe).toHaveBeenCalled()
  })
})

describe('urlBase64ToUint8Array', () => {
  it('decodes the URL-safe base64 of a VAPID key', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3])
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255]) // - and _ , no padding
  })
})
