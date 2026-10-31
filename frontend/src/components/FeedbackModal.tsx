import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Heart, Star, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { feedbackApi, type Me } from '../api/endpoints'
import { toast } from './Toaster'

const STARS = [1, 2, 3, 4, 5]

/**
 * The one-time "how do you like yodla?" window: a 1-5 star rating and an optional comment.
 * Sending or closing (✕ / Esc / outside click) both answer it for good — ask_feedback goes false in
 * the ['me'] cache so it never comes back (the server also remembers).
 */
export function FeedbackModal() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState('')
  const [open, setOpen] = useState(true)
  const answered = useRef(false)

  function finish() {
    answered.current = true
    setOpen(false)
    qc.setQueryData<Me>(['me'], (old) => (old ? { ...old, ask_feedback: false } : old))
  }

  const send = useMutation({
    mutationFn: () => feedbackApi.submit(rating, comment.trim()),
    onSuccess: () => toast(t('feedback.thanks'), { icon: Heart }),
  })
  const dismiss = useMutation({ mutationFn: feedbackApi.dismiss })

  function submit() {
    if (!rating || answered.current) return
    send.mutate()
    finish()
  }
  function close() {
    if (answered.current) return
    dismiss.mutate()
    finish()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!open) return null
  const shown = hover || rating
  const placeholder = !rating ? t('feedback.placeholder') : rating <= 3 ? t('feedback.placeholderLow') : t('feedback.placeholderHigh')

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="feedback-title"
        className="glass relative max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto p-6 text-left">
        <button type="button" onClick={close} aria-label={t('folders.close')}
          className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-surface-2"><X size={20} aria-hidden="true" /></button>
        <h2 id="feedback-title" className="pr-10 text-2xl font-bold text-fg">{t('feedback.title')}</h2>

        <div role="radiogroup" aria-labelledby="feedback-title" className="flex justify-center gap-1" onMouseLeave={() => setHover(0)}>
          {STARS.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={t('feedback.star', { n })}
              onClick={() => setRating(n)} onMouseEnter={() => setHover(n)}
              className={`grid h-14 w-14 place-items-center transition active:scale-90 ${n <= shown ? 'text-streak' : 'text-dot-off'}`}>
              <Star size={36} aria-hidden="true" data-filled={n <= shown} className={n <= shown ? 'fill-current' : ''} />
            </button>
          ))}
        </div>

        <textarea rows={3} maxLength={1000} className="field" value={comment} placeholder={placeholder}
          aria-label={placeholder} onChange={(e) => setComment(e.target.value)} />

        <button type="button" className="btn-primary w-full" disabled={!rating} onClick={submit}>{t('feedback.send')}</button>
      </div>
    </div>,
    document.body,
  )
}
