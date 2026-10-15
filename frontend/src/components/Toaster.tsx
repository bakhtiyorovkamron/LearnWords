import { useEffect, useState } from 'react'

// Minimal global toast: toast('Saved') from anywhere, <Toaster /> renders it (mounted in Layout).
// Optional action button ("Undo") and lifetime: toast(text, { action: { label, onClick }, ms: 6000 }).
type Action = { label: string; onClick: () => void }
type Toast = { id: number; text: string; action?: Action; ms: number }
const EVENT = 'app-toast'
const DEFAULT_MS = 2500
let seq = 0

export function toast(text: string, opts: { action?: Action; ms?: number } = {}) {
  window.dispatchEvent(new CustomEvent<Toast>(EVENT, {
    detail: { id: ++seq, text, action: opts.action, ms: opts.ms ?? DEFAULT_MS },
  }))
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([])
  const dismiss = (id: number) => setItems((xs) => xs.filter((x) => x.id !== id))
  useEffect(() => {
    function onToast(e: Event) {
      const tItem = (e as CustomEvent<Toast>).detail
      setItems((xs) => [...xs, tItem])
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== tItem.id)), tItem.ms)
    }
    window.addEventListener(EVENT, onToast)
    return () => window.removeEventListener(EVENT, onToast)
  }, [])
  return (
    <div className="pointer-events-none fixed bottom-[calc(var(--nav-h)+1.5rem)] left-1/2 z-[60] flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      {items.map((x) => (
        <div key={x.id} className="animate-rise pointer-events-auto flex items-center gap-3 rounded-2xl border border-lime-400/40 bg-emerald-900/95 px-5 py-3 text-sm font-semibold text-lime-100 shadow-xl">
          <span className="min-w-0">✓ {x.text}</span>
          {x.action && (
            <button type="button"
              onClick={() => { dismiss(x.id); x.action?.onClick() }}
              className="shrink-0 rounded-lg bg-lime-400 px-3 py-1 text-xs font-bold text-emerald-950 hover:bg-lime-300">
              {x.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
