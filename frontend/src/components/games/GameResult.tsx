import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, History, Trophy, Volume2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { wordsApi, type GameRecord, type GameResultResponse } from '../../api/endpoints'
import { speak, useCanSpeak } from '../../lib/speech'
import { shortFolderName, useFolderList } from '../Folders'
import { CloseButton } from '../Sheet'
import { toast } from '../Toaster'
import { Word } from '../WordCard'
import type { GameDef } from './registry'
import type { FinishedGame } from './types'

/** The record line: a placeholder while the result is saved, then the new best or the best to beat. */
function RecordPill({ game, save, before }: {
  game: GameDef
  save: { pending: boolean; error: boolean; data?: GameResultResponse }
  before?: GameRecord
}) {
  const { t } = useTranslation()
  if (save.pending) return <span data-testid="game-record-pending" className="mt-3.5 inline-block h-8 w-44 animate-pulse rounded-full bg-surface-2" />
  if (save.error || !save.data) return <p className="mt-3.5 text-sm text-danger">{t('games.saveFailed')}</p>
  const { record, new_record: isNew, previous } = save.data
  const pill = 'mt-3.5 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-bold'
  if (!isNew) {
    return (
      <span data-testid="game-record" className={`${pill} text-muted`}>
        <Trophy size={15} aria-hidden="true" />{t('games.bestWas', { value: game.format(record.best, record.best_of) })}
      </span>
    )
  }
  // The best it beat: its "out of" is the one known before the game (the answer has only the number).
  const was = previous === null ? null : game.format(previous, before && before.best === previous ? before.best_of : null)
  return (
    <span data-testid="game-record" className={`${pill} bg-accent/15 text-accent-text`}>
      <Trophy size={15} aria-hidden="true" />{was === null ? t('games.firstRecord') : t('games.newRecord', { value: was })}
    </span>
  )
}

/**
 * The end of a game: what the game and folder were, the result and the record, three numbers, the
 * mistakes (with a "review later" for all of them at once), and Play again / Back to the folder.
 */
export function GameResult({ game, folder, result, save, before, onAgain, onBack }: {
  game: GameDef
  folder: string // 'all' | 'none' | a folder id
  result: FinishedGame
  save: { pending: boolean; error: boolean; data?: GameResultResponse }
  before?: GameRecord // the record before this game
  onAgain: () => void
  onBack: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const folders = useFolderList()
  const mistakes = result.mistakes
  const canSpeak = useCanSpeak(mistakes[0]?.language ?? '')
  const [marking, setMarking] = useState(false)
  const [marked, setMarked] = useState(false)

  const current = folders.data?.folders.find((f) => f.id === folder)
  const folderName = folder === 'all' ? t('folders.all') : folder === 'none' ? t('folders.none') : current ? shortFolderName(current.name) : '…'

  async function markAll() {
    setMarking(true)
    try {
      await Promise.all(mistakes.map((w) => wordsApi.setRepeat(w.id, true)))
      setMarked(true)
      // Marked words come first everywhere and are due today: the lists and counters change.
      void Promise.all(['collection', 'folders', 'review-due', 'cards'].map((key) => qc.invalidateQueries({ queryKey: [key] })))
    } catch {
      toast(t('cards.repeatError'))
    } finally {
      setMarking(false)
    }
  }

  return (
    <>
      <div className="flex h-11 shrink-0 items-center"><CloseButton onClose={onBack} className="-ml-2.5" /></div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mt-2 text-center">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-muted">{t(game.nameKey)} · {folderName}</p>
          <p data-testid="game-score" className="mt-3 text-[64px] font-bold leading-none tracking-[-0.03em] tabular-nums text-fg">
            {game.format(result.score, result.of)}
          </p>
          <RecordPill game={game} save={save} before={before} />
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          {game.cells(t, result).map((c) => (
            <div key={c.label} className="rounded-[14px] border border-line bg-surface py-2.5 text-center">
              <p className="text-[19px] font-bold tabular-nums text-fg">{c.value}</p>
              <p className="text-[12.5px] text-muted">{c.label}</p>
            </div>
          ))}
        </div>

        {mistakes.length > 0 && (
          <section className="mt-6">
            <h2 className="text-base font-semibold text-fg">{t('games.mistakes')}</h2>
            <ul className="glass mt-2.5 divide-y divide-divider overflow-hidden">
              {mistakes.map((w) => (
                <li key={w.id} data-testid="game-mistake" className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p lang={w.language} className="truncate font-serif text-[18px] text-fg"><Word card={w} /></p>
                    <p className="truncate text-sm text-muted">{w.translation}</p>
                  </div>
                  {canSpeak && (
                    <button type="button" onClick={() => speak(w.word, w.language)} aria-label={t('quiz.listenTitle')} title={t('quiz.listenTitle')}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line text-fg transition hover:bg-surface-2">
                      <Volume2 size={18} aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => void markAll()} disabled={marking || marked}
              className="mt-3 flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] border border-mark/40 bg-mark/10 font-semibold text-mark transition disabled:cursor-default">
              {marked
                ? <><Check size={18} aria-hidden="true" />{t('games.marked', { count: mistakes.length })}</>
                : <><History size={18} aria-hidden="true" />{t('games.markRepeat', { count: mistakes.length })}</>}
            </button>
            <p className="mt-2 text-center text-[13.5px] text-muted">{t('games.markNote')}</p>
          </section>
        )}

        <div className="mt-auto grid grid-cols-2 gap-2.5 pb-1 pt-6">
          <button type="button" onClick={onAgain} className="btn-primary h-[52px]">{t('games.again')}</button>
          <button type="button" onClick={onBack} className="btn-ghost h-[52px]">{t('games.back')}</button>
        </div>
      </div>
    </>
  )
}
