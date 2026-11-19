/** A time as m:ss (whole seconds, rounded down): 83 400 ms → "1:23". */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Points out of a total: "17/20"; without the total just "17". */
export function formatPoints(points: number, of: number | null): string {
  return of === null ? String(points) : `${points}/${of}`
}
