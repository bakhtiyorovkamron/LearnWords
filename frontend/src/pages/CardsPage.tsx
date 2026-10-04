import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { collectionApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { CollectionPeriod, CollectionSort, CollectionStatus } from '../api/types'
import { WordCardView } from '../components/WordCard'
import { ReviewSession } from '../components/ReviewSession'
import { FlipCards } from '../components/FlipCards'

const PAGE = 48
const VIEW_KEY = 'collection-view'

export function CardsPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'review' | 'all'>('review')
  const tabs = [['review', t('cards.tabReview')], ['all', t('cards.tabCollection')]] as const
  return (
    <div className="space-y-8">
      <div className="flex gap-2">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={tab === k ? 'btn-primary' : 'btn-ghost'}>{label}</button>
        ))}
      </div>
      {tab === 'review' ? <ReviewSession /> : <Collection />}
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

// Tab-style button group, same look as "Повторение / Коллекция".
function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[]
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-2xl border border-emerald-400/15 bg-emerald-950/40 p-1">
      {options.map(([k, label]) => (
        <button key={k} type="button" onClick={() => onChange(k)}
          className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
            value === k ? 'bg-lime-400 text-emerald-950 shadow' : 'text-emerald-100/70 hover:bg-emerald-400/10 hover:text-white'
          }`}>
          {label}
        </button>
      ))}
    </div>
  )
}

function Collection() {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<CollectionStatus>('all')
  const [period, setPeriod] = useState<CollectionPeriod>('all')
  const [sort, setSort] = useState<CollectionSort>('date')
  const [view, setView] = useState<'list' | 'flip'>(() =>
    localStorage.getItem(VIEW_KEY) === 'flip' ? 'flip' : 'list')
  const search = useDebounced(q.trim(), 300)

  useEffect(() => { localStorage.setItem(VIEW_KEY, view) }, [view])

  // Filtering/sorting/search are done by the backend; pages of 48 are loaded on demand.
  const query = useInfiniteQuery({
    queryKey: ['collection', { status, period, sort, search }],
    queryFn: ({ pageParam }) =>
      collectionApi.list({ status, period, sort, q: search, limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
    placeholderData: keepPreviousData,
  })

  const cards = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data])
  const total = query.data?.pages[0]?.total
  const filtersActive = status !== 'all' || period !== 'all' || !!search

  return (
    <div className="space-y-6">
      <div className="animate-rise flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="display text-3xl font-extrabold md:text-4xl">
            {t('cards.titleA')}<span className="text-lime-300">{t('cards.titleB')}</span> 🃏
          </h1>
          <p className="mt-2 text-emerald-100/70">
            {total !== undefined ? t('cards.count', { count: total }) : t('cards.allInOnePlace')}
          </p>
        </div>
        <div className="relative w-full md:w-80">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-emerald-300/60">🔍</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('cards.search')}
            className="field pl-11" />
        </div>
      </div>

      <div className="glass flex flex-col gap-3 p-4 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
          <Segmented value={status} onChange={setStatus} options={[
            ['all', t('collection.filter.all')],
            ['new', t('collection.filter.new')],
            ['learning', t('collection.filter.learning')],
            ['learned', t('collection.filter.learned')],
          ] as const} />
          <Segmented value={period} onChange={setPeriod} options={[
            ['today', t('collection.period.today')],
            ['week', t('collection.period.week')],
            ['all', t('collection.period.all')],
          ] as const} />
          <select value={sort} onChange={(e) => setSort(e.target.value as CollectionSort)}
            className="field w-auto py-2 text-sm" aria-label={t('collection.sortLabel')}>
            <option value="date">{t('collection.sort.date')}</option>
            <option value="alpha">{t('collection.sort.alpha')}</option>
            <option value="progress">{t('collection.sort.progress')}</option>
          </select>
        </div>
        <Segmented value={view} onChange={setView} options={[
          ['list', `☰ ${t('collection.view.list')}`],
          ['flip', `🂠 ${t('collection.view.flip')}`],
        ] as const} />
      </div>

      {query.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-emerald-800/30" />
          ))}
        </div>
      )}
      {query.error && <p className="text-red-300">{errorMessage(query.error)}</p>}

      <div className={`transition-opacity ${query.isPlaceholderData ? 'opacity-50' : ''}`}>
        {view === 'list' ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c, i) => (
              <WordCardView key={c.id} card={c} index={i}
                progress={{ boxLevel: c.box_level, isLearned: c.is_learned }} />
            ))}
          </div>
        ) : (
          <FlipCards
            cards={cards}
            resetKey={JSON.stringify({ status, period, sort, search })}
            onNearEnd={query.hasNextPage && !query.isFetchingNextPage ? () => void query.fetchNextPage() : undefined}
          />
        )}
      </div>

      {query.hasNextPage && (
        <div className="text-center">
          <button type="button" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}
            className="btn-ghost">
            {query.isFetchingNextPage
              ? t('common.loading')
              : t('collection.loadMore', { shown: cards.length, total })}
          </button>
        </div>
      )}

      {query.data && !cards.length && (
        <div className="glass p-10 text-center">
          <div className="text-5xl">🍃</div>
          <p className="mt-3 text-emerald-100/70">{filtersActive ? t('cards.nothingFound') : t('cards.empty')}</p>
        </div>
      )}
    </div>
  )
}
