import { describe, expect, it } from 'vitest'
import {
  BUBBLE_COOLDOWN_MS, isInactiveEnoughToSleep, reactToEvent, reactToReturn, reactToStageChanged, wasAbsent,
} from './heroReaction'

const always = () => 0 // "wins" any probabilistic roll (rand() < chance is true for chance > 0)
const never = () => 0.999999 // "loses" any roll under 1

describe('reactToEvent: mood', () => {
  it('correct answer -> happy, 1.5s', () => {
    const { reaction } = reactToEvent({ type: 'answer', correct: true, streak: 1 }, 0, -Infinity, never)
    expect(reaction.mood).toBe('happy')
    expect(reaction.moodDurationMs).toBe(1500)
  })

  it('wrong answer -> sad, 2s', () => {
    const { reaction } = reactToEvent({ type: 'answer', correct: false, streak: 0 }, 0, -Infinity, never)
    expect(reaction.mood).toBe('sad')
    expect(reaction.moodDurationMs).toBe(2000)
  })
})

describe('reactToEvent: bubble frequency', () => {
  it('correct answers show a bubble roughly 1/4 of the time, gated by rand()', () => {
    const win = reactToEvent({ type: 'answer', correct: true, streak: 1 }, 10_000, 0, always)
    expect(win.reaction.bubbleKey).toBe('correct')
    const lose = reactToEvent({ type: 'answer', correct: true, streak: 1 }, 10_000, 0, never)
    expect(lose.reaction.bubbleKey).toBeNull()
  })

  it('wrong answers show a bubble roughly 1/3 of the time, gated by rand()', () => {
    const win = reactToEvent({ type: 'answer', correct: false, streak: 0 }, 10_000, 0, always)
    expect(win.reaction.bubbleKey).toBe('wrong')
    const lose = reactToEvent({ type: 'answer', correct: false, streak: 0 }, 10_000, 0, never)
    expect(lose.reaction.bubbleKey).toBeNull()
  })

  it('a probabilistic bubble is skipped outright while still in cooldown, even on a winning roll', () => {
    const lastBubbleAt = 10_000
    const now = lastBubbleAt + BUBBLE_COOLDOWN_MS - 1 // 1ms short of the cooldown elapsing
    const { reaction } = reactToEvent({ type: 'answer', correct: true, streak: 1 }, now, lastBubbleAt, always)
    expect(reaction.bubbleKey).toBeNull()
  })

  it('a probabilistic bubble is eligible again once the cooldown has fully elapsed', () => {
    const lastBubbleAt = 10_000
    const now = lastBubbleAt + BUBBLE_COOLDOWN_MS
    const { reaction } = reactToEvent({ type: 'answer', correct: true, streak: 1 }, now, lastBubbleAt, always)
    expect(reaction.bubbleKey).toBe('correct')
  })

  it('streaks of 5, 10 and 20 ALWAYS show their milestone bubble, even mid-cooldown', () => {
    for (const [streak, key] of [[5, 'streak5'], [10, 'streak10'], [20, 'streak20']] as const) {
      const { reaction } = reactToEvent({ type: 'answer', correct: true, streak }, 1000, 999, never)
      expect(reaction.bubbleKey).toBe(key)
    }
  })

  it('word_learned and session_finished always show a bubble, even mid-cooldown', () => {
    const learned = reactToEvent({ type: 'word_learned' }, 1000, 999, never)
    expect(learned.reaction.bubbleKey).toBe('wordLearned')
    const finished = reactToEvent({ type: 'session_finished', correctCount: 1, total: 1 }, 1000, 999, never)
    expect(finished.reaction.bubbleKey).toBe('sessionFinished')
  })

  it('a shown bubble resets the cooldown clock to now', () => {
    const { nextLastBubbleAt } = reactToEvent({ type: 'word_learned' }, 5000, 0, never)
    expect(nextLastBubbleAt).toBe(5000)
  })

  it('a bubble that does NOT show leaves the cooldown clock untouched', () => {
    const { nextLastBubbleAt } = reactToEvent({ type: 'answer', correct: true, streak: 1 }, 5000, 123, never)
    expect(nextLastBubbleAt).toBe(123)
  })
})

describe('reactToReturn / reactToStageChanged', () => {
  it('always returns the welcome-back line', () => {
    const { reaction } = reactToReturn()
    expect(reaction.bubbleKey).toBe('returnAfterAbsence')
  })

  it('always returns the growth line', () => {
    const { reaction } = reactToStageChanged()
    expect(reaction.bubbleKey).toBe('grown')
  })
})

describe('isInactiveEnoughToSleep / wasAbsent', () => {
  it('is false just under the inactivity threshold, true at/after it', () => {
    expect(isInactiveEnoughToSleep(0, 119_999)).toBe(false)
    expect(isInactiveEnoughToSleep(0, 120_000)).toBe(true)
  })

  it('wasAbsent is false with no prior visit, false just under 3 days, true at/after it', () => {
    const threeDays = 3 * 24 * 60 * 60 * 1000
    expect(wasAbsent(null, threeDays)).toBe(false)
    expect(wasAbsent(0, threeDays - 1)).toBe(false)
    expect(wasAbsent(0, threeDays)).toBe(true)
  })
})
