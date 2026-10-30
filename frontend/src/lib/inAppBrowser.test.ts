import { describe, expect, it } from 'vitest'
import { androidIntentUrl, detectInAppBrowser } from './inAppBrowser'

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21A329'
const ANDROID = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36'

describe('detectInAppBrowser', () => {
  it.each([
    ['Instagram on iOS', `${IOS} Instagram 300.0.0.29.110 (iPhone14,2; iOS 17_0; en_US; en-US; scale=3.00)`, 'instagram', 'ios'],
    ['Instagram on Android', `${ANDROID} Instagram 300.0.0.29.110 Android (33/13; 420dpi; 1080x2400; Google/google; Pixel 7)`, 'instagram', 'android'],
    ['Facebook on Android', `${ANDROID} [FB_IAB/FB4A;FBAV/430.0.0.0.0;]`, 'facebook', 'android'],
    ['Facebook on iOS', `${IOS} [FBAN/FBIOS;FBAV/430.0.0.0;FBBV/1;FBDV/iPhone14,2]`, 'facebook', 'ios'],
    ['TikTok (musical_ly)', `${ANDROID} musical_ly_28.0.0 JsSdk/1.0 NetType/WIFI AppName/musical_ly app_version/28.0.0`, 'tiktok', 'android'],
    ['TikTok (Bytedance webview)', `${IOS} BytedanceWebview/d8a21c6`, 'tiktok', 'ios'],
    ['Telegram on Android', `${ANDROID} Telegram-Android/10.2.4 (Google Pixel 7; Android 13; SDK 33; HIGH)`, 'telegram', 'android'],
  ])('%s is detected', (_name, ua, name, platform) => {
    expect(detectInAppBrowser(ua)).toEqual({ name, platform })
  })

  it.each([
    ['Chrome on Android', ANDROID],
    ['Safari on iOS', `${IOS} Version/17.0 Safari/604.1`],
    ['Telegram on iOS (opens Safari: no marker)', `${IOS} Safari/604.1`],
    ['desktop Chrome', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36'],
    ['desktop Firefox', 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/118.0'],
    ['an empty UA', ''],
  ])('%s is not', (_name, ua) => {
    expect(detectInAppBrowser(ua)).toBeNull()
  })
})

describe('androidIntentUrl', () => {
  it('opens the same page in Chrome, with the default browser as the fallback', () => {
    expect(androidIntentUrl('/s/aB3dE5gH7k')).toBe(
      'intent://yodla.fun/s/aB3dE5gH7k#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fyodla.fun;end')
    expect(androidIntentUrl('/')).toContain('intent://yodla.fun/#Intent;')
  })
})
