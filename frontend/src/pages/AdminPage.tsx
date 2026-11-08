import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Navigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, BookOpen, Layers, Library, MessageCircle, Phone, ScanSearch, Send, ShoppingBag, Star, Users, X, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { adminApi, meApi, type AdminPurchaseRequest, type AdminUser, type FeedbackSummary, type PushResult } from '../api/endpoints'
import { apiErrorInfo, errorMessage } from '../api/client'
import { dateLocale } from '../i18n'
import { formatUZS } from '../lib/money'
import { relativeTime } from '../lib/relativeTime'
import { AdminUserModal, Stars } from '../components/AdminUserModal'
import { PurchaseChat } from '../components/PurchaseChat'
import { CloseButton, useScrimClose } from '../components/Sheet'
import { CHAT_POLL_MS } from '../lib/purchaseChat'

type SortKey = 'email' | 'created_at' | 'words_count' | 'last_activity_at'

// Admin panel. Hiding/redirecting here is only UX — every /api/admin request is
// checked on the backend (RequireAdmin reads the role from the DB and returns 403).
export function AdminPage() {
  const { t } = useTranslation()
  const me = useQuery({ queryKey: ['me'], queryFn: meApi.get, staleTime: 5 * 60_000 })
  const isAdmin = me.data?.role === 'admin'

  if (me.isLoading) return <div className="h-64 animate-pulse rounded-2xl bg-surface-2" />
  if (!isAdmin) return <Navigate to="/" replace />

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-[26px] font-bold tracking-[-0.02em] text-fg">{t('admin.title')}</h1>
        <p className="mt-1 text-[15px] text-muted">{t('admin.subtitle')}</p>
      </div>
      <StatsBlock />
      <FeedbackBlock />
      <PushPanel />
      <WordCheckJobPanel />
      <PurchasesBlock />
      <UsersTable myId={me.data!.id} />
    </div>
  )
}

// "Check existing words": runs the word check over every saved German word in the background
// and stores suggestions — users accept or reject them themselves; nothing is fixed automatically.
function WordCheckJobPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const status = useQuery({
    queryKey: ['admin', 'word-check'],
    queryFn: adminApi.wordCheckStatus,
    refetchInterval: (q) => (q.state.data?.running ? 2000 : false),
  })
  const start = useMutation({
    mutationFn: adminApi.startWordCheck,
    onSuccess: (data) => qc.setQueryData(['admin', 'word-check'], data),
  })
  const s = status.data
  return (
    <section className="glass flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 font-semibold text-fg"><ScanSearch size={18} aria-hidden="true" className="text-accent-text" />{t('admin.wordCheck.title')}</h2>
        <p className="text-sm text-muted">{t('admin.wordCheck.hint')}</p>
        {s && (s.running || s.finished_at) && (
          <p className="text-sm text-accent-text">
            {t('admin.wordCheck.progress', { processed: s.processed, total: s.total })}
            {' · '}{t('admin.wordCheck.result', { suggestions: s.suggestions, confirmed: s.confirmed, unknown: s.unknown, failed: s.failed })}
          </p>
        )}
        {s?.error && <p className="text-sm text-danger">{s.error}</p>}
        {(start.error || status.error) && <p className="text-sm text-danger">{errorMessage(start.error ?? status.error)}</p>}
      </div>
      <button type="button" className="btn-primary shrink-0" disabled={s?.running || start.isPending} onClick={() => start.mutate()}>
        {s?.running ? t('admin.wordCheck.running') : t('admin.wordCheck.run')}
      </button>
    </section>
  )
}

