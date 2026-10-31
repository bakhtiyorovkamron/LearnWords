import { useEffect, useRef } from 'react'
import { isSessionSize, SESSION_SIZES, settingsApi, type SessionSize } from '../api/endpoints'
import { useStoredChoice } from '../components/DirectionToggle'

/** Words a Home session may ask for (?size=N): any whole number from 1 to this. */
export const MAX_URL_SESSION = 50

/** ?size=N from the URL → a whole number 1..50, or null (then the default of 20 applies). */
export function parseUrlSize(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return n >= 1 && n <= MAX_URL_SESSION ? n : null
}

/** The smallest size the server offers (10 / 20 / 50) that holds n cards. */
export function fetchSizeFor(n: number): SessionSize {
  return n <= 10 ? '10' : n <= 20 ? '20' : '50'
}

/**
 * The chosen training-session size: localStorage first (instant, survives a reload with no
 * network round-trip), then adopted from the user's profile once it loads — so it follows the
 * user across devices, same as the interface-language switcher. Writes go to both.
 */
export function useReviewSessionSize() {
  const [size, setLocal] = useStoredChoice<SessionSize>('review-session-size', SESSION_SIZES, '20')
  const synced = useRef(false)

  useEffect(() => {
    if (synced.current) return
    synced.current = true
    settingsApi
      .get()
      .then((s) => {
        if (isSessionSize(s.review_session_size)) setLocal(s.review_session_size)
      })
      .catch(() => undefined) // the localStorage value stays in effect
  }, [setLocal])

  function setSize(v: SessionSize) {
    setLocal(v)
    settingsApi.setReviewSessionSize(v).catch(() => undefined)
  }

  return [size, setSize] as const
}
