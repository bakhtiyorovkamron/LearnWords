import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { foldersApi, photoApi, searchApi, type PhotoImportResult, type PhotoWord } from '../api/endpoints'
import { apiErrorInfo, errorMessage, isFeatureError } from '../api/client'
import { useLearningLang } from '../lib/learningLang'
import { useFeatures } from '../lib/features'
import { MAX_PHOTO_BYTES, isPhotoType, preparePhoto } from '../lib/photo'
import { FOLDER_COLORS, FolderSelect, useFolders } from './Folders'
import { toast } from './Toaster'

/**
 * "Add from a photo": take or choose a picture of a textbook page, review the words found, add the
 * chosen ones. One photo costs one unit of the daily quota (shown); the words are saved only when
 * the user confirms, through the same call as the search page.
 */
/** Today as dd.MM — the default folder is named after the lesson day. */
function todayLabel(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}`
}

export function PhotoImport() {
  const { t, i18n } = useTranslation()
  const learning = useLearningLang()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { isOn, remaining, dailyLimit } = useFeatures()
  const folders = useFolders()
  const input = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<PhotoImportResult | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState<Set<string>>(new Set()) // full_word values already added here
  const [folderMode, setFolderMode] = useState<'new' | 'existing'>('new')
  const defaultName = t('photo.folderDefault', { date: todayLabel() })
  const [newName, setNewName] = useState(defaultName)
  const [existingId, setExistingId] = useState('')
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
      const target = await resolveFolder()
      let added = 0, skipped = 0
      for (const w of words) {
        try {
          await searchApi.add({
            word: w.full_word, translation: w.translation, pronunciation: '',
            example_sentence: '', example_translation: '',
            translation_language: i18n.language, folder_id: target.id,
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
      return { added, skipped, folder: target }
    },
    onSuccess: ({ added, skipped, folder }) => {
      toast(t('photo.addedTo', { folder: folder.name, added, skipped }), {
        action: { label: t('photo.openFolder'), onClick: () => navigate(`/cards?tab=all&folder=${encodeURIComponent(folder.id)}`) },
        ms: 7000,
      })
      setResult(null)
    },
    onSettled: () => {
      for (const k of ['contexts', 'cards', 'collection', 'review-due', 'folders', 'stories', 'stats']) {
        void qc.invalidateQueries({ queryKey: [k] })
      }
    },
  })

  /** The folder the words go to — created (once, before the first word) when it is new. */
  async function resolveFolder(): Promise<{ id: string; name: string }> {
    const existing = folders.data ?? []
    if (folderMode === 'existing' && existing.length) {
      const f = existing.find((x) => x.id === (existingId || existing[0].id)) ?? existing[0]
      return { id: f.id, name: f.name }
    }
    const name = newName.trim() || defaultName
    // Re-read the list: the cached one may miss a folder made in another tab.
    const fresh = (await foldersApi.list()).folders
    const same = fresh.find((f) => f.name.trim().toLowerCase() === name.toLowerCase())
    const folder = same ?? await foldersApi.create(name, FOLDER_COLORS[0])
    void qc.invalidateQueries({ queryKey: ['folders'] })
    return { id: folder.id, name: folder.name }
  }

  if (!isOn('photo_import')) return null
  const left = result ? result.remaining : remaining('photo_import')
  const limit = dailyLimit('photo_import')
  const exhausted = left === 0
  const hasFolders = (folders.data?.length ?? 0) > 0
  const mode = hasFolders ? folderMode : 'new'
  const seg = (on: boolean) =>
    `rounded-xl border px-3 py-1.5 text-sm font-semibold transition ${
      on ? 'border-lime-400 bg-lime-400 text-emerald-950'
        : 'border-emerald-400/20 bg-emerald-950/40 text-emerald-100/80 hover:border-lime-400/50 hover:text-white'
    }`

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
      <div>
        <h2 className="display text-xl font-bold">📷 {t('photo.title')}</h2>
        <p className="mt-1 text-sm text-emerald-100/70">{t('photo.hint')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input ref={input} type="file" accept="image/*" className="hidden" data-testid="photo-input"
          onChange={(e) => choose(e.target.files?.[0])} />
        <button type="button" className="btn-primary" disabled={read.isPending || add.isPending || exhausted}
          onClick={() => input.current?.click()}>
          {read.isPending ? t('photo.reading') : result ? t('photo.another') : t('photo.choose')}
        </button>
        {limit !== null && left !== null && (exhausted
          ? <span className="text-sm text-emerald-100/60">{t('photo.noneLeft', { limit })}</span>
          : (
            <span data-testid="photo-quota" className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-sm">
              {t('photo.left', { n: left, limit })}
              {limit <= 20 && (
                <span className="flex gap-1" aria-hidden="true">
                  {Array.from({ length: limit }, (_, i) => (
                    <span key={i} data-testid="photo-dot" data-filled={i < left}
                      className={`h-1.5 w-1.5 rounded-full ${i < left ? 'bg-lime-300' : 'bg-white/15'}`} />
                  ))}
                </span>
              )}
            </span>
          ))}
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
          <div className="space-y-2">
            {hasFolders && (
              <div role="radiogroup" aria-label={t('folders.label')} className="flex flex-wrap gap-2">
                <button type="button" role="radio" aria-checked={mode === 'new'} className={seg(mode === 'new')}
                  onClick={() => setFolderMode('new')}>{t('photo.folderNew')}</button>
                <button type="button" role="radio" aria-checked={mode === 'existing'} className={seg(mode === 'existing')}
                  onClick={() => setFolderMode('existing')}>{t('photo.folderExisting')}</button>
              </div>
            )}
            {mode === 'new' ? (
              <input className="field max-w-sm" maxLength={50} value={newName} aria-label={t('photo.folderName')}
                placeholder={defaultName} onChange={(e) => setNewName(e.target.value)} />
            ) : (
              <FolderSelect withoutNone value={existingId || folders.data?.[0]?.id || ''} onChange={setExistingId} />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
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
