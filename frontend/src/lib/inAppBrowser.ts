// In-app browsers (Instagram, Facebook, TikTok, Telegram on Android) don't keep cookies between
// openings, so the login would be lost every time. Detect them and point the user to a real browser.

export interface InAppBrowser {
  name: 'instagram' | 'facebook' | 'tiktok' | 'telegram'
  platform: 'android' | 'ios' | 'other'
}

const PATTERNS: [InAppBrowser['name'], RegExp][] = [
  ['instagram', /Instagram/i],
  ['facebook', /FBAN|FBAV/],
  ['tiktok', /BytedanceWebview|musical_ly/i],
  ['telegram', /Telegram-Android/i], // Telegram on iOS opens links in Safari: not a problem
]

export function detectInAppBrowser(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): InAppBrowser | null {
  const hit = PATTERNS.find(([, re]) => re.test(ua))
  if (!hit) return null
  const platform = /Android/i.test(ua) ? 'android' : /iPhone|iPad|iPod/i.test(ua) ? 'ios' : 'other'
  return { name: hit[0], platform }
}

export const SITE = 'yodla.fun'

/** Android: opens the current page in Chrome; the default browser if Chrome is missing. */
export function androidIntentUrl(pathname: string): string {
  return `intent://${SITE}${pathname}#Intent;scheme=https;package=com.android.chrome;` +
    `S.browser_fallback_url=${encodeURIComponent(`https://${SITE}`)};end`
}

const DISMISSED_KEY = 'inapp-banner-dismissed'

export function isBannerDismissed(): boolean {
  try { return sessionStorage.getItem(DISMISSED_KEY) === '1' } catch { return false }
}

export function dismissBanner(): void {
  try { sessionStorage.setItem(DISMISSED_KEY, '1') } catch { /* private mode: it just comes back next time */ }
}
