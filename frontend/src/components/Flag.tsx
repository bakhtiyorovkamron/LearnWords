import type { LearningLang } from '../api/endpoints'

// Country flags as SVG: emoji flags do not render on Windows. Colours are the flags' own, not theme colours.
const FLAGS: Record<LearningLang, React.ReactNode> = {
  de: (
    <>
      <rect width="24" height="5.34" fill="#000" />
      <rect y="5.33" width="24" height="5.34" fill="#D00" />
      <rect y="10.66" width="24" height="5.34" fill="#FFCE00" />
    </>
  ),
  en: (
    <>
      <rect width="24" height="16" fill="#012169" />
      <path d="M0 0l24 16M24 0L0 16" stroke="#fff" strokeWidth="3.2" />
      <path d="M0 0l24 16M24 0L0 16" stroke="#C8102E" strokeWidth="1.4" />
      <path d="M12 0v16M0 8h24" stroke="#fff" strokeWidth="5.4" />
      <path d="M12 0v16M0 8h24" stroke="#C8102E" strokeWidth="3.2" />
    </>
  ),
  fr: (
    <>
      <rect width="8" height="16" fill="#0055A4" />
      <rect x="8" width="8" height="16" fill="#fff" />
      <rect x="16" width="8" height="16" fill="#EF4135" />
    </>
  ),
  ko: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <circle cx="12" cy="8" r="3.6" fill="#0047A0" />
      <path d="M8.4 8a3.6 3.6 0 0 1 7.2 0a1.8 1.8 0 0 1-3.6 0a1.8 1.8 0 0 0-3.6 0z" fill="#CD2E3A" />
      <g stroke="#000" strokeWidth="0.9">
        <path d="M3.4 3.2l2.4-1.6M3.9 4.2l2.4-1.6M4.4 5.2l2.4-1.6" />
        <path d="M17.2 14.4l2.4-1.6M17.7 15.4l2.4-1.6M18.2 13.4l2.4-1.6" />
        <path d="M17.2 1.6l2.4 1.6M17.7 2.6l2.4 1.6M18.2 3.6l2.4 1.6" />
        <path d="M3.4 12.8l2.4 1.6M3.9 11.8l2.4 1.6M4.4 13.8l2.4 1.6" />
      </g>
    </>
  ),
}

/** The flag of a learning language, 24×16, decorative (the language name sits next to it). */
export function Flag({ lang, className = '' }: { lang: LearningLang; className?: string }) {
  return (
    <svg viewBox="0 0 24 16" width="24" height="16" aria-hidden="true" data-flag={lang}
      className={`shrink-0 rounded-[3px] ring-1 ring-black/10 ${className}`}>
      {FLAGS[lang]}
    </svg>
  )
}
