import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { FolderInput, Pencil, Trash, Trash2, Volume2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WordCard } from '../api/types'
import { ARTICLE_COLOR, splitArticle } from '../lib/article'
import { useDeleteWords } from '../lib/deleteWords'
import { fillGap } from '../lib/gap'
import { useMoveWords } from '../lib/moveWords'
import { EditWordModal } from './EditWordModal'
import { FolderPicker } from './FolderPicker'
import { useCanSpeak, speak } from '../lib/speech'
import { ProgressDots } from './ProgressDots'
import { Sheet } from './Sheet'

// A recorded audio_url is played first; otherwise (or if it fails) the browser reads the word in the
// card's language.
function play(card: WordCard) {
  if (card.audio_url && /^https?:/.test(card.audio_url)) {
    new Audio(card.audio_url).play().catch(() => speak(card.word, card.language))
  } else {
    speak(card.word, card.language)
  }
}

/** The word with its article in the article's colour (der / die / das); no article → plain. */
export function Word({ card }: { card: Pick<WordCard, 'word' | 'article'> }) {
  const { article, rest } = splitArticle(card.word, card.article)
  return (
    <>
      {article && <span data-article={article} className={ARTICLE_COLOR[article]}>{article} </span>}
      {rest}
    </>
  )
}

const sheetAction = 'flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base font-medium transition hover:bg-surface-2'

const PANEL = 168 // the swipe panel: two 84px actions
const ROW_OPEN = 'word-row-open' // window event: a row opened its panel (detail = card id); the others close
const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

type Sample = { x: number; t: number }
type Gesture = { x: number; y: number; start: number; offset: number; width: number; mode: 'pending' | 'swipe' | 'scroll'; prev: Sample; last: Sample }

/**
 * Swipe a row left to reveal its actions. Vertical moves stay native scroll (touch-action: pan-y);
 * a horizontal move of 8px decides it is a swipe. On release: past 60% of the row → onFullSwipe,
 * past half the panel or a fast flick → open, otherwise closed. Only one row is open at a time.
 */
function useRowSwipe(id: string, enabled: boolean, onFullSwipe: () => void) {
  const [offset, setOffset] = useState(0) // 0 (closed) … -row width
  const [dragging, setDragging] = useState(false)
  const gesture = useRef<Gesture | null>(null)
  const moved = useRef(false) // the click after a swipe must not open the sheet
  const open = offset < 0

  useEffect(() => {
    if (!open) return
    const close = () => setOffset(0)
    const onOther = (e: Event) => { if ((e as CustomEvent<string>).detail !== id) close() }
    window.addEventListener(ROW_OPEN, onOther)
    window.addEventListener('scroll', close, { passive: true })
    return () => {
      window.removeEventListener(ROW_OPEN, onOther)
      window.removeEventListener('scroll', close)
    }
  }, [open, id])

  function onPointerDown(e: ReactPointerEvent<HTMLElement>) {
    moved.current = false
    gesture.current = null
    if (!enabled || (e.target as Element).closest('[data-no-swipe]')) return
    const s = { x: e.clientX, t: Date.now() }
    gesture.current = { x: e.clientX, y: e.clientY, start: offset, offset, width: 0, mode: 'pending', prev: s, last: s }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLElement>) {
    const g = gesture.current
    if (!g || g.mode === 'scroll') return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (g.mode === 'pending') {
      if (Math.abs(dx) > 8 && Math.abs(dx) > 1.2 * Math.abs(dy)) {
        g.mode = 'swipe'
        g.width = e.currentTarget.getBoundingClientRect().width || e.currentTarget.offsetWidth
        moved.current = true
        setDragging(true)
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* no capture (jsdom): moves still arrive on the row */ }
      } else {
        if (Math.abs(dy) > 8) g.mode = 'scroll' // a scroll: give up for this gesture
        return
      }
    }
    g.prev = g.last
    g.last = { x: e.clientX, t: Date.now() }
    g.offset = Math.min(0, Math.max(-g.width, g.start + dx))
    setOffset(g.offset)
  }

  function onPointerEnd() {
    const g = gesture.current
    gesture.current = null
    if (!g || g.mode !== 'swipe') return
    setDragging(false)
    // px/ms of the last move; a pause before releasing is no flick.
    const dt = g.last.t - g.prev.t
    const v = dt > 0 && Date.now() - g.last.t < 100 ? (g.last.x - g.prev.x) / dt : 0
    if (g.offset < -0.6 * g.width) {
      setOffset(0)
      onFullSwipe()
    } else if (g.offset < -PANEL / 2 || v < -0.5) {
      setOffset(-PANEL)
      window.dispatchEvent(new CustomEvent(ROW_OPEN, { detail: id }))
    } else {
      setOffset(0)
    }
  }

  /** True when the click belongs to the swipe (it ended one, or closes the open panel). */
  function takeClick() {
    if (moved.current) {
      moved.current = false
      return true
    }
    if (open) {
      setOffset(0)
      return true
    }
    return false
  }

  return {
    offset, open, takeClick, close: () => setOffset(0),
    transition: dragging || reducedMotion() ? 'none' : 'transform 200ms ease-out',
    handlers: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd },
  }
}

/**
 * One word of the collection, as a row: the word (article coloured) with its translation, the box
 * indicator and a listen button. A tap opens the word's sheet (details, edit, move, delete); in select
 * mode it ticks the checkbox instead.
 */
