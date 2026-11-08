import { useTranslation } from 'react-i18next'
import { supportApi } from '../api/endpoints'
import { ChatThreadView } from '../components/ChatThread'
import { ErrorState } from '../components/ErrorState'
import { useSupportChat } from '../lib/supportChat'

/**
 * The user's own chat with the admin team — no purchase needed. Text and photos; card numbers are
 * hidden like in the order chat. Re-read every 30 s while the page is open and visible.
 */
export function SupportPage() {
  const { t } = useTranslation()
  const { thread, send } = useSupportChat()

  return (
    <div className="mx-auto flex h-[calc(100dvh-12rem)] min-h-[26rem] max-w-xl flex-col gap-3">
      <h1 className="text-[26px] font-bold tracking-[-0.02em] text-fg">{t('support.title')}</h1>
      <div className="glass flex min-h-0 flex-1 flex-col p-4">
        {thread.error && !thread.data ? <ErrorState error={thread.error} />
          : !thread.data ? <div className="h-64 animate-pulse rounded-2xl bg-surface-2" />
          : (
            <ChatThreadView side="user" messages={thread.data.messages} send={send} open
              otherLabel={t('chat.support')}
              photo={{ key: ['support-chat-image'], load: (mid) => supportApi.image(mid) }}
              texts={{
                placeholder: t('support.placeholder'), empty: t('support.empty'), hint: t('support.hintNoCards'),
                hiddenCard: t('support.hiddenCard'), rateLimited: t('support.rateLimited'), closed: '',
              }} />
          )}
      </div>
    </div>
  )
}
