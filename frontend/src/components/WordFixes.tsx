import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { wordFixesApi, type WordFix } from '../api/endpoints'
import { errorMessage } from '../api/client'

// "Possible mistakes in your words": suggestions from the admin job "check existing words".
// Nothing is changed until the user accepts a suggestion; hidden when there are none.
export function WordFixes() {
  const { t } = useTranslation()
  const fixes = useQuery({ queryKey: ['word-fixes'], queryFn: wordFixesApi.list, staleTime: 60_000 })
  if (!fixes.data?.length) return null
  return (
    <section className="glass space-y-3 border-amber-400/30 p-5">
      <h2 className="display text-lg font-bold text-amber-200">⚠️ {t('review.title')}</h2>
      <ul className="space-y-2">
        {fixes.data.map((f) => <FixRow key={f.id} fix={f} />)}
      </ul>
    </section>
  )
}

function FixRow({ fix }: { fix: WordFix }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const done = () => {
    for (const k of ['word-fixes', 'collection', 'cards', 'review-due', 'contexts']) {
      qc.invalidateQueries({ queryKey: [k] })
    }
  }
  const accept = useMutation({ mutationFn: () => wordFixesApi.accept(fix.id), onSuccess: done })
  const reject = useMutation({ mutationFn: () => wordFixesApi.reject(fix.id), onSuccess: done })
  const busy = accept.isPending || reject.isPending
  const error = accept.error ?? reject.error

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-emerald-400/15 bg-emerald-950/40 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1 text-sm">
        <p className="text-base">
          <s className="text-red-300/80">{fix.original_word}</s>
          <span className="mx-2 text-emerald-100/50">→</span>
          <b className="text-lime-300">{fix.suggested_word}</b>
          {fix.translation && <span className="text-emerald-100/60"> — {fix.translation}</span>}
        </p>
        <p className="flex flex-wrap gap-x-4 text-emerald-100/60">
          {fix.plural && <span>{t('check.plural', { plural: fix.plural })}</span>}
          {fix.reason && <span className="italic">{fix.reason}</span>}
        </p>
        {error && <p className="text-red-300">{errorMessage(error)}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" disabled={busy} onClick={() => accept.mutate()} className="btn-primary px-4 py-2 text-sm">
          {t('review.accept')}
        </button>
        <button type="button" disabled={busy} onClick={() => reject.mutate()} className="btn-ghost">
          {t('review.reject')}
        </button>
      </div>
    </li>
  )
}
