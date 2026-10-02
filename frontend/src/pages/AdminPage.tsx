import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { adminApi, meApi, type AdminUser } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { dateLocale } from '../i18n'

type SortKey = 'email' | 'created_at' | 'words_count' | 'last_activity_at'

// Admin panel. Hiding/redirecting here is only UX — every /api/admin request is
// checked on the backend (RequireAdmin reads the role from the DB and returns 403).
export function AdminPage() {
  const { t } = useTranslation()
  const me = useQuery({ queryKey: ['me'], queryFn: meApi.get, staleTime: 5 * 60_000 })
  const isAdmin = me.data?.role === 'admin'

  if (me.isLoading) return <div className="h-64 animate-pulse rounded-3xl bg-emerald-800/30" />
  if (!isAdmin) return <Navigate to="/contexts" replace />

  return (
    <div className="space-y-8">
      <div className="animate-rise">
        <h1 className="display text-3xl font-extrabold md:text-4xl">
          {t('admin.titleA')}<span className="text-lime-300">{t('admin.titleB')}</span> 🛡
        </h1>
        <p className="mt-2 text-emerald-100/70">{t('admin.subtitle')}</p>
      </div>
      <StatsBlock />
      <UsersTable myId={me.data!.id} />
    </div>
  )
}

function StatsBlock() {
  const { t } = useTranslation()
  const { data, error } = useQuery({ queryKey: ['admin', 'stats'], queryFn: adminApi.stats })
  const v = (n?: number) => (n === undefined ? '—' : n)
  const cards = [
    { icon: '👥', value: v(data?.total_users), label: t('admin.stats.users'),
      hint: data ? t('admin.stats.usersHint', { new7: data.new_users_7d, banned: data.banned_users }) : '' },
    { icon: '🔥', value: v(data?.active_users_7d), label: t('admin.stats.active7d'), hint: '' },
    { icon: '📝', value: v(data?.total_words), label: t('admin.stats.words'), hint: '' },
    { icon: '🃏', value: v(data?.training_sessions), label: t('admin.stats.trainings'),
      hint: data ? t('admin.stats.answers', { count: data.total_reviews }) : '' },
    { icon: '📖', value: v(data?.total_stories), label: t('admin.stats.stories'),
      hint: data ? t('admin.stats.stories30d', { count: data.stories_30d }) : '' },
  ]
  return (
    <section>
      {error && <p className="mb-3 text-red-300">{errorMessage(error)}</p>}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.icon} className="glass p-5 text-center">
            <div className="text-2xl">{c.icon}</div>
            <div className="display mt-1 text-2xl font-extrabold text-lime-300">{c.value}</div>
            <div className="text-xs text-emerald-100/60">{c.label}</div>
            {c.hint && <div className="mt-1 text-[11px] text-emerald-300/50">{c.hint}</div>}
          </div>
        ))}
      </div>
    </section>
  )
}

function UsersTable({ myId }: { myId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['admin', 'users'], queryFn: adminApi.users })
  const [q, setQ] = useState('')
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
    <th className="cursor-pointer select-none px-4 py-3 font-semibold hover:text-lime-300" onClick={() => toggleSort(key)}>
      {label} {sort.key === key ? (sort.desc ? '↓' : '↑') : ''}
    </th>
  )
  const actionError = ban.error ?? remove.error

  return (
    <section className="glass space-y-4 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className="display text-xl font-bold">
          {t('admin.users')} {data && <span className="text-lime-300">({rows.length}/{data.length})</span>}
        </h2>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.search')} className="field md:w-80" />
      </div>

      {error && <p className="text-red-300">{errorMessage(error)}</p>}
      {actionError && <p className="text-red-300">{t('admin.actionFailed', { error: errorMessage(actionError) })}</p>}
      {isLoading && <div className="h-40 animate-pulse rounded-2xl bg-emerald-800/30" />}

      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-emerald-300/70">
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
                  <tr key={u.id} className={`border-t border-emerald-400/10 ${u.is_banned ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-white">{u.email}</div>
                      <div className="font-mono text-[10px] text-emerald-300/50">{u.id}</div>
                    </td>
                    <td className="px-4 py-3 text-emerald-100/80">{fmt(u.created_at)}</td>
                    <td className="px-4 py-3 font-semibold text-lime-300">{u.words_count}</td>
                    <td className="px-4 py-3 text-emerald-100/80">{fmt(u.last_activity_at)}</td>
                    <td className="px-4 py-3">
                      {u.role === 'admin' && <span className="mr-1 rounded-full bg-lime-400/20 px-2 py-0.5 text-xs text-lime-200">admin</span>}
                      {u.is_banned
                        ? <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-200">{t('admin.banned')}</span>
                        : <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-xs text-emerald-200">{t('admin.active')}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {protectedUser ? (
                        <div className="text-right text-xs text-emerald-300/50">{self ? t('admin.you') : '—'}</div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <button type="button" disabled={busy} onClick={() => onBan(u)}
                            className="rounded-xl border border-amber-400/30 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-400/10 disabled:opacity-50">
                            {u.is_banned ? t('admin.unban') : t('admin.ban')}
                          </button>
                          <button type="button" disabled={busy} onClick={() => onDelete(u)}
                            className="rounded-xl border border-red-400/30 px-3 py-1.5 text-xs font-semibold text-red-200 transition hover:bg-red-500/15 disabled:opacity-50">
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
          {!rows.length && <p className="py-6 text-center text-emerald-100/60">{t('admin.nothingFound')}</p>}
        </div>
      )}
    </section>
  )
}
