import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { meApi, profileApi, type LearningLang } from '../api/endpoints'
import { apiErrorInfo, errorMessage } from '../api/client'
import { LearningLanguagePicker } from '../components/LearningLanguagePicker'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { Logo } from '../components/Logo'

/**
 * /welcome: the one question of an account created by Telegram — the language it learns. No app
 * shell around it; the app sends every page here until it is answered (Layout).
 */
export function WelcomePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: meApi.get, staleTime: 5 * 60_000 })
  const profile = useQuery({ queryKey: ['profile'], queryFn: profileApi.get, staleTime: 5 * 60_000 })
  const [lang, setLang] = useState<LearningLang>('de')

  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['me'] })
    navigate('/', { replace: true })
  }
  const save = useMutation({
    mutationFn: () => meApi.setLearningLanguage(lang),
    onSuccess: done,
    // Answered already (another tab): nothing to ask any more.
    onError: (err) => { if (apiErrorInfo(err).code === 'language_chosen') void done() },
  })

  if (me.data && !me.data.needs_language && !save.isPending) return <Navigate to="/" replace />

  const name = profile.data?.full_name?.trim() || (profile.data?.telegram.username ? `@${profile.data.telegram.username}` : '')
  const error = save.error && apiErrorInfo(save.error).code !== 'language_chosen' ? errorMessage(save.error) : null

  return (
    <div className="flex min-h-screen flex-col pb-[env(safe-area-inset-bottom)]">
      <header className="flex items-center justify-between gap-3 px-4 pt-[calc(env(safe-area-inset-top)+12px)]">
        <Logo />
        <LanguageSwitcher />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-6">
        <form className="glass w-full max-w-md space-y-5 p-5 md:p-8" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <div className="grid h-14 w-14 place-items-center rounded-full bg-accent text-on-accent" data-testid="welcome-badge">
            <Check size={28} strokeWidth={2.6} aria-hidden="true" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-2xl font-bold text-fg">{t('welcome.title', { name })}</h1>
            <p className="text-sm text-muted">{t('welcome.text')}</p>
          </div>
          <LearningLanguagePicker value={lang} onChange={setLang} />
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <button type="submit" className="btn-primary w-full" disabled={save.isPending || !me.data}>{t('welcome.start')}</button>
        </form>
      </main>
    </div>
  )
}
