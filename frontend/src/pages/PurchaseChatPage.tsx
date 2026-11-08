import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PurchaseChat } from '../components/PurchaseChat'

/** The buyer's chat with the admins about one purchase request (from BuySheet and the profile). */
export function PurchaseChatPage() {
  const { id = '' } = useParams()
  const { t } = useTranslation()
  return (
    <div className="mx-auto flex h-[calc(100dvh-13rem)] min-h-[26rem] max-w-xl flex-col gap-3">
      <Link to="/profile" className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-muted hover:text-fg">
        <ArrowLeft size={16} aria-hidden="true" />{t('chat.back')}
      </Link>
      <div className="glass flex min-h-0 flex-1 flex-col p-4">
        <PurchaseChat side="user" requestId={id} />
      </div>
    </div>
  )
}
