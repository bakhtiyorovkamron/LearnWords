import { SearchX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { WordCardView } from './WordCard'
import type { CollectionCard } from '../api/types'

/** The glass list of word rows (box indicator on each), optionally with checkboxes. */
export function WordList({ cards, selection }: {
  cards: CollectionCard[]
  selection?: { selected: Set<string>; toggle: (id: string) => void }
}) {
  return (
    <div className="glass divide-y divide-divider overflow-hidden">
      {cards.map((c) => (
        <WordCardView key={c.id} card={c}
          progress={{ boxLevel: c.box_level, isLearned: c.is_learned, nextReviewAt: c.next_review_at, reviewedToday: c.reviewed_today }}
          selection={selection ? { checked: selection.selected.has(c.id), onToggle: () => selection.toggle(c.id) } : undefined} />
      ))}
    </div>
  )
}

/** "Nothing found" for a search or filters that hide everything. */
export function NothingFound() {
  const { t } = useTranslation()
  return (
    <div className="glass p-10 text-center">
      <SearchX size={40} aria-hidden="true" className="mx-auto text-faint" />
      <p className="mt-3 text-muted">{t('cards.nothingFound')}</p>
    </div>
  )
}
