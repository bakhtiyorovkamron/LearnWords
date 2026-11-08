import { describe, expect, it } from 'vitest'
import { isPolling, tgInitial, tgReducer, WAIT_MS, type TgConnect, type TgEvent } from './telegramConnect'

const run = (events: TgEvent[], from: TgConnect = tgInitial) => events.reduce(tgReducer, from)

describe('the Telegram connect state machine', () => {
  it('idle → linking → waiting → connected', () => {
    let s = tgReducer(tgInitial, { type: 'link' })
    expect(s).toEqual({ status: 'linking' })
    s = tgReducer(s, { type: 'linked', at: 1000 })
    expect(s).toEqual({ status: 'waiting', since: 1000 })
    expect(isPolling(s)).toBe(true)
    s = tgReducer(s, { type: 'tick', at: 4000 })
    expect(s.status).toBe('waiting')
    s = tgReducer(s, { type: 'connected' })
    expect(s).toEqual({ status: 'connected' })
    expect(isPolling(s)).toBe(false)
  })

  it('waiting ends after 60 s, not before: back to idle, polling stops', () => {
    const waiting = run([{ type: 'link' }, { type: 'linked', at: 0 }])
    expect(tgReducer(waiting, { type: 'tick', at: WAIT_MS - 1 }).status).toBe('waiting')
    const over = tgReducer(waiting, { type: 'tick', at: WAIT_MS })
    expect(over).toEqual({ status: 'idle' })
    expect(isPolling(over)).toBe(false)
  })

  it('Connect again while waiting makes a fresh link and waits another 60 s', () => {
    const s = run([{ type: 'link' }, { type: 'linked', at: 0 }, { type: 'link' }, { type: 'linked', at: 50_000 }])
    expect(s).toEqual({ status: 'waiting', since: 50_000 })
    expect(tgReducer(s, { type: 'tick', at: 50_000 + WAIT_MS - 1 }).status).toBe('waiting')
  })

  it('the bot connected after the minute ran out: still connected', () => {
    expect(run([{ type: 'link' }, { type: 'linked', at: 0 }, { type: 'tick', at: WAIT_MS }, { type: 'connected' }]).status).toBe('connected')
  })

  it('503 telegram_unavailable: unavailable for good, the button cannot start again', () => {
    const s = run([{ type: 'link' }, { type: 'failed', unavailable: true }])
    expect(s).toEqual({ status: 'unavailable' })
    expect(tgReducer(s, { type: 'link' })).toBe(s)
  })

  it('another failure goes back to idle (the user may try again)', () => {
    expect(run([{ type: 'link' }, { type: 'failed', unavailable: false }])).toEqual({ status: 'idle' })
  })

  it('a double press while linking does nothing; stray events are ignored', () => {
    const linking = tgReducer(tgInitial, { type: 'link' })
    expect(tgReducer(linking, { type: 'link' })).toBe(linking)
    expect(tgReducer(tgInitial, { type: 'linked', at: 0 })).toBe(tgInitial)
    expect(tgReducer(tgInitial, { type: 'tick', at: WAIT_MS * 2 })).toBe(tgInitial)
    expect(tgReducer(tgInitial, { type: 'failed', unavailable: true })).toBe(tgInitial)
  })
})
