import { useTranslation } from 'react-i18next'
import { usePush, type PushStatus } from '../lib/push'
import { toast } from './Toaster'

const HINTS: Partial<Record<PushStatus, string>> = {
  denied: 'push.denied',
  unsupported: 'push.unsupported',
  'ios-needs-install': 'push.iosHint',
}

/**
 * Notifications switch. `row`: the "More" sheet on phones. `icon`: the 🔔 in the desktop header (its
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
        className={`grid h-9 w-9 place-items-center rounded-full text-lg transition hover:bg-emerald-400/10 disabled:opacity-50 ${push.status === 'on' ? '' : 'opacity-60'}`}>
        🔔
      </button>
    )
  }

  if (hint) {
    return (
      <p className="rounded-2xl border border-emerald-400/20 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-100/80">🔔 {t(hint)}</p>
    )
  }
  return (
    <div className="space-y-1">
      {push.status === 'on' ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3 font-semibold text-emerald-50">
          <span>{t('push.enabled')}</span>
          <button type="button" className="btn-ghost !px-3 !py-1 text-sm" disabled={push.busy} onClick={() => void push.disable()}>
            {t('push.disable')}
          </button>
        </div>
      ) : (
        <button type="button" className="btn-ghost w-full py-3" disabled={push.busy} onClick={() => void push.enable()}>
          {t('push.enable')}
        </button>
      )}
      {push.failed && <p role="alert" className="px-4 text-sm text-red-300">{t('common.unknownError')}</p>}
    </div>
  )
}
