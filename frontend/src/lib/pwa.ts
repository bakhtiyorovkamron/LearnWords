import { useSyncExternalStore } from 'react'
import { onHeroEvent } from './heroBus'

// Installable app (PWA): service worker registration + "Install app" state.
// Imported from main.tsx before the first render — `beforeinstallprompt` can fire very early.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const TRAININGS_KEY = 'pwa-trainings'
const DISMISSED_KEY = 'pwa-banner-dismissed-at'
const BANNER_AFTER_TRAININGS = 2
const DISMISS_FOR_MS = 14 * 24 * 60 * 60 * 1000

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

// iPhone/iPad Safari: no beforeinstallprompt there, the user adds the app via Share → Add to Home Screen.
export function isIosSafari(): boolean {
  const ua = navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser/.test(ua)
}

function readNumber(key: string): number {
  try {
    return Number(localStorage.getItem(key)) || 0
  } catch {
    return 0
  }
}

function writeNumber(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    /* ignore */
  }
}

// ---- store -------------------------------------------------------------------------------

interface PwaState {
  canInstall: boolean // Android/desktop Chrome: our own button can open the native install dialog
  iosHint: boolean // iPhone Safari, not installed: show the Share → Add to Home Screen hint instead
  showBanner: boolean // one-time banner after the 2nd training (hidden for 14 days on "Not now")
}

let deferred: BeforeInstallPromptEvent | null = null
let state: PwaState = { canInstall: false, iosHint: false, showBanner: false }
const listeners = new Set<() => void>()

function recompute() {
  const standalone = isStandalone()
  const canInstall = !standalone && deferred !== null
  const iosHint = !standalone && !canInstall && isIosSafari()
  const showBanner =
    (canInstall || iosHint) &&
    readNumber(TRAININGS_KEY) >= BANNER_AFTER_TRAININGS &&
    Date.now() - readNumber(DISMISSED_KEY) >= DISMISS_FOR_MS
  if (canInstall !== state.canInstall || iosHint !== state.iosHint || showBanner !== state.showBanner) {
    state = { canInstall, iosHint, showBanner }
    listeners.forEach((l) => l())
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePwa(): PwaState {
  return useSyncExternalStore(subscribe, () => state)
}

/** Opens the browser's native install dialog (Android/desktop Chrome). */
export async function installApp() {
  const e = deferred
  if (!e) return
  deferred = null // a prompt event can be used only once
  recompute()
  await e.prompt()
  await e.userChoice.catch(() => undefined)
}

/** "Not now" on the banner: hide it for 14 days. */
export function dismissBanner() {
  writeNumber(DISMISSED_KEY, Date.now())
  recompute()
}

// ---- wiring --------------------------------------------------------------------------------

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault() // no mini-infobar: we show our own button/banner instead
  deferred = e as BeforeInstallPromptEvent
  recompute()
})

window.addEventListener('appinstalled', () => {
  deferred = null
  recompute()
})

window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', recompute)

// Each finished training (review or practice) counts towards showing the banner.
onHeroEvent((e) => {
  if (e.type !== 'session_finished') return
  writeNumber(TRAININGS_KEY, readNumber(TRAININGS_KEY) + 1)
  recompute()
})

// ---- service worker ------------------------------------------------------------------------

export function registerServiceWorker() {
  recompute()
  // Not in `vite dev`: a service worker there would serve stale modules.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

  // A new deploy activates its service worker right away (skipWaiting + clients.claim), but a
  // page that is already open still runs the old JS. Reload it the next time it goes to the
  // background, so the user never sees a reload mid-action and finds the new version on return.
  // (Training answers are saved one by one, so nothing is lost.)
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return // first install, not an update
    if (document.visibilityState === 'hidden') location.reload()
    else document.addEventListener('visibilitychange', () => location.reload(), { once: true })
  })

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // An installed app can stay open for days — look for a new version whenever it comes back.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => undefined)
        })
      })
      .catch(() => undefined)
  })
}
