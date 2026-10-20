import { useEffect, useRef } from 'react'
import { NavigationType, useLocation, useNavigationType } from 'react-router-dom'
import { hasUserGesture } from './uiSoundEvents'
import { playUi, type UiSound } from './uiSounds'

// Sections in the order of the bottom menu / header: moving to a later one turns the page forward.
export const ORDER = ['/cards', '/contexts/new', '/search', '/story', '/contexts', '/stats', '/admin']

/**
 * The page sound for going from one path to another (null = none).
 *   - browser back/forward (POP) → pageBack;
 *   - both paths are sections in ORDER → forward when the index grows, else back;
 *   - a deeper page (/contexts → /contexts/:id) → forward; back up → back;
 *   - anything else (a push to an unrelated page) → forward.
 * Only the pathname counts: search params and hashes are the caller's business (ignored).
 */
export function pageSoundFor(from: string, to: string, navType: NavigationType): UiSound | null {
  if (from === to) return null
  if (navType === NavigationType.Pop) return 'pageBack'
  const a = ORDER.indexOf(from)
  const b = ORDER.indexOf(to)
  if (a >= 0 && b >= 0) return b > a ? 'pageForward' : 'pageBack'
  if (to.startsWith(from + '/')) return 'pageForward'
  if (from.startsWith(to + '/')) return 'pageBack'
  return 'pageForward'
}

// While a training session is open the page must not rustle (the session sets this).
let trainingOpen = false
export function setTrainingOpen(open: boolean) { trainingOpen = open }
export function isTrainingOpen(): boolean { return trainingOpen }

/**
 * Plays the page-turn for a route change — never before the first user gesture (no sound on load
 * or on the redirect after login), never during a training session, and not for redirects
 * (REPLACE): they are not something the user did.
 */
export function usePageSounds() {
  const { pathname } = useLocation()
  const navType = useNavigationType()
  const previous = useRef(pathname) // the first render starts here: nothing to compare, no sound

  useEffect(() => {
    if (previous.current === pathname) return
    const kind = navType === NavigationType.Replace ? null : pageSoundFor(previous.current, pathname, navType)
    previous.current = pathname
    if (kind && hasUserGesture() && !trainingOpen) playUi(kind)
  }, [pathname, navType])
}
