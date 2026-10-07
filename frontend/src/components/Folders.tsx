import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { foldersApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { Folder, FolderSelection } from '../api/types'
import { toast } from './Toaster'

export const FOLDER_COLORS = ['lime', 'amber', 'sky', 'rose', 'violet', 'slate'] as const

const DOT: Record<string, string> = {
  lime: 'bg-lime-400', amber: 'bg-amber-400', sky: 'bg-sky-400',
  rose: 'bg-rose-400', violet: 'bg-violet-400', slate: 'bg-slate-400',
}

export function FolderDot({ color }: { color: string }) {
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[color] ?? 'bg-emerald-300'}`} />
}

export function useFolders() {
  return useQuery({ queryKey: ['folders'], queryFn: foldersApi.list, staleTime: 60_000 })
}

/** Native select: "all words" (optional) / "without folder" / each folder. */
export function FolderSelect({ value, onChange, includeAll = false, className = '' }: {
  value: FolderSelection
  onChange: (v: FolderSelection) => void
  includeAll?: boolean // '' means "all words" when true, "no folder" when false
  className?: string
}) {
  const { t } = useTranslation()
  const folders = useFolders()
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`field w-auto py-2 text-sm ${className}`}
      aria-label={t('folders.label')}>
      {includeAll ? (
        <>
          <option value="">{t('folders.all')}</option>
          <option value="none">{t('folders.none')}</option>
        </>
      ) : (
        <option value="">{t('folders.none')}</option>
      )}
      {folders.data?.map((f) => <option key={f.id} value={f.id}>📁 {f.name}</option>)}
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
          <button key={f.id} type="button" className={chip(value === f.id)} onClick={() => onChange(f.id)}>
            <FolderDot color={f.color} /> {f.name}
            <span className="text-xs opacity-60">{f.words_count}</span>
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
        <FolderForm folder={editing} onClose={() => { setCreating(false); setEditing(null) }}
          onCreated={(f) => onChange(f.id)} />
      )}
    </div>
  )
}

function FolderForm({ folder, onClose, onCreated }: {
  folder: Folder | null; onClose: () => void; onCreated: (f: Folder) => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [name, setName] = useState(folder?.name ?? '')
  const [color, setColor] = useState(folder?.color || 'lime')
  const save = useMutation({
    mutationFn: () => folder
      ? foldersApi.update(folder.id, { name: name.trim(), color })
      : foldersApi.create(name.trim(), color),
    onSuccess: (f) => {
      qc.invalidateQueries({ queryKey: ['folders'] })
      if (!folder) onCreated(f)
      toast(folder ? t('folders.saved') : t('folders.created'))
      onClose()
    },
  })
  return (
    <form className="glass flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
      onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate() }}>
      <input autoFocus value={name} maxLength={50} onChange={(e) => setName(e.target.value)}
        placeholder={t('folders.namePlaceholder')} className="field flex-1 py-2" />
      <div className="flex gap-1.5">
        {FOLDER_COLORS.map((c) => (
          <button key={c} type="button" onClick={() => setColor(c)} aria-label={c}
            className={`grid h-7 w-7 place-items-center rounded-full ${color === c ? 'ring-2 ring-white' : ''}`}>
            <FolderDot color={c} />
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>{t('editWord.cancel')}</button>
        <button type="submit" className="btn-primary" disabled={save.isPending || !name.trim()}>{t('editWord.save')}</button>
      </div>
      {save.error && <p className="text-xs text-red-300">{errorMessage(save.error)}</p>}
    </form>
  )
}
