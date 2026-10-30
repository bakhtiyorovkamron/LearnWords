import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Ban, Copy, Link2, RotateCcw, Send, X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { foldersApi, type ShareInfo } from '../api/endpoints'
import { errorMessage } from '../api/client'
import type { Folder } from '../api/types'
import { toast } from './Toaster'

/**
 * Share a folder by a public link. Opening it turns the link on (or shows the existing one);
 * «Create a new link» replaces the token, «Turn off link» closes access.
 */
export function ShareFolderModal({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [info, setInfo] = useState<ShareInfo | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['folders'] })

  const enable = useMutation({
    mutationFn: () => foldersApi.share(folder.id),
    onSuccess: (r) => { setInfo(r); void refresh() },
  })
  const regenerate = useMutation({
    mutationFn: () => foldersApi.regenerateShare(folder.id),
    onSuccess: (r) => { setInfo(r); void refresh() },
  })
  const disable = useMutation({
    mutationFn: () => foldersApi.disableShare(folder.id),
    onSuccess: () => { void refresh(); toast(t('share.disabled')); onClose() },
  })

  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    enable.mutate()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function copy() {
    if (!info) return
    try {
      await navigator.clipboard.writeText(info.url)
    } catch {
      // No clipboard permission / insecure context: select the text so Ctrl+C works.
      input.current?.select()
      document.execCommand?.('copy')
    }
    toast(t('share.copied'))
  }

  const telegram = info
    ? `https://t.me/share/url?url=${encodeURIComponent(info.url)}&text=${encodeURIComponent(t('share.telegramText', { name: folder.name }))}`
    : undefined
  const busy = enable.isPending || regenerate.isPending || disable.isPending
  const error = enable.error ?? regenerate.error ?? disable.error

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="share-title"
        className="glass max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto p-6 text-left">
        <div className="flex items-start justify-between gap-3">
          <h2 id="share-title" className="flex items-center gap-2 text-xl font-bold text-fg"><Link2 size={20} aria-hidden="true" className="shrink-0" />{t('share.title', { name: folder.name })}</h2>
          <button type="button" onClick={onClose} aria-label={t('folders.close')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2"><X size={18} aria-hidden="true" /></button>
        </div>
        <p className="text-sm text-muted">{t('share.hint')}</p>

        <div className="flex gap-2">
          <input ref={input} readOnly value={info?.url ?? ''} aria-label={t('share.copy')}
            onFocus={(e) => e.currentTarget.select()} className="field min-w-0 flex-1 text-sm" />
          <button type="button" onClick={() => void copy()} disabled={!info} className="btn-primary shrink-0 disabled:opacity-50">
            <Copy size={16} aria-hidden="true" />{t('share.copy')}
          </button>
        </div>

        <a href={telegram} target="_blank" rel="noopener noreferrer" aria-disabled={!info}
          className={`btn-ghost flex w-full items-center justify-center gap-2 ${info ? '' : 'pointer-events-none opacity-50'}`}>
          <Send size={16} aria-hidden="true" />{t('share.telegram')}
        </a>

        {(folder.import_count ?? 0) > 0 && (
          <p className="text-sm text-accent-text">{t('share.imports', { count: folder.import_count })}</p>
        )}
        {error && <p className="text-sm text-danger">{errorMessage(error)}</p>}

        <div className="flex flex-wrap justify-between gap-2 border-t border-divider pt-4 text-sm">
          <button type="button" disabled={busy} onClick={() => regenerate.mutate()}
            className="flex items-center gap-1.5 text-muted hover:text-fg disabled:opacity-50"><RotateCcw size={14} aria-hidden="true" />{t('share.regenerate')}</button>
          <button type="button" disabled={busy} onClick={() => disable.mutate()}
            className="flex items-center gap-1.5 text-muted hover:text-danger disabled:opacity-50"><Ban size={14} aria-hidden="true" />{t('share.disable')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
