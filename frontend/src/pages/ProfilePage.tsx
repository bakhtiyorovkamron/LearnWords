import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { profileApi, type Profile } from '../api/endpoints'
import { apiErrorInfo, errorMessage } from '../api/client'
import { formatPhoneInput, phoneForApi } from '../lib/phone'
import { useTelegramConnect } from '../lib/telegramConnect'
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
    </div>
  )
}
