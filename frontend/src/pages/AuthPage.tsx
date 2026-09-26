import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { authApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { Logo } from '../components/Layout'

const floating = [
  { w: 'Fernweh', t: 'тоска по дальним краям', c: 'left-[6%] top-[14%]', d: '0s' },
  { w: 'Gemütlich', t: 'уютный', c: 'right-[8%] top-[20%]', d: '1.5s' },
  { w: 'Schmetterling', t: 'бабочка', c: 'left-[10%] bottom-[16%]', d: '3s' },
  { w: 'Feierabend', t: 'конец рабочего дня', c: 'right-[6%] bottom-[12%]', d: '2s' },
]

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

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      {floating.map((f) => (
        <div key={f.w} style={{ animationDelay: f.d }}
          className={`animate-float glass pointer-events-none absolute hidden px-5 py-3 lg:block ${f.c}`}>
          <div className="font-bold text-lime-300">{f.w}</div>
          <div className="text-xs text-emerald-100/70">{f.t}</div>
        </div>
      ))}

      <div className="grid w-full max-w-5xl items-center gap-10 md:grid-cols-2">
        <div className="animate-rise space-y-6 text-center md:text-left">
          <div className="flex justify-center md:justify-start"><Logo /></div>
          <h1 className="display text-4xl font-extrabold leading-tight md:text-5xl">
            Немецкий <span className="bg-gradient-to-r from-lime-300 to-teal-300 bg-clip-text text-transparent">через контекст</span>, а не зубрёжку
          </h1>
          <p className="text-lg text-emerald-100/70">
            Вставьте фразу из сериала, песни или чата — мы разберём её на слова с переводом, транскрипцией и произношением.
          </p>
          <div className="flex flex-wrap justify-center gap-3 md:justify-start">
            {['🌍 Перевод', '🔤 Транскрипция', '🔊 Озвучка'].map((b) => (
              <span key={b} className="rounded-full border border-lime-400/30 bg-lime-400/10 px-4 py-1.5 text-sm text-lime-200">{b}</span>
            ))}
          </div>
        </div>

        <form onSubmit={submit} className="glass animate-rise space-y-4 p-8 md:p-10">
          <h2 className="display text-2xl font-extrabold">{isLogin ? 'С возвращением! 👋' : 'Создать аккаунт 🌱'}</h2>
          <p className="text-sm text-emerald-100/60">
            {isLogin ? 'Войдите, чтобы продолжить обучение' : 'Начните собирать свою коллекцию слов'}
          </p>
          <input className="field" type="email" placeholder="Email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="field" type="password" placeholder="Пароль" required
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            value={password} onChange={(e) => setPassword(e.target.value)} />
          {!isLogin && (
            <input className="field" type="password" placeholder="Повторите пароль" required
              autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          )}
          {error && (
            <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">{error}</p>
          )}
          <button type="submit" disabled={mutation.isPending} className="btn-primary w-full">
            {mutation.isPending ? 'Секунду…' : isLogin ? 'Войти' : 'Зарегистрироваться'}
          </button>
          <p className="text-center text-sm text-emerald-100/60">
            {isLogin ? 'Нет аккаунта? ' : 'Уже есть аккаунт? '}
            <Link to={isLogin ? '/register' : '/login'} className="font-semibold text-lime-300 hover:underline">
              {isLogin ? 'Регистрация' : 'Войти'}
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
