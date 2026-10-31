import { Check, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WordCheck } from '../api/endpoints'
import { showBaseForm, suggestionOf, type CheckState } from '../lib/wordCheck'

interface Props {
  state: CheckState
  kept: boolean // the user chose "Keep as is" for this text
  highlight?: boolean // save was pressed while a suggestion is still open
  onUse: (r: WordCheck) => void
  onKeep: () => void
}

// Result of the word check under the input. A correction is only ever a suggestion with two
// buttons — the text is never changed without the user's click.
export function WordCheckHint({ state, kept, highlight, onUse, onKeep }: Props) {
  const { t } = useTranslation()

  if (state.status === 'checking') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        {t('check.checking')}
      </p>
    )
  }
  if (state.status !== 'done') return null
  const r = state.result

  if (r.status === 'unknown') {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-4 py-2 text-sm text-streak" aria-live="polite">
        <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{t('check.unknown')}
      </p>
    )
  }

  const details = (
    <>
      {showBaseForm(r) && <span>{t('check.baseForm', { lemma: r.lemma })}</span>}
      {r.plural && <span>{t('check.plural', { plural: r.plural })}</span>}
    </>
  )

  if (r.status === 'ok' || kept) {
    // Nothing to decide: just show the grammar that will be saved with the word.
    if (r.status === 'corrected' || (!r.article && !r.plural)) return null
    return (
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        <span className="flex items-center gap-1 font-serif text-accent-text"><Check size={14} aria-hidden="true" />{suggestionOf(r)}</span>
        {r.plural && <span>{t('check.plural', { plural: r.plural })}</span>}
      </p>
    )
  }

  return (
    <div
      className={`space-y-2 rounded-2xl border px-4 py-3 text-sm transition ${
        highlight ? 'border-streak bg-surface-2 ring-4 ring-streak/20' : 'border-line bg-surface-2'
      }`}
      role="status" aria-live="polite"
    >
      <p className="font-serif text-base font-medium text-accent-text">{t('check.suggest', { word: suggestionOf(r) })}</p>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-muted">
        {details}
        {r.reason && <span className="italic">{r.reason}</span>}
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={() => onUse(r)} className="btn-primary h-10 px-4 text-sm">{t('check.useSuggestion')}</button>
        <button type="button" onClick={onKeep} className="btn-ghost h-10 px-4 text-sm">{t('check.keep')}</button>
      </div>
    </div>
  )
}
