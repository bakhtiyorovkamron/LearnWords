import { useId } from 'react'

/** The yodla mark: a gradient square with a "y" — the same drawing as public/favicon.svg. */
export function LogoMark({ className = '' }: { className?: string }) {
  // The gradient id must be unique per copy: a shared id breaks the visible copy when the other
  // one sits in a display:none container (the desktop header logo on phones).
  const gradient = `logo-grad-${useId().replace(/:/g, '')}`
  return (
    <svg viewBox="0 0 512 512" width="32" height="32" className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#bef264" />
          <stop offset="1" stopColor="#10b981" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill={`url(#${gradient})`} />
      <path d="M152 114 L258 288 M362 114 L238 354 Q214 400 162 400" fill="none" stroke="#022c22" strokeWidth="58"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Mark + wordmark. The wordmark is the only text set in the display font. */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark />
      <span className="display text-[19px] font-extrabold tracking-tight text-fg">yodla</span>
    </span>
  )
}
