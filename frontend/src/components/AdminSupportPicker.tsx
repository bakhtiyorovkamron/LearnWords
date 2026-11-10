import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminUser } from '../api/endpoints'
import { ChatAvatar } from './ChatThread'
import { Sheet } from './Sheet'

const digits = (s: string) => s.replace(/\D/g, '')

/** Users matching the query by name, email or phone (case-insensitive; a phone also by its digits). */
export function filterUsers(users: AdminUser[], query: string): AdminUser[] {
  const q = query.trim().toLowerCase()
  if (!q) return users
  const d = digits(q)
  return users.filter((u) =>
    (u.full_name ?? '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q) ||
    (u.phone ?? '').toLowerCase().includes(q) || (d !== '' && digits(u.phone ?? '').includes(d)))
}

/**
 * "Who to write to": any user, even one who has not written yet. A sheet on phones, a dialog on
 * desktops. withThread: the ids of the users that already have a conversation in the inbox.
 */
export function AdminSupportPicker({ users, loading, withThread, onPick, onClose }: {
  users: AdminUser[] | undefined
  loading: boolean
  withThread: Set<string>
  onPick: (userId: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const rows = useMemo(() => filterUsers(users ?? [], q), [users, q])

  return (
    <Sheet label={t('support.pickTitle')} onClose={onClose}>
      <div>
        <h2 className="text-lg font-bold text-fg">{t('support.pickTitle')}</h2>
        <p className="text-sm text-muted">{t('support.pickHint')}</p>
      </div>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus
        placeholder={t('support.pickSearch')} aria-label={t('support.pickSearch')}
        className="field mt-3 text-base" />
      <ul className="mt-2 divide-y divide-divider">
        {rows.map((u) => (
          <li key={u.id}>
            <button type="button" onClick={() => onPick(u.id)} data-testid={`pick-user-${u.id}`}
              className="flex w-full items-center gap-3 py-2.5 text-left transition hover:bg-surface-2">
              <ChatAvatar className="h-10 w-10 text-base">{(u.full_name || u.email).charAt(0).toUpperCase()}</ChatAvatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-fg">{u.full_name || u.email}</span>
                <span className="block truncate text-xs text-muted">
                  {withThread.has(u.id) ? t('support.pickHasThread') : t('support.pickNoThread')}
                </span>
              </span>
              {u.is_banned && <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-danger">{t('admin.banned')}</span>}
            </button>
          </li>
        ))}
      </ul>
      {loading && <div className="mt-2 h-16 animate-pulse rounded-2xl bg-surface-2" />}
      {!loading && rows.length === 0 && <p className="py-6 text-center text-sm text-muted">{t('support.pickEmpty')}</p>}
    </Sheet>
  )
}
