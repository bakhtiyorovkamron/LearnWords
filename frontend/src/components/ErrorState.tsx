import { MessageCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '../api/client'
import { CONTACT, EXTERNAL_LINK } from '../lib/contact'

/** A full error state (a page or list that failed to load): the message plus «Report a problem». */
export function ErrorState({ error, className = '' }: { error: unknown; className?: string }) {
  const { t } = useTranslation()
  return (
    <div className={`space-y-1 ${className}`} role="alert">
      <p className="text-danger">{errorMessage(error)}</p>
      <a href={CONTACT.instagram} {...EXTERNAL_LINK} className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-text hover:underline">
        <MessageCircle size={14} aria-hidden="true" />{t('contact.reportProblem')}
      </a>
    </div>
  )
}
