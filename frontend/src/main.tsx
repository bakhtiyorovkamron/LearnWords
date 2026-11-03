import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './auth/AuthContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import App from './App'
import './i18n' // must run before the first render
import { registerServiceWorker } from './lib/pwa'
import { initTheme } from './lib/theme'
import './index.css'

registerServiceWorker()
initTheme()
// The serif of the card words is display=block (index.html): start loading both of its weights on
// the cards now, so a card never waits with its word invisible.
for (const weight of ['400', '500']) void document.fonts?.load(`${weight} 1em Newsreader`).catch(() => undefined)

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
