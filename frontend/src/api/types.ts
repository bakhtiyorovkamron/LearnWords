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
