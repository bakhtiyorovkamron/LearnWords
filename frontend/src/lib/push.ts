import { useCallback, useEffect, useState } from 'react'
import { apiErrorInfo } from '../api/client'
import { pushApi } from '../api/endpoints'
import { isIosSafari, isStandalone } from './pwa'

/**
 * 'unsupported' · 'ios-needs-install' (iPhone Safari outside the Home Screen app: no push there) ·
 * 'denied' (blocked in the browser) · 'off' · 'on'.
 */
export type PushStatus = 'unsupported' | 'ios-needs-install' | 'denied' | 'off' | 'on'

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

export async function status(): Promise<PushStatus> {
  try {
    if (isIosSafari() && !isStandalone()) return 'ios-needs-install'
  } catch { /* no matchMedia: not iOS Safari for our purposes */ }
  if (!supported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission === 'granted' && (await currentSubscription())) return 'on'
  return 'off'
}

/**
 * Turns notifications on: permission → push subscription → the server. Must be called from a click
 * (browsers refuse the permission prompt otherwise). Returns the status afterwards.
 */
export async function enable(): Promise<PushStatus> {
  const before = await status()
  if (before !== 'off' && before !== 'on') return before
  const permission = await Notification.requestPermission()
  if (permission === 'denied') return 'denied'
  if (permission !== 'granted') return 'off' // the prompt was dismissed
  let key: string
  try {
    key = await pushApi.publicKey()
  } catch (err) {
    if (apiErrorInfo(err).status === 503) return 'unsupported' // push is not configured on the server
    throw err
  }
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
  })
  await pushApi.subscribe(sub.toJSON())
  return 'on'
}

export async function disable(): Promise<PushStatus> {
  const sub = await currentSubscription()
  if (sub) {
    const endpoint = sub.endpoint
    await sub.unsubscribe()
    await pushApi.unsubscribe(endpoint).catch(() => undefined) // the server drops it on the next send anyway
  }
  return status()
}

/** Re-sends an existing subscription (a browser that was used by another account, or new keys). */
async function refreshOnServer(): Promise<void> {
  const sub = await currentSubscription()
  if (sub) await pushApi.subscribe(sub.toJSON())
}

/** Status + the two actions for the UI. `toggle` is for click handlers only. */
export function usePush() {
  const [current, setCurrent] = useState<PushStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    status()
      .then((s) => {
        if (!alive) return
        setCurrent(s)
        if (s === 'on') void refreshOnServer().catch(() => undefined) // keeps the device on THIS account
      })
      .catch(() => alive && setCurrent('unsupported'))
    return () => { alive = false }
  }, [])

  const run = useCallback(async (action: () => Promise<PushStatus>) => {
    setBusy(true)
    setFailed(false)
    try {
      setCurrent(await action())
    } catch {
      setFailed(true)
      setCurrent(await status().catch(() => 'off' as PushStatus))
    } finally {
      setBusy(false)
    }
  }, [])

  return {
    status: current,
    busy,
    failed,
    enable: useCallback(() => run(enable), [run]),
    disable: useCallback(() => run(disable), [run]),
  }
}
