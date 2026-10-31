import { Bell, BellRing } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePush, type PushStatus } from '../lib/push'
import { toast } from './Toaster'

const HINTS: Partial<Record<PushStatus, string>> = {
  denied: 'push.denied',
  unsupported: 'push.unsupported',
  'ios-needs-install': 'push.iosHint',
}

/**
 * Notifications switch. `row`: the "More" sheet on phones. `icon`: the bell in the desktop header (its
 * title is the text). When notifications cannot be turned on (blocked, unsupported, iPhone outside the
 * Home Screen app) the matching hint replaces the action.
 */
export function PushToggle({ variant }: { variant: 'row' | 'icon' }) {
  const { t } = useTranslation()
  const push = usePush()
  if (push.status === null) return null
  const hint = HINTS[push.status]

  if (variant === 'icon') {
    const text = hint ? t(hint) : push.status === 'on' ? `${t('push.enabled')} — ${t('push.disable')}` : t('push.enable')
    return (
      <button type="button" title={text} aria-label={text} aria-pressed={push.status === 'on'} disabled={push.busy}
        onClick={() => {
          if (hint) toast(t(hint), { ms: 6000 }) // nothing to switch: tell why
          else void (push.status === 'on' ? push.disable() : push.enable())
        }}
        className={`grid h-9 w-9 place-items-center rounded-full transition hover:bg-surface-2 disabled:opacity-50 ${push.status === 'on' ? 'text-accent-text' : 'text-muted'}`}>
        {push.status === 'on' ? <BellRing size={18} aria-hidden="true" /> : <Bell size={18} aria-hidden="true" />}
      </button>
    )
  }

  if (hint) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-muted"><Bell size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{t(hint)}</p>
    )
  }
  return (
    <div className="space-y-1">
      {push.status === 'on' ? (
        <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 font-semibold text-fg">
          <span className="flex items-center gap-2"><BellRing size={18} aria-hidden="true" className="text-accent-text" />{t('push.enabled')}</span>
          <button type="button" className="btn-ghost !px-3 !py-1 text-sm" disabled={push.busy} onClick={() => void push.disable()}>
            {t('push.disable')}
          </button>
        </div>
      ) : (
        <button type="button" className="btn-ghost w-full py-3" disabled={push.busy} onClick={() => void push.enable()}>
          <Bell size={18} aria-hidden="true" />{t('push.enable')}
        </button>
      )}
      {push.failed && <p role="alert" className="px-4 text-sm text-danger">{t('common.unknownError')}</p>}
    </div>
  )
}
