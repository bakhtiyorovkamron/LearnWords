import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { authApi, meApi } from '../api/endpoints'
import { StageUpOverlay } from './StageUpOverlay'
import { HeroIntroOverlay } from './HeroIntroOverlay'
import { InstallBanner, InstallMenuItem } from './InstallPrompt'
import { LanguageSwitcher } from './LanguageSwitcher'
import { Toaster } from './Toaster'
import { ContactLinks } from './ContactLinks'
import { CONTACT, EXTERNAL_LINK } from '../lib/contact'
import { useLearningLang } from '../lib/learningLang'
import { useFeatures } from '../lib/features'
import { isTrainingOpen } from '../lib/trainingState'
import { FeedbackModal } from './FeedbackModal'
import { InAppBanner } from './InAppBanner'

export const FEEDBACK_DELAY_MS = 3000

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-xl px-4 py-2 text-sm font-semibold transition ${
    isActive
      ? 'bg-lime-400 text-emerald-950 shadow-lg shadow-lime-400/30'
      : 'text-emerald-100/80 hover:bg-emerald-400/10 hover:text-white'
  }`

// Bottom navigation item (phones, below 768px).
const tab = (isActive: boolean) =>
  `flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold leading-tight transition ${
    isActive ? 'text-lime-300' : 'text-emerald-100/60 active:text-white'
  }`

// "More" sheet row.
const sheetLink = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-2xl px-4 py-3 font-semibold transition ${
    isActive ? 'bg-lime-400/15 text-lime-300' : 'text-emerald-50 hover:bg-emerald-400/10'
  }`

export function Logo() {
  return (
    <span className="display flex items-center gap-2 text-xl font-extrabold tracking-tight">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-lime-300 to-emerald-500 text-emerald-950 shadow-lg shadow-emerald-500/40">
        y
      </span>
      <span>
        yod<span className="text-lime-300">la</span>
      </span>
    </span>
  )
}

