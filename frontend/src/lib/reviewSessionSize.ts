import { type SessionSize } from '../api/endpoints'

/** Words a session may ask for (?size=N): any whole number from 1 to this. */
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
