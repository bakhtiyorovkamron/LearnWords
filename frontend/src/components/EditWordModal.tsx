import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { wordsApi, type WordUpdate } from '../api/endpoints'
import { errorMessage, isRateLimited, rateLimitMessage } from '../api/client'
import type { CollectionCard, WordCard } from '../api/types'
import { toast } from './Toaster'

type CollectionPage = { items: CollectionCard[]; total: number }

/** Replaces the edited card in every cached list (keeps box_level/is_learned of collection items). */
function patchCaches(qc: ReturnType<typeof useQueryClient>, updated: WordCard) {
  const merge = <T extends WordCard>(c: T): T => (c.id === updated.id ? { ...c, ...updated } : c)
  qc.setQueriesData<WordCard[]>({ queryKey: ['cards'] }, (old) => old?.map(merge))
  qc.setQueriesData<WordCard[]>({ queryKey: ['context-words'] }, (old) => old?.map(merge))
  qc.setQueriesData<InfiniteData<CollectionPage>>({ queryKey: ['collection'] }, (old) =>
    old && { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map(merge) })) })
  // Training queue is re-read next time it starts.
  qc.invalidateQueries({ queryKey: ['review-due'] })
}

export function EditWordModal({ card, onClose }: { card: WordCard; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [form, setForm] = useState({
    word: card.word,
    translation: card.translation,
    transcription: card.transcription ?? '',
    example_sentence: card.example_sentence ?? '',
    example_translation: card.example_translation ?? '',
  })
  const [localError, setLocalError] = useState<string | null>(null)

  // Same endpoint/flow as on the "Add" page, but uses the CURRENT values of the form fields.
  const generate = useMutation({
    mutationFn: () => wordsApi.generateExample(form.word.trim(), form.translation.trim()),
    onSuccess: (r) => setForm((f) => ({
      ...f,
      example_sentence: r.example_sentence,
      example_translation: r.example_translation,
    })),
  })
  const canGenerate = !!form.word.trim() && !!form.translation.trim()

  const save = useMutation({
    mutationFn: (u: WordUpdate) => wordsApi.update(card.id, u),
    onSuccess: (updated) => {
      patchCaches(qc, updated)
      toast(t('editWord.saved'))
      onClose()
    },
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function submit(e: FormEvent) {
    e.preventDefault()
    setLocalError(null)
    if (!form.word.trim()) return setLocalError(t('editWord.errWord'))
    if (!form.translation.trim()) return setLocalError(t('editWord.errTranslation'))
    // Send only changed fields.
    const original: Record<keyof typeof form, string> = {
      word: card.word, translation: card.translation, transcription: card.transcription ?? '',
      example_sentence: card.example_sentence ?? '', example_translation: card.example_translation ?? '',
    }
    const changes: WordUpdate = {}
    for (const k of Object.keys(form) as (keyof typeof form)[]) {
      if (form[k].trim() !== original[k].trim()) changes[k] = form[k].trim()
    }
    if (!Object.keys(changes).length) return onClose()
    save.mutate(changes)
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))
  const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-emerald-100/60'

  // Portal: the modal must not live inside the flip card (3D transform / click-to-flip).
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="edit-word-title"
        className="glass max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto p-6 text-left">
        <h2 id="edit-word-title" className="display text-2xl font-extrabold">✏️ {t('editWord.title')}</h2>

        <div>
          <label className={label} htmlFor="ew-word">{t('editWord.word')} *</label>
          <input id="ew-word" autoFocus className="field" value={form.word} onChange={set('word')} maxLength={100} />
        </div>
        <div>
          <label className={label} htmlFor="ew-tr">{t('editWord.translation')} *</label>
          <input id="ew-tr" className="field" value={form.translation} onChange={set('translation')} maxLength={500} />
        </div>
        <div>
          <label className={label} htmlFor="ew-pr">{t('editWord.pronunciation')}</label>
          <input id="ew-pr" className="field font-mono" value={form.transcription} onChange={set('transcription')} maxLength={200} />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className={`${label} mb-0`} htmlFor="ew-ex">{t('editWord.example')}</label>
            <button type="button" onClick={() => generate.mutate()}
              disabled={generate.isPending || !canGenerate}
              title={canGenerate ? undefined : t('newContext.hintNeedTranslation')}
              className="btn-ghost shrink-0 !px-3 !py-1 text-xs disabled:opacity-50">
              {generate.isPending ? (
                <>
                  <span className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-lime-300 border-t-transparent" />
                  {t('newContext.generating')}
                </>
              ) : (
                t('newContext.generate')
              )}
            </button>
          </div>
          <textarea id="ew-ex" rows={2} className="field" value={form.example_sentence} onChange={set('example_sentence')}
            placeholder={t('editWord.examplePlaceholder')} maxLength={500} />
          {generate.error && (
            <p className="mt-1 text-xs text-red-300">
              {isRateLimited(generate.error)
                ? rateLimitMessage(generate.error)
                : (generate.error as { response?: { status?: number } }).response?.status === 503
                  ? t('newContext.generateNotConfigured')
                  : t('newContext.generateFailed')}
            </p>
          )}
        </div>
        <div>
          <label className={label} htmlFor="ew-ext">{t('editWord.exampleTranslation')}</label>
          <textarea id="ew-ext" rows={2} className="field" value={form.example_translation} onChange={set('example_translation')} maxLength={500} />
        </div>

        <p className="text-xs text-emerald-100/50">{t('editWord.progressKept')}</p>
        {(localError || save.error) && (
          <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {localError ?? t('editWord.saveFailed', { error: errorMessage(save.error) })}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">{t('editWord.cancel')}</button>
          <button type="submit" disabled={save.isPending || generate.isPending} className="btn-primary">
            {save.isPending ? t('editWord.saving') : t('editWord.save')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