export function Layout() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const qc = useQueryClient()
  // Only decides whether to show the link; the backend checks the role on every /api/admin request.
  const me = useQuery({ queryKey: ['me'], queryFn: meApi.get, staleTime: 5 * 60_000 })
  const isAdmin = me.data?.role === 'admin'
  const learning = useLearningLang()
  const { isOn } = useFeatures()
  const searchOn = isOn('word_search')
  const [moreOpen, setMoreOpen] = useState(false)

  // The one-time rating window: 3 seconds after the page loads, and never in the middle of a training.
  const [feedbackDue, setFeedbackDue] = useState(false)
  const askFeedback = me.data?.ask_feedback === true
  useEffect(() => {
    if (!askFeedback) return
    let poll: ReturnType<typeof setInterval> | undefined
    const timer = setTimeout(() => {
      if (!isTrainingOpen()) return setFeedbackDue(true)
      poll = setInterval(() => { if (!isTrainingOpen()) { clearInterval(poll); setFeedbackDue(true) } }, 1000)
    }, FEEDBACK_DELAY_MS)
    return () => { clearTimeout(timer); clearInterval(poll) }
  }, [askFeedback])

  useEffect(() => setMoreOpen(false), [pathname])
  useEffect(() => {
    if (!moreOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMoreOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moreOpen])

  // Pages that live under "More" on phones (everything except the four bottom tabs).
  const inMore = ['/search', '/stats', '/admin'].some((p) => pathname === p || pathname.startsWith(p + '/'))

  async function logout() {
    await authApi.logout()
    qc.clear()
    navigate('/login')
  }

  const learningBadge = (
    <span title={learning.name} className="rounded-xl border border-emerald-400/20 px-3 py-2 text-sm">
      {learning.flag} {learning.name}
    </span>
  )

  return (
    <div className="min-h-screen pt-[env(safe-area-inset-top)] pb-[var(--nav-h)] md:pt-0">
      <InAppBanner />
      {/* Top menu: tablets and desktops. Phones get the bottom navigation below instead. */}
      <header className="sticky top-0 z-20 hidden border-b border-emerald-400/10 bg-emerald-950/70 pt-[env(safe-area-inset-top)] backdrop-blur-xl md:block">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
          <NavLink to="/" className="mr-4"><Logo /></NavLink>
          <NavLink to="/" end className={link}>🏠 {t('nav.home')}</NavLink>
          <NavLink to="/cards" className={link}>🃏 {t('nav.cards')}</NavLink>
          <NavLink to="/contexts/new" className={link}>➕ {t('nav.add')}</NavLink>
          {searchOn && <NavLink to="/search" className={link}>🔍 {t('nav.search')}</NavLink>}
          <NavLink to="/story" className={link}>📖 {t('nav.dailyStory')}</NavLink>
          <NavLink to="/stats" className={link}>📈 {t('nav.stats')}</NavLink>
          {isAdmin && <NavLink to="/admin" className={link}>🛡 {t('nav.admin')}</NavLink>}
          <div className="ml-auto flex items-center gap-2">
            {learningBadge}
            <LanguageSwitcher />
            <InstallMenuItem />
            <button onClick={logout} className="btn-ghost">{t('nav.logout')}</button>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-4 md:py-10">
        <Outlet />
      </main>
      <footer className="space-y-2 py-8 text-center text-xs text-emerald-300/40">
        <div>{learning.tagline}</div>
        <div className="text-emerald-100/60">{t('contact.question')} <ContactLinks /></div>
      </footer>

      {moreOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden" onClick={() => setMoreOpen(false)}>
          <div
            id="more-sheet"
            className="animate-rise absolute inset-x-0 bottom-[var(--nav-h)] max-h-[calc(100dvh-var(--nav-h)-env(safe-area-inset-top))] space-y-1 overflow-y-auto rounded-t-3xl border-t border-emerald-400/20 bg-emerald-950 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            {searchOn && <NavLink to="/search" className={sheetLink}>🔍 {t('nav.search')}</NavLink>}
            <NavLink to="/stats" className={sheetLink}>📈 {t('nav.stats')}</NavLink>
            {isAdmin && <NavLink to="/admin" className={sheetLink}>🛡 {t('nav.admin')}</NavLink>}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              {learningBadge}
              <LanguageSwitcher />
            </div>
            <InstallMenuItem className="btn-ghost w-full py-3" />
            <button onClick={logout} className="btn-ghost mt-2 w-full py-3">{t('nav.logout')}</button>
            <a href={CONTACT.instagram} {...EXTERNAL_LINK} className="mt-1 flex items-center justify-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-emerald-100/70 hover:bg-emerald-400/10 hover:text-white">
              💬 {t('contact.title')}
            </a>
          </div>
        </div>
      )}

      {/* Bottom navigation: phones only. Padded for the iPhone home indicator (safe area). */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-[var(--nav-h)] border-t border-emerald-400/15 bg-emerald-950/90 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        <NavLink to="/" end className={({ isActive }) => tab(isActive && !moreOpen)}>
          <span className="text-xl">🏠</span>{t('nav.home')}
        </NavLink>
        <NavLink to="/cards" className={({ isActive }) => tab(isActive && !moreOpen)}>
          <span className="text-xl">🃏</span>{t('nav.cards')}
        </NavLink>
        <NavLink to="/contexts/new" className={({ isActive }) => tab(isActive && !moreOpen)}>
          <span className="text-xl">➕</span>{t('nav.add')}
        </NavLink>
        <NavLink to="/story" className={({ isActive }) => tab(isActive && !moreOpen)}>
          <span className="text-xl">📖</span>{t('nav.dailyStory')}
        </NavLink>
        <button type="button" onClick={() => setMoreOpen((v) => !v)} className={tab(moreOpen || inMore)}
          aria-expanded={moreOpen} aria-controls="more-sheet">
          <span className="text-xl">☰</span>{t('nav.more')}
        </button>
      </nav>

      <Toaster />
      {askFeedback && feedbackDue && <FeedbackModal />}
      <StageUpOverlay />
      <HeroIntroOverlay />
      <InstallBanner />
    </div>
  )
}
