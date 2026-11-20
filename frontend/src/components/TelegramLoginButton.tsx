import { Loader2 } from 'lucide-react'
import type { TgLoginStatus } from '../lib/telegramLogin'

/** Telegram's paper plane (white on the Telegram blue). */
export function TelegramIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-icon="telegram" className="shrink-0">
      <path d="M20.67 3.33 2.93 10.18c-1.21.49-1.2 1.16-.22 1.46l4.55 1.42 1.75 5.37c.21.59.11.82.73.82.48 0 .69-.22.96-.48l2.3-2.24 4.79 3.54c.88.49 1.52.24 1.74-.82l3.15-14.84c.32-1.29-.49-1.88-1.34-1.48Zm-11.6 9.9 8.4-5.3c.42-.25.8-.12.49.16l-7.2 6.5-.28 2.99-1.41-4.35Z" />
    </svg>
  )
}

const look = 'flex h-[54px] w-full items-center justify-center gap-2.5 rounded-[14px] bg-telegram px-4 text-[17px] font-bold text-on-telegram transition hover:brightness-105 active:scale-[0.99] disabled:cursor-default disabled:opacity-70'

/**
 * The "Continue with Telegram" button. Ready: a real link to the bot (a tap opens Telegram, also on
 * iOS), onOpen marks the wait. Loading: a disabled button with a spinner. Error: a button that
 * tries again.
 */
export function TelegramLoginButton({ status, url, label, onOpen, onRetry }: {
  status: TgLoginStatus; url: string | null; label: string; onOpen: () => void; onRetry: () => void
}) {
  if (status === 'ready' && url) {
    return (
      <a href={url} target="_blank" rel="noopener" onClick={onOpen} className={look} data-testid="telegram-login">
        <TelegramIcon size={22} />{label}
      </a>
    )
  }
  const loading = status === 'loading'
  return (
    <button type="button" className={look} data-testid="telegram-login" disabled={loading} aria-busy={loading || undefined}
      onClick={onRetry}>
      {loading ? <Loader2 size={22} aria-hidden="true" className="shrink-0 animate-spin" /> : <TelegramIcon size={22} />}{label}
    </button>
  )
}
