import { useTranslation } from 'react-i18next'
import { errorMessage } from '../api/client'
import { CONTACT, EXTERNAL_LINK } from '../lib/contact'

/** A full error state (a page or list that failed to load): the message plus «Report a problem». */
export function ErrorState({ error, className = '' }: { error: unknown; className?: string }) {
  const { t } = useTranslation()
  return (
    <div className={`space-y-1 ${className}`} role="alert">
      <p className="text-red-300">{errorMessage(error)}</p>
      <a href={CONTACT.instagram} {...EXTERNAL_LINK} className="text-sm font-semibold text-lime-300 hover:underline">
        💬 {t('contact.reportProblem')}
      </a>
    </div>
  )
}
