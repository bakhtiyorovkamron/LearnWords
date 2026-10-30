import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * A bottom sheet on phones, a centred dialog from md up. The scrim and Esc close it. Used by the
 * collection's filter and the word actions.
 */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div data-testid="sheet-scrim" className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={label}
        className="animate-rise max-h-[90dvh] w-full overflow-y-auto rounded-t-[22px] border-t border-line bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-card)] md:max-w-sm md:rounded-[22px] md:border md:pb-5">
        {children}
      </div>
    </div>,
    document.body,
  )
}
