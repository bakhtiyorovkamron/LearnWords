import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { dateLocale } from '../i18n'
import { boxExplanation, whenLabel } from '../lib/boxInfo'

export type KnowledgeStatus = 'new' | 'learning' | 'learned'

// box 1 = new (gray), 2-5 = learning (amber), is_learned = learned (green).
export function knowledgeStatus(boxLevel: number, isLearned: boolean): KnowledgeStatus {
  if (isLearned) return 'learned'
  return boxLevel <= 1 ? 'new' : 'learning'
}

// Colours by status, from the theme tokens.
export const STATUS_STYLE: Record<KnowledgeStatus, { dot: string; text: string }> = {
  new: { dot: 'bg-faint', text: 'text-faint' },
  learning: { dot: 'bg-streak', text: 'text-streak' },
  learned: { dot: 'bg-accent', text: 'text-accent-text' },
}

/**
 * The Leitner box: 5 dots, filled up to box_level (all filled when learned), with the status word.
 * `compact`: 5 small vertical bars and no text (the collection rows). With `schedule` a tap explains
 * the box.
 */
export function ProgressDots({ boxLevel, isLearned, schedule, compact = false }: {
  boxLevel: number; isLearned: boolean
  // Collection words: when given, the indicator is a button with the box explanation.
  schedule?: { nextReviewAt: string; reviewedToday: boolean }
  compact?: boolean
}) {
  const { t } = useTranslation()
  const status = knowledgeStatus(boxLevel, isLearned)
  const s = STATUS_STYLE[status]
  const filled = isLearned ? 5 : Math.min(Math.max(boxLevel, 1), 5)
  const marks = compact ? (
    <div className="flex items-end gap-0.5" data-testid="box-bars">
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} data-filled={i < filled} className={`h-3 w-1 rounded-full ${i < filled ? s.dot : 'bg-dot-off'}`} />
      ))}
    </div>
  ) : (
    <div className="flex gap-1" data-testid="box-dots">
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} data-filled={i < filled} className={`h-2 w-2 rounded-full ${i < filled ? s.dot : 'bg-dot-off'}`} />
      ))}
    </div>
  )
  const dots = (
    <>
      {marks}
      {schedule?.reviewedToday && (
        <span aria-label={t('box.today')} role="img" className="grid h-4 w-4 place-items-center text-accent-text">
          <Check size={12} aria-hidden="true" />
        </span>
      )}
      {!compact && (
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${s.text}`}>{t(`collection.status.${status}`)}</span>
      )}
    </>
  )
  if (!schedule) return <div className="flex items-center gap-2">{dots}</div>
  return <BoxButton box={filled} isLearned={isLearned} schedule={schedule}>{dots}</BoxButton>
}

/** The indicator as a button; a tap opens the explanation (a portal, so nothing clips it or flips). */
function BoxButton({ box, isLearned, schedule, children }: {
  box: number; isLearned: boolean
  schedule: { nextReviewAt: string; reviewedToday: boolean }
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  // Below the indicator, kept inside the viewport.
  useLayoutEffect(() => {
    if (!open || !anchor.current || !pop.current) return
    const a = anchor.current.getBoundingClientRect()
    const w = pop.current.offsetWidth
    const left = Math.min(Math.max(8, a.left), window.innerWidth - w - 8)
    const below = a.bottom + 8
    const top = below + pop.current.offsetHeight > window.innerHeight - 8
      ? Math.max(8, a.top - pop.current.offsetHeight - 8) : below
    setPos({ top, left })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (!pop.current?.contains(target) && !anchor.current?.contains(target)) close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const when = whenLabel(schedule.nextReviewAt, t, dateLocale())
  const kind = boxExplanation(box, isLearned)
  return (
    <>
      <span
        ref={anchor} role="button" tabIndex={0} aria-expanded={open} aria-haspopup="dialog"
        aria-label={t('box.title', { n: box })}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o) }
        }}
        className="inline-flex cursor-pointer items-center gap-2 rounded-lg p-1 -m-1 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        {children}
      </span>
      {open && createPortal(
        <div
          ref={pop} role="dialog" aria-label={t('box.title', { n: box })}
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
          className="glass fixed z-[70] w-72 max-w-[calc(100vw-1rem)] space-y-1.5 p-3 text-left text-sm text-fg"
        >
          <p className="font-bold text-fg">{t('box.title', { n: box })}</p>
          {schedule.reviewedToday && (
            <p className="flex items-center gap-1.5 font-semibold text-accent-text"><Check size={14} aria-hidden="true" />{t('box.today')}</p>
          )}
          {kind !== 'learned' && <p>{t('box.next', { when })}</p>}
          <p className="text-muted">
            {kind === 'learned' ? t('box.learned', { when })
              : kind === 'lastBox' ? t('box.lastBox')
              : t('box.rule', { next: box + 1 })}
          </p>
        </div>,
        document.body,
      )}
    </>
  )
}
