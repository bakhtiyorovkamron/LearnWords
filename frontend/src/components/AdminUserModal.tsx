import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Camera, Languages, Palette, Search, Send, Star, type LucideIcon } from 'lucide-react'
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="admin-user-title"
        className="glass max-h-[90vh] w-full max-w-xl space-y-5 overflow-y-auto p-6 text-left">
        <div>
          <h2 id="admin-user-title" className="break-all text-xl font-bold text-fg">{user.email}</h2>
          <div className="mt-2 space-y-0.5 text-sm text-muted">
            <p>{t('admin.userCard.registered', { date: date(user.created_at) })}</p>
            <p>{t('admin.userCard.words', { n: user.words_count })}</p>
            {user.rating ? <p className="flex items-center gap-1.5">{t('admin.feedback.userRating', { rating: user.rating })}<Stars rating={user.rating} /></p> : null}
            <PushLine user={user} />
            <p>{t('admin.userCard.lastActive', { date: user.last_activity_at ? date(user.last_activity_at) : t('admin.userCard.never') })}</p>
          </div>
        </div>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">{t('admin.userCard.features')}</h3>
          {features.isLoading && <div className="h-24 animate-pulse rounded-2xl bg-surface-2" />}
          {features.error && <p className="text-sm text-danger">{errorMessage(features.error)}</p>}
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

const FEATURE_ICON: Record<string, LucideIcon> = {
  photo_import: Camera, daily_story: BookOpen, word_search: Search, story_autotranslate: Languages, theme_picker: Palette,
}

/** Five stars, `rating` of them filled; the number is in the aria-label. */
export function Stars({ rating }: { rating: number }) {
  return (
    <span role="img" aria-label={`${rating} / 5`} className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={14} aria-hidden="true" data-filled={n <= rating} className={n <= rating ? 'fill-current text-streak' : 'text-dot-off'} />
      ))}
    </span>
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
    <div className="space-y-1 rounded-2xl bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 font-semibold text-fg">
          {(() => { const I = FEATURE_ICON[state.feature]; return I ? <I size={18} aria-hidden="true" className="shrink-0 text-accent-text" /> : null })()}
          {t(`features.${state.feature}`)}
        </span>
        <button type="button" role="switch" aria-checked={state.enabled} aria-label={t(`features.${state.feature}`)}
          disabled={save.isPending}
          onClick={() => save.mutate({ enabled: !state.enabled, daily_limit: state.limit_override })}
          className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60 ${state.enabled ? 'bg-accent' : 'bg-dot-off'}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${state.enabled ? 'left-[22px] bg-on-accent' : 'left-0.5 bg-surface'}`} />
        </button>
      </div>
      {hasLimit && (
        <>
          <p data-testid={`usage-${state.feature}`} className="text-sm text-fg">
            <strong>{t('admin.userCard.usedOf', { used: state.used_today, limit: state.daily_limit ?? state.default_limit })}</strong>
            <span className="text-muted"> · {t(state.limit_override === null ? 'admin.userCard.sourceDefault' : 'admin.userCard.sourceCustom')}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor={`limit-${state.feature}`} className="text-muted">{t('admin.userCard.limit')}</label>
            <input id={`limit-${state.feature}`} type="number" min={0} step={1} className="field !w-24 !py-1.5" value={draft}
              placeholder={String(state.default_limit)}
              onChange={(e) => setDraft(e.target.value)} onBlur={commitLimit}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
            {state.limit_override !== null && (
              <button type="button" className="btn-ghost !px-3 !py-1 text-xs" disabled={save.isPending}
                onClick={() => save.mutate({ enabled: state.enabled, daily_limit: null })}>
                {t('admin.userCard.reset')}
              </button>
            )}
          </div>
        </>
      )}
      {save.error && <p role="alert" className="text-sm text-danger">{errorMessage(save.error)}</p>}
    </div>
  )
}

// Fixed test text: only for checking that notifications reach this user's devices.
const TEST_PUSH = { title: 'yodla', body: 'Test notification' }

function PushLine({ user }: { user: AdminUser }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const send = useMutation({
    mutationFn: () => adminApi.sendPush({ target: 'users', user_ids: [user.id], ...TEST_PUSH }),
    onSuccess: (r) => {
      toast(t('admin.push.result', { ...r }))
      void qc.invalidateQueries({ queryKey: ['admin'] })
    },
  })
  const n = user.push_devices ?? 0
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p>{t('admin.userCard.pushDevices', { n })}</p>
      {n > 0 && (
        <button type="button" className="btn-ghost !px-3 !py-1 text-xs" disabled={send.isPending} onClick={() => send.mutate()}>
          <Send size={12} aria-hidden="true" />{t('admin.userCard.sendTest')}
        </button>
      )}
      {send.error && <span role="alert" className="text-xs text-danger">{errorMessage(send.error)}</span>}
    </div>
  )
}
