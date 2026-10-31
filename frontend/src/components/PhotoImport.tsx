import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera, Check, CircleAlert, Folder as FolderIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { foldersApi, photoApi, searchApi, type PhotoImportResult, type PhotoWord } from '../api/endpoints'
import { apiErrorInfo, errorMessage, isFeatureError } from '../api/client'
import { ARTICLE_COLOR, splitArticle } from '../lib/article'
import { useLearningLang } from '../lib/learningLang'
import { useFeatures } from '../lib/features'
import { PhotoQualityError, isPhotoType, preparePhoto } from '../lib/photo'
import { takeHandedOffPhoto } from '../lib/photoHandoff'
import { FOLDER_COLORS, FolderSelect, useFolders } from './Folders'
import { toast } from './Toaster'

/**
 * "Add from a photo": take or choose a picture of a textbook page, review the words found, add the
 * chosen ones. One photo costs one unit of the daily quota (shown); the words are saved only when
 * the user confirms, through the same call as the search page.
 */
// Which message a rejected photo gets: by the on-device verdict, or by the server's 422 code.
const REJECTIONS = { too_small: 'photo.errTooSmall', too_dark: 'photo.errTooDark', blurry: 'photo.errBlurry' } as const
const REJECTION_CODES: Record<string, string> = {
  photo_not_document: 'photo.errNotDocument',
  photo_unreadable: 'photo.errUnreadable',
}

const BIG_DOTS_UP_TO = 5 // quota dots: larger up to this limit, smaller above it
const MAX_DOTS = 12 // above this the pill shows the text only

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
    // A photo rejected on this device never reached the server — nothing to refresh. A server-side
    // rejection (422) was refunded: the refresh keeps the shown quota correct.
    onError: (e) => { if (!(e instanceof PhotoQualityError)) void qc.invalidateQueries({ queryKey: ['me'] }) },
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

  // A photo chosen on the Home page: read it right away, once.
  useEffect(() => {
    const file = takeHandedOffPhoto()
    if (file && isOn('photo_import')) choose(file)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!isOn('photo_import')) return null
  const left = result ? result.remaining : remaining('photo_import')
  const limit = dailyLimit('photo_import')
  const exhausted = left === 0
  const hasFolders = (folders.data?.length ?? 0) > 0
  const mode = hasFolders ? folderMode : 'new'
  const seg = (on: boolean) =>
    `flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-semibold transition ${
      on ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface-2 text-muted hover:text-fg'
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
  // Photos rejected before or after the AI look: the daily limit was not used.
  const rejection = err instanceof PhotoQualityError ? REJECTIONS[err.reason] : REJECTION_CODES[apiErrorInfo(err).code ?? '']
  if (err && !localError) {
    const status = apiErrorInfo(err).status
    shown = rejection ? t(rejection)
      : isFeatureError(err) ? errorMessage(err)
      : status === 503 ? t('photo.notConfigured')
      : status === 413 ? t('photo.tooLarge')
      : t('photo.failed', { error: errorMessage(err) })
  }

  return (
    <section className="glass space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold text-fg"><Camera size={20} aria-hidden="true" className="text-accent-text" />{t('photo.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('photo.hint')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input ref={input} type="file" accept="image/*" className="hidden" data-testid="photo-input"
          onChange={(e) => choose(e.target.files?.[0])} />
        <button type="button" className="btn-primary" disabled={read.isPending || add.isPending || exhausted}
          onClick={() => input.current?.click()}>
          {read.isPending ? t('photo.reading') : (
            <><Camera size={18} aria-hidden="true" />{result ? t('photo.another') : t('photo.choose')}</>
          )}
        </button>
        {limit !== null && left !== null && (exhausted
          ? <span className="text-sm text-faint">{t('photo.noneLeft', { limit })}</span>
          : (
            <span data-testid="photo-quota" className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1 text-sm text-muted">
              {t('photo.left', { n: left, limit })}
              {/* Up to 5 photos: roomy dots; up to 12: small ones (10 fit a 360 px screen); more: text only. */}
              {limit <= MAX_DOTS && (
                <span className={`flex ${limit > BIG_DOTS_UP_TO ? 'gap-1' : 'gap-1.5'}`} aria-hidden="true">
                  {Array.from({ length: limit }, (_, i) => (
                    <span key={i} data-testid="photo-dot" data-filled={i < left}
                      className={`${limit > BIG_DOTS_UP_TO ? 'h-1.5 w-1.5' : 'h-2 w-2'} rounded-full ${i < left ? 'bg-accent' : 'bg-dot-off'}`} />
                  ))}
                </span>
              )}
            </span>
          ))}
      </div>

      {read.isPending && <div className="h-24 animate-pulse rounded-2xl bg-surface-2" />}

      {result && (result.words.length === 0 ? (
        <p className="text-muted">{t('photo.noWords')}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">{t('photo.found', { n: result.words.length })}</p>
          <ul className="max-h-96 divide-y divide-divider overflow-y-auto rounded-xl border border-line">
            {result.words.map((w) => {
              const done = saved.has(w.full_word)
              const disabled = w.already_added || done || add.isPending
              const { article, rest } = splitArticle(w.full_word, w.article)
              return (
                <li key={w.full_word}>
                  <label className={`flex min-h-12 items-center gap-3 px-3 py-2 ${w.already_added || done ? 'text-faint' : disabled ? 'opacity-60' : 'cursor-pointer hover:bg-surface-2'}`}>
                    <input type="checkbox" disabled={disabled} checked={!w.already_added && !done && picked.has(w.full_word)}
                      onChange={() => toggle(w)} className="h-5 w-5 shrink-0 accent-[var(--accent)]" />
                    <span className={`font-serif text-[17px] font-medium ${w.already_added || done ? '' : 'text-fg'}`} lang={learning.code}>
                      {article && <span className={w.already_added || done ? '' : ARTICLE_COLOR[article]}>{article} </span>}{rest}
                    </span>
                    <span className={`min-w-0 flex-1 truncate ${w.already_added || done ? '' : 'text-muted'}`}>{w.translation}</span>
                    {(w.already_added || done) && <span className="flex shrink-0 items-center gap-1 text-xs text-accent-text"><Check size={14} aria-hidden="true" />{t('photo.have')}</span>}
                  </label>
                </li>
              )
            })}
          </ul>
          <div className="space-y-2">
            {hasFolders && (
              <div role="radiogroup" aria-label={t('folders.label')} className="flex flex-wrap gap-2">
                <button type="button" role="radio" aria-checked={mode === 'new'} className={seg(mode === 'new')}
                  onClick={() => setFolderMode('new')}><FolderIcon size={16} aria-hidden="true" />{t('photo.folderNew')}</button>
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

      {shown && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger bg-surface-2 px-4 py-2 text-sm text-danger">
          <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <div>
            <p>{shown}</p>
            {rejection && !localError && <p className="mt-1 text-muted">{t('photo.notCharged')}</p>}
          </div>
        </div>
      )}
    </section>
  )
}
