import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { List, Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { gamesApi, type GameRecord } from '../../api/endpoints'
import { useLearningLang } from '../../lib/learningLang'
import { MIN_PRACTICE_WORDS } from '../../lib/practiceQueue'
import { Sheet } from '../Sheet'
import { formatRecord, gamesFor, type GameDef } from './registry'

const chip = 'inline-flex h-[34px] items-center gap-1.5 rounded-full bg-surface-2 px-3 text-[13.5px] font-semibold text-fg'

/** A game's name: its own drawing (der · die · das) or the translated one. */
function GameTitle({ game, className }: { game: GameDef; className?: string }) {
  const { t } = useTranslation()
  return game.Name ? <game.Name className={className} /> : <span className={className}>{t(game.nameKey)}</span>
}

/**
 * The "Games" block of a folder page (feature folder_games): a tile per game of the learning
 * language, with its record in the folder; a tap opens the start sheet. folder: 'all' | 'none' | an id.
 */
export function FolderGames({ folder, total }: { folder: string; total: number }) {
  const { t } = useTranslation()
  const learning = useLearningLang()
  const records = useQuery({ queryKey: ['game-records', folder], queryFn: () => gamesApi.records(folder) })
  const [open, setOpen] = useState<GameDef | null>(null)
  const recordOf = (g: GameDef) => records.data?.find((r) => r.game === g.id)

  return (
    <section className="space-y-2.5" aria-labelledby="folder-games-title">
      <h2 id="folder-games-title" className="font-semibold text-fg">{t('games.title')}</h2>
      <div className="grid grid-cols-2 gap-2.5">
        {gamesFor(learning.code).map((g) => {
          const rec = recordOf(g)
          return (
            <button key={g.id} type="button" onClick={() => setOpen(g)} aria-haspopup="dialog" data-testid={`game-tile-${g.id}`}
              className="relative flex h-[92px] flex-col justify-between rounded-[18px] border border-line bg-surface px-3.5 py-3 text-left transition hover:bg-surface-2">
              <span className="grid h-[38px] w-[38px] place-items-center rounded-xl bg-surface-2 text-fg"><g.Icon size={20} /></span>
              {rec && (
                <span data-testid={`game-record-${g.id}`}
                  className="absolute right-3 top-3 flex items-center gap-1 text-[13px] font-semibold tabular-nums text-muted">
                  <Trophy size={13} aria-hidden="true" />{formatRecord(g, rec)}
                </span>
              )}
              <GameTitle game={g} className={g.Name ? undefined : 'text-base font-semibold text-fg'} />
            </button>
          )
        })}
      </div>
      {open && <GameSheet game={open} folder={folder} total={total} record={recordOf(open)} onClose={() => setOpen(null)} />}
    </section>
  )
}

/** The start sheet: the game, its rule, what it is played with, the record, and Play. */
function GameSheet({ game, folder, total, record, onClose }: {
  game: GameDef; folder: string; total: number; record?: GameRecord; onClose: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const tooFew = total < MIN_PRACTICE_WORDS
  return (
    <Sheet label={t(game.nameKey)} onClose={onClose}>
      <div>
        <span className="grid h-[60px] w-[60px] place-items-center rounded-[18px] bg-surface-2 text-fg"><game.Icon size={28} /></span>
        <h2 className="mt-3.5 text-2xl font-bold text-fg">
          <GameTitle game={game} className={game.Name ? 'font-serif text-2xl font-bold' : undefined} />
        </h2>
        <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{t(game.ruleKey)}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className={chip}><List size={15} aria-hidden="true" className="text-muted" />{game.fact(t, total)}</span>
          {record && (
            <span className={chip}><Trophy size={15} aria-hidden="true" className="text-muted" />{t('games.record', { value: formatRecord(game, record) })}</span>
          )}
        </div>
      </div>
      <button type="button" disabled={tooFew} onClick={() => navigate(`/games/${game.id}?folder=${encodeURIComponent(folder)}`)}
        className="btn-primary mt-5 h-[52px] w-full rounded-[14px] disabled:opacity-50">
        {tooFew ? t('practice.needWords') : t('games.play')}
      </button>
    </Sheet>
  )
}
