import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { cardsApi } from '../api/endpoints'
import type { WordCard } from '../api/types'
import { knowledgeStatus, ProgressDots, STATUS_STYLE } from './ProgressDots'
import { EditWordModal } from './EditWordModal'
import { FolderPicker } from './FolderPicker'
import { useMoveWords } from '../lib/moveWords'

// Pronunciation is available only for German; other languages have no audio.
export const hasAudio = (lang: string) => lang === 'de'

// Mock storage returns mock:// URLs which browsers can't play — fall back to Web Speech API.
function play(card: WordCard) {
  if (!hasAudio(card.language)) return
  if (card.audio_url && /^https?:/.test(card.audio_url)) {
    new Audio(card.audio_url).play().catch(() => speak(card))
  } else {
    speak(card)
  }
}

function speak(card: WordCard) {
  if (!('speechSynthesis' in window)) return
  // "der Samstag / der Sonnabend" → pronounce only the first variant.
  const u = new SpeechSynthesisUtterance(card.word.split('/')[0].trim())
  u.lang = 'de-DE'
  window.speechSynthesis.speak(u)
}

/** The «⋯» menu: a bottom sheet on phones (above the tab bar), a centered dialog on desktop. */
function WordMenu({ title, onMove, onClose }: { title: string; onMove: () => void; onClose: () => void }) {
  const { t } = useTranslation()
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm md:items-center md:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="menu" aria-label={title}
        className="animate-rise glass w-full !rounded-b-none rounded-t-3xl pb-[var(--nav-h)] md:max-w-xs md:!rounded-3xl md:pb-0">
        <p className="truncate border-b border-emerald-400/10 px-5 py-3 text-sm font-semibold text-emerald-100/70">{title}</p>
        <div className="p-2">
          <button type="button" role="menuitem" onClick={onMove}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-base transition hover:bg-emerald-400/10">
            📁 {t('word.move')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function WordCardView({ card, index = 0, meaning, progress, selection }: {
  card: WordCard; index?: number; meaning?: string
  // When given (Collection page): status colour + 5-dot box_level indicator.
  progress?: { boxLevel: number; isLearned: boolean; nextReviewAt: string; reviewedToday: boolean }
  // Select mode (Collection, bulk move): a checkbox instead of the action buttons; a tap toggles.
  selection?: { checked: boolean; onToggle: () => void }
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  // «⋯» → «Move to folder»: only the grouping changes, progress stays the same.
  const [menuOpen, setMenuOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const moveWords = useMoveWords()
  async function moveTo(folderId: string | null, folderName: string) {
    setPicking(false)
    await moveWords([card.id], folderId, folderName)
  }
  const regen = useMutation({
    mutationFn: () => cardsApi.regenerateAudio(card.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cards'] }),
  })
  const remove = useMutation({
    mutationFn: () => cardsApi.remove(card.id),
    onSuccess: () => {
      // Drop the card from every cached list immediately.
      qc.setQueriesData<WordCard[]>({ queryKey: ['cards'] }, (old) => old?.filter((c) => c.id !== card.id))
      qc.setQueriesData<WordCard[]>({ queryKey: ['context-words'] }, (old) => old?.filter((c) => c.id !== card.id))
      qc.invalidateQueries({ queryKey: ['collection'] })
    },
  })

  function onDelete() {
    if (window.confirm(t('wordCard.deleteConfirm', { word: card.word }))) remove.mutate()
  }

  const tone = progress
    ? STATUS_STYLE[knowledgeStatus(progress.boxLevel, progress.isLearned)].card
    : 'border-emerald-400/15 from-emerald-800/60 to-emerald-900/40'

  return (
    <div
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
      onClick={selection?.onToggle}
      className={`animate-rise group relative overflow-hidden rounded-2xl border bg-gradient-to-br ${tone} p-4 transition hover:-translate-y-1 hover:border-lime-400/40 hover:shadow-xl hover:shadow-emerald-500/20 ${remove.isPending ? 'pointer-events-none opacity-40' : ''} ${selection ? 'cursor-pointer' : ''} ${selection?.checked ? 'ring-2 ring-lime-300' : ''}`}
    >
      <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-lime-400/10 blur-2xl transition group-hover:bg-lime-400/25" />
      {progress && (
        <div className="relative mb-2"><ProgressDots boxLevel={progress.boxLevel} isLearned={progress.isLearned}
          schedule={{ nextReviewAt: progress.nextReviewAt, reviewedToday: progress.reviewedToday }} /></div>
      )}
      <div className="relative flex items-center gap-3">
        {selection && (
          <input type="checkbox" checked={selection.checked} onChange={selection.onToggle}
            onClick={(e) => e.stopPropagation()} aria-label={card.word}
            className="h-5 w-5 shrink-0 accent-lime-400" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-bold text-white">{card.word}</div>
          <div className="font-mono text-xs text-lime-300/80">{card.transcription}</div>
          <div className="mt-1 text-sm text-emerald-100/80">{card.translation}</div>
          {meaning && meaning !== card.translation && (
            <div className="mt-1 text-sm font-semibold text-lime-200">— {meaning}</div>
          )}
          {card.example_sentence && (
            <div className="mt-2 border-t border-emerald-400/10 pt-2 text-xs text-emerald-100/70">
              <div className="italic">{card.example_sentence}</div>
              {card.example_translation && <div className="text-emerald-100/50">{card.example_translation}</div>}
            </div>
          )}
        </div>
        {hasAudio(card.language) && (<>
        <button
          onClick={() => play(card)}
          title={t('wordCard.listen')}
          className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-lime-300 to-emerald-500 text-emerald-950 shadow-lg shadow-emerald-500/40 transition hover:scale-110 active:scale-95"
        >
          ▶
        </button>
        <button
          onClick={() => regen.mutate()}
          disabled={regen.isPending}
          title={t('wordCard.regenAudio')}
          className={`grid h-9 w-9 place-items-center rounded-full text-emerald-300/60 transition hover:bg-emerald-400/10 hover:text-lime-300 disabled:opacity-50 ${regen.isPending ? 'animate-spin' : ''}`}
        >
          ↻
        </button>
        </>)}
        {!selection && (<>
        <button
          onClick={() => setEditing(true)}
          title={t('editWord.title')}
          aria-label={t('editWord.title')}
          className="grid h-9 w-9 place-items-center rounded-full text-emerald-300/60 transition hover:bg-emerald-400/10 hover:text-lime-300"
        >
          ✏️
        </button>
        <button
          onClick={onDelete}
          disabled={remove.isPending}
          title={t('wordCard.delete')}
          className="grid h-9 w-9 place-items-center rounded-full text-emerald-300/60 transition hover:bg-red-500/15 hover:text-red-300 disabled:opacity-50"
        >
          🗑
        </button>
        {progress && (
          <button
            onClick={() => setMenuOpen(true)}
            title={t('word.more')}
            aria-label={t('word.more')}
            aria-haspopup="menu"
            className="grid h-9 w-9 place-items-center rounded-full text-lg font-bold text-emerald-300/60 transition hover:bg-emerald-400/10 hover:text-lime-300"
          >
            ⋯
          </button>
        )}
        </>)}
      </div>
      {remove.error && <p className="relative mt-2 text-xs text-red-300">{t('wordCard.deleteFailed')}</p>}
      {editing && <EditWordModal card={card} onClose={() => setEditing(false)} />}
      {menuOpen && <WordMenu title={card.word} onClose={() => setMenuOpen(false)}
        onMove={() => { setMenuOpen(false); setPicking(true) }} />}
      {picking && <FolderPicker title={t('word.move')} current={card.folder_id ?? ''}
        onPick={moveTo} onClose={() => setPicking(false)} />}
    </div>
  )
}
