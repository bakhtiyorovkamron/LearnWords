import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { adminApi, type AdminUser, type FeatureState } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { dateLocale } from '../i18n'
import { toast } from './Toaster'

/** Card of one user in the admin panel: facts about the account and the per-user features. */
export function AdminUserModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const { t } = useTranslation()
  const features = useQuery({ queryKey: ['admin', 'user-features', user.id], queryFn: () => adminApi.userFeatures(user.id) })
  const date = (iso: string) => new Date(iso).toLocaleDateString(dateLocale())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="admin-user-title"
        className="glass max-h-[90vh] w-full max-w-xl space-y-5 overflow-y-auto p-6 text-left">
        <div>
          <h2 id="admin-user-title" className="display break-all text-xl font-extrabold">{user.email}</h2>
          <div className="mt-2 space-y-0.5 text-sm text-emerald-100/70">
            <p>{t('admin.userCard.registered', { date: date(user.created_at) })}</p>
            <p>{t('admin.userCard.words', { n: user.words_count })}</p>
            {user.rating ? <p>{t('admin.feedback.userRating', { rating: user.rating })}</p> : null}
            <p>{t('admin.userCard.lastActive', { date: user.last_activity_at ? date(user.last_activity_at) : t('admin.userCard.never') })}</p>
          </div>
        </div>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-100/60">{t('admin.userCard.features')}</h3>
          {features.isLoading && <div className="h-24 animate-pulse rounded-2xl bg-emerald-800/30" />}
          {features.error && <p className="text-sm text-red-300">{errorMessage(features.error)}</p>}
          {features.data?.map((f) => <FeatureRow key={f.feature} userId={user.id} state={f} />)}
        </section>

        <div className="flex justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>{t('admin.userCard.close')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function FeatureRow({ userId, state }: { userId: string; state: FeatureState }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const hasLimit = state.default_limit !== null
  const shown = state.limit_override === null ? '' : String(state.limit_override)
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])

  // The row always shows the server's state, so a failed save simply leaves (or restores) the old one.
  const save = useMutation({
    mutationFn: (body: { enabled: boolean; daily_limit: number | null }) => adminApi.setUserFeature(userId, state.feature, body),
    onSuccess: (updated) => {
      qc.setQueryData<FeatureState[]>(['admin', 'user-features', userId], (old) =>
        old?.map((x) => (x.feature === updated.feature ? updated : x)))
      toast(t('admin.userCard.saved'))
    },
    onError: () => setDraft(shown),
  })

  function commitLimit() {
    const raw = draft.trim()
    const n = raw === '' ? null : Number(raw)
    if (n !== null && (!Number.isInteger(n) || n < 0)) { setDraft(shown); return }
    if (n === state.limit_override) return
    save.mutate({ enabled: state.enabled, daily_limit: n })
  }

  return (
    <div className="space-y-1 rounded-2xl bg-emerald-900/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">{t(`features.${state.feature}`)}</span>
        <button type="button" role="switch" aria-checked={state.enabled} aria-label={t(`features.${state.feature}`)}
          disabled={save.isPending}
          onClick={() => save.mutate({ enabled: !state.enabled, daily_limit: state.limit_override })}
          className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60 ${state.enabled ? 'bg-lime-400' : 'bg-emerald-950/80 ring-1 ring-emerald-400/30'}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${state.enabled ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
      {hasLimit && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <input type="number" min={0} step={1} className="field !w-28 !py-1.5" value={draft}
            aria-label={t('admin.userCard.limit')}
            placeholder={t('admin.userCard.limitDefault', { n: state.default_limit })}
            onChange={(e) => setDraft(e.target.value)} onBlur={commitLimit}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
          <span className="text-emerald-100/60">{t('admin.userCard.usedToday', { used: state.used_today })}</span>
        </div>
      )}
      {save.error && <p role="alert" className="text-sm text-red-300">{errorMessage(save.error)}</p>}
    </div>
  )
}
