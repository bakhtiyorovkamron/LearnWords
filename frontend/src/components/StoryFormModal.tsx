import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { storiesApi, type DailyStory, type OwnStoryInput } from '../api/endpoints'
import { apiErrorInfo, errorMessage, isRateLimited, rateLimitMessage } from '../api/client'
import { useLearningLang } from '../lib/learningLang'
import { toast } from './Toaster'

// Same limits as the server (code points, not UTF-16 units).
export const TEXT_MIN = 10
export const TEXT_MAX = 4000
export const TITLE_MAX = 120
export const TRANSLATION_MAX = 8000
const CYRILLIC_SHARE = 0.3

type Mode = OwnStoryInput['translation_mode']

const length = (s: string) => Array.from(s).length
const normalize = (s: string) => s.replace(/\r\n?/g, '\n').trim()

/** Share of letters that are Cyrillic (0 when the text has no letters) — the server's rule. */
export function cyrillicShare(s: string): number {
  const letters = s.match(/\p{L}/gu)?.length ?? 0
  if (!letters) return 0
  return (s.match(/\p{Script=Cyrillic}/gu)?.length ?? 0) / letters
}

type Problem = 'errText' | 'errCyrillic' | 'errTitle' | 'errTranslation'

/** The client-side checks; the first problem found, or null when the story may be sent. */
export function checkOwnStory(f: { title: string; text: string; mode: Mode; translation: string }): Problem | null {
  const text = normalize(f.text)
  if (length(text) < TEXT_MIN || length(text) > TEXT_MAX) return 'errText'
  if (cyrillicShare(text) > CYRILLIC_SHARE) return 'errCyrillic'
  if (length(f.title.trim()) > TITLE_MAX) return 'errTitle'
  if (f.mode === 'manual') {
    const tr = normalize(f.translation)
    if (!tr || length(tr) > TRANSLATION_MAX) return 'errTranslation'
  }
  return null
}

/**
 * Add / edit an own story: the text in the learning language and its translation — written by the
 * user or made by the system. Edit mode (a `story` is given) prefills everything; the manual field
 * starts with the story's current translation so an automatic one can be corrected by hand.
 */
export function StoryFormModal({ story, initialMode, onClose, onSaved }: {
  story?: DailyStory
  initialMode?: Mode
  onClose: () => void
  onSaved?: (story: DailyStory) => void
}) {
  const { t, i18n } = useTranslation()
  const learning = useLearningLang()
  const qc = useQueryClient()

  const [title, setTitle] = useState(story?.title ?? '')
  const [text, setText] = useState(story?.story_de ?? '')
  const [mode, setMode] = useState<Mode>(initialMode ?? (story?.translation_source === 'user' ? 'manual' : 'auto'))
  const [translation, setTranslation] = useState(story?.story_translation ?? '')
  const [problem, setProblem] = useState<Problem | null>(null)

  const save = useMutation({
    mutationFn: (body: OwnStoryInput) => (story ? storiesApi.updateOwn(story.id, body) : storiesApi.createOwn(body)),
    onSuccess: (saved) => {
      qc.setQueryData(['stories', 'by-id', saved.id, i18n.language], saved)
      void qc.invalidateQueries({ queryKey: ['stories'] })
      toast(t('story.own.saved'))
      onSaved?.(saved)
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
    const found = checkOwnStory({ title, text, mode, translation })
    setProblem(found)
    if (found) return // nothing is sent
    save.mutate({
      title: title.trim(), text: normalize(text), translation_mode: mode,
      translation: mode === 'manual' ? normalize(translation) : '',
    })
  }

  // Server errors: 503 = no AI for the automatic translation, 429 = rate limit; the form keeps
  // everything the user typed in every case.
  let serverError: string | null = null
  if (save.error) {
    serverError = isRateLimited(save.error) ? rateLimitMessage(save.error)
      : apiErrorInfo(save.error).status === 503 ? t('story.own.autoUnavailable')
      : t('story.own.saveFailed', { error: errorMessage(save.error) })
  }
  const shown = problem
    ? t(`story.own.${problem}`, { ...learning.vars, min: TEXT_MIN, max: problem === 'errTitle' ? TITLE_MAX : TEXT_MAX })
    : serverError

  const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-emerald-100/60'
  const pill = (on: boolean) =>
    `rounded-xl border px-4 py-2 text-sm font-semibold transition ${
      on ? 'border-lime-400 bg-lime-400 text-emerald-950'
        : 'border-emerald-400/20 bg-emerald-950/40 text-emerald-100/80 hover:border-lime-400/50 hover:text-white'
    }`

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="story-form-title"
        className="glass max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto p-6 text-left">
        <h2 id="story-form-title" className="display text-2xl font-extrabold">
          {story ? t('story.own.editTitle') : `✍️ ${t('story.own.addTitle')}`}
        </h2>
        <p className="text-sm text-emerald-100/70">{t('story.own.intro', learning.vars)}</p>

        <div>
          <label className={label} htmlFor="sf-title">{t('story.own.titleLabel')}</label>
          <input id="sf-title" className="field" value={title} maxLength={TITLE_MAX}
            placeholder={t('story.own.titlePlaceholder')} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div>
          <label className={label} htmlFor="sf-text">{t('story.own.textLabel', learning.vars)} *</label>
          <textarea id="sf-text" rows={8} className="field" lang={learning.code} value={text}
            onChange={(e) => setText(e.target.value)} autoFocus={!story} />
          <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-emerald-100/50">
            <span>{t('story.own.textHint')}</span>
            <span className={length(text) > TEXT_MAX ? 'text-red-300' : ''}>{length(text)} / {TEXT_MAX}</span>
          </div>
        </div>

        <div>
          <p className={label}>{t('story.own.translationLabel')}</p>
          <div role="radiogroup" aria-label={t('story.own.translationLabel')} className="flex flex-wrap gap-2">
            <button type="button" role="radio" aria-checked={mode === 'auto'} className={pill(mode === 'auto')}
              onClick={() => setMode('auto')}>{t('story.own.modeAuto')}</button>
            <button type="button" role="radio" aria-checked={mode === 'manual'} className={pill(mode === 'manual')}
              onClick={() => setMode('manual')}>{t('story.own.modeManual')}</button>
          </div>
          {mode === 'auto' ? (
            <p className="mt-2 text-sm text-emerald-100/60">{t('story.own.autoHint')}</p>
          ) : (
            <div className="mt-3">
              <label className={label} htmlFor="sf-translation">{t('story.own.manualLabel')}</label>
              <textarea id="sf-translation" rows={6} className="field" maxLength={TRANSLATION_MAX} value={translation}
                onChange={(e) => setTranslation(e.target.value)} autoFocus={!!story && initialMode === 'manual'} />
              <p className="mt-1 text-xs text-emerald-100/50">{t('story.own.manualHint')}</p>
            </div>
          )}
        </div>

        {shown && (
          <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">{shown}</p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">{t('story.own.cancel')}</button>
          <button type="submit" disabled={save.isPending} className="btn-primary">
            {save.isPending ? t(mode === 'manual' ? 'story.own.saving' : 'story.own.translating') : t('story.own.save')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
