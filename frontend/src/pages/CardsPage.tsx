import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Leaf, Search, SearchX, SlidersHorizontal, SquareCheck, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { collectionApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { CollectionPeriod, CollectionSort, CollectionStatus } from '../api/types'
import { WordCardView } from '../components/WordCard'
import { ReviewSession } from '../components/ReviewSession'
import { FlipCards } from '../components/FlipCards'
import { DirectionToggle, useStoredChoice } from '../components/DirectionToggle'
import { FilterSheet } from '../components/FilterSheet'
import { FolderBar, useFolderList } from '../components/Folders'
import { Segmented } from '../components/Segmented'
import { WordFixes } from '../components/WordFixes'
import { FolderPicker } from '../components/FolderPicker'
import { toast } from '../components/Toaster'
import { useMoveWords } from '../lib/moveWords'
import { useTrainingOpen } from '../lib/trainingState'
import { ErrorState } from '../components/ErrorState'

const PAGE = 48
const VIEW_KEY = 'collection-view'
const FLIP_DIRECTIONS = ['de_ru', 'ru_de'] as const

export function CardsPage() {
  const { t } = useTranslation()
  // Deep link from a folder card on the Contexts page: ?tab=all&folder=<id|none|''>.
  // The tab is in the URL, so /cards always opens Review — also when coming from /cards?tab=all.
  const [params, setParams] = useSearchParams()
  const tab: 'review' | 'all' = params.get('tab') === 'all' ? 'all' : 'review'
  const initialFolder = params.get('folder') ?? ''
  const training = useTrainingOpen() // a session is on screen: only the questions, no tabs
  const tabs = [['review', t('cards.tabReview')], ['all', t('cards.tabCollection')]] as const
  return (
    <div className="space-y-4 md:space-y-6">
      {!training && (
        <Segmented value={tab} onChange={(k) => setParams(k === 'all' ? { tab: 'all' } : {}, { replace: true })} options={tabs} />
      )}
      {tab === 'review' ? <ReviewSession /> : <Collection initialFolder={initialFolder} />}
    </div>
  )
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

function Collection({ initialFolder = '' }: { initialFolder?: string }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<CollectionStatus>('all')
  const [period, setPeriod] = useState<CollectionPeriod>('all')
  const [sort, setSort] = useState<CollectionSort>('date')
  const [folder, setFolder] = useState(initialFolder) // '' = all words (default, as before)
  const [searchOpen, setSearchOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [view, setView] = useState<'list' | 'flip'>(() =>
    localStorage.getItem(VIEW_KEY) === 'flip' ? 'flip' : 'list')
  const search = useDebounced(q.trim(), 300)
  const [flipDirection, setFlipDirection] = useStoredChoice('flip-direction', FLIP_DIRECTIONS, 'de_ru')

  useEffect(() => { localStorage.setItem(VIEW_KEY, view) }, [view])

  // Bulk move: «Select» shows checkboxes (list view only); the bar at the bottom moves the picked words.
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [picking, setPicking] = useState(false)
  const [selectingAll, setSelectingAll] = useState(false)
  const moveWords = useMoveWords()
  const filterKey = JSON.stringify({ status, period, sort, search, folder })
  useEffect(() => { setSelected(new Set()) }, [filterKey]) // picked words may be filtered out now
  useEffect(() => { if (view !== 'list') setSelecting(false) }, [view])
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()) }
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s)
    if (!n.delete(id)) n.add(id)
    return n
  })

  // Filtering/sorting/search are done by the backend; pages of 48 are loaded on demand.
  const query = useInfiniteQuery({
    queryKey: ['collection', { status, period, sort, search, folder }],
    queryFn: ({ pageParam }) =>
      collectionApi.list({ status, period, sort, q: search, folder, limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
    placeholderData: keepPreviousData,
  })

  const cards = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data])
  const filteredTotal = query.data?.pages[0]?.total
  async function selectAll() {
    setSelectingAll(true)
    try {
      const r = await collectionApi.ids({ status, period, sort, q: search, folder })
      setSelected(new Set(r.ids))
      if (r.total > r.ids.length) toast(t('select.limit', { n: r.ids.length, total: r.total }))
    } catch (e) {
      toast(errorMessage(e))
    } finally {
      setSelectingAll(false)
    }
  }

  async function moveSelected(folderId: string | null, folderName: string) {
    setPicking(false)
    if (await moveWords([...selected], folderId, folderName)) stopSelecting()
  }

  const filtersActive = status !== 'all' || period !== 'all' || !!search || !!folder
  const filterCount = (status !== 'all' ? 1 : 0) + (period !== 'all' ? 1 : 0) + (sort !== 'date' ? 1 : 0)
  const resetFilters = () => { setStatus('all'); setPeriod('all'); setSort('date') }

  // The heading always shows the TRUE total word count, independent of any filter — a separate
  // line shows how many match the current filter (collection.found below).
  const grandTotal = useQuery({
    queryKey: ['collection', 'grand-total'],
    queryFn: () =>
      collectionApi.list({ status: 'all', period: 'all', sort: 'date', q: '', limit: 1, offset: 0 }).then((r) => r.total),
    staleTime: 30_000,
  })
  const due = useFolderList().data?.all.due_today ?? 0

  return (
    <div className={`mx-auto max-w-3xl space-y-4 ${selecting ? 'pb-24' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold tracking-[-0.02em] text-fg">{t('cards.title')}</h1>
          <p className="mt-1 text-[15px] text-muted">
            {grandTotal.data !== undefined && t('folders.wordsCount', { count: grandTotal.data })}
            {grandTotal.data !== undefined && due > 0 && ` · ${t('cards.dueToday', { count: due })}`}
          </p>
          {filtersActive && <p className="text-sm text-accent-text">{t('collection.found', { count: filteredTotal ?? 0 })}</p>}
        </div>
        <button type="button" onClick={() => setSearchOpen((o) => !o)} aria-label={t('cards.search')} title={t('cards.search')}
          aria-expanded={searchOpen || q !== ''}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line text-muted transition hover:bg-surface-2">
          <Search size={20} aria-hidden="true" />
        </button>
      </div>

      {(searchOpen || q !== '') && (
        <div className="relative">
          <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('cards.search')}
            aria-label={t('cards.search')} className="field pl-11 pr-11" />
          {q !== '' && (
            <button type="button" onClick={() => setQ('')} aria-label={t('folders.close')}
              className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-surface-2">
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      <WordFixes />

      <Segmented value={view} onChange={setView} options={[
        ['list', t('collection.view.list')],
        ['flip', t('collection.view.flip')],
      ] as const} />

      <FolderBar value={folder} onChange={setFolder} />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setFilterOpen(true)} aria-haspopup="dialog" className="btn-ghost h-10">
          <SlidersHorizontal size={16} aria-hidden="true" />{t('collection.filter.title')}
          {filterCount > 0 && (
            <span data-testid="filter-badge" className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-xs font-bold text-on-accent">{filterCount}</span>
          )}
        </button>
        {view === 'list' && cards.length > 0 && (
          <>
            <button type="button" onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
              className={selecting ? 'btn-primary h-10' : 'btn-ghost h-10'}>
              <SquareCheck size={16} aria-hidden="true" />{selecting ? t('select.cancel') : t('select.start')}
            </button>
            {selecting && (
              <button type="button" onClick={() => void selectAll()} disabled={selectingAll} className="btn-ghost h-10 disabled:opacity-50">
                {t('select.all')}
              </button>
            )}
          </>
        )}
        <span className="ml-auto text-sm text-muted">{t(`collection.sortShort.${sort}`)}</span>
      </div>

      {query.error && <ErrorState error={query.error} />}

      <div className={`transition-opacity ${query.isPlaceholderData ? 'opacity-50' : ''}`}>
        {query.isLoading ? (
          <div className="glass divide-y divide-divider overflow-hidden" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-16 animate-pulse bg-surface-2" />)}
          </div>
        ) : view === 'list' ? (
          cards.length > 0 && (
            <div className="glass divide-y divide-divider overflow-hidden">
              {cards.map((c) => (
                <WordCardView key={c.id} card={c}
                  progress={{ boxLevel: c.box_level, isLearned: c.is_learned, nextReviewAt: c.next_review_at, reviewedToday: c.reviewed_today }}
                  selection={selecting ? { checked: selected.has(c.id), onToggle: () => toggle(c.id) } : undefined} />
              ))}
            </div>
          )
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center">
              <DirectionToggle value={flipDirection} onChange={setFlipDirection} options={FLIP_DIRECTIONS} />
            </div>
            <FlipCards
              cards={cards}
              direction={flipDirection}
              resetKey={JSON.stringify({ status, period, sort, search, folder })}
              onNearEnd={query.hasNextPage && !query.isFetchingNextPage ? () => void query.fetchNextPage() : undefined}
            />
          </div>
        )}
      </div>

      {query.hasNextPage && (
        <div className="text-center">
          <button type="button" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}
            className="btn-ghost">
            {query.isFetchingNextPage
              ? t('common.loading')
              : t('collection.loadMore', { shown: cards.length, total: filteredTotal })}
          </button>
        </div>
      )}

      {query.data && !cards.length && (
        <div className="glass p-10 text-center">
          {filtersActive
            ? <SearchX size={40} aria-hidden="true" className="mx-auto text-faint" />
            : <Leaf size={40} aria-hidden="true" className="mx-auto text-faint" />}
          <p className="mt-3 text-muted">{filtersActive ? t('cards.nothingFound') : t('cards.empty')}</p>
        </div>
      )}

      {selecting && (
        // Above the tab bar on phones (--nav-h), at the very bottom on desktop (--nav-h is 0 there).
        <div className="fixed inset-x-0 bottom-[var(--nav-h)] z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <span className="text-sm font-semibold text-fg">{t('select.count', { n: selected.size })}</span>
            <button type="button" disabled={!selected.size} onClick={() => setPicking(true)}
              className="btn-primary disabled:opacity-50">
              {t('move.button', { n: selected.size })}
            </button>
          </div>
        </div>
      )}
      {picking && <FolderPicker title={t('move.button', { n: selected.size })} current={folder === 'none' ? '' : folder || undefined}
        onPick={(id, name) => void moveSelected(id, name)} onClose={() => setPicking(false)} />}
      {filterOpen && (
        <FilterSheet status={status} period={period} sort={sort} onStatus={setStatus} onPeriod={setPeriod} onSort={setSort}
          onReset={resetFilters} onClose={() => setFilterOpen(false)} />
      )}
    </div>
  )
}
