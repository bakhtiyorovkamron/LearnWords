import { useSyncExternalStore } from 'react'

// Is a training session on screen right now? The shell (header, bottom nav, tabs) steps aside for
// it, and other UI — e.g. the feedback window — waits for it to end.
let trainingOpen = false
const listeners = new Set<() => void>()

export function setTrainingOpen(open: boolean) {
  if (trainingOpen === open) return
  trainingOpen = open
  listeners.forEach((l) => l())
}
export function isTrainingOpen(): boolean { return trainingOpen }

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Re-renders when a session opens or closes. */
export function useTrainingOpen(): boolean {
  return useSyncExternalStore(subscribe, isTrainingOpen)
}
