import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Camera, ChevronLeft, Languages, Loader2, Repeat } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { authApi, type LearningLang } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { LearningLanguagePicker } from '../components/LearningLanguagePicker'
import { TelegramIcon, TelegramLoginButton } from '../components/TelegramLoginButton'
import { Toaster } from '../components/Toaster'
import { useTelegramLogin } from '../lib/telegramLogin'
import { Logo } from '../components/Logo'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { ContactLinks } from '../components/ContactLinks'
import { PasswordField } from '../components/PasswordField'
import { InAppBanner } from '../components/InAppBanner'

// German words are learning content (not translated); only their glosses come from i18n.
const floating = [
  { w: 'Fernweh', c: 'left-[6%] top-[14%]', d: '0s' },
  { w: 'Gemütlich', c: 'right-[8%] top-[20%]', d: '1.5s' },
  { w: 'Schmetterling', c: 'left-[10%] bottom-[16%]', d: '3s' },
  { w: 'Feierabend', c: 'right-[6%] bottom-[12%]', d: '2s' },
]

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { t } = useTranslation()
  const isLogin = mode === 'login'
  const navigate = useNavigate()
  const location = useLocation()
  // Where to go after signing in (e.g. a shared-folder link /s/:token); kept when switching login ↔ register.
  const fromLoc = (location.state as { from?: { pathname: string; search?: string } } | null)?.from
  const from = fromLoc ? fromLoc.pathname + (fromLoc.search ?? '') : '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [learningLang, setLearningLang] = useState<LearningLang>('de')
  const [localError, setLocalError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => isLogin
      ? authApi.login({ email, password })
      : authApi.register({ email, password, learning_language: learningLang }),
    onSuccess: () => navigate(from, { replace: true }),
  })
  // Sign in (and up) with Telegram: a new account chooses its learning language on /welcome.
  const tg = useTelegramLogin((newUser) => navigate(newUser ? '/welcome' : from, { replace: true }))

  function submit(e: FormEvent) {
    e.preventDefault()
    setLocalError(null)
    if (password.length < 8) return setLocalError(t('auth.passwordTooShort'))
    if (!isLogin && password !== confirm) return setLocalError(t('auth.passwordsMismatch'))
    mutation.mutate()
  }

  const error = localError ?? (mutation.error
    ? ((mutation.error as { response?: { status?: number } }).response?.status === 403
      ? t('auth.banned')
      : errorMessage(mutation.error))
    : null)

  return (
    <>
    <InAppBanner />
    <div className="relative flex min-h-screen flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <header className="relative z-10 flex items-center justify-between gap-3 px-4 pt-[calc(env(safe-area-inset-top)+12px)]">
        <Logo />
        <LanguageSwitcher sync={false} />
      </header>
      {floating.map((f) => (
        <div key={f.w} style={{ animationDelay: f.d }}
          className={`animate-float glass pointer-events-none absolute hidden px-5 py-3 lg:block ${f.c}`}>
          <div className="font-serif font-medium text-accent-text">{f.w}</div>
          <div className="text-xs text-muted">{t(`auth.floating.${f.w}`)}</div>
        </div>
      ))}

      <main className="flex flex-1 items-center justify-center px-4 py-5 md:py-12">
      <div className="grid w-full max-w-5xl items-center gap-5 md:grid-cols-2 md:gap-10">
        <div className="space-y-6 text-center md:text-left">
          <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-fg md:text-5xl">
            {t('auth.heroTitle1')}<span className="text-accent-text">{t('auth.heroTitleAccent')}</span>{t('auth.heroTitle2')}
          </h1>
          {/* Phones show just the title: the form must start on the first screen. */}
          <p className="hidden text-lg text-muted md:block">{t('auth.heroText')}</p>
          <ul className="hidden flex-col gap-2.5 text-left text-muted md:inline-flex">
            {[[Camera, t('auth.badgeTranslation')], [Languages, t('auth.badgeTranscription')], [Repeat, t('auth.badgeAudio')]].map(([Icon, text]) => {
              const I = Icon as typeof Camera
              return (
                <li key={text as string} className="flex items-center gap-3 text-[15px]">
                  <I size={18} aria-hidden="true" className="shrink-0 text-accent-text" />{text as string}
                </li>
              )
            })}
          </ul>
        </div>

        <div className="space-y-4">
        {tg.waiting ? (
          <section className="glass relative space-y-5 p-5 pt-14 text-center md:p-8 md:pt-14" aria-labelledby="telegram-wait-title" data-testid="telegram-waiting">
            <button type="button" onClick={tg.back} aria-label={t('auth.back')}
              className="absolute left-3 top-3 grid h-10 w-10 place-items-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-fg">
              <ChevronLeft size={22} aria-hidden="true" />
            </button>
            <div className="mx-auto grid h-[72px] w-[72px] place-items-center rounded-full bg-telegram text-on-telegram">
              <TelegramIcon size={34} />
            </div>
            <div className="space-y-2">
              <h2 id="telegram-wait-title" className="text-2xl font-bold text-fg">{t('auth.telegramWaitTitle')}</h2>
              <p className="text-sm text-muted">{t('auth.telegramWaitText', { bot: tg.bot })}</p>
            </div>
            <p role="status" className="flex items-center justify-center gap-2 text-sm font-semibold text-fg">
              <Loader2 size={16} aria-hidden="true" className="animate-spin text-accent-text" />{t('auth.telegramWaiting')}
            </p>
            <TelegramLoginButton status={tg.status} url={tg.url} label={t('auth.telegramAgain')} onOpen={tg.opened} onRetry={tg.retry} />
            <p className="text-xs text-faint">{t('auth.telegramLinkLife')}</p>
          </section>
        ) : (
        <form onSubmit={submit} className="glass space-y-4 p-5 md:p-8">
          <h2 className="text-2xl font-bold text-fg">{isLogin ? t('auth.welcomeBack') : t('auth.createAccount')}</h2>
          <p className="text-sm text-muted">
            {isLogin ? t('auth.loginSubtitle') : t('auth.registerSubtitle')}
          </p>
          {tg.status !== 'unavailable' && (
            <div className="space-y-4">
              <TelegramLoginButton status={tg.status} url={tg.url} label={t('auth.telegramLogin')} onOpen={tg.opened} onRetry={tg.retry} />
              {tg.expired && <p role="status" className="text-center text-sm text-muted">{t('auth.telegramExpired')}</p>}
              <div className="flex items-center gap-3" aria-hidden="true">
                <span className="h-px flex-1 bg-line" />
                <span className="text-[13px] text-faint">{t('auth.or')}</span>
                <span className="h-px flex-1 bg-line" />
              </div>
            </div>
          )}
          {!isLogin && <LearningLanguagePicker value={learningLang} onChange={setLearningLang} />}
          <input className="field" type="email" placeholder={t('auth.email')} autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <PasswordField placeholder={t('auth.password')} autoComplete={isLogin ? 'current-password' : 'new-password'}
            value={password} onChange={setPassword} />
          {!isLogin && (
            <PasswordField placeholder={t('auth.confirmPassword')} autoComplete="new-password"
              value={confirm} onChange={setConfirm} />
          )}
          {error && (
            <p className="rounded-xl border border-danger bg-surface-2 px-4 py-2 text-sm text-danger">{error}</p>
          )}
          <button type="submit" disabled={mutation.isPending} className="btn-primary w-full">
            {mutation.isPending ? t('auth.wait') : isLogin ? t('auth.login') : t('auth.register')}
          </button>
          <p className="text-center text-sm text-muted">
            {isLogin ? t('auth.noAccount') : t('auth.haveAccount')}
            <Link to={isLogin ? '/register' : '/login'} state={location.state} className="font-semibold text-accent-text hover:underline">
              {isLogin ? t('auth.registerLink') : t('auth.loginLink')}
            </Link>
          </p>
          {tg.status !== 'unavailable' && <p className="text-center text-sm text-muted">{t('auth.telegramNewHint')}</p>}
        </form>
        )}
        <p className="text-center text-sm text-muted">{t('contact.loginProblem')} <ContactLinks /></p>
        </div>
      </div>
      </main>
    </div>
    <Toaster />
    </>
  )
}
