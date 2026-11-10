import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { adminApi, adminSupportApi, type SupportThread } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { dateLocale } from '../i18n'
import { CHAT_POLL_MS } from '../lib/chatThread'
import { usePageVisible } from '../lib/pageVisible'
import { shortTime } from '../lib/chatLayout'
import { SUPPORT_THREADS_KEY, useAdminSupportThread } from '../lib/supportChat'
import { AdminSupportPicker } from './AdminSupportPicker'
import { ChatAvatar, ChatThreadView } from './ChatThread'

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
export function AdminSupport({ startWith, onStarted }: { startWith?: string | null; onStarted?: () => void }) {
  const { t } = useTranslation()
  const threads = useSupportThreads()
  const [openId, setOpenId] = useState<number | null>(null)
  const [picking, setPicking] = useState(false)
  // The same users query as the users table (same key), read only while the picker is open.
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: adminApi.users, enabled: picking, staleTime: 30_000 })
  const withThread = useMemo(() => new Set((threads.data ?? []).map((th) => th.user_id)), [threads.data])

  // Open (and create, when the user never wrote) the thread with a user: the picker and the user card use this.
  const open = useMutation({ mutationFn: adminSupportApi.open, onSuccess: (th) => setOpenId(th.id) })
  const openFor = open.mutate

  const started = useRef<string | null>(null)
  useEffect(() => {
    if (!startWith) { started.current = null; return }
    if (started.current === startWith) return
    started.current = startWith
    openFor(startWith)
    onStarted?.()
  }, [startWith, openFor, onStarted])

  return (
    <section aria-labelledby="admin-support-title" className="glass p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="admin-support-title" className="text-lg font-bold text-fg">{t('support.title')}</h2>
        <button type="button" onClick={() => setPicking(true)} className="btn-primary">
          <Pencil size={16} aria-hidden="true" />{t('support.write')}
        </button>
      </div>
      {threads.error && <p className="text-sm text-danger">{errorMessage(threads.error)}</p>}
      {open.error && <p role="alert" className="mb-2 text-sm text-danger">{errorMessage(open.error)}</p>}
      {threads.isLoading && <div className="h-24 animate-pulse rounded-2xl bg-surface-2" />}
      {threads.data && (
        <div className="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
          <div className={openId !== null ? 'max-md:hidden' : ''}>
            {threads.data.length === 0 ? (
              <p className="text-sm text-muted">{t('support.threadsEmpty')}</p>
            ) : (
              <ul aria-label={t('support.title')} className="divide-y divide-divider">
                {threads.data.map((th) => (
                  <li key={th.id}>
                    <ThreadRow th={th} active={th.id === openId} onOpen={() => setOpenId(th.id)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          {openId !== null ? (
            <div className="flex h-[70dvh] min-h-[24rem] flex-col gap-2">
              <AdminSupportThread key={openId} id={openId} onBack={() => setOpenId(null)} />
            </div>
          ) : (
            <p className="text-sm text-muted max-md:hidden">{t('support.pickThread')}</p>
          )}
        </div>
      )}
      {picking && (
        <AdminSupportPicker users={users.data} loading={users.isLoading} withThread={withThread}
          onClose={() => setPicking(false)}
          onPick={(id) => { setPicking(false); openFor(id) }} />
      )}
    </section>
  )
}

function ThreadRow({ th, active, onOpen }: { th: SupportThread; active: boolean; onOpen: () => void }) {
  const { t } = useTranslation()
  return (
    <button type="button" onClick={onOpen} data-testid={`support-thread-${th.id}`} aria-current={active || undefined}
      className={`flex w-full items-center gap-3 px-2 py-3 text-left transition hover:bg-surface-2 ${active ? 'bg-surface-2' : ''}`}>
      <ChatAvatar className="h-11 w-11 text-base">{th.user_email.charAt(0).toUpperCase()}</ChatAvatar>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-fg">{th.user_email}</span>
        {th.preview && (
          <span className={`block truncate text-sm ${th.unread > 0 ? 'font-bold text-fg' : 'text-muted'}`}>{th.preview}</span>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {th.last_message_at && (
          <time dateTime={th.last_message_at} title={new Date(th.last_message_at).toLocaleString(dateLocale())} className="text-[11px] tabular-nums text-faint">
            {shortTime(th.last_message_at, t, dateLocale())}
          </time>
        )}
        {th.unread > 0 && (
          <span data-testid={`support-unread-${th.id}`} title={t('support.unread', { count: th.unread })}
            className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[11px] font-bold tabular-nums leading-none text-on-accent">
            {th.unread}<span className="sr-only"> · {t('support.unread', { count: th.unread })}</span>
          </span>
        )}
      </span>
    </button>
  )
}

function AdminSupportThread({ id, onBack }: { id: number; onBack: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { thread, send, messages } = useAdminSupportThread(id)
  const lastId = messages.at(-1)?.id ?? 0

  // Read up to the newest message on screen: when opened, and as new ones arrive.
  useEffect(() => {
    if (!lastId) return
    // Also what brings a thread that was empty into the inbox after the admin's first message.
    void adminSupportApi.read(id, lastId).catch(() => undefined).then(() => qc.invalidateQueries({ queryKey: SUPPORT_THREADS_KEY }))
  }, [id, lastId, qc])

  if (thread.error && !thread.data) return <p className="text-sm text-danger">{errorMessage(thread.error)}</p>
  if (!thread.data) return <div className="h-48 animate-pulse rounded-2xl bg-surface-2" />
  return (
    <ChatThreadView side="admin" messages={messages} send={send} open
      header={{ title: thread.data.meta.user_email, avatar: thread.data.meta.user_email.charAt(0).toUpperCase(), onBack }}
      readMarker={thread.data.meta.readMarker} otherReadMarker={thread.data.meta.otherReadMarker}
      otherLabel={t('chat.user')}
      photo={{ key: ['admin-support-image', id], load: (mid) => adminSupportApi.image(id, mid) }}
      texts={{
        placeholder: t('support.placeholder'), empty: t('support.emptyAdmin'), hint: t('support.hintNoCards'),
        hiddenCard: t('support.hiddenCard'), rateLimited: t('support.rateLimited'), closed: '',
      }} />
  )
}
