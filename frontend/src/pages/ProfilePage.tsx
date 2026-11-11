import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, LifeBuoy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { profileApi, telegramApi, type Profile } from '../api/endpoints'
import { apiErrorInfo, errorMessage } from '../api/client'
import { formatPhoneInput, phoneForApi } from '../lib/phone'
import { useTelegramConnect } from '../lib/telegramConnect'
import { formatUZS } from '../lib/money'
import { usePurchaseOverview } from '../lib/purchases'
import { ErrorState } from '../components/ErrorState'
import { StatusPill } from '../components/PurchaseChat'
import { toast } from '../components/Toaster'
import { UnreadBadge } from '../components/UnreadBadge'
import { useChatUnread } from '../lib/chatUnread'

/** The user's own profile: name, phone, the Telegram connection, support and their purchase requests. */
export function ProfilePage() {
  const { t } = useTranslation()
  const profile = useQuery({ queryKey: ['profile'], queryFn: profileApi.get })
  const unreadSupport = useChatUnread().data?.support ?? 0

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-[26px] font-bold tracking-[-0.02em] text-fg">{t('profile.title')}</h1>
      {profile.error ? <ErrorState error={profile.error} />
        : profile.data ? <ProfileForm profile={profile.data} />
        : <div className="glass h-64 animate-pulse" />}
      <Link to="/support" data-testid="support-entry" className="glass flex items-center gap-3 p-5 transition hover:text-accent-text">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-accent-text"><LifeBuoy size={20} aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-fg">{t('support.entry')}</span>
          <span className="block text-sm text-muted">{t('support.entryHint')}</span>
        </span>
        <UnreadBadge count={unreadSupport} testId="badge-support" />
        <ChevronRight size={18} aria-hidden="true" className="text-faint" />
      </Link>
      <MyRequests />
    </div>
  )
}

/**
 * The user's latest purchase requests, each opening its chat with the admins. Nothing when there
 * are none, or buying is off on this server.
 */
