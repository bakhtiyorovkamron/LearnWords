// The "Connect Telegram" flow on the profile page, as a small state machine:
//   idle → linking (POST link) → waiting (the bot is open; the profile is polled) → connected
//                               ↘ unavailable (503 telegram_unavailable: the button stays off)
//   waiting → timeout after WAIT_MS: polling stops; "Check" looks once more and waits again.
// Whether Telegram IS connected comes from the profile; this only tracks the attempt.

export const POLL_MS = 3_000
export const WAIT_MS = 60_000

export type TgConnect =
  | { status: 'idle' }
  | { status: 'linking' }
  | { status: 'waiting'; url: string; since: number }
  | { status: 'timeout'; url: string }
  | { status: 'connected' }
  | { status: 'unavailable' }

export type TgEvent =
  | { type: 'link' } // the button was pressed
  | { type: 'linked'; url: string; at: number } // the server made the deep link (the bot is opened)
  | { type: 'failed'; unavailable: boolean } // the link request failed
  | { type: 'tick'; at: number } // time passes while waiting
  | { type: 'check'; at: number } // "Check": after a timeout, wait (and poll) again
  | { type: 'connected' } // the profile says Telegram is connected
  | { type: 'disconnected' } // "Disconnect" went through

export const tgInitial: TgConnect = { status: 'idle' }

export function tgReducer(state: TgConnect, e: TgEvent): TgConnect {
  switch (e.type) {
    case 'link':
      return state.status === 'unavailable' || state.status === 'linking' ? state : { status: 'linking' }
    case 'linked':
      return state.status === 'linking' ? { status: 'waiting', url: e.url, since: e.at } : state
    case 'failed':
      return state.status === 'linking' ? (e.unavailable ? { status: 'unavailable' } : { status: 'idle' }) : state
    case 'tick':
      return state.status === 'waiting' && e.at - state.since >= WAIT_MS ? { status: 'timeout', url: state.url } : state
    case 'check':
      return state.status === 'timeout' ? { status: 'waiting', url: state.url, since: e.at } : state
    case 'connected':
      return state.status === 'unavailable' ? state : { status: 'connected' }
    case 'disconnected':
      return state.status === 'unavailable' ? state : { status: 'idle' }
  }
}

/** Poll the profile only while waiting for the bot. */
export const isPolling = (s: TgConnect) => s.status === 'waiting'
