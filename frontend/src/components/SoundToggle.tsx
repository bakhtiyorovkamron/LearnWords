import { useTranslation } from 'react-i18next'
import { setSoundsEnabled, setUiSoundsSwitch, useSoundsEnabled, useUiSoundsEnabled } from '../lib/sounds'
import { toast } from './Toaster'

/**
 * Sound switches. `icon`: 🔊/🔇 round button for the training sounds (training corner, header).
 * `ui-icon`: the same for interface sounds (taps, page turns). `row`: settings rows for both —
 * «Training sounds» and, under it, «Interface sounds». Interface sounds play only while the
 * training switch is on too (it is the master).
 */
export function SoundToggle({ variant = 'icon', className = '' }: {
  variant?: 'icon' | 'ui-icon' | 'row'; className?: string
}) {
  const { t } = useTranslation()
  const on = useSoundsEnabled()
  const uiOn = useUiSoundsEnabled()
  const state = t(on ? 'sound.on' : 'sound.off')
  const uiState = t(uiOn ? 'sound.on' : 'sound.off')

  function toggle() {
    setSoundsEnabled(!on)
    toast(t(on ? 'sound.off' : 'sound.on'))
  }
  function toggleUi() {
    setUiSoundsSwitch(!uiOn)
    toast(`${t('sound.ui')}: ${t(uiOn ? 'sound.off' : 'sound.on')}`)
  }

  const row = 'flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 font-semibold text-emerald-50 transition hover:bg-emerald-400/10'
  if (variant === 'row') {
    return (
      <>
        <button type="button" role="switch" aria-checked={on} onClick={toggle} className={`${row} ${className}`}>
          <span>{on ? '🔊' : '🔇'} {t('settings.sounds')}</span>
          <span className={`text-sm ${on ? 'text-lime-300' : 'text-emerald-100/50'}`}>{state}</span>
        </button>
        <button type="button" role="switch" aria-checked={uiOn} onClick={toggleUi}
          className={`${row} !py-2 ${on ? '' : 'opacity-50'} ${className}`}>
          <span className="min-w-0 text-left">
            {t('sound.ui')}
            <span className="block text-xs font-normal text-emerald-100/60">{t('sound.uiHint')}</span>
          </span>
          <span className={`shrink-0 text-sm ${uiOn ? 'text-lime-300' : 'text-emerald-100/50'}`}>{uiState}</span>
        </button>
      </>
    )
  }
  if (variant === 'ui-icon') {
    return (
      <button type="button" role="switch" aria-checked={uiOn} onClick={toggleUi}
        title={`${t('sound.ui')} — ${t('sound.uiHint')}: ${uiState}`} aria-label={`${t('sound.ui')}: ${uiState}`}
        className={`grid h-9 w-9 place-items-center rounded-full text-lg transition hover:bg-emerald-400/10 ${uiOn && on ? '' : 'opacity-40'} ${className}`}>
        👆
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
