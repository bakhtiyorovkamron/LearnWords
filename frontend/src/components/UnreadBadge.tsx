import { useTranslation } from 'react-i18next'

/** The count a badge shows: the number up to 9, then "9+". */
export const badgeText = (count: number) => (count > 9 ? '9+' : String(count))

/**
 * A small lime pill with the number of unread chat messages ("9+" above 9); nothing for 0.
 * `className` places it (e.g. absolute over an icon).
 */
export function UnreadBadge({ count, className = '', testId }: { count: number; className?: string; testId?: string }) {
  const { t } = useTranslation()
  if (!(count > 0)) return null
  return (
    <span role="img" data-testid={testId} aria-label={t('chat.unreadAria', { count })}
      className={`inline-grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-accent px-1 text-[11px] font-bold leading-none text-on-accent ${className}`}>
      <span aria-hidden="true">{badgeText(count)}</span>
    </span>
  )
}
