import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Folder as FolderIcon, Pencil, Play, Plus, Share2, Trash, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { foldersApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { Folder, FolderSelection } from '../api/types'
import { FOLDER_COLORS, FOLDER_DOT } from '../lib/folderColors'
import { toast } from './Toaster'
import { ShareFolderModal } from './ShareFolderModal'

export { FOLDER_COLORS }
const DOT = FOLDER_DOT

export function FolderDot({ color }: { color: string }) {
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[color] ?? 'bg-faint'}`} />
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
      // nowrap + ellipsis: long text is cut instead of wrapping.
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
        <option key={f.id} value={f.id} title={f.name}>{shortFolderName(f.name)}</option>
      ))}
    </select>
  )
}

// A small ghost action under the chips.
const action = 'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'

/** Chips row for the Collection: All words / each folder / + Folder; actions for the active folder. */
export function FolderBar({ value, onChange }: { value: FolderSelection; onChange: (v: FolderSelection) => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const folders = useFolders()
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
    `flex h-9 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition ${
      on ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface text-muted hover:text-fg'
    }`

  return (
    <div className="space-y-2">
      <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
        <button type="button" className={chip(value === '')} onClick={() => onChange('')}>{t('folders.all')}</button>
        {folders.data?.map((f) => (
          <button key={f.id} type="button" className={chip(value === f.id)} onClick={() => onChange(f.id)} title={f.name}>
            <FolderDot color={f.color} /> <span className="max-w-[12rem] truncate">{shortFolderName(f.name)}</span>
            <span className="text-xs opacity-70">{f.total}</span>
          </button>
        ))}
        <button type="button" className={chip(value === 'none')} onClick={() => onChange('none')}>{t('folders.none')}</button>
        <button type="button" onClick={() => setCreating(true)}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-line px-4 text-sm font-semibold text-accent-text transition hover:bg-surface-2">
          <Plus size={16} aria-hidden="true" />{t('folders.new')}
        </button>
      </div>
      {active && (
        <div className="flex flex-wrap gap-1">
          {active.total > 0 && (
            <button type="button" className={`${action} font-semibold text-accent-text`} onClick={() => train(active.id)}>
              <Play size={16} aria-hidden="true" />{t('folders.train')}
            </button>
          )}
          <button type="button" className={`${action} text-muted`} disabled={active.total === 0}
            title={active.total === 0 ? t('share.emptyFolder') : undefined} onClick={() => setSharing(active)}>
            <Share2 size={16} aria-hidden="true" />{t('folders.share')}
          </button>
          <button type="button" className={`${action} text-muted`} onClick={() => setEditing(active)}>
            <Pencil size={16} aria-hidden="true" />{t('folders.rename')}
          </button>
          <button type="button" className={`${action} text-danger`} disabled={remove.isPending}
            onClick={() => { if (window.confirm(t('folders.deleteConfirm', { name: active.name }))) remove.mutate(active.id) }}>
            <Trash size={16} aria-hidden="true" />{t('folders.delete')}
          </button>
        </div>
      )}
      {remove.error && <p className="text-xs text-danger">{errorMessage(remove.error)}</p>}
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
