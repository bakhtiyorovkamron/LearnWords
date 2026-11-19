import type { Folder } from '../api/types'
import { MIN_PRACTICE_WORDS } from './practiceQueue'

type TrainableFolder = Pick<Folder, 'id' | 'total' | 'due_today'>

/** The ▶ of a folder: its due words, or free practice when none are due (with enough words for options). */
export function canTrainFolder(f: TrainableFolder): boolean {
  return f.due_today > 0 || f.total >= MIN_PRACTICE_WORDS
}

export function folderTrainUrl(f: TrainableFolder): string {
  const id = encodeURIComponent(f.id)
  return f.due_today > 0 ? `/train?folder=${id}&size=${Math.min(f.due_today, 20)}` : `/train?mode=practice&folder=${id}`
}

/** The aria-label key of the ▶: review training or free practice. */
export function folderTrainLabelKey(f: TrainableFolder): 'folders.trainFolder' | 'practice.trainFolder' {
  return f.due_today > 0 ? 'folders.trainFolder' : 'practice.trainFolder'
}
