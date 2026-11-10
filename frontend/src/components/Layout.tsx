import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { BookOpen, ChartColumn, House, Layers, LifeBuoy, List, LogOut, MessageCircle, Plus, Search, Shield, UserRound, type LucideIcon } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { authApi, meApi } from '../api/endpoints'
import { StageUpOverlay } from './StageUpOverlay'
import { HeroIntroOverlay } from './HeroIntroOverlay'
import { InstallBanner, InstallMenuItem } from './InstallPrompt'
import { LanguageSwitcher } from './LanguageSwitcher'
import { Toaster } from './Toaster'
import { UnreadBadge } from './UnreadBadge'
import { useAdminChatUnread, useChatUnread, useChatUnreadToasts } from '../lib/chatUnread'
import { ContactLinks } from './ContactLinks'
import { CONTACT, EXTERNAL_LINK } from '../lib/contact'
import { useLearningLang } from '../lib/learningLang'
import { useFeatures } from '../lib/features'
import { setMoreMenuOpen, useMoreMenuOpen } from '../lib/moreMenu'
import { isTrainingOpen, useTrainingOpen } from '../lib/trainingState'
import { FeedbackModal } from './FeedbackModal'
import { TelegramPromoDialog } from './TelegramPromoDialog'
import { InAppBanner } from './InAppBanner'
import { Logo } from './Logo'
import { PushToggle } from './PushToggle'
import { ThemePicker } from './ThemePicker'
import { useThemeSync } from '../lib/theme'

export const FEEDBACK_DELAY_MS = 3000

// Desktop header link: icon + label.
const link = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
    isActive ? 'bg-surface-2 text-accent-text' : 'text-muted hover:bg-surface-2 hover:text-fg'
  }`

// Bottom navigation item (phones, below 768px).
const tab = (isActive: boolean) =>
  `flex flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold leading-tight transition ${
    isActive ? 'text-accent-text' : 'text-muted'
  }`

// "More" sheet row.
const sheetLink = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-xl px-4 py-3 font-semibold transition ${
    isActive ? 'bg-surface-2 text-accent-text' : 'text-fg hover:bg-surface-2'
  }`

function Icon({ icon: I, size = 18, stroke = 2 }: { icon: LucideIcon; size?: number; stroke?: number }) {
  return <I size={size} strokeWidth={stroke} aria-hidden="true" className="shrink-0" />
}

