import { useEffect, useReducer, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { profileApi, telegramApi, type Profile } from '../api/endpoints'
import { apiErrorInfo, errorMessage } from '../api/client'
import { formatPhoneInput, phoneForApi } from '../lib/phone'
import { isPolling, POLL_MS, tgInitial, tgReducer } from '../lib/telegramConnect'
import { ErrorState } from '../components/ErrorState'
import { toast } from '../components/Toaster'

/** The user's own profile: name, phone and the Telegram connection. Nothing else lives here. */
export function ProfilePage() {
  const { t } = useTranslation()
  const profile = useQuery({ queryKey: ['profile'], queryFn: profileApi.get })

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-[26px] font-bold tracking-[-0.02em] text-fg">{t('profile.title')}</h1>
      {profile.error ? <ErrorState error={profile.error} />
        : profile.data ? <ProfileForm profile={profile.data} />
        : <div className="glass h-64 animate-pulse" />}
    </div>
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

/**
 * Telegram: "Connect" asks the server for a deep link, opens the bot, and polls the profile every 3 s
 * (for up to a minute) until the bot has bound the account. Connected: "Connected · @username" and
 * "Disconnect".
 */
function TelegramRow() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [state, dispatch] = useReducer(tgReducer, tgInitial)
  const polling = isPolling(state)
  const profile = useQuery({ queryKey: ['profile'], queryFn: profileApi.get, refetchInterval: polling ? POLL_MS : false })
  const tg = profile.data?.telegram
  const connected = !!tg?.connected

  useEffect(() => { if (connected) dispatch({ type: 'connected' }) }, [connected])
  // The minute of waiting runs out even when the profile answers the same thing every time.
  useEffect(() => {
    if (!polling) return
    const id = window.setInterval(() => dispatch({ type: 'tick', at: Date.now() }), 1000)
    return () => window.clearInterval(id)
  }, [polling])

  const link = useMutation({
    mutationFn: telegramApi.link,
    onMutate: () => dispatch({ type: 'link' }),
    onSuccess: ({ url }) => {
      window.open(url, '_blank', 'noopener')
      dispatch({ type: 'linked', url, at: Date.now() })
    },
    onError: (err) => dispatch({ type: 'failed', unavailable: apiErrorInfo(err).code === 'telegram_unavailable' }),
  })
  const unlink = useMutation({
    mutationFn: telegramApi.unlink,
    onSuccess: () => {
      qc.setQueryData<Profile>(['profile'], (p) => p && { ...p, telegram: { connected: false, username: null } })
      dispatch({ type: 'disconnected' })
    },
  })

  const check = () => {
    dispatch({ type: 'check', at: Date.now() })
    void profile.refetch()
  }
  const disconnect = () => {
    if (window.confirm(t('profile.telegramDisconnectConfirm'))) unlink.mutate()
  }
  const unavailable = state.status === 'unavailable'
  const waitingUrl = state.status === 'waiting' || state.status === 'timeout' ? state.url : null
  const error = (link.error && !unavailable ? link.error : null) ?? unlink.error

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-muted">{t('profile.telegram')}</div>
          <div data-testid="profile-telegram" className="mt-0.5 text-fg">
            {connected
              ? [t('profile.telegramConnected'), tg?.username && `@${tg.username}`].filter(Boolean).join(' · ')
              : t('profile.telegramNotConnected')}
          </div>
        </div>
        {connected
          ? <button type="button" className="btn-ghost" disabled={unlink.isPending} onClick={disconnect}>{t('profile.telegramDisconnect')}</button>
          : <button type="button" className="btn-ghost" disabled={unavailable || link.isPending || profile.isLoading}
              onClick={() => link.mutate()}>{t('profile.telegramConnect')}</button>}
      </div>
      {!connected && unavailable && <p role="status" className="text-sm text-muted">{t('profile.telegramUnavailable')}</p>}
      {!connected && waitingUrl && (
        <div role="status" data-testid="telegram-waiting" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm">
          <span className="text-fg">{t('profile.telegramWaiting')}</span>
          <span className="flex gap-2">
            {/* If the browser blocked the new tab, the link opens the bot. */}
            <a href={waitingUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost !px-3 !py-1.5">{t('profile.telegramOpenBot')}</a>
            <button type="button" className="btn-ghost !px-3 !py-1.5" onClick={check}>{t('profile.telegramCheck')}</button>
          </span>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{errorMessage(error)}</p>}
    </div>
  )
}
