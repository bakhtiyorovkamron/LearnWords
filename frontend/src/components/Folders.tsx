import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Folder as FolderIcon, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { foldersApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { Folder, FolderSelection } from '../api/types'
import { toast } from './Toaster'
import { ShareFolderModal } from './ShareFolderModal'

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
export function FolderSelect({ value, onChange, includeAll = false, withoutNone = false, className = '' }: {
  value: FolderSelection
  onChange: (v: FolderSelection) => void
  includeAll?: boolean // '' means "all words" when true, "no folder" when false
  withoutNone?: boolean // no "without folder" option: a folder must be chosen
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
      {withoutNone ? null : includeAll ? (
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
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Folder | null>(null)
  const [sharing, setSharing] = useState<Folder | null>(null)

  // Train the words of this folder: the review screen reads the choice from here.
  function train(id: string) {
    localStorage.setItem('review-folder', id)
    navigate('/cards')
  }

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
          {active.total > 0 && (
            <button type="button" className="font-semibold text-accent-text hover:underline" onClick={() => train(active.id)}>
              {t('folders.train')}
            </button>
          )}
          <button type="button" className="text-emerald-100/60 hover:text-lime-300" onClick={() => setEditing(active)}>
            ✏️ {t('folders.rename')}
          </button>
          <button type="button" className="text-emerald-100/60 hover:text-lime-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-emerald-100/60"
            disabled={active.total === 0} title={active.total === 0 ? t('share.emptyFolder') : undefined}
            onClick={() => setSharing(active)}>
            🔗 {t('folders.share')}
          </button>
          <button type="button" className="text-emerald-100/60 hover:text-red-300" disabled={remove.isPending}
            onClick={() => { if (window.confirm(t('folders.deleteConfirm', { name: active.name }))) remove.mutate(active.id) }}>
            🗑 {t('folders.delete')}
          </button>
        </div>
      )}
      {remove.error && <p className="text-xs text-red-300">{errorMessage(remove.error)}</p>}
      {sharing && <ShareFolderModal folder={sharing} onClose={() => setSharing(null)} />}
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
          <h2 id="folder-form-title" className="text-xl font-bold text-fg">
            {folder ? t('folders.rename') : t('folders.new')}
          </h2>
          <button type="button" onClick={onClose} aria-label={t('folders.close')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-fg">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="folder-name">
            {t('folders.nameLabel')}
          </label>
          <div className="relative">
            <input id="folder-name" autoFocus value={name} maxLength={FOLDER_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('folders.namePlaceholder')} className="field w-full pr-14" />
            <span className="pointer-events-none absolute bottom-2.5 right-4 text-xs text-faint">
              {name.length}/{FOLDER_NAME_MAX}
            </span>
          </div>
          {isDuplicate && <p className="mt-1.5 text-xs text-danger">{t('folders.nameTaken')}</p>}
        </div>

        <div>
          <p className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">{t('folders.colorLabel')}</p>
          <div className="flex flex-wrap gap-3">
            {FOLDER_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={c} aria-pressed={color === c}
                className={`relative grid h-8 w-8 place-items-center rounded-full ${DOT[c]} transition ${
                  color === c ? 'ring-2 ring-fg ring-offset-2 ring-offset-surface' : 'opacity-60 hover:opacity-100'
                }`}>
                {color === c && <Check size={16} strokeWidth={3} aria-hidden="true" className="text-bg" />}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-3">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-bg ${DOT[color]}`}><FolderIcon size={18} aria-hidden="true" /></span>
          <span className={`min-w-0 flex-1 truncate font-semibold ${trimmed ? 'text-fg' : 'text-faint'}`}>
            {trimmed || t('folders.previewPlaceholder')}
          </span>
        </div>

        {save.error && !isDuplicate && <p className="text-xs text-danger">{errorMessage(save.error)}</p>}

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