function StatsBlock() {
  const { t } = useTranslation()
  const { data, error } = useQuery({ queryKey: ['admin', 'stats'], queryFn: adminApi.stats })
  const feedback = useQuery({ queryKey: ['admin', 'feedback'], queryFn: adminApi.feedback })
  const tg = useQuery({ queryKey: ['admin', 'telegram-stats'], queryFn: adminApi.telegramStats }).data
  const v = (n?: number) => (n === undefined ? '—' : n)
  // wide: the card takes two grid columns (its value is a whole phrase).
  const cards: { icon: LucideIcon; value: string | number; label: string; hint: string; wide?: boolean }[] = [
    { icon: Users, value: v(data?.total_users), label: t('admin.stats.users'),
      hint: data ? t('admin.stats.usersHint', { new7: data.new_users_7d, banned: data.banned_users }) : '' },
    { icon: Activity, value: v(data?.active_users_7d), label: t('admin.stats.active7d'), hint: '' },
    { icon: Library, value: v(data?.total_words), label: t('admin.stats.words'), hint: '' },
    { icon: Layers, value: v(data?.training_sessions), label: t('admin.stats.trainings'),
      hint: data ? t('admin.stats.answers', { count: data.total_reviews }) : '' },
    { icon: BookOpen, value: v(data?.total_stories), label: t('admin.stats.stories'),
      hint: data ? t('admin.stats.stories30d', { count: data.stories_30d }) : '' },
    { icon: Star, value: feedback.data?.count ? feedback.data.average.toFixed(1) : '—', label: t('admin.feedback.tile'),
      hint: feedback.data ? t('admin.feedback.count', { n: feedback.data.count }) : '' },
    { icon: Send, value: tg ? t('admin.telegramStats.of', { connected: tg.connected, total: tg.total_users, percent: tg.percent }) : '—',
      label: t('admin.telegramStats.title'), hint: tg ? t('admin.telegramStats.last7d', { count: tg.connected_last_7d }) : '', wide: true },
  ]
  return (
    <section>
      {error && <p className="mb-3 text-danger">{errorMessage(error)}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className={`glass p-4${c.wide ? ' col-span-2' : ''}`}>
            <c.icon size={18} aria-hidden="true" className="text-accent-text" />
            <div className="mt-2 text-[28px] font-bold leading-tight tabular-nums text-fg">{c.value}</div>
            <div className="text-sm text-muted">{c.label}</div>
            {c.hint && <div className="mt-1 text-[11px] text-faint">{c.hint}</div>}
          </div>
        ))}
      </div>
    </section>
  )
}

const PUSH_TITLE_MAX = 60
const PUSH_BODY_MAX = 200
const PUSH_MAX_USERS = 200

type PushMode = 'me' | 'all' | 'users'

