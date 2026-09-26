import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { authApi } from '../api/endpoints'
import { errorMessage } from '../api/client'

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const isLogin = mode === 'login'
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/contexts'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => (isLogin ? authApi.login : authApi.register)({ email, password }),
    onSuccess: () => navigate(from, { replace: true }),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setLocalError(null)
    if (password.length < 8) return setLocalError('Пароль должен быть не короче 8 символов')
    if (!isLogin && password !== confirm) return setLocalError('Пароли не совпадают')
    mutation.mutate()
  }

  const error = localError ?? (mutation.error ? errorMessage(mutation.error) : null)
  const input = 'w-full rounded-md border border-slate-300 px-3 py-2 focus:border-indigo-500 focus:outline-none'

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl bg-white p-8 shadow">
        <h1 className="text-2xl font-bold">{isLogin ? 'Вход' : 'Регистрация'}</h1>
        <input className={input} type="email" placeholder="Email" autoComplete="email" required
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={input} type="password" placeholder="Пароль" required
          autoComplete={isLogin ? 'current-password' : 'new-password'}
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {!isLogin && (
          <input className={input} type="password" placeholder="Повторите пароль" required
            autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={mutation.isPending}
          className="w-full rounded-md bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
          {mutation.isPending ? '…' : isLogin ? 'Войти' : 'Зарегистрироваться'}
        </button>
        <p className="text-center text-sm text-slate-500">
          {isLogin ? 'Нет аккаунта? ' : 'Уже есть аккаунт? '}
          <Link to={isLogin ? '/register' : '/login'} className="text-indigo-600 hover:underline">
            {isLogin ? 'Регистрация' : 'Войти'}
          </Link>
        </p>
      </form>
    </div>
  )
}
