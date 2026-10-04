export interface User {
  id: string
  email: string
  created_at: string
}

export interface AuthResponse {
  access_token: string
  access_expires_at: string
  user?: User
}

export interface Context {
  id: string
  user_id: string
  image_url?: string
  photo_credit?: string
  source_text: string
  meaning?: string
  language: string
  created_at: string
}


export interface WordCard {
  id: string
  context_id: string
  word: string
  translation: string
  transcription: string
  audio_url?: string
  language: string
  created_at: string
  example_sentence?: string
  example_translation?: string
}

export interface DueCard extends WordCard {
  box_level: number
  has_example: boolean
}

export interface Progress {
  word_id: string
  box_level: number
  correct_streak_at_max: number
  is_learned: boolean
  next_review_at: string
}

export interface DayStat {
  date: string
  reviewed: number
  correct: number
  new_words: number
}

export interface Stats {
  daily: DayStat[]
  totals: {
    total_words_learned: number
    current_streak_days: number
    longest_streak_days: number
    accuracy_percent: number
  }
}

export interface ContextWithCards {
  context: Context
  cards: WordCard[]
}

export interface Page<T> {
  items: T[]
  limit?: number
  offset?: number
}
