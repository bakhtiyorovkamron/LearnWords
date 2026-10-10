// Pure decision logic for how the hero reacts to events — kept free of React/DOM so it's
// testable on its own. HeroWidget just calls these and applies the result.
import type { HeroEvent } from './heroBus'
import type { HeroMood } from './heroAssets'
import type { HeroPhraseKey } from './heroPhrases'

export const BUBBLE_COOLDOWN_MS = 4000
export const ABSENCE_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000 // 3+ days
export const INACTIVITY_SLEEPY_MS = 2 * 60 * 1000 // 2 minutes

export interface HeroReaction {
  mood: HeroMood
  /** How long the mood lasts before reverting to idle; null = indefinite (sleepy). */
  moodDurationMs: number | null
  bubbleKey: HeroPhraseKey | null
}

const NO_BUBBLE_MOOD_ONLY = (mood: HeroMood, moodDurationMs: number | null): HeroReaction => ({
  mood,
  moodDurationMs,
  bubbleKey: null,
})

/**
 * Decides the mood + whether to show a speech bubble for `event`.
 * - correct/wrong always change mood; the bubble is probabilistic (1/4, 1/3) UNLESS a streak
 *   milestone is hit, which always shows a bubble.
 * - word_learned/session_finished always show a bubble.
 * - "Always" bubbles still reset the cooldown (so an opportunistic bubble right after must
 *   still wait BUBBLE_COOLDOWN_MS) — they just aren't blocked BY it themselves.
 * - Probabilistic bubbles are skipped outright while still in cooldown (no wasted roll).
 *
 * `now`/`lastBubbleAt` in ms; `rand()` in [0, 1) — both injectable for deterministic tests.
 */
export function reactToEvent(
  event: HeroEvent,
  now: number,
  lastBubbleAt: number,
  rand: () => number = Math.random,
): { reaction: HeroReaction; nextLastBubbleAt: number } {
  const cooldownOk = now - lastBubbleAt >= BUBBLE_COOLDOWN_MS

  switch (event.type) {
    case 'session_started':
      return { reaction: NO_BUBBLE_MOOD_ONLY('idle', null), nextLastBubbleAt: lastBubbleAt }

    case 'answer': {
      const mood: HeroMood = event.correct ? 'happy' : 'sad'
      const moodDurationMs = event.correct ? 1500 : 2000
      const milestoneKey: HeroPhraseKey | null =
        event.streak === 5 ? 'streak5' : event.streak === 10 ? 'streak10' : event.streak === 20 ? 'streak20' : null
      if (milestoneKey) {
        return { reaction: { mood, moodDurationMs, bubbleKey: milestoneKey }, nextLastBubbleAt: now }
      }
      const chance = event.correct ? 1 / 4 : 1 / 3
      if (cooldownOk && rand() < chance) {
        return {
          reaction: { mood, moodDurationMs, bubbleKey: event.correct ? 'correct' : 'wrong' },
          nextLastBubbleAt: now,
        }
      }
      return { reaction: NO_BUBBLE_MOOD_ONLY(mood, moodDurationMs), nextLastBubbleAt: lastBubbleAt }
    }

    case 'word_learned':
      return { reaction: { mood: 'cheer', moodDurationMs: 2000, bubbleKey: 'wordLearned' }, nextLastBubbleAt: now }

    case 'session_finished':
      return { reaction: { mood: 'cheer', moodDurationMs: 2000, bubbleKey: 'sessionFinished' }, nextLastBubbleAt: now }
  }
}

/** The hero has been away 3+ days: always shows the return line (bypasses/resets cooldown). */
export function reactToReturn(): { reaction: HeroReaction; nextLastBubbleAt: number } {
  return { reaction: { mood: 'happy', moodDurationMs: 2000, bubbleKey: 'returnAfterAbsence' }, nextLastBubbleAt: 0 }
}

/** The hero just reached a new stage: always shows the growth line. */
export function reactToStageChanged(): { reaction: HeroReaction; nextLastBubbleAt: number } {
  return { reaction: { mood: 'cheer', moodDurationMs: 2200, bubbleKey: 'grown' }, nextLastBubbleAt: 0 }
}

/** True once `lastActivityAt` is at least INACTIVITY_SLEEPY_MS in the past. */
export function isInactiveEnoughToSleep(lastActivityAt: number, now: number): boolean {
  return now - lastActivityAt >= INACTIVITY_SLEEPY_MS
}

/** True when the gap since the previous visit is 3+ days — i.e. show the "welcome back" line. */
export function wasAbsent(lastSeenAt: number | null, now: number): boolean {
  return lastSeenAt !== null && now - lastSeenAt >= ABSENCE_THRESHOLD_MS
}
