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
      <p className="flex items-center gap-2 text-sm text-emerald-100/60" aria-live="polite">
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-lime-300 border-t-transparent" />
        {t('check.checking')}
      </p>
    )
  }
  if (state.status !== 'done') return null
  const r = state.result

  if (r.status === 'unknown') {
    return (
      <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm text-amber-100" aria-live="polite">
        ⚠️ {t('check.unknown')}
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
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-emerald-100/60">
        <span className="text-lime-300/90">✓ {suggestionOf(r)}</span>
        {r.plural && <span>{t('check.plural', { plural: r.plural })}</span>}
      </p>
    )
  }

  return (
    <div
      className={`space-y-2 rounded-2xl border px-4 py-3 text-sm transition ${
        highlight ? 'border-amber-300 bg-amber-400/15 ring-4 ring-amber-300/20' : 'border-lime-400/30 bg-lime-400/10'
      }`}
      role="status" aria-live="polite"
    >
      <p className="text-base font-semibold text-white">{t('check.suggest', { word: suggestionOf(r) })}</p>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-emerald-100/70">
        {details}
        {r.reason && <span className="italic">{r.reason}</span>}
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={() => onUse(r)} className="btn-primary px-4 py-2 text-sm">{t('check.useSuggestion')}</button>
        <button type="button" onClick={onKeep} className="btn-ghost">{t('check.keep')}</button>
      </div>
    </div>
  )
}
