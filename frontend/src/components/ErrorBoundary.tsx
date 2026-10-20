import { Component, type ErrorInfo, type ReactNode } from 'react'
import i18n from '../i18n'
import { CONTACT, EXTERNAL_LINK } from '../lib/contact'

/**
 * Catches render crashes anywhere below it: a friendly message, «Reload» and the contact link
 * instead of a blank page. The original error goes to the console.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('render crash', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    const t = (key: string) => i18n.t(key)
    return (
      <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="text-5xl">🍂</div>
        <h1 className="display text-2xl font-extrabold">{t('errorBoundary.title')}</h1>
        <p className="max-w-md text-emerald-100/70">{t('errorBoundary.text')}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            {t('errorBoundary.reload')}
          </button>
          <a href={CONTACT.instagram} {...EXTERNAL_LINK} className="btn-ghost">💬 {t('contact.reportProblem')}</a>
        </div>
      </div>
    )
  }
}
