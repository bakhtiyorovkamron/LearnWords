import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { foldersApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { Folder, FolderSelection, FolderStats } from '../api/types'
import { useLearningLang } from '../lib/learningLang'
import { STATUS_STYLE } from './ProgressDots'
import { toast } from './Toaster'

export const FOLDER_COLORS = ['lime', 'amber', 'sky', 'rose', 'violet', 'slate'] as const

const DOT: Record<string, string> = {
  lime: 'bg-lime-400', amber: 'bg-amber-400', sky: 'bg-sky-400',
  rose: 'bg-rose-400', violet: 'bg-violet-400', slate: 'bg-slate-400',
}

export function FolderDot({ color }: { color: string }) {
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[color] ?? 'bg-emerald-300'}`} />
}

export function useFolderList() {
  return useQuery({ queryKey: ['folders'], queryFn: foldersApi.list, staleTime: 60_000 })
}

/** Just the user's folders (no all/none aggregates) — for the dropdown/chips pickers. */
export function useFolders() {
  const q = useFolderList()
  return { ...q, data: q.data?.folders }
}

const MAX_FOLDER_LABEL = 24

/** Folder names are user input of any length: cut to N chars + "…" (full name stays in the title). */
export function shortFolderName(name: string, max = MAX_FOLDER_LABEL): string {
  const chars = Array.from(name.trim()) // emoji-safe
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('')
}

/** Native select: "all words" (optional) / "without folder" / each folder. Fixed width, never stretches its container. */
export function FolderSelect({ value, onChange, includeAll = false, className = '' }: {
  value: FolderSelection
  onChange: (v: FolderSelection) => void
  includeAll?: boolean // '' means "all words" when true, "no folder" when false
  className?: string
}) {
  const { t } = useTranslation()
  const folders = useFolders()
  const selected = folders.data?.find((f) => f.id === value)
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={selected?.name}
      aria-label={t('folders.label')}
      // min-w-0/max-w-full: may shrink inside flex parents and never overflow the card;
      // nowrap + ellipsis: long text is cut instead of wrapping; leading-normal + items-center keeps 📁, text and ▼ on one line.
      className={`field block min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap py-2 text-sm leading-normal ${className}`}
    >
      {includeAll ? (
        <>
          <option value="">{t('folders.all')}</option>
          <option value="none">{t('folders.none')}</option>
        </>
      ) : (
        <option value="">{t('folders.none')}</option>
      )}
      {folders.data?.map((f) => (
        <option key={f.id} value={f.id} title={f.name}>📁 {shortFolderName(f.name)}</option>
      ))}
    </select>
  )
}

/** Chips row for the Collection: All words / each folder / + New folder; rename/delete the active one. */
export function FolderBar({ value, onChange }: { value: FolderSelection; onChange: (v: FolderSelection) => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const folders = useFolders()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Folder | null>(null)

  const remove = useMutation({
    mutationFn: (id: string) => foldersApi.remove(id),
    onSuccess: () => {
      onChange('')
      qc.invalidateQueries({ queryKey: ['folders'] })
      qc.invalidateQueries({ queryKey: ['collection'] })
      toast(t('folders.deleted'))
    },
  })

  const active = folders.data?.find((f) => f.id === value)
  const chip = (on: boolean) =>
    `flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold transition ${
      on ? 'border-lime-400 bg-lime-400 text-emerald-950'
        : 'border-emerald-400/20 bg-emerald-950/40 text-emerald-100/80 hover:border-lime-400/50 hover:text-white'
    }`

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={chip(value === '')} onClick={() => onChange('')}>📚 {t('folders.all')}</button>
        {folders.data?.map((f) => (
          <button key={f.id} type="button" className={chip(value === f.id)} onClick={() => onChange(f.id)} title={f.name}>
            <FolderDot color={f.color} /> <span className="max-w-[12rem] truncate">{shortFolderName(f.name)}</span>
            <span className="text-xs opacity-60">{f.total}</span>
          </button>
        ))}
        <button type="button" className={chip(value === 'none')} onClick={() => onChange('none')}>{t('folders.none')}</button>
        <button type="button" onClick={() => setCreating(true)}
          className="rounded-full border border-dashed border-lime-400/50 px-4 py-1.5 text-sm font-semibold text-lime-300 hover:bg-lime-400/10">
          + {t('folders.new')}
        </button>
      </div>
      {active && (
        <div className="flex gap-3 text-xs">
          <button type="button" className="text-emerald-100/60 hover:text-lime-300" onClick={() => setEditing(active)}>
            ✏️ {t('folders.rename')}
          </button>
          <button type="button" className="text-emerald-100/60 hover:text-red-300" disabled={remove.isPending}
            onClick={() => { if (window.confirm(t('folders.deleteConfirm', { name: active.name }))) remove.mutate(active.id) }}>
            🗑 {t('folders.delete')}
          </button>
        </div>
      )}
      {remove.error && <p className="text-xs text-red-300">{errorMessage(remove.error)}</p>}
      {(creating || editing) && (
        <FolderFormModal folder={editing} onClose={() => { setCreating(false); setEditing(null) }}
          onCreated={(f) => onChange(f.id)} />
      )}
    </div>
  )
}

const FOLDER_NAME_MAX = 40

/** Create / rename+recolour a folder, as a centered modal with a live preview. */
export function FolderFormModal({ folder, onClose, onCreated }: {
  folder: Folder | null; onClose: () => void; onCreated?: (f: Folder) => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const allFolders = useFolders()
  const [name, setName] = useState(folder?.name ?? '')
  const [color, setColor] = useState(folder?.color || 'lime')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const trimmed = name.trim()
  // Unique per user, checked live against the already-loaded folder list (own folder excluded when renaming).
  const isDuplicate = trimmed !== '' && (allFolders.data ?? [])
    .some((f) => f.id !== folder?.id && f.name.toLowerCase() === trimmed.toLowerCase())
  const isValid = trimmed !== '' && !isDuplicate

  const save = useMutation({
    mutationFn: () => folder
      ? foldersApi.update(folder.id, { name: trimmed, color })
      : foldersApi.create(trimmed, color),
    onSuccess: (f) => {
      qc.invalidateQueries({ queryKey: ['folders'] })
      onCreated?.(f)
      toast(folder ? t('folders.saved') : t('folders.created'))
      onClose()
    },
  })

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form
        role="dialog" aria-modal="true" aria-labelledby="folder-form-title"
        className="glass max-h-[90vh] w-full max-w-md space-y-5 overflow-y-auto p-6 text-left"
        onSubmit={(e) => { e.preventDefault(); if (isValid) save.mutate() }}
      >
        <div className="flex items-center justify-between">
          <h2 id="folder-form-title" className="display text-xl font-extrabold">
            {folder ? t('folders.rename') : t('folders.new')}
          </h2>
          <button type="button" onClick={onClose} aria-label={t('folders.close')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-emerald-300/60 transition hover:bg-emerald-400/10 hover:text-white">
            ✕
          </button>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-emerald-100/60" htmlFor="folder-name">
            {t('folders.nameLabel')}
          </label>
          <div className="relative">
            <input id="folder-name" autoFocus value={name} maxLength={FOLDER_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('folders.namePlaceholder')} className="field w-full pr-14" />
            <span className="pointer-events-none absolute bottom-2.5 right-4 text-xs text-emerald-100/40">
              {name.length}/{FOLDER_NAME_MAX}
            </span>
          </div>
          {isDuplicate && <p className="mt-1.5 text-xs text-red-300">{t('folders.nameTaken')}</p>}
        </div>

        <div>
          <p className="mb-2 block text-xs font-semibold uppercase tracking-wide text-emerald-100/60">{t('folders.colorLabel')}</p>
          <div className="flex flex-wrap gap-3">
            {FOLDER_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={c} aria-pressed={color === c}
                className={`relative grid h-8 w-8 place-items-center rounded-full ${DOT[c]} transition ${
                  color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-emerald-900' : 'opacity-60 hover:opacity-100'
                }`}>
                {color === c && <span aria-hidden className="text-sm font-bold text-emerald-950">✓</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-emerald-400/15 bg-emerald-950/40 p-3">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg text-emerald-950 ${DOT[color]}`}>📁</span>
          <span className={`min-w-0 flex-1 truncate font-semibold ${trimmed ? 'text-white' : 'text-emerald-100/40'}`}>
            {trimmed || t('folders.previewPlaceholder')}
          </span>
        </div>

        {save.error && !isDuplicate && <p className="text-xs text-red-300">{errorMessage(save.error)}</p>}

        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="btn-ghost h-11 flex-1">{t('editWord.cancel')}</button>
          <button type="submit" disabled={!isValid || save.isPending} className="btn-primary h-11 flex-1">
            {t('editWord.save')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

/** Three-segment progress bar (new/learning/learned), same colours as the Collection filter. */
function FolderProgressBar({ stats }: { stats: FolderStats }) {
  const { t } = useTranslation()
  const pct = (n: number) => (stats.total ? (n / stats.total) * 100 : 0)
  return (
    <div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/10">
        <span className={STATUS_STYLE.new.bar} style={{ width: `${pct(stats.new_count)}%` }} />
        <span className={STATUS_STYLE.learning.bar} style={{ width: `${pct(stats.learning_count)}%` }} />
        <span className={STATUS_STYLE.learned.bar} style={{ width: `${pct(stats.learned_count)}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-emerald-100/60">
        {t('folders.learnedOf', { learned: stats.learned_count, total: stats.total })}
      </p>
    </div>
  )
}

interface FolderCardData {
  linkId: string // '' = all words, 'none' = no folder, otherwise the folder id
  name: string
  color?: string // real folders only; All/No-folder use `icon` instead
  icon?: string
  stats: FolderStats
  locked?: boolean // All/No-folder: no rename/delete menu
}

function FolderCard({ data, onEdit, onDelete, deleting }: {
  data: FolderCardData; onEdit?: () => void; onDelete?: () => void; deleting?: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  function train() {
    localStorage.setItem('review-folder', data.linkId)
    navigate('/cards')
  }

  return (
    <div className="animate-rise group relative flex h-full flex-col overflow-hidden rounded-3xl border border-emerald-400/15 bg-gradient-to-br from-emerald-800/50 via-emerald-900/40 to-teal-900/40 p-5 transition hover:-translate-y-1 hover:border-lime-400/40 hover:shadow-xl hover:shadow-emerald-500/10">
      {/* Fixed-height header: reserves the "⋯" button's slot even when it's not rendered,
          so every card's title row — and everything below it — lines up. */}
      <div className="flex h-8 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {data.color ? <FolderDot color={data.color} /> : <span className="text-lg leading-none">{data.icon}</span>}
          <h3 className="truncate text-lg font-bold text-white" title={data.name}>{shortFolderName(data.name)}</h3>
        </div>
        {!data.locked ? (
          <div className="relative shrink-0">
            <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-label={t('folders.menu')}
              className="grid h-8 w-8 place-items-center rounded-full text-emerald-300/60 transition hover:bg-emerald-400/10 hover:text-lime-300">
              ⋯
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-9 z-20 w-40 overflow-hidden rounded-xl border border-emerald-400/20 bg-emerald-950 shadow-xl"
                onMouseLeave={() => setMenuOpen(false)}>
                <button type="button" onClick={() => { setMenuOpen(false); onEdit?.() }}
                  className="block w-full px-4 py-2 text-left text-sm text-emerald-100/80 hover:bg-emerald-400/10 hover:text-white">
                  ✏️ {t('folders.rename')}
                </button>
                <button type="button" disabled={deleting} onClick={() => { setMenuOpen(false); onDelete?.() }}
                  className="block w-full px-4 py-2 text-left text-sm text-red-300/80 hover:bg-red-500/10 hover:text-red-200 disabled:opacity-50">
                  🗑 {t('folders.delete')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div aria-hidden className="h-8 w-8 shrink-0" />
        )}
      </div>

      <p className="mt-1 text-xs text-emerald-100/60">{t('folders.wordsCount', { count: data.stats.total })}</p>

      <div className="mt-4"><FolderProgressBar stats={data.stats} /></div>

      {/* Reserved slot: present (empty) even with nothing due, so the buttons below never shift. */}
      <div className="mt-3 min-h-[1.75rem]">
        {data.stats.due_today > 0 && (
          <p className="inline-flex items-center gap-1 rounded-full bg-lime-400/15 px-3 py-1 text-xs font-semibold text-lime-300">
            🔔 {t('folders.dueToday', { count: data.stats.due_today })}
          </p>
        )}
      </div>

      {/* mt-auto: pinned to the bottom of the (grid-stretched) card, flush with every sibling. */}
      <div className="mt-auto flex gap-2">
        <Link to={`/cards?tab=all&folder=${encodeURIComponent(data.linkId)}`}
          className="btn-ghost flex-1 py-2 text-center text-sm">
          {t('folders.open')}
        </Link>
        <button type="button" onClick={train} className="btn-primary flex-1 py-2 text-sm">
          {t('folders.train')}
        </button>
      </div>
    </div>
  )
}

/** "My folders" grid for the Contexts page: All words / user folders / + New folder. */
export function FolderGrid() {
  const { t } = useTranslation()
  const learning = useLearningLang()
  const qc = useQueryClient()
  const list = useFolderList()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Folder | null>(null)

  const remove = useMutation({
    mutationFn: (id: string) => foldersApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['folders'] })
      toast(t('folders.deleted'))
    },
  })

  if (list.isLoading) {
    return (
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-52 animate-pulse rounded-3xl bg-emerald-800/30" />
        ))}
      </div>
    )
  }
  if (list.error) return <p className="text-red-300">{errorMessage(list.error)}</p>
  if (!list.data) return null

  const { all, folders } = list.data

  if (all.total === 0) {
    return (
      <div className="glass p-10 text-center">
        <div className="text-5xl">🌿</div>
        <p className="mt-3 text-emerald-100/70">{t('home.empty', learning.vars)}</p>
        <Link to="/contexts/new" className="btn-primary mt-6">{t('home.start')}</Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <FolderCard data={{ linkId: '', name: t('folders.all'), icon: '📚', stats: all, locked: true }} />
        {folders.map((f) => (
          <FolderCard key={f.id} data={{ linkId: f.id, name: f.name, color: f.color, stats: f }}
            onEdit={() => setEditing(f)}
            onDelete={() => { if (window.confirm(t('folders.deleteConfirm', { name: f.name }))) remove.mutate(f.id) }}
            deleting={remove.isPending && remove.variables === f.id} />
        ))}
        <button type="button" onClick={() => setCreating(true)}
          className="flex min-h-[13rem] flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-lime-400/30 text-lime-300/80 transition hover:border-lime-400/60 hover:text-lime-300">
          <span className="text-3xl">+</span>
          <span className="text-sm font-semibold">{t('folders.new')}</span>
        </button>
      </div>

      {folders.length === 0 && <p className="text-center text-sm text-emerald-100/50">{t('folders.createHint')}</p>}
      {remove.error && <p className="text-center text-xs text-red-300">{errorMessage(remove.error)}</p>}

      {(creating || editing) && (
        <FolderFormModal folder={editing} onClose={() => { setCreating(false); setEditing(null) }} />
      )}
    </div>
  )
}
