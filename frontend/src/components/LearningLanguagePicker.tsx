import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LEARNING_LANGS, type LearningLang } from '../api/endpoints'
import { Flag } from './Flag'

/** "Which language are you learning?": the tiles of the registration form (and of /welcome). */
export function LearningLanguagePicker({ value, onChange }: { value: LearningLang; onChange: (code: LearningLang) => void }) {
  const { t } = useTranslation()
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-fg">{t('auth.learningLanguage')}</legend>
      <div className="grid grid-cols-2 gap-2">
        {LEARNING_LANGS.map((l) => {
          const on = value === l.code
          return (
            <button key={l.code} type="button" onClick={() => onChange(l.code)} aria-pressed={on}
              className={`flex min-h-12 items-center gap-2.5 rounded-xl border-2 px-3 py-2 text-left text-sm transition ${
                on ? 'border-accent bg-surface-2 text-fg' : 'border-line text-muted hover:text-fg'}`}>
              <Flag lang={l.code} />
              <span className="min-w-0 flex-1 truncate font-semibold">{l.name}</span>
              {on && <Check size={18} aria-hidden="true" className="shrink-0 text-accent-text" />}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-faint">{t('auth.learningLanguageHint')}</p>
    </fieldset>
  )
}