export function WordCardView({ card, progress, selection }: {
  card: WordCard
  // When given (Collection page): the compact box indicator.
  progress?: { boxLevel: number; isLearned: boolean; nextReviewAt: string; reviewedToday: boolean }
  // Select mode (Collection, bulk move): a checkbox; a tap toggles.
  selection?: { checked: boolean; onToggle: () => void }
}) {
  const { t } = useTranslation()
  const [sheet, setSheet] = useState(false)
  const [editing, setEditing] = useState(false)
  const [picking, setPicking] = useState(false)
  const canSpeak = useCanSpeak(card.language)
  const moveWords = useMoveWords()
  async function moveTo(folderId: string | null, folderName: string) {
    setPicking(false)
    await moveWords([card.id], folderId, folderName)
  }
  const deleteWords = useDeleteWords()

  // No confirm: the row disappears at once (the lists drop hidden words) and the toast offers Undo.
  function onDelete() {
    setSheet(false)
    deleteWords([{ id: card.id, word: card.word }])
  }
  // Swipe left: Move / Delete; a full swipe deletes at once. Off in select mode.
  const swipe = useRowSwipe(card.id, !selection, () => deleteWords([{ id: card.id, word: card.word }]))
  const swipeAction = 'flex w-[84px] flex-col items-center justify-center gap-1 text-xs font-semibold'

  // The modals are siblings of the row, not children: a click inside them must not reach the row.
  return (
    <>
      <div
        data-testid="word-row"
        {...swipe.handlers}
        onClick={() => {
          if (swipe.takeClick()) return
          if (selection) selection.onToggle()
          else setSheet(true)
        }}
        className={`relative flex min-h-16 cursor-pointer touch-pan-y select-none items-center gap-3 overflow-hidden px-4 py-2.5 transition [-webkit-touch-callout:none] hover:bg-surface-2 ${
          selection?.checked ? 'bg-surface-2' : ''}`}
      >
        {selection && (
          <input type="checkbox" checked={selection.checked} onChange={selection.onToggle}
            onClick={(e) => e.stopPropagation()} aria-label={card.word}
            className="h-5 w-5 shrink-0 accent-[var(--accent)]" />
        )}
        <button type="button" aria-haspopup="dialog" className="min-w-0 flex-1 text-left">
          <span className="block truncate font-serif text-[18px] font-medium text-fg" lang={card.language}><Word card={card} /></span>
          <span className="block truncate text-sm text-muted">{card.translation}</span>
        </button>
        {progress && (
          <ProgressDots compact boxLevel={progress.boxLevel} isLearned={progress.isLearned}
            schedule={{ nextReviewAt: progress.nextReviewAt, reviewedToday: progress.reviewedToday }} />
        )}
        {canSpeak && (
          <button type="button" data-no-swipe onClick={(e) => { e.stopPropagation(); play(card) }} aria-label={t('wordCard.listen')} title={t('wordCard.listen')}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line text-muted transition hover:bg-surface-2">
            <Volume2 size={18} aria-hidden="true" />
          </button>
        )}
        {/* Slides in from the right over the row; the row content stays in place. */}
        {!selection && (
          <div aria-hidden={!swipe.open || undefined} data-testid="swipe-panel"
            onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
            className="absolute inset-y-0 right-0 flex w-[168px] shadow-[-6px_0_14px_-6px_rgba(0,0,0,0.3)]"
            style={{ transform: `translateX(${PANEL + swipe.offset}px)`, transition: swipe.transition }}>
            <button type="button" tabIndex={swipe.open ? 0 : -1} className={`${swipeAction} bg-surface-2 text-accent-text`}
              onClick={() => { swipe.close(); setPicking(true) }}>
              <FolderInput size={20} aria-hidden="true" />{t('del.swipeMove')}
            </button>
            <button type="button" tabIndex={swipe.open ? 0 : -1} className={`${swipeAction} bg-danger text-on-accent`}
              onClick={() => { swipe.close(); deleteWords([{ id: card.id, word: card.word }]) }}>
              <Trash2 size={20} aria-hidden="true" />{t('del.swipeDelete')}
            </button>
          </div>
        )}
      </div>

      {sheet && (
        <Sheet label={card.word} onClose={() => setSheet(false)}>
          <div className="space-y-1">
            <p className="font-serif text-[22px] leading-tight text-fg" lang={card.language}><Word card={card} /></p>
            {card.transcription && <p className="text-sm text-muted">{card.transcription}</p>}
            {card.translation && <p className="text-fg">{card.translation}</p>}
          </div>
          {card.example_sentence && (
            <div className="mt-4 space-y-0.5 border-t border-divider pt-3">
              <p className="font-serif italic text-fg" lang={card.language}>{fillGap(card)}</p>
              {card.example_translation && <p className="text-sm text-muted">{card.example_translation}</p>}
            </div>
          )}
          <div className="mt-4 space-y-1 border-t border-divider pt-3">
            <button type="button" className={`${sheetAction} text-fg`} onClick={() => { setSheet(false); setEditing(true) }}>
              <Pencil size={18} aria-hidden="true" />{t('editWord.title')}
            </button>
            <button type="button" className={`${sheetAction} text-fg`} onClick={() => { setSheet(false); setPicking(true) }}>
              <FolderInput size={18} aria-hidden="true" />{t('word.move')}
            </button>
            <button type="button" className={`${sheetAction} text-danger`} onClick={onDelete}>
              <Trash size={18} aria-hidden="true" />{t('wordCard.delete')}
            </button>
          </div>
        </Sheet>
      )}
      {editing && <EditWordModal card={card} onClose={() => setEditing(false)} />}
      {picking && <FolderPicker title={t('word.move')} current={card.folder_id ?? ''}
        onPick={moveTo} onClose={() => setPicking(false)} />}
    </>
  )
}
