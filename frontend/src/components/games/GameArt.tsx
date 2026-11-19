/** Pairs: two cards joined by a line. */
export function PairsIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="8" height="11" x="2.5" y="6.5" rx="2" />
      <rect width="8" height="11" x="13.5" y="6.5" rx="2" />
      <path d="M10.5 12h3" />
    </svg>
  )
}

/** der · die · das: three dots in the article colours (7 px with a 3 px gap at size 20). */
export function ArticlesIcon({ size }: { size: number }) {
  const dot = Math.round(size * 0.35)
  return (
    <span aria-hidden="true" className="flex items-center" style={{ gap: Math.round(size * 0.15) }}>
      {['bg-der', 'bg-die', 'bg-das'].map((bg) => (
        <span key={bg} className={`rounded-full ${bg}`} style={{ width: dot, height: dot }} />
      ))}
    </span>
  )
}

/** The name "der · die · das" with each article in its colour. className sets the size and weight. */
export function ArticlesName({ className = 'font-serif text-[17px] font-semibold' }: { className?: string }) {
  return (
    <span className={className}>
      <span className="text-der">der</span><span className="text-muted"> · </span>
      <span className="text-die">die</span><span className="text-muted"> · </span>
      <span className="text-das">das</span>
    </span>
  )
}
