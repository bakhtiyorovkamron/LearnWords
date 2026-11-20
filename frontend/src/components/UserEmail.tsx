import { isTelegramEmail } from '../lib/telegramEmail'

/**
 * A user's email in the admin panel. An account created by Telegram has a made-up address (not a
 * mailbox): it shows "Telegram", the real value stays in the tooltip.
 */
export function UserEmail({ email, className }: { email: string; className?: string }) {
  if (isTelegramEmail(email)) {
    return <span title={email} className={className} data-telegram-email="">Telegram</span>
  }
  return <span className={className}>{email}</span>
}