export function Layout() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const qc = useQueryClient()
  // Only decides whether to show the link; the backend checks the role on every /api/admin request.
  const me = useQuery({ queryKey: ['me'], queryFn: meApi.get, staleTime: 5 * 60_000 })
  const isAdmin = me.data?.role === 'admin'
  const chatUnread = useChatUnread()
  const unreadTotal = chatUnread.data?.total ?? 0
  const unreadSupport = chatUnread.data?.support ?? 0
  const unreadPurchases = (chatUnread.data?.purchases ?? []).reduce((n, p) => n + p.unread, 0)
  const adminUnread = useAdminChatUnread(isAdmin).data?.total ?? 0
  useChatUnreadToasts(chatUnread.data)
  const learning = useLearningLang()
  const { isOn } = useFeatures()
  const searchOn = isOn('word_search')
  useThemeSync(isOn('theme_picker'), me.isSuccess) // night without the picker; the server's theme with it
  const moreOpen = useMoreMenuOpen()
  // During a training session the shell steps aside: no header, bottom nav or footer.
  const focus = useTrainingOpen()
  // The cards deck fills the screen: no footer under it.
  const cardsPage = pathname.startsWith('/cards')

  // The desktop header's height as --header-h, for a page that fills the screen exactly (the cards
  // deck). It wraps on narrow desktops, so it is measured, not assumed; 0 on phones (it is hidden).
  const shell = useRef<HTMLDivElement>(null)
  const header = useRef<HTMLElement>(null)
  useEffect(() => {
    const root = shell.current
    const el = header.current
    if (!root || !el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => root.style.setProperty('--header-h', `${el.offsetHeight}px`))
    observer.observe(el)
    return () => { observer.disconnect(); root.style.removeProperty('--header-h') }
  }, [focus])

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

  useEffect(() => setMoreMenuOpen(false), [pathname])
  useEffect(() => {
    if (!moreOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMoreMenuOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moreOpen])

  async function logout() {
    await authApi.logout()
    qc.clear()
    navigate('/login')
  }

  const learningBadge = (
    <span title={learning.name} className="rounded-xl border border-line px-3 py-2 text-sm text-muted">
      {learning.flag} {learning.name}
    </span>
  )

  return (
    <div ref={shell} className="min-h-screen pt-[env(safe-area-inset-top)] pb-[var(--nav-h)] md:pt-0"
      style={focus ? ({ '--nav-h': '0px' } as React.CSSProperties) : undefined}>
      <InAppBanner />
      {/* Top menu: tablets and desktops. Phones get the bottom navigation below instead. */}
      {!focus && <header ref={header} className="sticky top-0 z-20 hidden border-b border-line bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur md:block">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
          <NavLink to="/" className="mr-4" aria-label="yodla"><Logo /></NavLink>
          <NavLink to="/" end className={link}><Icon icon={House} />{t('nav.home')}</NavLink>
          <NavLink to="/cards" className={link}><Icon icon={Layers} />{t('nav.cards')}</NavLink>
          <NavLink to="/words" className={link}><Icon icon={List} />{t('nav.words')}</NavLink>
          <NavLink to="/contexts/new" className={link}><Icon icon={Plus} />{t('nav.add')}</NavLink>
          {searchOn && <NavLink to="/search" className={link}><Icon icon={Search} />{t('nav.search')}</NavLink>}
          <NavLink to="/story" className={link}><Icon icon={BookOpen} />{t('nav.dailyStory')}</NavLink>
          <NavLink to="/stats" className={link}><Icon icon={ChartColumn} />{t('nav.stats')}</NavLink>
          <NavLink to="/profile" className={link}><Icon icon={UserRound} />{t('profile.title')}<UnreadBadge count={unreadTotal} testId="badge-profile" /></NavLink>
          {isAdmin && <NavLink to="/admin" className={link}><Icon icon={Shield} />{t('nav.admin')}<UnreadBadge count={adminUnread} testId="badge-admin" /></NavLink>}
          <div className="ml-auto flex items-center gap-2">
            {learningBadge}
            <LanguageSwitcher />
            <ThemePicker variant="menu" />
            <PushToggle variant="icon" />
            <InstallMenuItem />
            <button onClick={logout} className="btn-ghost">{t('nav.logout')}</button>
          </div>
        </nav>
      </header>}
      <main className="mx-auto max-w-6xl px-4 py-4 md:py-10">
        <Outlet />
      </main>
      {!focus && !cardsPage && (
        <footer className="space-y-2 py-8 text-center text-xs text-faint">
          <div>{learning.tagline}</div>
          <div className="text-muted">{t('contact.question')} <ContactLinks /></div>
        </footer>
      )}

      {moreOpen && !focus && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden" onClick={() => setMoreMenuOpen(false)}>
          <div
            id="more-sheet"
            className="animate-rise absolute inset-x-0 bottom-[var(--nav-h)] max-h-[calc(100dvh-var(--nav-h)-env(safe-area-inset-top))] space-y-1 overflow-y-auto rounded-t-3xl border-t border-line bg-surface p-4"
            onClick={(e) => e.stopPropagation()}
          >
            {searchOn && <NavLink to="/search" className={sheetLink}><Icon icon={Search} size={20} />{t('nav.search')}</NavLink>}
            <NavLink to="/stats" className={sheetLink}><Icon icon={ChartColumn} size={20} />{t('nav.stats')}</NavLink>
            <NavLink to="/profile" className={sheetLink}><Icon icon={UserRound} size={20} />{t('profile.title')}<UnreadBadge count={unreadPurchases} testId="badge-sheet-profile" /></NavLink>
            <NavLink to="/support" className={sheetLink}><Icon icon={LifeBuoy} size={20} />{t('support.title')}<UnreadBadge count={unreadSupport} testId="badge-sheet-support" /></NavLink>
            {isAdmin && <NavLink to="/admin" className={sheetLink}><Icon icon={Shield} size={20} />{t('nav.admin')}<UnreadBadge count={adminUnread} testId="badge-sheet-admin" /></NavLink>}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              {learningBadge}
              <LanguageSwitcher />
            </div>
            <ThemePicker variant="row" />
            <PushToggle variant="row" />
            <InstallMenuItem className="btn-ghost w-full py-3" />
            <button onClick={logout} className="btn-ghost mt-2 w-full py-3"><Icon icon={LogOut} size={18} />{t('nav.logout')}</button>
            <a href={CONTACT.instagram} {...EXTERNAL_LINK} className="mt-1 flex items-center justify-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-fg">
              <Icon icon={MessageCircle} size={18} />{t('contact.title')}
            </a>
          </div>
        </div>
      )}

      {/* Bottom navigation: phones only. Padded for the iPhone home indicator (safe area). */}
      {!focus && <nav className="fixed inset-x-0 bottom-0 z-40 flex h-[var(--nav-h)] border-t border-line bg-bg/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <NavLink to="/" end className={({ isActive }) => tab(isActive)}>
          <span className="relative">
            <Icon icon={House} size={22} stroke={1.75} />
            <UnreadBadge count={unreadTotal} testId="badge-home" className="absolute -right-2.5 -top-1.5" />
          </span>{t('nav.home')}
        </NavLink>
        <NavLink to="/cards" className={({ isActive }) => tab(isActive)}>
          <Icon icon={Layers} size={22} stroke={1.75} />{t('nav.cards')}
        </NavLink>
        {/* The center action: add a word. No text label, a raised round button. */}
        <div className="flex flex-1 justify-center">
          <NavLink to="/contexts/new" aria-label={t('nav.add')}
            className="-mt-5 grid h-14 w-14 place-items-center rounded-full border-4 border-bg bg-accent text-on-accent shadow-[var(--shadow-card)] transition active:scale-95">
            <Plus size={26} strokeWidth={2.4} aria-hidden="true" />
          </NavLink>
        </div>
        <NavLink to="/words" className={({ isActive }) => tab(isActive)}>
          <Icon icon={List} size={22} stroke={1.75} />{t('nav.words')}
        </NavLink>
        <NavLink to="/story" className={({ isActive }) => tab(isActive)}>
          <Icon icon={BookOpen} size={22} stroke={1.75} />{t('nav.dailyStory')}
        </NavLink>
      </nav>}

      <Toaster />
      {askFeedback && feedbackDue && <FeedbackModal />}
      <TelegramPromoDialog />
      <StageUpOverlay />
      <HeroIntroOverlay />
      <InstallBanner />
    </div>
  )
}
