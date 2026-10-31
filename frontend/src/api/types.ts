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
  folder_id?: string | null // optional folder; null = no folder
  translation_language?: string | null // language `translation` is written in (ru | en | uz)
  // Grammar from the word check, stored next to the typed text; null = not checked.
  lemma?: string | null
  article?: string | null
  plural?: string | null
  part_of_speech?: string | null
}

export interface FolderStats {
  total: number
  new_count: number
  learning_count: number
  learned_count: number
  due_today: number
}

export interface Folder extends FolderStats {
  id: string
  name: string
  color: string
  created_at: string
  share_token?: string | null // public link token; null/absent = not shared
  import_count?: number // how many users added a copy of the shared folder
}

// GET /api/folders response: the user's folders plus the "all words" aggregate. Words without
// a folder are included in "all" and stay reachable via the 'none' FolderSelection elsewhere.
export interface FolderList {
  all: FolderStats
  folders: Folder[]
}

/** '' = all words, 'none' = words without a folder, otherwise a folder id. */
export type FolderSelection = string

export interface DueCard extends WordCard {
  box_level: number
  has_example: boolean
}

// Card with Leitner progress (Collection page).
export interface CollectionCard extends WordCard {
  box_level: number // Leitner box 1-5
  is_learned: boolean
  next_review_at: string // RFC 3339, UTC midnight of the review day
  reviewed_today: boolean // answered in a Leitner review today (extra practice doesn't count)
}

export type CollectionStatus = 'all' | 'new' | 'learning' | 'learned'
export type CollectionPeriod = 'all' | 'today' | 'week'
export type CollectionSort = 'date' | 'alpha' | 'progress'

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
  active?: boolean // any answer that day (review or practice)
  goal_met?: boolean // the daily goal was reached
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

// GET /api/shared/:token — the public view of a shared folder (nothing identifies the owner).
export interface SharedWord {
  word: string
  article: string | null
  translation: string
  transcription: string
  example_sentence: string
  example_translation: string
}
export interface SharedFolder {
  name: string
  color: string
  language: string
  word_count: number
  words: SharedWord[]
}
