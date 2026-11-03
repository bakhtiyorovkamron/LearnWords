import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** The words search box: a Search icon inside, an X to clear it when it is not empty. */
export function SearchField({ value, onChange, autoFocus = false }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="relative">
      <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
      <input autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} placeholder={t('cards.search')}
        aria-label={t('cards.search')} className="field pl-11 pr-11" />
      {value !== '' && (
        <button type="button" onClick={() => onChange('')} aria-label={t('folders.close')}
          className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-surface-2">
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
