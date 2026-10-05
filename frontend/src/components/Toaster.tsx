import { useEffect, useState } from 'react'

// Minimal global toast: toast('Saved') from anywhere, <Toaster /> renders it (mounted in Layout).
type Toast = { id: number; text: string }
const EVENT = 'app-toast'
let seq = 0

export function toast(text: string) {
  window.dispatchEvent(new CustomEvent<Toast>(EVENT, { detail: { id: ++seq, text } }))
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([])
  useEffect(() => {
    function onToast(e: Event) {
      const tItem = (e as CustomEvent<Toast>).detail
      setItems((xs) => [...xs, tItem])
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== tItem.id)), 2500)
    }
    window.addEventListener(EVENT, onToast)
    return () => window.removeEventListener(EVENT, onToast)
  }, [])
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      {items.map((x) => (
        <div key={x.id} className="animate-rise rounded-2xl border border-lime-400/40 bg-emerald-900/95 px-5 py-3 text-sm font-semibold text-lime-100 shadow-xl">
          ✓ {x.text}
        </div>
      ))}
    </div>
  )
}
