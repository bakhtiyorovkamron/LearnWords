import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Camera, Languages, Repeat } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { authApi, LEARNING_LANGS, type LearningLang } from '../api/endpoints'
import { errorMessage } from '../api/client'
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <div className="absolute right-4 top-4 z-10"><LanguageSwitcher sync={false} /></div>
      {floating.map((f) => (
        <div key={f.w} style={{ animationDelay: f.d }}
          className={`animate-float glass pointer-events-none absolute hidden px-5 py-3 lg:block ${f.c}`}>
          <div className="font-serif font-medium text-accent-text">{f.w}</div>
          <div className="text-xs text-muted">{t(`auth.floating.${f.w}`)}</div>
        </div>
      ))}

      <div className="grid w-full max-w-5xl items-center gap-10 md:grid-cols-2">
        <div className="space-y-6 text-center md:text-left">
          <div className="flex justify-center md:justify-start"><Logo /></div>
          <h1 className="text-4xl font-bold leading-tight tracking-[-0.02em] text-fg md:text-5xl">
            {t('auth.heroTitle1')}<span className="text-accent-text">{t('auth.heroTitleAccent')}</span>{t('auth.heroTitle2')}
          </h1>
          <p className="text-lg text-muted">{t('auth.heroText')}</p>
          <ul className="inline-flex flex-col gap-2.5 text-left text-muted">
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
        <form onSubmit={submit} className="glass space-y-4 p-6 md:p-8">
          <h2 className="text-2xl font-bold text-fg">{isLogin ? t('auth.welcomeBack') : t('auth.createAccount')}</h2>
          <p className="text-sm text-muted">
            {isLogin ? t('auth.loginSubtitle') : t('auth.registerSubtitle')}
          </p>
          <input className="field" type="email" placeholder={t('auth.email')} autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <PasswordField placeholder={t('auth.password')} autoComplete={isLogin ? 'current-password' : 'new-password'}
            value={password} onChange={setPassword} />
          {!isLogin && (
            <PasswordField placeholder={t('auth.confirmPassword')} autoComplete="new-password"
              value={confirm} onChange={setConfirm} />
          )}
          {!isLogin && (
            <fieldset className="space-y-2">
              <legend className="text-sm text-muted">{t('auth.learningLanguage')}</legend>
              <div className="grid grid-cols-2 gap-2">
                {LEARNING_LANGS.map((l) => (
                  <button key={l.code} type="button" onClick={() => setLearningLang(l.code)}
                    aria-pressed={learningLang === l.code}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition ${
                      learningLang === l.code
                        ? 'border-accent bg-surface-2 text-fg'
                        : 'border-line text-muted hover:text-fg'}`}>
                    <span className="text-lg">{l.flag}</span>
                    <span className="font-semibold">{l.name}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-faint">{t('auth.learningLanguageHint')}</p>
            </fieldset>
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
        </form>
        <p className="text-center text-sm text-muted">{t('contact.loginProblem')} <ContactLinks /></p>
        </div>
      </div>
    </div>
    </>
  )
}
