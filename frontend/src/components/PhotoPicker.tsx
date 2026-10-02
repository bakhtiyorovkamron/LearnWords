import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { contextsApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { resizeImage } from '../lib/image'
import { useTranslation } from 'react-i18next'

// Modal for uploading a photo for an existing context.
export function PhotoPicker({ contextId, onClose }: { contextId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const upload = useMutation({
    mutationFn: async (file: File) => contextsApi.setPhoto(contextId, await resizeImage(file)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contexts'] })
      onClose()
    },
  })

  const error = localError ?? (upload.error ? errorMessage(upload.error) : null)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-emerald-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}>
      <div className="glass w-full max-w-md p-6 md:p-8" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="display text-2xl font-extrabold">{t('photo.titleA')}<span className="text-lime-300">{t('photo.titleB')}</span></h2>
          <button onClick={onClose} className="btn-ghost">✕</button>
        </div>

        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            setLocalError(null)
            if (f) upload.mutate(f)
          }} />
        <button onClick={() => inputRef.current?.click()} disabled={upload.isPending}
          className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-emerald-400/30 text-emerald-200/70 transition hover:border-lime-400 hover:text-lime-300 disabled:opacity-60">
          <span className="text-4xl">{upload.isPending ? '⏳' : '📷'}</span>
          <span className="text-sm font-semibold">{upload.isPending ? t('photo.uploading') : t('photo.choose')}</span>
        </button>
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </div>
    </div>
  )
}
