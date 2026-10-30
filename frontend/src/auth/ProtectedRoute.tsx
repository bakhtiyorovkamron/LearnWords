import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from './AuthContext'

export function ProtectedRoute() {
  const { isAuthenticated, isLoading, status, retry } = useAuth()
  const { t } = useTranslation()
  const location = useLocation()
  if (isLoading) return <div className="p-8 text-center text-slate-500">{t('common.loading')}</div>
  // The server could not be reached: we do not know who this is. Never send them to /login for that.
  if (!isAuthenticated && status === 'offline') {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center">
        <div className="space-y-4">
          <div className="text-4xl" aria-hidden="true">📡</div>
          <p className="text-emerald-100/80">{t('auth.offline')}</p>
          <button type="button" className="btn-primary" onClick={retry}>{t('auth.retry')}</button>
        </div>
      </div>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />
  return <Outlet />
}

export function GuestRoute() {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) return null
  return isAuthenticated ? <Navigate to="/" replace /> : <Outlet />
}
