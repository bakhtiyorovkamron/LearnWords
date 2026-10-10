// Stage × mood → visual resource. Nothing else in the app reads emoji/animation details
// directly — swapping in real art later (SVGs or images) means editing only this file.

export type HeroMood = 'idle' | 'happy' | 'sad' | 'cheer' | 'sleepy'

// Temporary placeholders (no art yet). One emoji per stage; mood only changes the animation
// for now — give moods their own art here later without touching HeroWidget.
const STAGE_EMOJI: readonly string[] = ['👶', '🧒', '🎨', '🎒', '🎧', '🧑‍💼']

const MOOD_ANIMATION_CLASS: Record<HeroMood, string> = {
  idle: 'hero-anim-idle',
  happy: 'hero-anim-happy',
  sad: 'hero-anim-sad',
  cheer: 'hero-anim-cheer',
  sleepy: 'hero-anim-sleepy',
}

export interface HeroAsset {
  emoji: string
  animationClass: string
}

export function heroAsset(stage: number, mood: HeroMood): HeroAsset {
  const idx = Math.min(Math.max(Math.trunc(stage), 1), STAGE_EMOJI.length) - 1
  return { emoji: STAGE_EMOJI[idx], animationClass: MOOD_ANIMATION_CLASS[mood] }
}