function MyRequests() {
  const { t, i18n } = useTranslation()
  const requests = usePurchaseOverview().data?.requests ?? []
  const unread = useChatUnread().data?.purchases ?? []
  if (requests.length === 0) return null
  return (
    <section className="glass space-y-2 p-5" aria-labelledby="my-requests-title">
      <h2 id="my-requests-title" className="text-lg font-bold text-fg">{t('chat.myRequests')}</h2>
      <ul className="divide-y divide-divider">
        {requests.map((r) => (
          <li key={r.id}>
            <Link to={`/purchases/${r.id}`} data-testid={`my-request-${r.id}`}
              className="flex items-center justify-between gap-3 py-3 text-sm transition hover:text-accent-text">
              <span className="min-w-0 text-muted">
                <span className="font-mono font-semibold text-fg">{r.code}</span>
                {' · '}{t('buy.pack', { n: r.amount })}{' · '}{formatUZS(r.price_uzs, i18n.language)}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <UnreadBadge count={unread.find((u) => u.id === r.id)?.unread ?? 0} testId={`badge-request-${r.id}`} /><StatusPill status={r.status} /><ChevronRight size={16} aria-hidden="true" className="text-faint" /></span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Mounted once the profile is loaded, so the fields start from the saved values and a late answer
// never overwrites what the user has already typed.
function ProfileForm({ profile }: { profile: Profile }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [name, setName] = useState(profile.full_name ?? '')
  const [phone, setPhone] = useState(formatPhoneInput(profile.phone ?? ''))

  const save = useMutation({
    mutationFn: () => profileApi.update({ full_name: name.trim(), phone: phoneForApi(phone) }),
    onSuccess: (p) => {
      qc.setQueryData(['profile'], p)
      toast(t('profile.saved'))
    },
  })

  // The server's codes say which field is wrong.
  const code = save.error ? apiErrorInfo(save.error).code : undefined
  const nameError = code === 'invalid_name' ? t('errors.invalid_name') : null
  const phoneError = code === 'invalid_phone' ? t('errors.invalid_phone') : null
  const otherError = save.error && !nameError && !phoneError ? errorMessage(save.error) : null

  return (
    <form className="glass space-y-5 p-5" noValidate
      onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <div>
        <label htmlFor="profile-name" className="mb-1.5 block text-sm font-medium text-muted">{t('profile.name')}</label>
        <input id="profile-name" className="field" type="text" autoComplete="name" maxLength={80}
          value={name} onChange={(e) => { setName(e.target.value); save.reset() }}
          aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? 'profile-name-error' : undefined} />
        {nameError && <p id="profile-name-error" role="alert" className="mt-1.5 text-sm text-danger">{nameError}</p>}
      </div>

      <div>
        <label htmlFor="profile-phone" className="mb-1.5 block text-sm font-medium text-muted">
          {t('profile.phone')} <span className="font-normal text-faint">· {t('profile.phoneHint')}</span>
        </label>
        <input id="profile-phone" className="field" type="tel" inputMode="tel" autoComplete="tel" placeholder="+998 90 123 45 67"
          value={phone} onChange={(e) => { setPhone(formatPhoneInput(e.target.value)); save.reset() }}
          aria-invalid={phoneError ? true : undefined} aria-describedby={phoneError ? 'profile-phone-error' : undefined} />
        {phoneError && <p id="profile-phone-error" role="alert" className="mt-1.5 text-sm text-danger">{phoneError}</p>}
      </div>

      <TelegramRow />

      {otherError && <p role="alert" className="text-sm text-danger">{otherError}</p>}
      <button type="submit" className="btn-primary w-full" disabled={save.isPending}>{t('profile.save')}</button>
    </form>
  )
}

/** Telegram: "Connect" opens the bot at once and waits for it; connected: "Connected · @username". */
function TelegramRow() {
  const { t } = useTranslation()
  const tg = useTelegramConnect()

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-muted">{t('profile.telegram')}</div>
          <div data-testid="profile-telegram" className="mt-0.5 text-fg">
            {tg.connected
              ? [t('profile.telegramConnected'), tg.username && `@${tg.username}`].filter(Boolean).join(' · ')
              : t('profile.telegramNotConnected')}
          </div>
        </div>
        {!tg.connected && (
          <button type="button" className="btn-ghost" disabled={tg.unavailable || tg.pending || tg.loading}
            onClick={() => void tg.connect()}>{t('profile.telegramConnect')}</button>
        )}
      </div>
      {!tg.connected && tg.unavailable && <p role="status" className="text-sm text-muted">{t('profile.telegramUnavailable')}</p>}
      {!tg.connected && tg.waiting && <p role="status" data-testid="telegram-waiting" className="text-sm text-muted">{t('profile.telegramWaiting')}</p>}
      {tg.error && <p role="alert" className="text-sm text-danger">{errorMessage(tg.error)}</p>}
      {tg.connected && <NotificationsSwitch />}
    </div>
  )
}

/**
 * "News and reminders in Telegram": the user's own switch for broadcasts (the bot's /stop and /resume do
 * the same). Support and order messages are not affected. Optimistic: it flips at once and goes back on an error.
 */
function NotificationsSwitch() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const profile = useQuery({ queryKey: ['profile'], queryFn: profileApi.get })
  const on = profile.data?.telegram.notifications ?? true
  const set = useMutation({
    mutationFn: (enabled: boolean) => telegramApi.setNotifications(enabled),
    onMutate: async (enabled) => {
      await qc.cancelQueries({ queryKey: ['profile'] })
      const previous = qc.getQueryData<Profile>(['profile'])
      qc.setQueryData<Profile>(['profile'], (p) => (p ? { ...p, telegram: { ...p.telegram, notifications: enabled } } : p))
      return { previous }
    },
    onError: (_e, _v, ctx) => { if (ctx?.previous) qc.setQueryData(['profile'], ctx.previous) },
  })
  return (
    <div>
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="text-sm font-medium text-fg">{t('profile.telegramNotifications')}</span>
        <input type="checkbox" role="switch" checked={on} onChange={(e) => set.mutate(e.target.checked)}
          className="h-5 w-5 shrink-0 accent-[var(--accent)]" />
      </label>
      {set.error && <p role="alert" className="mt-1.5 text-sm text-danger">{errorMessage(set.error)}</p>}
    </div>
  )
}
