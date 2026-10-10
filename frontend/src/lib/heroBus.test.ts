import { describe, expect, it, vi } from 'vitest'
import { emitHeroEvent, onHeroEvent } from './heroBus'

describe('heroBus', () => {
  it('delivers an emitted event to a subscribed listener', () => {
    const listener = vi.fn()
    const off = onHeroEvent(listener)
    emitHeroEvent({ type: 'session_started' })
    expect(listener).toHaveBeenCalledWith({ type: 'session_started' })
    off()
  })

  it('stops delivering events after unsubscribing', () => {
    const listener = vi.fn()
    const off = onHeroEvent(listener)
    off()
    emitHeroEvent({ type: 'word_learned' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('delivers to multiple independent subscribers', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = onHeroEvent(a)
    const offB = onHeroEvent(b)
    emitHeroEvent({ type: 'answer', correct: true, streak: 3 })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    offA()
    offB()
  })

  it('passes the full event payload through unchanged', () => {
    const listener = vi.fn()
    const off = onHeroEvent(listener)
    emitHeroEvent({ type: 'session_finished', correctCount: 7, total: 10 })
    expect(listener).toHaveBeenCalledWith({ type: 'session_finished', correctCount: 7, total: 10 })
    off()
  })
})
