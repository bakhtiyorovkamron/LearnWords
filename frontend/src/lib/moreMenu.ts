import { useSyncExternalStore } from 'react'

// Is the "More" sheet (search, statistics, settings) open? The button is in the Home header and the
// sheet lives in the Layout, so the state sits outside both — same pattern as trainingState.
let open = false
const listeners = new Set<() => void>()

export function setMoreMenuOpen(value: boolean) {
  if (open === value) return
  open = value
  listeners.forEach((l) => l())
}
export function isMoreMenuOpen(): boolean { return open }

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Re-renders when the sheet opens or closes. */
export function useMoreMenuOpen(): boolean {
  return useSyncExternalStore(subscribe, isMoreMenuOpen)
}
