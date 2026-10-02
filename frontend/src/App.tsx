import { Navigate, Route, Routes } from 'react-router-dom'
import { GuestRoute, ProtectedRoute } from './auth/ProtectedRoute'
import { Layout } from './components/Layout'
import { AuthPage } from './pages/AuthPage'
import { ContextsPage } from './pages/ContextsPage'
import { NewContextPage } from './pages/NewContextPage'
import { ContextDetailPage } from './pages/ContextDetailPage'
import { CardsPage } from './pages/CardsPage'
import { StatsPage } from './pages/StatsPage'
import { StoryPage } from './pages/StoryPage'

export default function App() {
  return (
    <Routes>
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/contexts" element={<ContextsPage />} />
          <Route path="/contexts/new" element={<NewContextPage />} />
          <Route path="/contexts/:id" element={<ContextDetailPage />} />
          <Route path="/cards" element={<CardsPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/story" element={<StoryPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/contexts" replace />} />
    </Routes>
  )
}
