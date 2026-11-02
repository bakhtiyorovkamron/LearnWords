import { useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { ArrowLeftRight, ChevronDown, Leaf, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { collectionApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { DeckFolderSheet } from '../components/DeckFolderSheet'
import { useStoredChoice } from '../components/DirectionToggle'
import { ErrorState } from '../components/ErrorState'
import { FlipCards } from '../components/FlipCards'
import { FolderDot, shortFolderName, useFolderList } from '../components/Folders'
import { useLearningLang } from '../lib/learningLang'
import { parseUrlSize } from '../lib/reviewSessionSize'

const PAGE = 48
const DIRECTIONS = ['de_ru', 'ru_de'] as const

/**
 * "Cards": the flashcard deck of one folder (?folder=<id|none>, all words without it). The legacy
 * links of the old Cards tab still work: ?start=1[&size=N] → /train, ?practice=1 → /, ?tab=all → /words.
 */
export function CardsDeckPage() {
  const { t, i18n } = useTranslation()
  const learning = useLearningLang()
  const [params, setParams] = useSearchParams()
  const folder = params.get('folder') ?? '' // '' = all words, 'none', or a folder id
  const [direction, setDirection] = useStoredChoice('flip-direction', DIRECTIONS, 'de_ru')
  const [picking, setPicking] = useState(false)
  const folders = useFolderList()

  const query = useInfiniteQuery({
    queryKey: ['collection', { status: 'all', period: 'all', sort: 'date', search: '', folder }],
    queryFn: ({ pageParam }) =>
      collectionApi.list({ status: 'all', period: 'all', sort: 'date', q: '', folder, limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
    placeholderData: keepPreviousData,
  })
  const cards = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data])
  const total = query.data?.pages[0]?.total ?? 0

  if (params.get('start') === '1') {
    const size = parseUrlSize(params.get('size'))
    return <Navigate to={size ? `/train?size=${size}` : '/train'} replace />
  }
  if (params.get('practice') === '1') return <Navigate to="/" replace />
  if (params.get('tab') === 'all') {
    return <Navigate to={folder ? `/words/${encodeURIComponent(folder)}` : '/words'} replace />
  }

  const current = folders.data?.folders.find((f) => f.id === folder)
  const name = folder === '' ? t('folders.all') : folder === 'none' ? t('folders.none') : current ? shortFolderName(current.name) : '…'
  const count = folder === '' ? folders.data?.all.total : folder === 'none'
    ? (folders.data ? folders.data.all.total - folders.data.folders.reduce((n, f) => n + f.total, 0) : undefined)
    : current?.total

  function pickFolder(v: string) {
    setParams((p) => {
      const next = new URLSearchParams(p)
      if (v) next.set('folder', v)
      else next.delete('folder')
      return next
    }, { replace: true })
  }

  const directionLabel = t(`direction.${direction}`, { lang: learning.vars.langCode, native: i18n.language.toUpperCase() })
  const pill = 'flex h-10 items-center gap-2 rounded-full border border-line bg-surface text-sm font-semibold text-fg transition hover:bg-surface-2'

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-var(--nav-h)-2rem)] max-w-3xl flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setPicking(true)} aria-haspopup="dialog" className={`${pill} min-w-0 px-3.5`}>
          {current ? <FolderDot color={current.color} /> : <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${folder === 'none' ? 'bg-faint' : 'bg-accent'}`} />}
          <span className="min-w-0 truncate">{name}</span>
          {count !== undefined && <span className="font-normal tabular-nums text-muted">{count}</span>}
          <ChevronDown size={14} aria-hidden="true" className="shrink-0" />
        </button>
        <button type="button" onClick={() => setDirection(direction === 'de_ru' ? 'ru_de' : 'de_ru')}
          className={`${pill} shrink-0 px-3 text-[13px] font-bold`} aria-label={directionLabel}>
          {directionLabel}<ArrowLeftRight size={14} aria-hidden="true" className="text-muted" />
        </button>
      </div>

      {query.error ? (
        <ErrorState error={query.error} />
      ) : query.isLoading ? (
        <div className="mt-4 animate-pulse rounded-[32px] bg-surface-2" style={{ height: 'clamp(380px, 60dvh, 560px)' }} aria-busy="true" />
      ) : cards.length === 0 ? (
        <div className="glass p-10 text-center">
          <Leaf size={40} aria-hidden="true" className="mx-auto text-faint" />
          <p className="mt-3 text-muted">{folder ? t('cards.emptyFolder') : t('cards.empty')}</p>
          <Link to="/contexts/new" className="btn-primary mt-5"><Plus size={18} aria-hidden="true" />{t('home.addWord')}</Link>
        </div>
      ) : (
        <FlipCards
          cards={cards}
          total={total}
          direction={direction}
          resetKey={`${folder}|${direction}`}
          onNearEnd={query.hasNextPage && !query.isFetchingNextPage ? () => void query.fetchNextPage() : undefined}
        />
      )}
      {picking && <DeckFolderSheet value={folder} onPick={pickFolder} onClose={() => setPicking(false)} />}
    </div>
  )
}
