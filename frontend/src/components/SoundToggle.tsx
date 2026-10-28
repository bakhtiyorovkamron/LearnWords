import { useTranslation } from 'react-i18next'
import { setSoundsEnabled, useSoundsEnabled } from '../lib/sounds'
import { toast } from './Toaster'

/**
 * 🔊/🔇 round button for the training sounds — in the training corner. (The interface-sound
 * switch has no button any more; each user's saved choice is still applied on load by Layout.)
 */
export function SoundToggle({ className = '' }: { className?: string }) {
  const { t } = useTranslation()
  const on = useSoundsEnabled()
  const state = t(on ? 'sound.on' : 'sound.off')

  function toggle() {
    setSoundsEnabled(!on)
    toast(t(on ? 'sound.off' : 'sound.on'))
  }

  return (
    <button type="button" role="switch" aria-checked={on} onClick={toggle} title={state} aria-label={`${t('settings.sounds')}: ${state}`}
      className={`grid h-9 w-9 place-items-center rounded-full text-lg transition hover:bg-emerald-400/10 ${on ? '' : 'opacity-60'} ${className}`}>
      {on ? '🔊' : '🔇'}
    </button>
  )
}
