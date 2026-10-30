import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Ban, Check, Folder as FolderIcon, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Folder } from '../api/types'
import { FolderDot, FolderFormModal, shortFolderName, useFolders } from './Folders'

/**
 * Where to move words: "No folder", each folder, "+ New folder" (creates it and picks it).
 * A bottom sheet above the tab bar on phones, a centered dialog on desktop.
 * `current` (folder id, '' = none) is marked; `onPick` gets the id (null = no folder) and its name.
 */
export function FolderPicker({ title, current, onPick, onClose }: {
  title: string
  current?: string
  onPick: (folderId: string | null, folderName: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const folders = useFolders()
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (creating) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, creating])

  const row = 'flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-base transition hover:bg-surface-2'
  const mark = (active: boolean) => (active ? <Check size={18} aria-hidden="true" className="ml-auto text-accent-text" /> : null)

  if (creating) {
    return <FolderFormModal folder={null} onClose={() => setCreating(false)}
      onCreated={(f: Folder) => onPick(f.id, f.name)} />
  }
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm md:items-center md:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className="animate-rise flex max-h-[calc(100dvh-env(safe-area-inset-top)-1rem)] w-full flex-col overflow-hidden rounded-t-[22px] border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:max-h-[80vh] md:max-w-sm md:rounded-[22px] md:border md:pb-0">
        <h2 className="flex items-center gap-2 border-b border-divider px-5 py-4 text-lg font-bold text-fg"><FolderIcon size={20} aria-hidden="true" />{title}</h2>
        <div className="space-y-1 overflow-y-auto p-2">
          <button type="button" className={row} onClick={() => onPick(null, t('folder.none'))}>
            <Ban size={14} aria-hidden="true" className="text-faint" />{t('folder.none')}{mark(current === '')}
          </button>
          {folders.data?.map((f) => (
            <button key={f.id} type="button" className={row} title={f.name} onClick={() => onPick(f.id, f.name)}>
              <FolderDot color={f.color} />
              <span className="min-w-0 truncate">{shortFolderName(f.name)}</span>
              {mark(current === f.id)}
            </button>
          ))}
          <button type="button" className={`${row} font-semibold text-accent-text`} onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" />{t('folder.new')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
