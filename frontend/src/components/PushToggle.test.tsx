import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { pushApi } from '../api/endpoints'
import * as toaster from './Toaster'
import { PushToggle } from './PushToggle'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, pushApi: { publicKey: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() } }
})

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

function browser(o: { permission?: NotificationPermission; sub?: boolean; push?: boolean; ua?: string; asked?: NotificationPermission } = {}) {
  const { permission = 'default', sub = false, push = true, ua = '', asked = 'granted' } = o
  let subscribed = sub
  const subscription = {
    endpoint: 'https://push.example.com/abc',
    toJSON: () => ({ endpoint: 'https://push.example.com/abc', keys: { p256dh: 'P', auth: 'A' } }),
    unsubscribe: vi.fn(async () => { subscribed = false; return true }),
  }
  const reg = {
    pushManager: {
      getSubscription: vi.fn(async () => (subscribed ? subscription : null)),
      subscribe: vi.fn(async () => { subscribed = true; return subscription }),
    },
  }
  const N = Object.assign(function () {}, { permission, requestPermission: vi.fn(async () => { N.permission = asked; return asked }) })
  vi.stubGlobal('Notification', N)
  if (push) vi.stubGlobal('PushManager', function () {})
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(reg), getRegistration: async () => reg } })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined }))
  if (ua) vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  return { N, reg }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(pushApi.publicKey).mockResolvedValue('AQID')
  vi.mocked(pushApi.subscribe).mockResolvedValue({} as never)
  vi.mocked(pushApi.unsubscribe).mockResolvedValue({} as never)
  vi.spyOn(toaster, 'toast').mockImplementation(() => undefined)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  // @ts-expect-error cleaning up the fake
  delete navigator.serviceWorker
})

describe('PushToggle (the More sheet)', () => {
  it('off → the button asks permission on click and posts the subscription; then it reads "on" with Turn off', async () => {
    const { N } = browser()
    render(<PushToggle variant="row" />)
    const button = await screen.findByRole('button', { name: '🔔 Turn on notifications' })
    expect(N.requestPermission).not.toHaveBeenCalled() // nothing is asked until the click
    fireEvent.click(button)
    await waitFor(() => expect(pushApi.subscribe).toHaveBeenCalledTimes(1))
    expect(N.requestPermission).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('🔔 Notifications on')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeTruthy()
  })

  it('Turn off unsubscribes and goes back to the enable button', async () => {
    browser({ permission: 'granted', sub: true })
    render(<PushToggle variant="row" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }))
    await waitFor(() => expect(pushApi.unsubscribe).toHaveBeenCalledWith('https://push.example.com/abc'))
    expect(await screen.findByRole('button', { name: '🔔 Turn on notifications' })).toBeTruthy()
  })

  it('on mount an existing subscription is re-sent, so the device follows the logged-in account', async () => {
    browser({ permission: 'granted', sub: true })
    render(<PushToggle variant="row" />)
    await screen.findByText('🔔 Notifications on')
    await waitFor(() => expect(pushApi.subscribe).toHaveBeenCalledTimes(1))
  })

  it('blocked in the browser → the hint instead of a button', async () => {
    browser({ permission: 'denied' })
    render(<PushToggle variant="row" />)
    expect(await screen.findByText(/Notifications are blocked in your browser/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('iPhone Safari outside the Home Screen app → the install hint', async () => {
    browser({ ua: IPHONE_SAFARI, push: false })
    render(<PushToggle variant="row" />)
    expect(await screen.findByText(/adding yodla to the Home Screen/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('a browser without push → the unsupported text', async () => {
    browser({ push: false })
    render(<PushToggle variant="row" />)
    expect(await screen.findByText(/doesn't support notifications/)).toBeTruthy()
  })

  it('a refused prompt shows the blocked hint', async () => {
    browser({ asked: 'denied' })
    render(<PushToggle variant="row" />)
    fireEvent.click(await screen.findByRole('button', { name: '🔔 Turn on notifications' }))
    expect(await screen.findByText(/Notifications are blocked in your browser/)).toBeTruthy()
    expect(pushApi.subscribe).not.toHaveBeenCalled()
  })
})

describe('PushToggle (the header bell)', () => {
  it('its title is the text of the state', async () => {
    browser()
    render(<PushToggle variant="icon" />)
    expect((await screen.findByRole('button')).getAttribute('title')).toBe('🔔 Turn on notifications')
  })

  it('where it cannot work, the click shows the hint instead of doing anything', async () => {
    const { N } = browser({ permission: 'denied' })
    render(<PushToggle variant="icon" />)
    const bell = await screen.findByRole('button')
    expect(bell.getAttribute('title')).toMatch(/blocked in your browser/)
    fireEvent.click(bell)
    expect(toaster.toast).toHaveBeenCalledWith(expect.stringMatching(/blocked in your browser/), expect.anything())
    expect(N.requestPermission).not.toHaveBeenCalled()
  })

  it('on → click turns it off', async () => {
    browser({ permission: 'granted', sub: true })
    render(<PushToggle variant="icon" />)
    const bell = await screen.findByRole('button')
    await waitFor(() => expect(bell.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(bell)
    await waitFor(() => expect(pushApi.unsubscribe).toHaveBeenCalled())
  })
})
