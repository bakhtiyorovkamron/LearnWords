import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { photoApi, searchApi, type PhotoImportResult, type PhotoWord } from '../api/endpoints'
import { apiErrorInfo, errorMessage, isFeatureError } from '../api/client'
import { useLearningLang } from '../lib/learningLang'
import { useFeatures } from '../lib/features'
import { MAX_PHOTO_BYTES, isPhotoType, preparePhoto } from '../lib/photo'
import { FolderSelect } from './Folders'
import { toast } from './Toaster'

/**
 * "Add from a photo": take or choose a picture of a textbook page, review the words found, add the
 * chosen ones. One photo costs one unit of the daily quota (shown); the words are saved only when
 * the user confirms, through the same call as the search page.
 */
export function PhotoImport() {
  const { t, i18n } = useTranslation()
  const learning = useLearningLang()
  const qc = useQueryClient()
  const { isOn, remaining } = useFeatures()
  const input = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<PhotoImportResult | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState<Set<string>>(new Set()) // full_word values already added here
  const [folder, setFolder] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const read = useMutation({
    mutationFn: async (file: File) => photoApi.import(await preparePhoto(file)),
    onSuccess: (r) => {
      setResult(r)
      setSaved(new Set())
      setPicked(new Set(r.words.filter((w) => !w.already_added).map((w) => w.full_word)))
      void qc.invalidateQueries({ queryKey: ['me'] }) // the quota left
    },
    onError: () => void qc.invalidateQueries({ queryKey: ['me'] }),
  })

  const add = useMutation({
    mutationFn: async (words: PhotoWord[]) => {
      let added = 0, skipped = 0
      for (const w of words) {
        try {
          await searchApi.add({
            word: w.full_word, translation: w.translation, pronunciation: '',
            example_sentence: '', example_translation: '',
            translation_language: i18n.language, folder_id: folder || undefined,
            ...(learning.code === 'de' && w.word_type !== 'phrase' && w.word_type !== 'other' && {
              lemma: w.word, article: w.word_type === 'noun' ? w.article : null, plural: null, part_of_speech: w.word_type,
            }),
          })
          added++
        } catch (e) {
          if (apiErrorInfo(e).status !== 409) throw Object.assign(e as object, { added, skipped }) // 409: already there
          skipped++
        }
        setSaved((s) => new Set(s).add(w.full_word))
      }
      return { added, skipped }
    },
    onSuccess: ({ added, skipped }) => {
      toast(t('photo.added', { added, skipped }))
      setResult(null)
    },
    onSettled: () => {
      for (const k of ['contexts', 'cards', 'collection', 'review-due', 'folders', 'stories', 'stats']) {
        void qc.invalidateQueries({ queryKey: [k] })
      }
    },
  })

  if (!isOn('photo_import')) return null
  const left = result ? result.remaining : remaining('photo_import')
  const exhausted = left === 0

  function choose(file: File | undefined) {
    if (input.current) input.current.value = '' // the same file can be chosen again
    if (!file) return
    setLocalError(null)
    if (!isPhotoType(file.type)) return setLocalError(t('photo.notImage'))
    read.reset()
    add.reset()
    read.mutate(file)
  }

  function toggle(w: PhotoWord) {
    setPicked((s) => {
      const n = new Set(s)
      if (!n.delete(w.full_word)) n.add(w.full_word)
      return n
    })
  }

  const chosen = (result?.words ?? []).filter((w) => picked.has(w.full_word) && !saved.has(w.full_word))
  const err = read.error ?? add.error
  let shown: string | null = localError
  if (err && !localError) {
    const status = apiErrorInfo(err).status
    shown = isFeatureError(err) ? errorMessage(err)
      : status === 503 ? t('photo.notConfigured')
      : status === 413 ? t('photo.tooLarge')
      : t('photo.failed', { error: errorMessage(err) })
  }

  return (
    <section className="glass animate-rise space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="display text-xl font-bold">📷 {t('photo.title')}</h2>
          <p className="mt-1 text-sm text-emerald-100/70">{t('photo.hint')}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <input ref={input} type="file" accept="image/*" className="hidden" data-testid="photo-input"
            onChange={(e) => choose(e.target.files?.[0])} />
          <button type="button" className="btn-primary" disabled={read.isPending || add.isPending || exhausted}
            onClick={() => input.current?.click()}>
            {read.isPending ? t('photo.reading') : result ? t('photo.another') : t('photo.choose')}
          </button>
          {left !== null && <span className="text-xs text-emerald-100/60">{t('photo.left', { n: left })}</span>}
        </div>
      </div>

      {read.isPending && <div className="h-24 animate-pulse rounded-2xl bg-emerald-800/30" />}

      {result && (result.words.length === 0 ? (
        <p className="text-emerald-100/70">{t('photo.noWords')}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-emerald-100/70">{t('photo.found', { n: result.words.length })}</p>
          <ul className="max-h-96 space-y-1 overflow-y-auto">
            {result.words.map((w) => {
              const done = saved.has(w.full_word)
              const disabled = w.already_added || done || add.isPending
              return (
                <li key={w.full_word}>
                  <label className={`flex items-center gap-3 rounded-xl px-3 py-2 ${disabled ? 'opacity-60' : 'cursor-pointer hover:bg-emerald-400/10'}`}>
                    <input type="checkbox" disabled={disabled} checked={!w.already_added && !done && picked.has(w.full_word)}
                      onChange={() => toggle(w)} />
                    <span className="font-semibold" lang={learning.code}>{w.full_word}</span>
                    <span className="min-w-0 flex-1 truncate text-emerald-100/70">{w.translation}</span>
                    {(w.already_added || done) && <span className="shrink-0 text-xs text-lime-300">✓ {t('photo.have')}</span>}
                  </label>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <FolderSelect value={folder} onChange={setFolder} />
            <button type="button" className="btn-primary" disabled={!chosen.length || add.isPending}
              onClick={() => add.mutate(chosen)}>
              {add.isPending ? t('photo.adding') : t('photo.add', { count: chosen.length })}
            </button>
          </div>
        </div>
      ))}

      {shown && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">{shown}</p>}
    </section>
  )
}
