import { useTranslation } from 'react-i18next'
import { supportApi } from '../api/endpoints'
import { ChatThreadView } from '../components/ChatThread'
import { ErrorState } from '../components/ErrorState'
import { useMarkRead } from '../lib/chatUnread'
import { useSupportChat } from '../lib/supportChat'

/**
 * The user's own chat with the admin team — no purchase needed. Text and photos; card numbers are
 * hidden like in the order chat. While it is open, visible and scrolled to the bottom, the newest
 * message is marked read (the badges). Re-read every 5 s while the screen is open and visible, and when
 * the page or the window comes back.
 */
export function SupportPage() {
  const { t } = useTranslation()
  const { thread, send, messages } = useSupportChat()
  const markRead = useMarkRead()

  return (
    <div className="mx-auto flex h-[calc(100dvh-12rem)] min-h-[26rem] max-w-xl flex-col gap-3">
      <h1 className="text-[26px] font-bold tracking-[-0.02em] text-fg">{t('support.title')}</h1>
      <div className="glass flex min-h-0 flex-1 flex-col p-4">
        {thread.error && !thread.data ? <ErrorState error={thread.error} />
          : !thread.data ? <div className="h-64 animate-pulse rounded-2xl bg-surface-2" />
          : (
            <ChatThreadView side="user" messages={messages} send={send} open
              seenFloor={thread.data.meta.readMarker} onSeen={(id) => { markRead.support(id).catch(() => undefined) }}
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
