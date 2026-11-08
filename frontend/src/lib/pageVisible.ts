import { useEffect, useState } from 'react'

const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'

/** Is the page on screen (document.visibilityState)? Re-renders when it is hidden or shown again. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(isVisible)
  useEffect(() => {
    const update = () => setVisible(isVisible())
    document.addEventListener('visibilitychange', update)
    update()
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return visible
}
