import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { wordsApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { toast } from '../components/Toaster'

export const UNDO_MS = 6000

// Words waiting to be deleted: hidden from every list until the delete is committed and the lists
// are refetched, or until Undo. A new Set on every change, so React sees a new snapshot.
let hidden: ReadonlySet<string> = new Set()
const subscribers = new Set<() => void>()

function setHidden(next: ReadonlySet<string>) {
  hidden = next
  subscribers.forEach((fn) => fn())
}
function hide(ids: string[]) {
  setHidden(new Set([...hidden, ...ids]))
}
function unhide(ids: string[]) {
  const next = new Set(hidden)
  ids.forEach((id) => next.delete(id))
  setHidden(next)
}
function subscribe(fn: () => void) {
  subscribers.add(fn)
  return () => { subscribers.delete(fn) }
}

export function useHiddenWordIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => hidden)
}

/** cards without the words waiting to be deleted; the same array when none of them is hidden. */
export function useVisibleCards<T extends { id: string }>(cards: T[]): T[] {
  const ids = useHiddenWordIds()
  return useMemo(() => {
    if (ids.size === 0) return cards
    const visible = cards.filter((c) => !ids.has(c.id))
    return visible.length === cards.length ? cards : visible
  }, [cards, ids])
}

// Every delete is its own batch with its own timer and toast, so each Undo cancels exactly its batch.
type Batch = { ids: string[]; timer: ReturnType<typeof setTimeout>; commit: () => Promise<void> }
const batches = new Map<number, Batch>()
let seq = 0
let listening = false

function send(id: number): Promise<void> {
  const b = batches.get(id)
  if (!b) return Promise.resolve()
  batches.delete(id)
  clearTimeout(b.timer)
  return b.commit()
}

/** Sends every pending batch now, without waiting for its Undo time. */
export function commitPendingDeletes(): Promise<void> {
  return Promise.all([...batches.keys()].map(send)).then(() => undefined)
}

// Leaving the page sends what is pending. Best effort: if the request dies with the tab, the words
// simply stay.
function listenForPageExit() {
  if (listening) return
  listening = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void commitPendingDeletes()
  })
  window.addEventListener('pagehide', () => { void commitPendingDeletes() })
}

/** Tests only: forgets pending batches (nothing is sent) and hidden ids. */
export function resetDeleteWords() {
  batches.forEach((b) => clearTimeout(b.timer))
  batches.clear()
  setHidden(new Set())
}

/**
 * Deletes words with Undo: the rows disappear at once and «Deleted …» with Undo shows for 6 s.
 * The request is sent only after that; Undo before it means nothing is ever sent.
 */
export function useDeleteWords() {
  const { t } = useTranslation()
  const qc = useQueryClient()

  return useCallback((items: { id: string; word: string }[]) => {
    const ids = items.map((i) => i.id)
    const id = ++seq
    hide(ids)

    const commit = async () => {
      try {
        await wordsApi.remove(ids)
      } catch (e) {
        toast(`${t('wordCard.deleteFailed')}: ${errorMessage(e)}`)
      }
      try {
        // Folder counters, due-today and every word list change. The rows come back only after the
        // refetch, so a deleted word does not flash before the new lists arrive.
        await Promise.all(['collection', 'folders', 'review-due', 'cards'].map((key) => qc.invalidateQueries({ queryKey: [key] })))
      } finally {
        unhide(ids)
      }
    }
    // The cache was never touched, so Undo has nothing to refetch. Already sent → nothing to undo.
    const undo = () => {
      const b = batches.get(id)
      if (!b) return
      clearTimeout(b.timer)
      batches.delete(id)
      unhide(ids)
    }

    batches.set(id, { ids, timer: setTimeout(() => void send(id), UNDO_MS), commit })
    listenForPageExit()
    const text = items.length === 1 ? t('del.doneOne', { word: items[0].word }) : t('del.doneMany', { count: items.length })
    toast(text, { ms: UNDO_MS, icon: Trash2, action: { label: t('move.undo'), onClick: undo } })
  }, [t, qc])
}
