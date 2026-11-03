import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FolderDot, shortFolderName, useFolderList } from './Folders'
import { Sheet } from './Sheet'

/**
 * Which words are in the deck: all of them, one folder, or the words without a folder (offered only
 * when there are some). `value` is '' (all) | 'none' | a folder id; picking closes the sheet.
 */
export function FolderSheet({ title, value, onPick, onClose }: {
  title: string; value: string; onPick: (folder: string) => void; onClose: () => void
}) {
  const { t } = useTranslation()
  const list = useFolderList()
  const all = list.data?.all.total ?? 0
  const folders = list.data?.folders ?? []
  const withoutFolder = all - folders.reduce((n, f) => n + f.total, 0)

  const row = 'flex min-h-[52px] w-full items-center gap-3 px-1 text-left text-[15px] text-fg transition hover:bg-surface-2'
  const choose = (v: string) => { onPick(v); onClose() }
  const mark = (on: boolean) => on && <Check size={18} aria-hidden="true" className="shrink-0 text-accent-text" />

  return (
    <Sheet label={title} onClose={onClose}>
      <h2 className="text-lg font-bold text-fg">{title}</h2>
      <div role="radiogroup" aria-label={title} className="mt-2 divide-y divide-divider">
        <button type="button" role="radio" aria-checked={value === ''} className={row} onClick={() => choose('')}>
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />
          <span className="min-w-0 flex-1 truncate font-semibold">{t('folders.all')}</span>
          <span className="text-sm tabular-nums text-muted">{all}</span>{mark(value === '')}
        </button>
        {folders.map((f) => (
          <button key={f.id} type="button" role="radio" aria-checked={value === f.id} className={row} title={f.name} onClick={() => choose(f.id)}>
            <FolderDot color={f.color} />
            <span className="min-w-0 flex-1 truncate font-semibold">{shortFolderName(f.name)}</span>
            <span className="text-sm tabular-nums text-muted">{f.total}</span>{mark(value === f.id)}
          </button>
        ))}
        {withoutFolder > 0 && (
          <button type="button" role="radio" aria-checked={value === 'none'} className={row} onClick={() => choose('none')}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-faint" />
            <span className="min-w-0 flex-1 truncate font-semibold">{t('folders.none')}</span>
            <span className="text-sm tabular-nums text-muted">{withoutFolder}</span>{mark(value === 'none')}
          </button>
        )}
      </div>
    </Sheet>
  )
}
