import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { keepPreviousData, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronLeft, Ellipsis, Layers, Leaf, Pencil, Play, Plus, Search, Share2, SlidersHorizontal, SquareCheck, Trash } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { collectionApi, foldersApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { CollectionPeriod, CollectionSort, CollectionStatus } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { FilterSheet } from '../components/FilterSheet'
import { FolderDot, FolderFormModal, useFolderList } from '../components/Folders'
import { FolderPicker } from '../components/FolderPicker'
import { FolderSheet } from '../components/FolderSheet'
import { GoalRing } from '../components/GoalRing'
import { SearchField } from '../components/SearchField'
import { Sheet } from '../components/Sheet'
import { ShareFolderModal } from '../components/ShareFolderModal'
import { toast } from '../components/Toaster'
import { NothingFound, WordList } from '../components/WordList'
import { useDebounced } from '../lib/useDebounced'
import { useMoveWords } from '../lib/moveWords'
import { useVisibleCards } from '../lib/deleteWords'

const PAGE = 48
const squareButton = 'grid h-12 w-12 shrink-0 place-items-center rounded-[14px] border border-line text-fg transition hover:bg-surface-2 disabled:opacity-40'
const sheetRow = 'flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base font-medium transition hover:bg-surface-2'

/**
 * One folder of "My words" (/words/:folder — a folder id | all | none): a summary with Train / Cards /
 * Share / More, then the words as a list with filters, selection and moving.
 */
export function FolderPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { folder: param = 'all' } = useParams()
  const list = useFolderList()
  const isAll = param === 'all'
  const isNone = param === 'none'
  const folderId = isAll ? '' : param // '' = all words, 'none', or an id

  const [status, setStatus] = useState<CollectionStatus>('all')
  const [period, setPeriod] = useState<CollectionPeriod>('all')
  const [sort, setSort] = useState<CollectionSort>('date')
  const [q, setQ] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [picking, setPicking] = useState(false) // the folder sheet
  const [menu, setMenu] = useState(false) // the actions sheet
  const [editing, setEditing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const search = useDebounced(q.trim(), 300)

  // Bulk move: «Select» shows checkboxes; the bar at the bottom moves the picked words.
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [movePicker, setMovePicker] = useState(false)
  const [selectingAll, setSelectingAll] = useState(false)
  const moveWords = useMoveWords()
  const filterKey = JSON.stringify({ status, period, sort, search, folder: folderId })
  useEffect(() => { setSelected(new Set()) }, [filterKey]) // picked words may be filtered out now
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()) }
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s)
    if (!n.delete(id)) n.add(id)
    return n
  })

  // Filtering/sorting/search are done by the backend; pages of 48 are loaded on demand.
  const query = useInfiniteQuery({
    queryKey: ['collection', { status, period, sort, search, folder: folderId }],
    queryFn: ({ pageParam }) =>
      collectionApi.list({ status, period, sort, q: search, folder: folderId, limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
    placeholderData: keepPreviousData,
  })
  // Words waiting to be deleted are left out, so the empty state shows when they were the last ones.
  const cards = useVisibleCards(useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]))
  const filteredTotal = query.data?.pages[0]?.total

  const remove = useMutation({
    mutationFn: (id: string) => foldersApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['folders'] })
      qc.invalidateQueries({ queryKey: ['collection'] })
      toast(t('folders.deleted'))
      navigate('/words')
    },
  })

  const data = list.data
  const current = data?.folders.find((f) => f.id === param)
  // An id that is not one of the user's folders (deleted, mistyped) goes back to the hub.
  if (data && !isAll && !isNone && !current) return <Navigate to="/words" replace />

  const withoutFolder = data ? data.all.total - data.folders.reduce((n, f) => n + f.total, 0) : 0
  const stats = isAll ? data?.all : isNone ? undefined : current
  const total = isNone ? withoutFolder : stats?.total ?? 0
  const learned = stats?.learned_count ?? 0
  const due = stats?.due_today ?? 0
  const pct = total > 0 ? Math.round((learned / total) * 100) : 0
  const name = isAll ? t('folders.all') : isNone ? t('folders.none') : current?.name ?? '…'

  const trainUrl = isNone ? '/train?folder=none&size=20'
    : isAll ? `/train?size=${Math.min(due, 20)}`
    : `/train?folder=${encodeURIComponent(param)}&size=${Math.min(due, 20)}`
  const trainDisabled = !isNone && due === 0
  const cardsUrl = isAll ? '/cards' : `/cards?folder=${encodeURIComponent(param)}`

  const filtersActive = status !== 'all' || period !== 'all' || !!search
  const filterCount = (status !== 'all' ? 1 : 0) + (period !== 'all' ? 1 : 0) + (sort !== 'date' ? 1 : 0)
  const resetFilters = () => { setStatus('all'); setPeriod('all'); setSort('date') }

  async function selectAll() {
    setSelectingAll(true)
    try {
      const r = await collectionApi.ids({ status, period, sort, q: search, folder: folderId })
      setSelected(new Set(r.ids))
      if (r.total > r.ids.length) toast(t('select.limit', { n: r.ids.length, total: r.total }))
    } catch (e) {
      toast(errorMessage(e))
    } finally {
      setSelectingAll(false)
    }
  }
  async function moveSelected(id: string | null, folderName: string) {
    setMovePicker(false)
    if (await moveWords([...selected], id, folderName)) stopSelecting()
  }
  function onDelete() {
    setMenu(false)
    if (current && window.confirm(t('folders.deleteConfirm', { name: current.name }))) remove.mutate(current.id)
  }

  const dot = isAll ? <span className="h-3 w-3 shrink-0 rounded-full bg-accent" />
    : isNone ? <span className="h-3 w-3 shrink-0 rounded-full bg-faint" />
    : <FolderDot color={current?.color ?? ''} />

  return (
    <div className={`mx-auto max-w-3xl space-y-4 ${selecting ? 'pb-24' : ''}`}>
      <div className="flex items-center gap-2">
        <Link to="/words" aria-label={t('words.back')} className="-ml-3 grid h-11 w-11 shrink-0 place-items-center rounded-full text-fg transition hover:bg-surface-2">
          <ChevronLeft size={22} aria-hidden="true" />
        </Link>
        <button type="button" onClick={() => setPicking(true)} aria-haspopup="dialog" className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          {dot}
          <h1 className="min-w-0 truncate text-[26px] font-bold tracking-[-0.02em] text-fg">{name}</h1>
          <ChevronDown size={18} aria-hidden="true" className="shrink-0 text-muted" />
        </button>
        <button type="button" onClick={() => setSearchOpen((o) => !o)} aria-label={t('cards.search')} title={t('cards.search')}
          aria-expanded={searchOpen || q !== ''}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line text-muted transition hover:bg-surface-2">
          <Search size={20} aria-hidden="true" />
        </button>
      </div>

      {(searchOpen || q !== '') && <SearchField value={q} onChange={setQ} autoFocus />}

      <section className="glass space-y-3.5 rounded-[20px] p-4">
        <div className="flex items-center gap-4">
          {!isNone && <GoalRing size={64} stroke={7} done={learned} target={total} met={false} label={`${pct}%`} />}
          <div className="min-w-0">
            <p className="text-xl font-bold text-fg">{t('folders.wordsCount', { count: total })}</p>
            {!isNone && <p className="text-sm text-muted">{t('words.folderStats', { learned, due })}</p>}
          </div>
        </div>
        <div className="flex gap-2">
          {trainDisabled ? (
            <button type="button" disabled className="btn-ghost h-12 flex-1 rounded-[14px] opacity-60">{t('words.noDueToday')}</button>
          ) : (
            <button type="button" onClick={() => navigate(trainUrl)} className="btn-primary h-12 flex-1 rounded-[14px]">
              <Play size={14} fill="currentColor" aria-hidden="true" />{t('folders.train')}
            </button>
          )}
          <Link to={cardsUrl} aria-label={t('nav.cards')} className={squareButton}><Layers size={18} aria-hidden="true" /></Link>
          {current && (
            <button type="button" onClick={() => setSharing(true)} disabled={current.total === 0}
              aria-label={t('folders.share')} title={current.total === 0 ? t('share.emptyFolder') : t('folders.share')} className={squareButton}>
              <Share2 size={18} aria-hidden="true" />
            </button>
          )}
          <button type="button" onClick={() => setMenu(true)} aria-label={t('words.actions')} aria-haspopup="dialog" className={squareButton}>
            <Ellipsis size={18} aria-hidden="true" />
          </button>
        </div>
      </section>
      {remove.error && <p className="text-sm text-danger">{errorMessage(remove.error)}</p>}

      <div className="flex items-center gap-3">
        <h2 className="flex-1 font-semibold text-fg">{t('words.listTitle')}</h2>
        {selecting && (
          <button type="button" onClick={() => void selectAll()} disabled={selectingAll} className="btn-ghost h-9 !px-3 text-[13px] disabled:opacity-50">
            {t('select.all')}
          </button>
        )}
        <button type="button" onClick={() => setFilterOpen(true)} aria-haspopup="dialog"
          className="flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-semibold text-muted transition hover:bg-surface-2">
          <SlidersHorizontal size={14} aria-hidden="true" />{t(`collection.sortShort.${sort}`)}
          {filterCount > 0 && (
            <span data-testid="filter-badge" className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-xs font-bold text-on-accent">{filterCount}</span>
          )}
        </button>
      </div>
      {filtersActive && <p className="-mt-2 text-sm text-accent-text">{t('collection.found', { count: filteredTotal ?? 0 })}</p>}

      {query.error && <ErrorState error={query.error} />}

      <div className={`transition-opacity ${query.isPlaceholderData ? 'opacity-50' : ''}`}>
        {query.isLoading ? (
          <div className="glass divide-y divide-divider overflow-hidden" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-16 animate-pulse bg-surface-2" />)}
          </div>
        ) : cards.length > 0 ? (
          <WordList cards={cards} selection={selecting ? { selected, toggle } : undefined} />
        ) : query.data && (filtersActive ? <NothingFound /> : (
          <div className="glass p-10 text-center">
            <Leaf size={40} aria-hidden="true" className="mx-auto text-faint" />
            <p className="mt-3 text-muted">{folderId ? t('cards.emptyFolder') : t('cards.empty')}</p>
            <Link to="/contexts/new" className="btn-primary mt-5"><Plus size={18} aria-hidden="true" />{t('home.addWord')}</Link>
          </div>
        ))}
      </div>

      {query.hasNextPage && (
        <div className="text-center">
          <button type="button" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage} className="btn-ghost">
            {query.isFetchingNextPage ? t('common.loading') : t('collection.loadMore', { shown: cards.length, total: filteredTotal })}
          </button>
        </div>
      )}

      {selecting && (
        // Above the tab bar on phones (--nav-h), at the very bottom on desktop (--nav-h is 0 there).
        <div className="fixed inset-x-0 bottom-[var(--nav-h)] z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <span className="text-sm font-semibold text-fg">{t('select.count', { n: selected.size })}</span>
            <div className="flex gap-2">
              <button type="button" onClick={stopSelecting} className="btn-ghost">{t('select.cancel')}</button>
              <button type="button" disabled={!selected.size} onClick={() => setMovePicker(true)} className="btn-primary disabled:opacity-50">
                {t('move.button', { n: selected.size })}
              </button>
            </div>
          </div>
        </div>
      )}

      {picking && (
        <FolderSheet title={t('words.pickFolder')} value={isNone ? 'none' : folderId}
          onPick={(v) => navigate(`/words/${v === '' ? 'all' : encodeURIComponent(v)}`)} onClose={() => setPicking(false)} />
      )}
      {menu && (
        <Sheet label={t('words.actions')} onClose={() => setMenu(false)}>
          <h2 className="mb-2 text-lg font-bold text-fg">{t('words.actions')}</h2>
          <div className="space-y-1">
            {current && (
              <button type="button" className={`${sheetRow} text-fg`} onClick={() => { setMenu(false); setEditing(true) }}>
                <Pencil size={18} aria-hidden="true" />{t('folders.rename')}
              </button>
            )}
            <button type="button" className={`${sheetRow} text-fg`} onClick={() => { setMenu(false); setSelecting(true) }}>
              <SquareCheck size={18} aria-hidden="true" />{t('select.start')}
            </button>
            {current && (
              <button type="button" className={`${sheetRow} text-danger`} disabled={remove.isPending} onClick={onDelete}>
                <Trash size={18} aria-hidden="true" />{t('folders.delete')}
              </button>
            )}
          </div>
        </Sheet>
      )}
      {editing && current && <FolderFormModal folder={current} onClose={() => setEditing(false)} />}
      {sharing && current && <ShareFolderModal folder={current} onClose={() => setSharing(false)} />}
      {movePicker && <FolderPicker title={t('move.button', { n: selected.size })} current={isNone ? '' : folderId || undefined}
        onPick={(id, folderName) => void moveSelected(id, folderName)} onClose={() => setMovePicker(false)} />}
      {filterOpen && (
        <FilterSheet status={status} period={period} sort={sort} onStatus={setStatus} onPeriod={setPeriod} onSort={setSort}
          onReset={resetFilters} onClose={() => setFilterOpen(false)} />
      )}
    </div>
  )
}