/** Send a push notification: to yourself (a test), to every subscribed device, or to chosen users. */
function PushPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const stats = useQuery({ queryKey: ['admin', 'push'], queryFn: adminApi.pushStats })
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: adminApi.users }) // shared with the users table
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [mode, setMode] = useState<PushMode>('me')
  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [result, setResult] = useState<PushResult | null>(null)

  const subscribers = useMemo(() => (users.data ?? []).filter((u) => (u.push_devices ?? 0) > 0), [users.data])
  const byId = useMemo(() => new Map(subscribers.map((u) => [u.id, u])), [subscribers])
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return subscribers.filter((u) => !q || u.email.toLowerCase().includes(q))
  }, [subscribers, search])

  const send = useMutation({
    mutationFn: () => adminApi.sendPush({
      target: mode, ...(mode === 'users' && { user_ids: selected }), title: title.trim(), body: body.trim(),
    }),
    onSuccess: (r) => {
      setResult(r)
      void qc.invalidateQueries({ queryKey: ['admin'] }) // expired devices were removed
    },
  })

  const valid = title.trim().length > 0 && body.trim().length > 0 &&
    (mode !== 'users' || (selected.length > 0 && selected.length <= PUSH_MAX_USERS))

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || send.isPending) return
    if (mode === 'all' && !window.confirm(t('admin.push.confirmAll', { n: stats.data?.devices ?? 0 }))) return
    setResult(null)
    send.mutate()
  }

  const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-faint'
  const radio = (value: PushMode, text: string) => (
    <label className="flex items-center gap-2">
      <input type="radio" name="push-target" checked={mode === value} onChange={() => setMode(value)} className="accent-[var(--accent)]" />{text}
    </label>
  )
  return (
    <section className="glass space-y-4 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold text-fg">{t('admin.push.title')}</h2>
        {stats.data && <span className="text-sm text-muted">{t('admin.push.subscribers', { n: stats.data.devices })}</span>}
      </div>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={label} htmlFor="push-title">{t('admin.push.fieldTitle')}</label>
          <input id="push-title" className="field" value={title} onChange={(e) => setTitle(e.target.value.slice(0, PUSH_TITLE_MAX))} />
          <span className="text-xs text-faint">{title.length}/{PUSH_TITLE_MAX}</span>
        </div>
        <div>
          <label className={label} htmlFor="push-body">{t('admin.push.fieldBody')}</label>
          <textarea id="push-body" rows={2} className="field" value={body} onChange={(e) => setBody(e.target.value.slice(0, PUSH_BODY_MAX))} />
          <span className="text-xs text-faint">{body.length}/{PUSH_BODY_MAX}</span>
        </div>
        <div role="radiogroup" className="flex flex-wrap gap-4 text-sm text-fg">
          {radio('me', t('admin.push.toMe'))}
          {radio('all', t('admin.push.toAll'))}
          {radio('users', t('admin.push.toSelected'))}
        </div>

        {mode === 'users' && (
          users.data && subscribers.length === 0 ? (
            <p className="text-sm text-muted">{t('admin.push.noSubscribers')}</p>
          ) : (
            <div className="space-y-2">
              {selected.length > 0 && (
                <div className="flex flex-wrap gap-2" data-testid="push-chips">
                  {selected.map((id) => (
                    <button key={id} type="button" onClick={() => toggle(id)}
                      className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1 text-xs text-fg hover:opacity-80">
                      {byId.get(id)?.email ?? id}<X size={12} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}
              <p className="text-sm text-muted">{t('admin.push.selectedCount', { n: selected.length })}</p>
              <input className="field" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={t('admin.push.searchUser')} aria-label={t('admin.push.searchUser')} />
              <ul data-testid="push-picker" className="max-h-64 divide-y divide-divider overflow-y-auto rounded-2xl border border-line">
                {shown.map((u) => (
                  <li key={u.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-2">
                      <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} className="h-4 w-4 accent-[var(--accent)]" />
                      <span className="min-w-0 flex-1 truncate">{u.email}</span>
                      <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted" title={t('admin.userCard.pushDevices', { n: u.push_devices ?? 0 })}>
                        <Phone size={12} aria-hidden="true" />{u.push_devices}
                      </span>
                    </label>
                  </li>
                ))}
                {users.data && shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">{t('admin.nothingFound')}</li>}
              </ul>
            </div>
          )
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary" disabled={!valid || send.isPending}><Send size={16} aria-hidden="true" />{t('admin.push.send')}</button>
          {result && <span className="text-sm text-accent-text">{t('admin.push.result', { ...result })}</span>}
        </div>
        {send.error && <p role="alert" className="text-sm text-danger">{errorMessage(send.error)}</p>}
      </form>
    </section>
  )
}

/** The ratings users left, newest first. */
function FeedbackBlock() {
  const { t } = useTranslation()
  const { data } = useQuery<FeedbackSummary>({ queryKey: ['admin', 'feedback'], queryFn: adminApi.feedback })
  if (!data?.items.length) return null
  return (
    <section className="glass space-y-3 p-6">
      <h2 className="text-lg font-bold text-fg">{t('admin.feedback.title')} <span className="text-accent-text">({data.count})</span></h2>
      <ul className="max-h-96 space-y-3 overflow-y-auto">
        {data.items.map((f, i) => (
          <li key={`${f.email}-${i}`} className="border-t border-divider pt-3 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-x-3 text-sm">
              <Stars rating={f.rating} />
              <span className="font-semibold text-fg">{f.email}</span>
              <span className="text-xs text-faint">{new Date(f.created_at).toLocaleDateString(dateLocale())}</span>
            </div>
            <p className={`mt-1 text-sm ${f.comment ? 'text-fg' : 'text-faint'}`}>{f.comment || t('admin.feedback.noComment')}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** How long the first tap on "Approve" waits for the second one. */
const APPROVE_CONFIRM_MS = 3000

/**
 * Photo purchases waiting for the admin: find the transfer by its code, then approve (adds the
 * photos once and tells the user) or reject. A request someone else decided meanwhile just
 * disappears on refresh.
 */
function PurchasesBlock() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  // Re-read every 30 s while visible: new requests and the chats' unread badges come in by themselves.
  const list = useQuery({
    queryKey: ['admin', 'purchases', 'pending'], queryFn: () => adminApi.purchases('pending'),
    refetchInterval: CHAT_POLL_MS, refetchIntervalInBackground: false,
  })
  const [chat, setChat] = useState<AdminPurchaseRequest | null>(null)
  const refresh = () => {
    for (const key of [['admin', 'purchases'], ['admin', 'users'], ['admin', 'user-features']]) {
      void qc.invalidateQueries({ queryKey: key })
    }
  }
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      approve ? adminApi.approvePurchase(id) : adminApi.rejectPurchase(id),
    onSuccess: refresh,
    onError: (e) => { if (apiErrorInfo(e).code === 'already_decided') refresh() },
  })
  const failed = decide.error && apiErrorInfo(decide.error).code !== 'already_decided' ? decide.error : null
  const n = list.data?.length ?? 0

  return (
    <section className="glass space-y-4 p-6" aria-labelledby="admin-purchases-title">
      <h2 id="admin-purchases-title" className="flex items-center gap-2 text-lg font-bold text-fg">
        <ShoppingBag size={18} aria-hidden="true" className="text-accent-text" />{t('admin.purchases.title')}
        {n > 0 && (
          <span data-testid="purchases-count" className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold tabular-nums text-on-accent">{n}</span>
        )}
      </h2>
      {list.isLoading && <div className="h-16 animate-pulse rounded-2xl bg-surface-2" />}
      {list.error && <p className="text-sm text-danger">{errorMessage(list.error)}</p>}
      {list.data && (n === 0 ? (
        <p className="text-sm text-muted">{t('admin.purchases.empty')}</p>
      ) : (
        <ul className="divide-y divide-divider">
          {list.data.map((p) => (
            <PurchaseRow key={p.id} p={p} busy={decide.isPending && decide.variables?.id === p.id}
              onApprove={() => decide.mutate({ id: p.id, approve: true })}
              onReject={() => decide.mutate({ id: p.id, approve: false })}
              onChat={() => setChat(p)} />
          ))}
        </ul>
      ))}
      {failed && <p role="alert" className="text-sm text-danger">{t('admin.actionFailed', { error: errorMessage(failed) })}</p>}
      {chat && <ChatPanel request={chat} onClose={() => { setChat(null); refresh() }} />}
    </section>
  )
}

/** A request's chat in a panel on the right (full screen on phones): the same thread, the admin's composer. */
function ChatPanel({ request, onClose }: { request: AdminPurchaseRequest; onClose: () => void }) {
  const { t } = useTranslation()
  const scrim = useScrimClose(onClose)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" {...scrim}>
      <aside role="dialog" aria-modal="true" aria-label={t('chat.title')}
        className="animate-rise flex h-full w-full max-w-md flex-col gap-2 border-l border-line bg-surface p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-semibold text-muted">{request.user_email}</span>
          <CloseButton onClose={onClose} />
        </div>
        <div className="min-h-0 flex-1"><PurchaseChat side="admin" requestId={request.id} /></div>
      </aside>
    </div>,
    document.body,
  )
}

function PurchaseRow({ p, busy, onApprove, onReject, onChat }: {
  p: AdminPurchaseRequest; busy: boolean; onApprove: () => void; onReject: () => void; onChat: () => void
}) {
  const { t, i18n } = useTranslation()
  // Approving adds photos for real money: the first tap only arms the button for 3 s.
  const [armed, setArmed] = useState(false)
  const timer = useRef<number>()
  useEffect(() => () => window.clearTimeout(timer.current), [])

  function approve() {
    window.clearTimeout(timer.current)
    if (!armed) {
      setArmed(true)
      timer.current = window.setTimeout(() => setArmed(false), APPROVE_CONFIRM_MS)
      return
    }
    setArmed(false)
    onApprove()
  }

  const btn = 'rounded-xl border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50'
  return (
    <li data-testid={`purchase-${p.id}`} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="truncate font-semibold text-fg">{p.user_email}</div>
        <div className="text-sm text-muted">
          <span className="font-mono font-semibold text-fg">{p.code}</span>
          {' · '}{t('buy.pack', { n: p.amount })}{' · '}{formatUZS(p.price_uzs, i18n.language)}{' · '}
          <time dateTime={p.created_at} title={new Date(p.created_at).toLocaleString(dateLocale())}>{relativeTime(p.created_at)}</time>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={onChat} className={`${btn} inline-flex items-center gap-1.5 border-line text-fg hover:bg-surface-2`}>
          <MessageCircle size={14} aria-hidden="true" />{t('chat.open')}
          {p.unread > 0 && (
            <span data-testid={`unread-${p.id}`} title={t('chat.unread', { count: p.unread })}
              className="rounded-full bg-accent px-1.5 text-[10px] font-bold tabular-nums text-on-accent">
              {p.unread}<span className="sr-only"> · {t('chat.unread', { count: p.unread })}</span>
            </span>
          )}
        </button>
        <button type="button" disabled={busy} onClick={approve}
          className={`${btn} ${armed ? 'border-accent bg-accent text-on-accent' : 'border-line text-accent-text hover:bg-surface-2'}`}>
          {armed ? t('admin.purchases.sure') : t('admin.purchases.approve')}
        </button>
        <button type="button" disabled={busy} onClick={onReject} className={`${btn} border-line text-danger hover:bg-surface-2`}>
          {t('admin.purchases.reject')}
        </button>
      </div>
    </li>
  )
}

function UsersTable({ myId }: { myId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['admin', 'users'], queryFn: adminApi.users })
  const [q, setQ] = useState('')
  const [opened, setOpened] = useState<AdminUser | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'created_at', desc: true })

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] })
  const ban = useMutation({
    mutationFn: (u: AdminUser) => adminApi.setBanned(u.id, !u.is_banned),
    onSuccess: refresh,
  })
  const remove = useMutation({ mutationFn: (u: AdminUser) => adminApi.remove(u.id), onSuccess: refresh })

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = (data ?? []).filter((u) => !s || u.email.toLowerCase().includes(s) || u.id.includes(s))
    const val = (u: AdminUser): string | number => {
      switch (sort.key) {
        case 'email': return u.email.toLowerCase()
        case 'words_count': return u.words_count
        case 'created_at': return u.created_at
        case 'last_activity_at': return u.last_activity_at ?? ''
      }
    }
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b)
      const r = x < y ? -1 : x > y ? 1 : 0
      return sort.desc ? -r : r
    })
  }, [data, q, sort])

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== 'email' }))
  }

  function onBan(u: AdminUser) {
    const msg = u.is_banned ? t('admin.confirmUnban', { email: u.email }) : t('admin.confirmBan', { email: u.email })
    if (window.confirm(msg)) ban.mutate(u)
  }

  function onDelete(u: AdminUser) {
    if (window.confirm(t('admin.confirmDelete', { email: u.email }))) remove.mutate(u)
  }

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(dateLocale()) : '—')
  const th = (key: SortKey, label: string) => (
    <th className="cursor-pointer select-none px-4 py-3 font-semibold hover:text-fg" onClick={() => toggleSort(key)}>
      {label} {sort.key === key ? (sort.desc ? '↓' : '↑') : ''}
    </th>
  )
  const actionError = ban.error ?? remove.error

  return (
    <section className="glass space-y-4 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className="text-lg font-bold text-fg">
          {t('admin.users')} {data && <span className="text-accent-text tabular-nums">({rows.length}/{data.length})</span>}
        </h2>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.search')} className="field md:w-80" />
      </div>

      {error && <p className="text-danger">{errorMessage(error)}</p>}
      {actionError && <p className="text-danger">{t('admin.actionFailed', { error: errorMessage(actionError) })}</p>}
      {isLoading && <div className="h-40 animate-pulse rounded-2xl bg-surface-2" />}

      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-faint">
              <tr>
                {th('email', t('admin.col.email'))}
                {th('created_at', t('admin.col.registered'))}
                {th('words_count', t('admin.col.words'))}
                {th('last_activity_at', t('admin.col.lastActivity'))}
                <th className="px-4 py-3 font-semibold">{t('admin.col.status')}</th>
                <th className="px-4 py-3 text-right font-semibold">{t('admin.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const self = u.id === myId
                const protectedUser = self || u.role === 'admin'
                const busy = (ban.isPending && ban.variables?.id === u.id) || (remove.isPending && remove.variables?.id === u.id)
                return (
                  <tr key={u.id} tabIndex={0}
                    onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) setOpened(u) }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setOpened(u) }}
                    className={`cursor-pointer border-t border-divider hover:bg-surface-2 ${u.is_banned ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-fg">{u.email}</div>
                      <div className="font-mono text-[10px] text-faint">{u.id}</div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted">{fmt(u.created_at)}</td>
                    <td className="px-4 py-3 font-semibold tabular-nums text-fg">{u.words_count}</td>
                    <td className="px-4 py-3 tabular-nums text-muted">{fmt(u.last_activity_at)}</td>
                    <td className="px-4 py-3">
                      {u.role === 'admin' && <span className="mr-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-accent-text">admin</span>}
                      {u.is_banned
                        ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-danger">{t('admin.banned')}</span>
                        : <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{t('admin.active')}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {protectedUser ? (
                        <div className="text-right text-xs text-faint">{self ? t('admin.you') : '—'}</div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <button type="button" disabled={busy} onClick={() => onBan(u)}
                            className="rounded-xl border border-line px-3 py-1.5 text-xs font-semibold text-streak transition hover:bg-surface-2 disabled:opacity-50">
                            {u.is_banned ? t('admin.unban') : t('admin.ban')}
                          </button>
                          <button type="button" disabled={busy} onClick={() => onDelete(u)}
                            className="rounded-xl border border-line px-3 py-1.5 text-xs font-semibold text-danger transition hover:bg-surface-2 disabled:opacity-50">
                            {t('admin.delete')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!rows.length && <p className="py-6 text-center text-muted">{t('admin.nothingFound')}</p>}
        </div>
      )}
      {opened && <AdminUserModal user={opened} onClose={() => setOpened(null)} />}
    </section>
  )
}
