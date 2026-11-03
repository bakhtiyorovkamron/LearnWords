import { useEffect, useState } from 'react'

/** `value`, but only after it has stopped changing for `ms` (a search box that waits for the typing to pause). */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}
