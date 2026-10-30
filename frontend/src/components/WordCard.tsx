import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FolderInput, Pencil, Trash, Volume2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cardsApi } from '../api/endpoints'
import type { WordCard } from '../api/types'
import { ARTICLE_COLOR, splitArticle } from '../lib/article'
import { useMoveWords } from '../lib/moveWords'
import { EditWordModal } from './EditWordModal'
import { FolderPicker } from './FolderPicker'
import { ProgressDots } from './ProgressDots'
import { Sheet } from './Sheet'

// Pronunciation is available only for German; other languages have no audio.
export const hasAudio = (lang: string) => lang === 'de'

// Cards have no recorded audio (audio_url is empty): the browser's speech synthesis reads the word.
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

/** The word with its article in the article's colour (der / die / das); no article → plain. */
function Word({ card }: { card: WordCard }) {
  const { article, rest } = splitArticle(card.word, card.article)
  return (
    <>
      {article && <span data-article={article} className={ARTICLE_COLOR[article]}>{article} </span>}
      {rest}
    </>
  )
}

const sheetAction = 'flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base font-medium transition hover:bg-surface-2'

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
  const qc = useQueryClient()
  const [sheet, setSheet] = useState(false)
  const [editing, setEditing] = useState(false)
  const [picking, setPicking] = useState(false)
  const moveWords = useMoveWords()
  async function moveTo(folderId: string | null, folderName: string) {
    setPicking(false)
    await moveWords([card.id], folderId, folderName)
  }
  const remove = useMutation({
    mutationFn: () => cardsApi.remove(card.id),
    onSuccess: () => {
      // Drop the card from every cached list immediately.
      qc.setQueriesData<WordCard[]>({ queryKey: ['cards'] }, (old) => old?.filter((c) => c.id !== card.id))
      qc.invalidateQueries({ queryKey: ['collection'] })
    },
  })

  function onDelete() {
    setSheet(false)
    if (window.confirm(t('wordCard.deleteConfirm', { word: card.word }))) remove.mutate()
  }

  // The modals are siblings of the row, not children: a click inside them must not reach the row.
  return (
    <>
      <div
        data-testid="word-row"
        onClick={() => (selection ? selection.onToggle() : setSheet(true))}
        className={`flex min-h-16 cursor-pointer items-center gap-3 px-4 py-2.5 transition hover:bg-surface-2 ${
          selection?.checked ? 'bg-surface-2' : ''} ${remove.isPending ? 'pointer-events-none opacity-40' : ''}`}
      >
        {selection && (
          <input type="checkbox" checked={selection.checked} onChange={selection.onToggle}
            onClick={(e) => e.stopPropagation()} aria-label={card.word}
            className="h-5 w-5 shrink-0 accent-[var(--accent)]" />
        )}
        <button type="button" aria-haspopup="dialog" className="min-w-0 flex-1 text-left">
          <span className="block truncate font-serif text-[18px] font-medium text-fg" lang={card.language}><Word card={card} /></span>
          <span className="block truncate text-sm text-muted">{card.translation}</span>
          {remove.error && <span className="block text-xs text-danger">{t('wordCard.deleteFailed')}</span>}
        </button>
        {progress && (
          <ProgressDots compact boxLevel={progress.boxLevel} isLearned={progress.isLearned}
            schedule={{ nextReviewAt: progress.nextReviewAt, reviewedToday: progress.reviewedToday }} />
        )}
        {hasAudio(card.language) && (
          <button type="button" onClick={(e) => { e.stopPropagation(); play(card) }} aria-label={t('wordCard.listen')} title={t('wordCard.listen')}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line text-muted transition hover:bg-surface-2">
            <Volume2 size={18} aria-hidden="true" />
          </button>
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
              <p className="font-serif italic text-fg" lang={card.language}>{card.example_sentence}</p>
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
            <button type="button" className={`${sheetAction} text-danger`} disabled={remove.isPending} onClick={onDelete}>
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
