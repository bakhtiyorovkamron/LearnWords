import { CONTACT, EXTERNAL_LINK } from '../lib/contact'

/** Small inline contact links: «📷 @yodla.fun» (+ Telegram when configured). */
export function ContactLinks({ className = '' }: { className?: string }) {
  const link = 'font-semibold text-lime-300 hover:underline'
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-3 ${className}`}>
      <a href={CONTACT.instagram} {...EXTERNAL_LINK} className={link}>📷 {CONTACT.instagramHandle}</a>
      {CONTACT.telegram && <a href={CONTACT.telegram} {...EXTERNAL_LINK} className={link}>✈️ Telegram</a>}
    </span>
  )
}
