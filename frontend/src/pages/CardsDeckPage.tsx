import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { Ellipsis, Leaf, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { collectionApi, wordsApi } from '../api/endpoints'
import type { CollectionCard } from '../api/types'
import { FolderSheet } from '../components/FolderSheet'
import { useStoredChoice } from '../components/DirectionToggle'
import { DeckScrubber } from '../components/DeckScrubber'
import { ErrorState } from '../components/ErrorState'
import { toast } from '../components/Toaster'
import { FlipCards, type FlipCardsHandle } from '../components/FlipCards'
import { FolderDot, shortFolderName, useFolderList } from '../components/Folders'
import { splitArticle } from '../lib/article'
import { useLearningLang } from '../lib/learningLang'
import { parseUrlSize } from '../lib/reviewSessionSize'
import { setTrainingOpen } from '../lib/trainingState'

const PAGE = 48
type DeckPage = { items: CollectionCard[]; total: number }
const DIRECTIONS = ['de_ru', 'ru_de'] as const

const round = 'grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface-2'
const isTyping = (t: EventTarget | null) =>
  (t instanceof HTMLInputElement && t.type !== 'range') || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement

/**
 * The deck's "⋯" menu: a bottom sheet on phones, a popover under the button from md up. One row per
 * setting (more can follow): the folder (opens the folder sheet) and the direction (toggles in place,
 * the menu stays open). An outside tap and Esc close it; the caller puts the focus back on "⋯".
 */
function DeckMenu({ anchor, rows, onClose }: {
  anchor: DOMRect | null
  rows: { key: string; label: string; value: React.ReactNode; onSelect: () => void }[]
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const place = anchor
    ? ({ '--menu-top': `${anchor.bottom + 8}px`, '--menu-right': `${Math.max(window.innerWidth - anchor.right, 8)}px` } as React.CSSProperties)
    : undefined
  return (
    <div data-testid="deck-menu-scrim" className="fixed inset-0 z-50 bg-black/50 md:bg-transparent"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={panel} role="menu" style={place}
        className="animate-rise absolute inset-x-0 bottom-0 rounded-t-[22px] border-t border-line bg-surface p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-card)] md:inset-x-auto md:bottom-auto md:right-[var(--menu-right)] md:top-[var(--menu-top)] md:w-72 md:rounded-[18px] md:border md:pb-2">
        {rows.map((r) => (
          <button key={r.key} type="button" role="menuitem" onClick={r.onSelect}
            className="flex min-h-[52px] w-full items-center justify-between gap-4 rounded-xl px-4 text-left font-semibold text-fg transition hover:bg-surface-2">
            <span>{r.label}</span>
            <span className="flex min-w-0 items-center gap-2 text-sm font-normal text-muted">{r.value}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * "Cards": the flashcard deck of one folder (?folder=<id|none>, all words without it), full screen —
 * the shell steps aside as for a training. Top bar: X, the counter, "⋯" (folder, direction). Under the
 * deck its controls and a scrubber over the whole folder; ⤢ (or F) opens focus mode, where the card
 * fills the screen with only the word and the sound. The legacy links of the old Cards tab still work:
 * ?start=1[&size=N] → /train, ?practice=1 → /train?mode=practice, ?tab=all → /words.
 */
export function CardsDeckPage() {
  const { t, i18n } = useTranslation()
  const learning = useLearningLang()
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const folder = params.get('folder') ?? '' // '' = all words, 'none', or a folder id
  const [direction, setDirection] = useStoredChoice('flip-direction', DIRECTIONS, 'de_ru')
  const [picking, setPicking] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const [focusMode, setFocusMode] = useState(false) // never remembered: the deck always opens normal
  const [index, setIndex] = useState(0) // the deck index, reported by FlipCards: one source of truth
  const [jumping, setJumping] = useState(false) // the scrubber waits for pages to load
  const [pendingJump, setPendingJump] = useState<number | null>(null)
  const folders = useFolderList()
  const qc = useQueryClient()
  const deck = useRef<FlipCardsHandle>(null)
  // When this deck was opened (again for a new folder): marks made since then do not reorder the
  // pages still to load — the deck keeps its order while it is open.
  const [opened, setOpened] = useState(() => ({ folder, at: new Date().toISOString() }))
  if (opened.folder !== folder) setOpened({ folder, at: new Date().toISOString() })
  const marksBefore = opened.at
  const moreButton = useRef<HTMLButtonElement>(null)

  // The shell (header, bottom nav, More sheet, chat toasts) steps aside, as during a training.
  useEffect(() => {
    setTrainingOpen(true)
    return () => setTrainingOpen(false)
  }, [])

  // Marked "review later" words first (sort=repeat), then the newest words.
  const deckKey = useMemo(() => ['collection', { status: 'all', period: 'all', sort: 'repeat', search: '', folder, marksBefore }], [folder, marksBefore])
  const query = useInfiniteQuery({
    queryKey: deckKey,
    queryFn: ({ pageParam }) =>
      collectionApi.list({ status: 'all', period: 'all', sort: 'repeat', q: '', folder, limit: PAGE, offset: pageParam, marksBefore }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
    placeholderData: keepPreviousData,
  })
  const cards = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data])
  const total = query.data?.pages[0]?.total ?? 0
  const ready = !query.error && !query.isLoading && cards.length > 0

  // On open: "Marked words first: N", N = the marked cards at the head of the first page.
  const firstPage = query.data?.pages[0]
  const toasted = useRef('')
  useEffect(() => {
    if (!firstPage || query.isPlaceholderData || toasted.current === marksBefore) return
    toasted.current = marksBefore
    const n = firstPage.items.findIndex((c) => !c.repeat_marked)
    const leading = n === -1 ? firstPage.items.length : n
    if (leading > 0) toast(t('cards.repeatFirst', { count: leading }))
  }, [firstPage, query.isPlaceholderData, marksBefore, t])

  /**
   * The mark, optimistically: the card changes inside the cached pages (setQueryData, never a
   * refetch: nothing may reorder while the deck is open), and goes back if the server says no.
   */
  const toggleRepeat = useCallback(async (card: CollectionCard, marked: boolean) => {
    const set = (v: boolean) => qc.setQueryData<InfiniteData<DeckPage>>(deckKey, (d) => d && {
      ...d,
      pages: d.pages.map((p) => ({ ...p, items: p.items.map((c) => (c.id === card.id ? { ...c, repeat_marked: v } : c)) })),
    })
    set(marked)
    try {
      await wordsApi.setRepeat(card.id, marked)
    } catch (e) {
      set(!marked)
      throw e
    }
  }, [qc, deckKey])

  // X (and Esc): back where the user came from inside the app, Home when the deck was opened directly.
  const close = useCallback(() => {
    if (location.key !== 'default') navigate(-1)
    else navigate('/')
  }, [location.key, navigate])

  const closeMenu = useCallback(() => {
    setMenuOpen(false)
    moreButton.current?.focus()
  }, [])

  // Esc: out of focus mode, else close the deck; F (and "а", the same key in the Russian layout) toggles
  // focus mode. Not while a menu or a sheet is open (they handle their own Esc) or while typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (menuOpen || picking || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') {
        if (focusMode) setFocusMode(false)
        else close()
      } else if (ready && (e.code === 'KeyF' || ['f', 'F', 'а', 'А'].includes(e.key))) {
        e.preventDefault()
        setFocusMode((f) => !f)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen, picking, focusMode, ready, close])

  /** Loads pages until the card at index is in (or nothing more comes). */
  const ensureLoaded = useCallback(async (target: number) => {
    let loaded = cards.length
    let more = query.hasNextPage
    while (loaded <= target && more) {
      const r = await query.fetchNextPage()
      if (r.isError) break
      loaded = r.data?.pages.reduce((n, p) => n + p.items.length, 0) ?? loaded
      more = r.hasNextPage
    }
  }, [cards.length, query])

  async function jump(target: number) {
    if (target < cards.length) return deck.current?.jumpTo(target)
    setJumping(true)
    try {
      await ensureLoaded(target)
      setPendingJump(target) // jumped once the new cards have reached the deck
    } finally {
      setJumping(false)
    }
  }
  useEffect(() => {
    if (pendingJump === null || cards.length === 0) return
    deck.current?.jumpTo(Math.min(pendingJump, cards.length - 1))
    setPendingJump(null)
  }, [pendingJump, cards.length])

  const labelOf = useCallback((n: number) => {
    const c = cards[n]
    if (!c) return undefined
    const { article, rest } = splitArticle(c.word, c.article)
    return article ? `${article} ${rest}` : rest
  }, [cards])

  if (params.get('start') === '1') {
    const size = parseUrlSize(params.get('size'))
    return <Navigate to={size ? `/train?size=${size}` : '/train'} replace />
  }
  if (params.get('practice') === '1') return <Navigate to="/train?mode=practice" replace />
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
  const menuRows = [
    {
      key: 'folder', label: t('cards.folder'),
      value: <>
        {current ? <FolderDot color={current.color} /> : <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${folder === 'none' ? 'bg-faint' : 'bg-accent'}`} />}
        <span className="min-w-0 truncate">{name}</span>
        {count !== undefined && <span className="tabular-nums text-faint">{count}</span>}
      </>,
      onSelect: () => { setMenuOpen(false); setPicking(true) },
    },
    { key: 'direction', label: t('cards.direction'), value: <span className="font-semibold text-fg">{directionLabel}</span>,
      onSelect: () => setDirection(direction === 'de_ru' ? 'ru_de' : 'de_ru') },
  ]

  // Exactly the screen, never scrolling; the shell is hidden here, so nothing else takes height.
  // Normal: the viewport minus both safe areas (the scrubber stays above the home indicator) and main's
  // padding (py-4 = 2rem on phones); from md up minus main's md:py-10 = 5rem (no safe area there).
  // Focus: the page cancels main's vertical padding (-my-4 md:-my-10) and is the viewport minus the top
  // safe area (md: the whole viewport). The card keeps FOCUS_INSET on every side, so the gap under the
  // status bar is the gap at the sides; it may run under the home indicator, its controls clear it.
  // Both change at once on a switch; only the card's size animates (FlipCards).
  // Top bar → the deck (takes the rest) → its controls → the scrubber. Focus mode: the deck alone.
  const pageHeight = focusMode
    ? '-my-4 h-[calc(100dvh-env(safe-area-inset-top))] md:-my-10 md:h-dvh'
    : 'h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] md:h-[calc(100dvh-5rem)]'
  return (
    <div data-testid="deck-page"
      className={`mx-auto flex max-w-3xl flex-col gap-3 overflow-hidden ${pageHeight}`}>
      {!focusMode && (
        <div data-testid="deck-topbar" className="relative flex h-11 shrink-0 items-center justify-between">
          <button type="button" onClick={close} aria-label={t('cards.close')} title={t('cards.close')} className={`-ml-2.5 ${round}`}>
            <X size={22} aria-hidden="true" />
          </button>
          {ready && (
            <span data-testid="deck-counter" className="absolute left-1/2 -translate-x-1/2 text-[15px] font-semibold tabular-nums text-muted">
              {index + 1} / {total}
            </span>
          )}
          <button ref={moreButton} type="button" aria-label={t('cards.options')} title={t('cards.options')}
            aria-haspopup="menu" aria-expanded={menuOpen}
            onClick={() => { setAnchor(moreButton.current?.getBoundingClientRect() ?? null); setMenuOpen(true) }}
            className={`-mr-2.5 ${round}`}>
            <Ellipsis size={22} aria-hidden="true" />
          </button>
        </div>
      )}

      {query.error ? (
        <ErrorState error={query.error} />
      ) : query.isLoading ? (
        <div className="min-h-[320px] max-h-[720px] flex-1 animate-pulse rounded-[32px] bg-surface-2" aria-busy="true" />
      ) : cards.length === 0 ? (
        <div className="glass p-10 text-center">
          <Leaf size={40} aria-hidden="true" className="mx-auto text-faint" />
          <p className="mt-3 text-muted">{folder ? t('cards.emptyFolder') : t('cards.empty')}</p>
          <Link to="/contexts/new" className="btn-primary mt-5"><Plus size={18} aria-hidden="true" />{t('home.addWord')}</Link>
        </div>
      ) : (
        <>
          <FlipCards
            ref={deck}
            cards={cards}
            direction={direction}
            resetKey={`${folder}|${direction}`}
            onNearEnd={query.hasNextPage && !query.isFetchingNextPage ? () => void query.fetchNextPage() : undefined}
            onIndexChange={setIndex}
            focus={focusMode}
            onFocusChange={setFocusMode}
            onToggleRepeat={toggleRepeat}
          />
          {!focusMode && total > 1 && (
            <DeckScrubber index={index} total={total} labelOf={labelOf} onJump={(n) => void jump(n)} busy={jumping || pendingJump !== null} />
          )}
        </>
      )}
      {menuOpen && <DeckMenu anchor={anchor} rows={menuRows} onClose={closeMenu} />}
      {picking && <FolderSheet title={t('cards.pickFolder')} value={folder} onPick={pickFolder} onClose={() => setPicking(false)} />}
    </div>
  )
}
