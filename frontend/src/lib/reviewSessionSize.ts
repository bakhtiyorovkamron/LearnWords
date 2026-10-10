import { useEffect, useRef } from 'react'
import { isSessionSize, SESSION_SIZES, settingsApi, type SessionSize } from '../api/endpoints'
import { useStoredChoice } from '../components/DirectionToggle'

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
