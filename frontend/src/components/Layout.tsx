import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { authApi, meApi } from '../api/endpoints'
import { LanguageSwitcher } from './LanguageSwitcher'

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-xl px-4 py-2 text-sm font-semibold transition ${
    isActive
      ? 'bg-lime-400 text-emerald-950 shadow-lg shadow-lime-400/30'
      : 'text-emerald-100/80 hover:bg-emerald-400/10 hover:text-white'
  }`

export function Logo() {
  return (
    <span className="display flex items-center gap-2 text-xl font-extrabold tracking-tight">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-lime-300 to-emerald-500 text-emerald-950 shadow-lg shadow-emerald-500/40">
        W
      </span>
      <span>
        Wort<span className="text-lime-300">kontext</span>
      </span>
    </span>
  )
}

export function Layout() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  // Only decides whether to show the link; the backend checks the role on every /api/admin request.
  const me = useQuery({ queryKey: ['me'], queryFn: meApi.get, staleTime: 5 * 60_000 })
  const isAdmin = me.data?.role === 'admin'

  async function logout() {
    await authApi.logout()
    qc.clear()
    navigate('/login')
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-emerald-400/10 bg-emerald-950/70 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
          <NavLink to="/contexts" className="mr-4"><Logo /></NavLink>
          <NavLink to="/contexts" end className={link}>📚 {t('nav.contexts')}</NavLink>
          <NavLink to="/contexts/new" className={link}>✨ {t('nav.add')}</NavLink>
          <NavLink to="/cards" className={link}>🃏 {t('nav.cards')}</NavLink>
          <NavLink to="/stats" className={link}>📈 {t('nav.stats')}</NavLink>
          <NavLink to="/story" className={link}>📖 {t('nav.dailyStory')}</NavLink>
          {isAdmin && <NavLink to="/admin" className={link}>🛡 {t('nav.admin')}</NavLink>}
          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitcher />
            <button onClick={logout} className="btn-ghost">{t('nav.logout')}</button>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-10">
        <Outlet />
      </main>
      <footer className="py-8 text-center text-xs text-emerald-300/40">
        Deutsch lernen — Wort für Wort 🌿
      </footer>
    </div>
  )
}
