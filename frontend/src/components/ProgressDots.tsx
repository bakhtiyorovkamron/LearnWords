import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { dateLocale } from '../i18n'
import { boxExplanation, whenLabel } from '../lib/boxInfo'

export type KnowledgeStatus = 'new' | 'learning' | 'learned'

// box 1 = new (gray), 2-5 = learning (amber), is_learned = learned (green ✓).
export function knowledgeStatus(boxLevel: number, isLearned: boolean): KnowledgeStatus {
  if (isLearned) return 'learned'
  return boxLevel <= 1 ? 'new' : 'learning'
}

export const STATUS_STYLE: Record<KnowledgeStatus, { card: string; dot: string; text: string; bar: string }> = {
  new: {
    card: 'border-slate-400/25 from-slate-700/40 to-emerald-950/40',
    dot: 'bg-slate-300', text: 'text-slate-300', bar: 'bg-slate-400',
  },
  learning: {
    card: 'border-amber-400/35 from-amber-900/30 to-emerald-950/40',
    dot: 'bg-amber-300', text: 'text-amber-300', bar: 'bg-amber-400',
  },
  learned: {
    card: 'border-lime-400/50 from-emerald-700/60 to-emerald-900/40',
    dot: 'bg-lime-300', text: 'text-lime-300', bar: 'bg-lime-400',
  },
}

/** 5 dots, filled up to box_level (all filled + ✓ when learned). With `schedule` a tap explains the box. */
export function ProgressDots({ boxLevel, isLearned, schedule }: {
  boxLevel: number; isLearned: boolean
  // Collection words: when given, the dots are a button with the box explanation.
  schedule?: { nextReviewAt: string; reviewedToday: boolean }
}) {
  const { t } = useTranslation()
  const status = knowledgeStatus(boxLevel, isLearned)
  const s = STATUS_STYLE[status]
  const filled = isLearned ? 5 : Math.min(Math.max(boxLevel, 1), 5)
  const dots = (
    <>
      <div className="flex gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className={`h-2 w-2 rounded-full ${i < filled ? s.dot : 'bg-white/15'}`} />
        ))}
      </div>
      {schedule?.reviewedToday && (
        <span aria-label={t('box.today')} className="grid h-4 w-4 place-items-center rounded-full bg-lime-400/25 text-[10px] font-bold leading-none text-lime-300">✓</span>
      )}
      <span className={`text-[11px] font-semibold uppercase tracking-wide ${s.text}`}>
        {status === 'learned' ? '✓ ' : ''}{t(`collection.status.${status}`)}
      </span>
    </>
  )
  if (!schedule) return <div className="flex items-center gap-2">{dots}</div>
  return <BoxButton box={filled} isLearned={isLearned} schedule={schedule}>{dots}</BoxButton>
}

/** The dots as a button; a tap opens the explanation (a portal, so no card clips it or flips). */
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

  // Below the dots, kept inside the viewport.
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
        className="inline-flex cursor-pointer items-center gap-2 rounded-lg p-1 -m-1 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-lime-300"
      >
        {children}
      </span>
      {open && createPortal(
        <div
          ref={pop} role="dialog" aria-label={t('box.title', { n: box })}
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-[70] w-72 max-w-[calc(100vw-1rem)] space-y-1.5 rounded-2xl border border-lime-400/30 bg-emerald-950 p-3 text-left text-sm text-emerald-50 shadow-2xl"
        >
          <p className="font-bold text-white">{t('box.title', { n: box })}</p>
          {schedule.reviewedToday && <p className="font-semibold text-lime-300">✓ {t('box.today')}</p>}
          {kind !== 'learned' && <p>{t('box.next', { when })}</p>}
          <p className="text-emerald-100/75">
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
