import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { Library, Play, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { collectionApi } from '../api/endpoints'
import type { Folder } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { FolderDot, FolderFormModal, useFolderList } from '../components/Folders'
import { SearchField } from '../components/SearchField'
import { NothingFound, WordList } from '../components/WordList'
import { WordFixes } from '../components/WordFixes'
import { useDebounced } from '../lib/useDebounced'
import { useVisibleCards } from '../lib/deleteWords'

const PAGE = 48
const tile = 'relative min-h-[128px] rounded-[18px] border border-line bg-surface p-3.5'

/** A 6px bar: how much of the folder is learned. */
function LearnedBar({ learned, total, className = '' }: { learned: number; total: number; className?: string }) {
  const pct = total > 0 ? Math.round((learned / total) * 100) : 0
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-dot-off ${className}`} role="presentation">
      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} data-testid="learned-bar" />
    </div>
  )
}

/**
 * "My words": the folder hub. Tiles — all words, each folder (▶ trains it), the words without a folder,
 * a new folder. A search box above them turns the tiles into found words.
 */
export function WordsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const list = useFolderList()
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const search = useDebounced(q.trim(), 300)

  const found = useInfiniteQuery({
    queryKey: ['collection', { status: 'all', period: 'all', sort: 'date', search, folder: '' }],
    queryFn: ({ pageParam }) =>
      collectionApi.list({ status: 'all', period: 'all', sort: 'date', q: search, folder: '', limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
    enabled: search !== '',
    placeholderData: keepPreviousData,
  })
  const cards = useVisibleCards(useMemo(() => found.data?.pages.flatMap((p) => p.items) ?? [], [found.data]))
  const foundTotal = found.data?.pages[0]?.total

  const all = list.data?.all
  const folders = useMemo(() => [...(list.data?.folders ?? [])].reverse(), [list.data]) // the API lists the oldest first
  const withoutFolder = all ? all.total - folders.reduce((n, f) => n + f.total, 0) : 0

  const header = (
    <div>
      <h1 className="text-[26px] font-bold tracking-[-0.02em] text-fg">{t('cards.title')}</h1>
      {all && (
        <p className="mt-1 text-[15px] text-muted">
          {t('words.summary', { words: t('folders.wordsCount', { count: all.total }), folders: t('words.foldersCount', { count: folders.length }) })}
        </p>
      )}
    </div>
  )

  function folderTile(f: Folder) {
    return (
      <div key={f.id} className={tile}>
        <Link to={`/words/${encodeURIComponent(f.id)}`} className="block">
          <FolderDot color={f.color} />
          <p className="mt-2 line-clamp-2 text-base font-semibold leading-snug text-fg" title={f.name}>{f.name}</p>
          <p className="mt-0.5 text-sm text-muted">{t('folders.wordsCount', { count: f.total })}</p>
        </Link>
        <LearnedBar learned={f.learned_count} total={f.total} className={`mt-3 ${f.due_today > 0 ? 'mr-12' : ''}`} />
        {/* A sibling of the link, never inside it. */}
        {f.due_today > 0 && (
          <button type="button" aria-label={t('folders.trainFolder', { name: f.name })}
            onClick={() => navigate(`/train?folder=${encodeURIComponent(f.id)}&size=${Math.min(f.due_today, 20)}`)}
            className="absolute bottom-2.5 right-2.5 grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-accent-text">
            <Play size={14} fill="currentColor" aria-hidden="true" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {header}
      <WordFixes />
      <SearchField value={q} onChange={setQ} />

      {search !== '' ? (
        <div className={`space-y-3 transition-opacity ${found.isPlaceholderData ? 'opacity-50' : ''}`}>
          {found.error ? <ErrorState error={found.error} /> : found.isLoading ? (
            <div className="glass divide-y divide-divider overflow-hidden" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse bg-surface-2" />)}
            </div>
          ) : cards.length === 0 ? <NothingFound /> : (
            <>
              <p className="text-sm text-accent-text">{t('collection.found', { count: foundTotal ?? 0 })}</p>
              <WordList cards={cards} />
              {found.hasNextPage && (
                <div className="text-center">
                  <button type="button" onClick={() => found.fetchNextPage()} disabled={found.isFetchingNextPage} className="btn-ghost">
                    {found.isFetchingNextPage ? t('common.loading') : t('collection.loadMore', { shown: cards.length, total: foundTotal })}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : list.error ? (
        <ErrorState error={list.error} />
      ) : !all ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="min-h-[128px] animate-pulse rounded-[18px] bg-surface-2" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div className={`${tile} border-2 border-accent`}>
            <Link to="/words/all" className="block">
              <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-surface-2"><Library size={18} aria-hidden="true" className="text-accent-text" /></span>
              <p className="mt-2 text-base font-semibold text-fg">{t('folders.all')}</p>
              <p className="mt-0.5 text-sm text-muted">{t('words.tileAll', { count: all.total, learned: all.learned_count })}</p>
            </Link>
            <LearnedBar learned={all.learned_count} total={all.total} className="mt-3" />
          </div>
          {folders.map(folderTile)}
          {withoutFolder > 0 && (
            <Link to="/words/none" className={`${tile} block`}>
              <span className="block h-2.5 w-2.5 rounded-full bg-faint" />
              <p className="mt-2 text-base font-semibold text-fg">{t('folders.none')}</p>
              <p className="mt-0.5 text-sm text-muted">{t('folders.wordsCount', { count: withoutFolder })}</p>
            </Link>
          )}
          <button type="button" onClick={() => setCreating(true)}
            className={`${tile} flex flex-col items-center justify-center gap-2 border-2 border-dashed text-accent-text transition hover:bg-surface-2`}>
            <Plus size={22} aria-hidden="true" />
            <span className="text-base font-semibold">{t('folders.new')}</span>
          </button>
        </div>
      )}
      {creating && <FolderFormModal folder={null} onClose={() => setCreating(false)} onCreated={(f) => navigate(`/words/${encodeURIComponent(f.id)}`)} />}
    </div>
  )
}
