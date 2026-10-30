import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CollectionPeriod, CollectionSort, CollectionStatus } from '../api/types'
import { Segmented } from './Segmented'
import { Sheet } from './Sheet'

export const SORTS: readonly CollectionSort[] = ['date', 'alpha', 'progress']

/**
 * The collection's filter: status, period and sort. Changes apply at once (the list refetches);
 * "Reset" puts all three back, "Done" closes.
 */
export function FilterSheet({ status, period, sort, onStatus, onPeriod, onSort, onReset, onClose }: {
  status: CollectionStatus; period: CollectionPeriod; sort: CollectionSort
  onStatus: (v: CollectionStatus) => void
  onPeriod: (v: CollectionPeriod) => void
  onSort: (v: CollectionSort) => void
  onReset: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <Sheet label={t('collection.filter.title')} onClose={onClose}>
      <h2 className="text-lg font-bold text-fg">{t('collection.filter.title')}</h2>
      <div className="mt-4 space-y-4">
        <Segmented value={status} onChange={onStatus} className="w-full" label={t('collection.filter.title')} options={[
          ['all', t('collection.filter.all')],
          ['new', t('collection.filter.new')],
          ['learning', t('collection.filter.learning')],
          ['learned', t('collection.filter.learned')],
        ] as const} />
        <Segmented value={period} onChange={onPeriod} className="w-full" label={t('collection.period.all')} options={[
          ['today', t('collection.period.today')],
          ['week', t('collection.period.week')],
          ['all', t('collection.period.all')],
        ] as const} />
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">{t('collection.sortLabel')}</p>
          <div role="radiogroup" aria-label={t('collection.sortLabel')} className="divide-y divide-divider overflow-hidden rounded-xl border border-line">
            {SORTS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={sort === k} onClick={() => onSort(k)}
                className="flex h-12 w-full items-center justify-between gap-3 px-4 text-left text-[15px] text-fg transition hover:bg-surface-2">
                {t(`collection.sort.${k}`)}
                {sort === k && <Check size={18} aria-hidden="true" className="shrink-0 text-accent-text" />}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-5 flex gap-3">
        <button type="button" onClick={onReset} className="btn-ghost h-11 flex-1">{t('collection.filter.reset')}</button>
        <button type="button" onClick={onClose} className="btn-primary h-11 flex-1">{t('collection.filter.done')}</button>
      </div>
    </Sheet>
  )
}
