import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { authApi } from '../api/endpoints'

const link = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-md text-sm font-medium ${isActive ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`

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
      <header className="border-b bg-white">
        <nav className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <span className="mr-4 text-lg font-bold text-indigo-600">LearnWords</span>
          <NavLink to="/contexts" end className={link}>Контексты</NavLink>
          <NavLink to="/contexts/new" className={link}>Загрузить</NavLink>
          <NavLink to="/cards" className={link}>Карточки</NavLink>
          <button onClick={logout} className="ml-auto text-sm text-slate-500 hover:text-slate-800">
            Выйти
          </button>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
