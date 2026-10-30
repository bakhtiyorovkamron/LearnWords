import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { InAppBanner } from './InAppBanner'

const IG_ANDROID = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/118.0.0.0 Mobile Safari/537.36 Instagram 300.0.0.29.110 Android (33/13)'
const IG_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/21A329 Instagram 300.0.0.29.110'
const CHROME = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/118.0.0.0 Mobile Safari/537.36'

const ua = (value: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(value)
const renderBanner = (path = '/') => render(<MemoryRouter initialEntries={[path]}><InAppBanner /></MemoryRouter>)

beforeEach(async () => { await i18n.changeLanguage('en'); sessionStorage.clear() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('InAppBanner', () => {
  it('Android: the text and a button that is the intent:// link to Chrome for this page', () => {
    ua(IG_ANDROID)
    renderBanner('/login')
    expect(screen.getByText("Your login won't be saved here")).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Open in browser' })
    expect(link.getAttribute('href')).toBe(
      'intent://yodla.fun/login#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fyodla.fun;end')
  })

  it('iOS: no button, the text says how to open Safari', () => {
    ua(IG_IOS)
    renderBanner()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Tap ⋯ at the top and choose "Open in Safari".')).toBeTruthy()
  })

  it('a normal browser shows nothing', () => {
    ua(CHROME)
    renderBanner()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('can be dismissed — for the session only', () => {
    ua(IG_ANDROID)
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: '✕' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(sessionStorage.getItem('inapp-banner-dismissed')).toBe('1')
    cleanup()
    renderBanner() // remembered while the session lasts
    expect(screen.queryByRole('alert')).toBeNull()
    sessionStorage.clear() // a new session
    cleanup()
    renderBanner()
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('still works when sessionStorage throws', () => {
    ua(IG_ANDROID)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: '✕' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
