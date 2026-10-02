import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { authApi } from '../api/endpoints'

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
  const navigate = useNavigate()
  const qc = useQueryClient()

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
          <NavLink to="/contexts" end className={link}>📚 Контексты</NavLink>
          <NavLink to="/contexts/new" className={link}>✨ Добавить</NavLink>
          <NavLink to="/cards" className={link}>🃏 Карточки</NavLink>
          <NavLink to="/stats" className={link}>📈 Статистика</NavLink>
          <NavLink to="/story" className={link}>📖 История дня</NavLink>
          <button onClick={logout} className="btn-ghost ml-auto">Выйти</button>
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
