import { useTranslation } from 'react-i18next'
import type { PurchaseStatus } from '../api/endpoints'
import { formatUZS } from '../lib/money'
import { chatOpen, usePurchaseChat, type ChatSide } from '../lib/purchaseChat'
import { ChatThreadView } from './ChatThread'
import { ErrorState } from './ErrorState'

const PILL: Record<PurchaseStatus, string> = {
  pending: 'bg-surface-2 text-accent-text',
  paid: 'bg-accent text-on-accent',
  rejected: 'bg-surface-2 text-danger',
  cancelled: 'bg-surface-2 text-muted',
}

/** The request's status as a small pill. */
export function StatusPill({ status }: { status: PurchaseStatus }) {
  const { t } = useTranslation()
  return (
    <span data-testid="chat-status" className={`inline-block shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL[status] ?? PILL.pending}`}>
      {t(`chat.status.${status}`)}
    </span>
  )
}

/**
 * The chat of one purchase request, for the buyer or an admin: the header (code, pack, price,
 * status) and the shared thread view. Re-read every 30 s while the request is pending. A cancelled
 * or rejected request keeps its history but takes no new messages.
 */
export function PurchaseChat({ side, requestId }: { side: ChatSide; requestId: string }) {
  const { t, i18n } = useTranslation()
  const { thread, send, api } = usePurchaseChat(side, requestId)

  if (thread.error && !thread.data) return <ErrorState error={thread.error} />
  if (!thread.data) return <div className="h-64 animate-pulse rounded-2xl bg-surface-2" />
  const { meta: r, messages } = thread.data

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 data-testid="chat-header" className="text-base font-bold text-fg">
          {t('chat.header', { code: r.code, amount: r.amount, price: formatUZS(r.price_uzs, i18n.language) })}
        </h2>
        <StatusPill status={r.status} />
      </header>
      <ChatThreadView side={side} messages={messages} send={send} open={chatOpen(r.status)}
        otherLabel={side === 'admin' ? t('chat.buyer') : t('chat.support')}
        photo={{ key: ['purchase-chat-image', side, r.id], load: (mid) => api.image(r.id, mid) }}
        systemText={(m) => (m.event === 'paid' ? t('chat.systemPaid', { count: r.amount })
          : m.event === 'cancelled' ? t('chat.systemCancelled') : null)}
        texts={{
          placeholder: t('chat.placeholder'), empty: t('chat.empty'), hint: t('chat.hintNoCards'),
          hiddenCard: t('chat.hiddenCard'), rateLimited: t('chat.rateLimited'), closed: t('chat.cancelled'),
        }} />
    </div>
  )
}
