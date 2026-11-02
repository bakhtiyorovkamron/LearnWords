import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Link2, Play, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ErrorState } from './ErrorState'
import { FolderDot, FolderFormModal, shortFolderName, useFolderList } from './Folders'

const VISIBLE_FOLDERS = 6

/**
 * "My folders" on the Home page: one flat list, newest folder first — a row opens the folder in the
 * collection; the last row creates a folder. More than six folders are folded behind one row.
 */
export function FolderList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const list = useFolderList()
  const [creating, setCreating] = useState(false)
  const [expanded, setExpanded] = useState(false)

  if (list.error) return <ErrorState error={list.error} />

  const header = (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[17px] font-semibold text-fg">{t('folders.myFolders')}</h2>
      {list.data && (
        <Link to="/cards" className="text-sm text-muted hover:text-fg">{t('home.allWords', { count: list.data.all.total })}</Link>
      )}
    </div>
  )

  if (list.isLoading || !list.data) {
    return (
      <section>
        {header}
        <div className="glass divide-y divide-divider overflow-hidden" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[54px] animate-pulse bg-surface-2" />
          ))}
        </div>
      </section>
    )
  }

  const newest = [...list.data.folders].reverse() // the API lists the oldest first
  const rows = expanded ? newest : newest.slice(0, VISIBLE_FOLDERS)
  const rest = newest.length - VISIBLE_FOLDERS

  return (
    <section>
      {header}
      <div className="glass divide-y divide-divider overflow-hidden">
        {rows.map((f) => (
          <div key={f.id} className="flex items-center transition hover:bg-surface-2">
            <Link to={`/cards?folder=${encodeURIComponent(f.id)}`}
              className="flex h-[54px] min-w-0 flex-1 items-center gap-3 pl-4 pr-2">
              <FolderDot color={f.color} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-fg" title={f.name}>{shortFolderName(f.name)}</span>
              {f.share_token && <Link2 size={14} aria-label={t('share.isShared')} role="img" className="shrink-0 text-faint" />}
              <span className="text-sm tabular-nums text-muted">{f.total}</span>
            </Link>
            {/* A sibling of the link, never inside it. No due words: an empty spacer keeps the counts aligned. */}
            {f.due_today > 0 ? (
              <button type="button" aria-label={t('folders.trainFolder', { name: f.name })}
                onClick={() => navigate(`/train?folder=${encodeURIComponent(f.id)}&size=${Math.min(f.due_today, 20)}`)}
                className="mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface-2 text-accent-text">
                <Play size={14} fill="currentColor" aria-hidden="true" />
              </button>
            ) : (
              <span aria-hidden="true" className="mr-2 h-11 w-11 shrink-0" />
            )}
          </div>
        ))}
        {!expanded && rest > 0 && (
          <button type="button" onClick={() => setExpanded(true)}
            className="flex h-[54px] w-full items-center px-4 text-left text-[15px] text-muted transition hover:bg-surface-2">
            {t('home.moreFolders', { count: rest })}
          </button>
        )}
        <button type="button" onClick={() => setCreating(true)}
          className="flex h-[54px] w-full items-center gap-3 px-4 text-left text-[15px] font-semibold text-accent-text transition hover:bg-surface-2">
          <Plus size={18} aria-hidden="true" />{t('folders.new')}
        </button>
      </div>
      {newest.length === 0 && <p className="mt-2 text-sm text-muted">{t('folders.createHint')}</p>}
      {creating && <FolderFormModal folder={null} onClose={() => setCreating(false)} />}
    </section>
  )
}
