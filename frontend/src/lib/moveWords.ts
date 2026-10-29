import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { wordsApi, type MoveResult } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { toast } from '../components/Toaster'

const UNDO_MS = 6000

/** Groups words by the folder they were in: one move request per previous folder restores them all. */
export function groupByFolder(previous: MoveResult['previous']): { folderId: string | null; ids: string[] }[] {
  const groups = new Map<string | null, string[]>()
  for (const p of previous) groups.set(p.folder_id, [...(groups.get(p.folder_id) ?? []), p.word_id])
  return [...groups].map(([folderId, ids]) => ({ folderId, ids }))
}

/**
 * Moves words to a folder (null = no folder) and shows «Moved to “Folder”: N» with Undo for 6 s.
 * Undo puts every word back into its own previous folder through the same endpoint.
 * Resolves to true on success.
 */
export function useMoveWords() {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const refresh = useCallback(() => {
    // Folder counters, due-today and every word list depend on the folder.
    for (const key of ['collection', 'folders', 'review-due', 'cards']) {
      void qc.invalidateQueries({ queryKey: [key] })
    }
  }, [qc])

  return useCallback(async (ids: string[], folderId: string | null, folderName: string): Promise<boolean> => {
    try {
      const res = await wordsApi.move(ids, folderId)
      refresh()
      toast(t('move.done', { folder: folderName, n: res.moved }), {
        ms: UNDO_MS,
        action: {
          label: t('move.undo'),
          onClick: () => {
            Promise.all(groupByFolder(res.previous).map((g) => wordsApi.move(g.ids, g.folderId)))
              .catch((e) => toast(`${t('move.failed')}: ${errorMessage(e)}`))
              .finally(refresh)
          },
        },
      })
      return true
    } catch (e) {
      toast(`${t('move.failed')}: ${errorMessage(e)}`)
      return false
    }
  }, [t, refresh])
}
