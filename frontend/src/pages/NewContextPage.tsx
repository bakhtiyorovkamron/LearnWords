import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { contextsApi, wordsApi } from '../api/endpoints'
import { errorMessage, isRateLimited, rateLimitMessage } from '../api/client'
import { resizeImage } from '../lib/image'
import { FolderSelect } from '../components/Folders'
import { useLearningLang } from '../lib/learningLang'

const MAX_LEN = 2000

export function NewContextPage() {
  const { t } = useTranslation()
  const learning = useLearningLang()
  const examples = learning.examples
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [meaning, setMeaning] = useState('')
  const [pronunciation, setPronunciation] = useState('')
  const [exampleSentence, setExampleSentence] = useState('')
  const [exampleTranslation, setExampleTranslation] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [folderId, setFolderId] = useState('') // optional; '' = no folder

  // AI example generation works for a single word (the word is replaced by ___ in the sentence).
  const singleWord = text.trim() !== '' && !/\s/.test(text.trim())
  const generate = useMutation({
    mutationFn: () => wordsApi.generateExample(text.trim(), meaning.trim()),
    onSuccess: (r) => {
      // Fill the fields; the user can still edit them before saving.
      setExampleSentence(r.example_sentence)
      setExampleTranslation(r.example_translation)
    },
  })

  useEffect(() => {
    if (!photo) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(photo)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  async function pickPhoto(file?: File) {
    if (!file) return
    setLocalError(null)
    try {
      setPhoto(await resizeImage(file))
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : t('newContext.errPhoto'))
    }
  }

  const mutation = useMutation({
    mutationFn: () =>
      contextsApi.create({
        text: text.trim(), meaning: meaning.trim(), pronunciation: pronunciation.trim(), photo, language: learning.code,
        exampleSentence: exampleSentence.trim(), exampleTranslation: exampleTranslation.trim(),
        folderId: folderId || undefined,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['contexts'] })
      qc.invalidateQueries({ queryKey: ['cards'] })
      qc.invalidateQueries({ queryKey: ['stories'] })
      qc.invalidateQueries({ queryKey: ['folders'] })
      qc.invalidateQueries({ queryKey: ['collection'] })
      qc.setQueryData(['context-words', res.context.id], res.cards)
      navigate(`/contexts/${res.context.id}`)
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setLocalError(null)
    if (!text.trim()) return setLocalError(t('newContext.errTextRequired', learning.vars))
    if (!meaning.trim()) return setLocalError(t('newContext.errTranslationRequired'))
    // Pronunciation is optional.
    mutation.mutate()
  }

  const error = localError ?? (mutation.error ? errorMessage(mutation.error) : null)
  const labelCls = 'mb-2 block text-xs uppercase tracking-wider text-emerald-300/60'

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="animate-rise text-center">
        <h1 className="display text-3xl font-extrabold md:text-4xl">
          {t('newContext.titleA')}<span className="text-lime-300">{t('newContext.titleB')}</span> ✨
        </h1>
        <p className="mt-2 text-emerald-100/70">{t('newContext.subtitle')}</p>
      </div>

      <form onSubmit={submit} className="glass animate-rise space-y-5 p-6 md:p-8">
        <div className="relative">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
            rows={7}
            autoFocus
            placeholder={learning.phrasePlaceholder}
            lang={learning.code}
            className="field resize-none text-lg leading-relaxed"
          />
          <span className="absolute bottom-3 right-4 text-xs text-emerald-300/50">
            {text.length}/{MAX_LEN}
          </span>
        </div>

        <div>
          <label className={labelCls}>{t('newContext.translation')}</label>
          <input
            value={meaning}
            required
            onChange={(e) => setMeaning(e.target.value.slice(0, 500))}
            placeholder={t('newContext.translationPlaceholder')}
            className="field"
          />
        </div>

        <div>
          <label className={labelCls}>{t('newContext.pronunciation')}</label>
          <input
            value={pronunciation}
            onChange={(e) => setPronunciation(e.target.value.slice(0, 200))}
            placeholder={learning.pronunciationPlaceholder}
            className="field"
          />
        </div>

        <div>
          <label className={labelCls}>{t('folders.fieldLabel')}</label>
          <FolderSelect value={folderId} onChange={setFolderId} className="w-full" />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <label className="text-xs uppercase tracking-wider text-emerald-300/60">{t('newContext.example')}</label>
            <button type="button" onClick={() => generate.mutate()}
              disabled={generate.isPending || !singleWord || !meaning.trim()}
              title={singleWord ? t('newContext.hintNeedTranslation') : t('newContext.hintSingleWord')}
              className="btn-ghost shrink-0 disabled:opacity-50">
              {generate.isPending ? (
                <>
                  <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-lime-300 border-t-transparent" />
                  {t('newContext.generating')}
                </>
              ) : (
                t('newContext.generate')
              )}
            </button>
          </div>
          <input
            value={exampleSentence}
            onChange={(e) => setExampleSentence(e.target.value.slice(0, 500))}
            placeholder={learning.gapPlaceholder}
            className="field"
          />
          <input
            value={exampleTranslation}
            onChange={(e) => setExampleTranslation(e.target.value.slice(0, 500))}
            placeholder={t('newContext.exampleTranslationPlaceholder')}
            className="field"
          />
          {generate.error && (
            <p className="text-sm text-red-300">
              {isRateLimited(generate.error)
                ? rateLimitMessage(generate.error)
                : (generate.error as { response?: { status?: number } }).response?.status === 503
                  ? t('newContext.generateNotConfigured')
                  : t('newContext.generateFailed')}
            </p>
          )}
          {!exampleSentence && (
            <p className="text-xs text-emerald-300/50">{t('newContext.autoExampleHint')}</p>
          )}
        </div>

        <div>
          <label className={labelCls}>{t('newContext.photo')}</label>
          {preview ? (
            <div className="relative overflow-hidden rounded-2xl">
              <img src={preview} alt="" className="aspect-[4/3] w-full object-cover" />
              <button type="button" onClick={() => setPhoto(null)}
                className="absolute right-3 top-3 rounded-full bg-emerald-950/70 px-3 py-1.5 text-xs font-semibold text-lime-300 backdrop-blur hover:bg-emerald-950">
                {t('newContext.removePhoto')}
              </button>
            </div>
          ) : (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-emerald-400/30 py-8 text-emerald-200/70 transition hover:border-lime-400 hover:text-lime-300">
              <span className="text-3xl">📷</span>
              <span className="text-sm font-semibold">{t('newContext.uploadPhoto')}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = '' }} />
            </label>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-emerald-300/60">{t('newContext.tryExample')}</p>
          <div className="flex flex-wrap gap-2">
            {examples.map((ex) => (
              <button key={ex} type="button" onClick={() => setText(ex)}
                className="rounded-full border border-emerald-400/20 bg-emerald-950/40 px-4 py-1.5 text-sm text-emerald-100/80 transition hover:border-lime-400/50 hover:bg-lime-400/10 hover:text-lime-200">
                {ex}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">{error}</p>
        )}

        <button type="submit" disabled={mutation.isPending} className="btn-primary w-full text-lg">
          {mutation.isPending ? (
            <>
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-950 border-t-transparent" />
              {t('newContext.analyzing')}
            </>
          ) : (
            t('newContext.submit')
          )}
        </button>
      </form>
    </div>
  )
}
