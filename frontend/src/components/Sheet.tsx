import { useEffect, useRef, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Scrim handlers: a tap on the scrim closes. onClick (not only mousedown) so a touch on iOS closes
 * reliably; a press that started inside the dialog and ended on the scrim does not.
 */
export function useScrimClose(onClose: () => void) {
  const fromInside = useRef(false)
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => { fromInside.current = e.target !== e.currentTarget },
    onClick: (e: MouseEvent<HTMLElement>) => {
      const inside = fromInside.current
      fromInside.current = false
      if (!inside && e.target === e.currentTarget) onClose()
    },
  }
}

/** The 44×44 X of a sheet or dialog. */
export function CloseButton({ onClose, className = '' }: { onClose: () => void; className?: string }) {
  const { t } = useTranslation()
  return (
    <button type="button" onClick={onClose} aria-label={t('common.close')} title={t('common.close')}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface-2 ${className}`}>
      <X size={20} aria-hidden="true" />
    </button>
  )
}

/**
 * A bottom sheet on phones, a centred dialog from md up. The X, the scrim and Esc close it; a band of
 * scrim always stays visible above it (85dvh at most). Used by the collection's filter and the word actions.
 */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const scrim = useScrimClose(onClose)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // The first child (usually the title) keeps clear of the X in the corner.
  return createPortal(
    <div data-testid="sheet-scrim" className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:p-4" {...scrim}>
      <div role="dialog" aria-modal="true" aria-label={label}
        className="animate-rise relative max-h-[85dvh] w-full overflow-y-auto rounded-t-[22px] border-t border-line bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-card)] md:max-h-[80vh] md:max-w-sm md:rounded-[22px] md:border md:pb-5 [&>:first-child]:pr-10">
        {children}
        <CloseButton onClose={onClose} className="absolute right-2 top-2" />
      </div>
    </div>,
    document.body,
  )
}
