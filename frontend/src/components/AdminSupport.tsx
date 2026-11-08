import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { adminSupportApi, type SupportThread } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { dateLocale } from '../i18n'
import { CHAT_POLL_MS } from '../lib/chatThread'
import { usePageVisible } from '../lib/pageVisible'
import { relativeTime } from '../lib/relativeTime'
import { SUPPORT_THREADS_KEY, useAdminSupportThread } from '../lib/supportChat'
import { ChatThreadView } from './ChatThread'

/** The support threads, re-read every 30 s while the page is visible (also for the tab's badge). */
export function useSupportThreads() {
  const visible = usePageVisible()
  return useQuery({
    queryKey: SUPPORT_THREADS_KEY,
    queryFn: () => adminSupportApi.threads(),
    refetchInterval: visible ? CHAT_POLL_MS : false,
    refetchIntervalInBackground: false,
  })
}

/**
 * The admins' support inbox: the threads (newest conversation first, unread badges, the last
 * message) and the open thread with the admin composer. Opening a thread marks it read, and so does
 * every new message that arrives while it is open.
 */
export function AdminSupport() {
  const { t } = useTranslation()
  const threads = useSupportThreads()
  const [openId, setOpenId] = useState<number | null>(null)
  const open = threads.data?.find((x) => x.id === openId) ?? null

  return (
    <section aria-labelledby="admin-support-title" className="glass p-4 sm:p-6">
      <h2 id="admin-support-title" className="mb-4 text-lg font-bold text-fg">{t('support.title')}</h2>
      {threads.error && <p className="text-sm text-danger">{errorMessage(threads.error)}</p>}
      {threads.isLoading && <div className="h-24 animate-pulse rounded-2xl bg-surface-2" />}
      {threads.data && (threads.data.length === 0 ? (
        <p className="text-sm text-muted">{t('support.threadsEmpty')}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
          <ul aria-label={t('support.title')} className={`divide-y divide-divider ${openId !== null ? 'max-md:hidden' : ''}`}>
            {threads.data.map((th) => (
              <li key={th.id}>
                <ThreadRow th={th} active={th.id === openId} onOpen={() => setOpenId(th.id)} />
              </li>
            ))}
          </ul>
          {openId !== null ? (
            <div className="flex h-[70dvh] min-h-[24rem] flex-col gap-2">
              <button type="button" onClick={() => setOpenId(null)} className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-muted hover:text-fg md:hidden">
                <ArrowLeft size={16} aria-hidden="true" />{t('support.back')}
              </button>
              {open && <p className="truncate text-sm font-semibold text-muted">{open.user_email}</p>}
              <AdminSupportThread key={openId} id={openId} />
            </div>
          ) : (
            <p className="text-sm text-muted max-md:hidden">{t('support.pickThread')}</p>
          )}
        </div>
      ))}
    </section>
  )
}

function ThreadRow({ th, active, onOpen }: { th: SupportThread; active: boolean; onOpen: () => void }) {
  const { t } = useTranslation()
  return (
    <button type="button" onClick={onOpen} data-testid={`support-thread-${th.id}`} aria-current={active || undefined}
      className={`flex w-full items-start gap-2 px-2 py-3 text-left transition hover:bg-surface-2 ${active ? 'bg-surface-2' : ''}`}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-fg">{th.user_email}</span>
        {th.preview && <span className="block truncate text-sm text-muted">{th.preview}</span>}
        {th.last_message_at && (
          <time dateTime={th.last_message_at} title={new Date(th.last_message_at).toLocaleString(dateLocale())} className="text-[11px] text-faint">
            {relativeTime(th.last_message_at)}
          </time>
        )}
      </span>
      {th.unread > 0 && (
        <span data-testid={`support-unread-${th.id}`} title={t('support.unread', { count: th.unread })}
          className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-bold tabular-nums text-on-accent">
          {th.unread}<span className="sr-only"> · {t('support.unread', { count: th.unread })}</span>
        </span>
      )}
    </button>
  )
}

function AdminSupportThread({ id }: { id: number }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { thread, send, messages } = useAdminSupportThread(id)
  const lastId = messages.at(-1)?.id ?? 0

  // Read up to the newest message on screen: when opened, and as new ones arrive.
  useEffect(() => {
    if (!lastId) return
    void adminSupportApi.read(id, lastId).then(() => qc.invalidateQueries({ queryKey: SUPPORT_THREADS_KEY })).catch(() => undefined)
  }, [id, lastId, qc])

  if (thread.error && !thread.data) return <p className="text-sm text-danger">{errorMessage(thread.error)}</p>
  if (!thread.data) return <div className="h-48 animate-pulse rounded-2xl bg-surface-2" />
  return (
    <ChatThreadView side="admin" messages={messages} send={send} open
      otherLabel={t('chat.user')}
      photo={{ key: ['admin-support-image', id], load: (mid) => adminSupportApi.image(id, mid) }}
      texts={{
        placeholder: t('support.placeholder'), empty: t('support.empty'), hint: t('support.hintNoCards'),
        hiddenCard: t('support.hiddenCard'), rateLimited: t('support.rateLimited'), closed: '',
      }} />
  )
}
