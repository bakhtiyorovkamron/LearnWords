import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { gamesApi, practiceApi, type GameRecord } from '../api/endpoints'
import type { DueCard } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { GameHeader } from '../components/games/GameHeader'
import { GameResult } from '../components/games/GameResult'
import { gameById, type GameDef } from '../components/games/registry'
import type { FinishedGame, GameWord } from '../components/games/types'
import { useFeatures } from '../lib/features'
import { useLearningLang } from '../lib/learningLang'
import { firstVariant, shuffle } from '../lib/quiz'
import { setTrainingOpen } from '../lib/trainingState'

/** The words a game is played with: a translation, the first variant, what the game takes; shuffled, at most maxWords. */
function pickWords(game: GameDef, cards: DueCard[]): GameWord[] {
  const usable = cards
    .filter((c) => (c.translation ?? '').trim() !== '')
    .map((c) => ({ ...c, word: firstVariant(c.word) }))
    .filter(game.fits)
  return shuffle(usable).slice(0, game.maxWords)
}

/**
 * A folder game (/games/:game?folder=<all|none|id>), full screen like a training. The words are a
 * fresh random set of the folder each round; nothing is saved until the end, and only the result
 * (games never touch the Leitner boxes). X and "Back to the folder" go to the folder page — the
 * game may have been opened directly, so never history back.
 */
export function GamePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { game: id } = useParams()
  const [params] = useSearchParams()
  const folder = params.get('folder') || 'all'
  const game = gameById(id)
  const features = useFeatures()
  const learning = useLearningLang()
  const enabled = features.isEnabled('folder_games')
  const [round, setRound] = useState(0) // a new round = a new random set of words
  const [finished, setFinished] = useState<{ result: FinishedGame; before?: GameRecord } | null>(null)

  // The shell (header, bottom nav, More sheet, chat toasts) steps aside, as during a training.
  useEffect(() => {
    setTrainingOpen(true)
    return () => setTrainingOpen(false)
  }, [])

  const on = !!game && enabled
  const words = useQuery({
    queryKey: ['game-words', id, folder, round],
    queryFn: () => practiceApi.words('random', folder === 'all' ? '' : folder, '50'),
    enabled: on,
    staleTime: 0,
    gcTime: 0,
  })
  const records = useQuery({ queryKey: ['game-records', folder], queryFn: () => gamesApi.records(folder), enabled: on })
  const save = useMutation({
    mutationFn: (body: Parameters<typeof gamesApi.result>[0]) => gamesApi.result(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['game-records', folder] }),
  })
  const picked = useMemo(() => (game && words.data ? pickWords(game, words.data) : []), [game, words.data])

  const back = useCallback(() => navigate(`/words/${encodeURIComponent(folder)}`), [navigate, folder])
  const finish = useCallback((result: FinishedGame) => {
    if (!game) return
    setFinished({ result, before: records.data?.find((r) => r.game === game.id) })
    save.mutate({ game: game.id, folder_id: folder, score: result.score, of: result.of })
  }, [game, records.data, save, folder])
  function again() {
    setFinished(null)
    save.reset()
    setRound((r) => r + 1)
  }

  if (!game) return <Navigate to="/words" replace />
  if (features.loaded && !enabled) return <Navigate to={`/words/${encodeURIComponent(folder)}`} replace />

  const title = t(game.nameKey)
  let body: React.ReactNode
  if (finished) {
    body = (
      <GameResult game={game} folder={folder} result={finished.result} before={finished.before} onAgain={again} onBack={back}
        save={{ pending: save.isPending, error: save.isError, data: save.data }} />
    )
  } else if (!enabled || words.isLoading) {
    body = (
      <>
        <GameHeader title={title} onClose={back} />
        <div className="mt-6 min-h-0 flex-1 animate-pulse rounded-[24px] bg-surface-2" aria-busy="true" />
      </>
    )
  } else if (words.error) {
    body = <><GameHeader title={title} onClose={back} /><div className="mt-6"><ErrorState error={words.error} /></div></>
  } else if (picked.length < game.minWords) {
    body = (
      <>
        <GameHeader title={title} onClose={back} />
        <div data-testid="game-empty" className="glass mt-6 p-8 text-center">
          <p className="text-muted">{t(game.notEnoughKey)}</p>
          <button type="button" onClick={back} className="btn-primary mt-5">{t('games.back')}</button>
        </div>
      </>
    )
  } else {
    body = <game.Play key={round} words={picked} lang={learning.code} title={title} onFinish={finish} onClose={back} />
  }

  return (
    <div data-testid="game-page"
      className="mx-auto flex h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] max-w-xl flex-col overflow-hidden md:h-[calc(100dvh-5rem)]">
      {body}
    </div>
  )
}
