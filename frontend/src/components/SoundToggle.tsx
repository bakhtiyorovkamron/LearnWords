import { useTranslation } from 'react-i18next'
import { setSoundsEnabled, useSoundsEnabled } from '../lib/sounds'
import { toast } from './Toaster'

/**
 * 🔊/🔇 switch for the training sounds. `icon`: a round button (training corner, header);
 * `row`: a full-width settings row with the label «Training sounds».
 */
export function SoundToggle({ variant = 'icon', className = '' }: { variant?: 'icon' | 'row'; className?: string }) {
  const { t } = useTranslation()
  const on = useSoundsEnabled()
  const state = t(on ? 'sound.on' : 'sound.off')

  function toggle() {
    setSoundsEnabled(!on)
    toast(t(on ? 'sound.off' : 'sound.on'))
  }

  if (variant === 'row') {
    return (
      <button type="button" role="switch" aria-checked={on} onClick={toggle}
        className={`flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 font-semibold text-emerald-50 transition hover:bg-emerald-400/10 ${className}`}>
        <span>{on ? '🔊' : '🔇'} {t('settings.sounds')}</span>
        <span className={`text-sm ${on ? 'text-lime-300' : 'text-emerald-100/50'}`}>{state}</span>
      </button>
    )
  }
  return (
    <button type="button" role="switch" aria-checked={on} onClick={toggle} title={state} aria-label={`${t('settings.sounds')}: ${state}`}
      className={`grid h-9 w-9 place-items-center rounded-full text-lg transition hover:bg-emerald-400/10 ${on ? '' : 'opacity-60'} ${className}`}>
      {on ? '🔊' : '🔇'}
    </button>
  )
}
