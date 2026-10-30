import { Camera, Send } from 'lucide-react'
import { CONTACT, EXTERNAL_LINK } from '../lib/contact'

/** Small inline contact links: Instagram handle (+ Telegram when configured). */
export function ContactLinks({ className = '' }: { className?: string }) {
  const link = 'inline-flex items-center gap-1.5 font-semibold text-accent-text hover:underline'
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-3 ${className}`}>
      <a href={CONTACT.instagram} {...EXTERNAL_LINK} className={link}><Camera size={14} aria-hidden="true" />{CONTACT.instagramHandle}</a>
      {CONTACT.telegram && <a href={CONTACT.telegram} {...EXTERNAL_LINK} className={link}><Send size={14} aria-hidden="true" />Telegram</a>}
    </span>
  )
}
