import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLearningLang } from '../lib/learningLang'

/** useState persisted in localStorage (falls back to `initial` for unknown stored values). */
export function useStoredChoice<T extends string>(key: string, allowed: readonly T[], initial: T) {
  const [value, setValue] = useState<T>(() => {
    const v = localStorage.getItem(key) as T | null
    return v && allowed.includes(v) ? v : initial
  })
  useEffect(() => { localStorage.setItem(key, value) }, [key, value])
  return [value, setValue] as const
}

/** Segmented "DE → UZ / UZ → DE [/ Aralash]" toggle; the learning-language code comes from the
 *  account, the native-language code from the current UI language — neither is baked into the
 *  locale strings (direction.de_ru/ru_de are just "{{lang}} → {{native}}" templates).
 *  Internal keys stay de_ru / ru_de and mean "learning language → native" / "native → learning". */
export function DirectionToggle<T extends string>({ value, onChange, options }: {
  value: T
  onChange: (v: T) => void
  options: readonly T[]
}) {
  const { t, i18n } = useTranslation()
  const lang = useLearningLang().vars.langCode
  const native = i18n.language.toUpperCase()
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-emerald-400/15 bg-emerald-950/40 p-1"
      role="radiogroup" aria-label={t('direction.label')}>
      {options.map((k) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)}
          className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
            value === k ? 'bg-lime-400 text-emerald-950 shadow' : 'text-emerald-100/70 hover:bg-emerald-400/10 hover:text-white'
          }`}>
          {t(`direction.${k}`, { lang, native })}
        </button>
      ))}
    </div>
  )
}
