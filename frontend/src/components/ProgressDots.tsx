import { useTranslation } from 'react-i18next'

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

/** 5 dots, filled up to box_level (all filled + ✓ when learned). */
export function ProgressDots({ boxLevel, isLearned }: { boxLevel: number; isLearned: boolean }) {
  const { t } = useTranslation()
  const status = knowledgeStatus(boxLevel, isLearned)
  const s = STATUS_STYLE[status]
  const filled = isLearned ? 5 : Math.min(Math.max(boxLevel, 1), 5)
  return (
    <div className="flex items-center gap-2" title={t('collection.boxTitle', { level: filled })}>
      <div className="flex gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className={`h-2 w-2 rounded-full ${i < filled ? s.dot : 'bg-white/15'}`} />
        ))}
      </div>
      <span className={`text-[11px] font-semibold uppercase tracking-wide ${s.text}`}>
        {status === 'learned' ? '✓ ' : ''}{t(`collection.status.${status}`)}
      </span>
    </div>
  )
}
