/** Accounts created by Telegram get "tg<chat id>@telegram.yodla.fun": not a mailbox, never shown as one. */
export const TELEGRAM_EMAIL_DOMAIN = '@telegram.yodla.fun'

export const isTelegramEmail = (email?: string | null): boolean =>
  !!email && email.trim().toLowerCase().endsWith(TELEGRAM_EMAIL_DOMAIN)
