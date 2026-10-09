import { api, tokenStore } from './client'
import type {
  AuthResponse, CollectionCard, CollectionPeriod, CollectionSort, CollectionStatus,
  Context, ContextWithCards, DueCard, Folder, FolderSelection, Page, Progress, Stats, WordCard,
} from './types'

export interface Credentials {
  email: string
  password: string
}

// Language the user learns — chosen once at registration.
export type LearningLang = 'de' | 'en' | 'fr' | 'ko'
export const LEARNING_LANGS: { code: LearningLang; flag: string; name: string; locale: string }[] = [
  { code: 'de', flag: '🇩🇪', name: 'Deutsch', locale: 'de-DE' },
  { code: 'en', flag: '🇬🇧', name: 'English', locale: 'en-US' },
  { code: 'fr', flag: '🇫🇷', name: 'Français', locale: 'fr-FR' },
  { code: 'ko', flag: '🇰🇷', name: '한국어', locale: 'ko-KR' },
]

export const authApi = {
  async login(c: Credentials) {
    const { data } = await api.post<AuthResponse>('/auth/login', c)
    tokenStore.set(data.access_token)
    return data
  },
  async register(c: Credentials & { learning_language?: LearningLang }) {
    const { data } = await api.post<AuthResponse>('/auth/register', c)
    tokenStore.set(data.access_token)
    if (c.learning_language) localStorage.setItem('learning_language', c.learning_language)
    return data
  },
  async logout() {
    await api.post('/auth/logout').catch(() => undefined)
    tokenStore.set(null)
    localStorage.removeItem('learning_language')
  },
}

export const contextsApi = {
  list: () => api.get<Page<Context>>('/contexts').then((r) => r.data.items),
  words: (id: string) => api.get<Page<WordCard>>(`/contexts/${id}/words`).then((r) => r.data.items),
  remove: (id: string) => api.delete(`/contexts/${id}`),
  setPhoto: (id: string, file: File) => {
    const fd = new FormData()
    fd.append('photo', file)
    return api.put(`/contexts/${id}/photo`, fd)
  },
  create(input: {
    text: string; meaning?: string; pronunciation?: string; photo?: File | null; language?: string
    exampleSentence?: string; exampleTranslation?: string; folderId?: string
  }) {
    const fd = new FormData()
    fd.append('text', input.text)
    fd.append('meaning', input.meaning ?? '')
    fd.append('pronunciation', input.pronunciation ?? '')
    fd.append('example_sentence', input.exampleSentence ?? '')
    fd.append('example_translation', input.exampleTranslation ?? '')
    if (input.language) fd.append('language', input.language) // backend uses the account language
    if (input.folderId) fd.append('folder_id', input.folderId)
    return api.post<ContextWithCards>('/contexts', fd).then((r) => r.data)
  },
}

export const wordsApi = {
  generateExample: (word: string, translation: string) =>
    api
      .post<{ example_sentence: string; example_translation: string; full_sentence: string }>(
        '/words/generate-example',
        { word, translation },
        { timeout: 45_000 },
      )
      .then((r) => r.data),
  // Only changed fields are sent; learning progress is not affected.
  update: (id: string, u: WordUpdate) => api.patch<WordCard>(`/words/${id}`, u).then((r) => r.data),
}

export interface WordUpdate {
  word?: string; translation?: string; transcription?: string
  example_sentence?: string; example_translation?: string
  folder_id?: string // '' = remove from folder
}

// Folders are optional grouping only; progress/stories/stats don't depend on them.
export const foldersApi = {
  list: () => api.get<{ folders: Folder[] }>('/folders').then((r) => r.data.folders),
  create: (name: string, color: string) => api.post<Folder>('/folders', { name, color }).then((r) => r.data),
  update: (id: string, u: { name?: string; color?: string }) => api.patch<Folder>(`/folders/${id}`, u).then((r) => r.data),
  remove: (id: string) => api.delete(`/folders/${id}`),
}

export interface WordInfo {
  word: string
  word_type: 'noun' | 'verb' | 'adjective' | 'adverb' | 'other'
  article: string | null
  plural: string | null
  translation: string
  pronunciation: string
  verb_type: 'weak' | 'strong' | string | null
  conjugation_present: Record<string, string> | null
  perfekt: string | null
  praeteritum: string | null
  comparative: string | null
  superlative: string | null
  example_sentence: string
  example_translation: string
  already_added: boolean
}

export const searchApi = {
  // AI call with retries on the backend → generous timeout.
  search: (query: string) =>
    api.post<WordInfo>('/search-word', { query }, { timeout: 120_000 }).then((r) => r.data),
  add: (w: {
    word: string; translation: string; pronunciation: string
    example_sentence: string; example_translation: string; folder_id?: string
  }) => api.post<ContextWithCards>('/search-word/add', w).then((r) => r.data),
}

export interface StoryWord { word: string; translation: string }
export interface DailyStory {
  id: string; date: string; genre: string; title: string
  story_de: string; story_ru: string; words_used: StoryWord[]; created_at: string
}

export const storiesApi = {
  today: () =>
    api.get<{ story: DailyStory | null; words_today: StoryWord[]; genres: string[] }>('/stories/today').then((r) => r.data),
  list: () => api.get<{ stories: DailyStory[] }>('/stories').then((r) => r.data.stories),
  // The backend retries the AI call up to 3 times, so allow several minutes.
  generate: (genre?: string) =>
    api.post<DailyStory>('/stories/generate', { genre: genre ?? '' }, { timeout: 420_000 }).then((r) => r.data),
}

export const settingsApi = {
  get: () => api.get<{ interface_language: string }>('/me/settings').then((r) => r.data),
  setLanguage: (lang: string) => api.put('/me/settings', { interface_language: lang }),
}

export interface Me { id: string; email: string; role: 'user' | 'admin'; learning_language?: LearningLang }

export const meApi = {
  get: () => api.get<Me>('/me').then((r) => r.data),
}

export interface AdminUser {
  id: string; email: string; role: 'user' | 'admin'; is_banned: boolean
  created_at: string; words_count: number; last_activity_at: string | null
}

export interface AdminStats {
  total_users: number; banned_users: number; new_users_7d: number; active_users_7d: number
  total_words: number; total_reviews: number; training_sessions: number
  total_stories: number; stories_30d: number
}

// All of these are additionally guarded on the backend (RequireAdmin → 403 for non-admins).
export const adminApi = {
  users: () => api.get<{ users: AdminUser[] }>('/admin/users').then((r) => r.data.users),
  stats: () => api.get<AdminStats>('/admin/stats').then((r) => r.data),
  remove: (id: string) => api.delete(`/admin/users/${id}`),
  setBanned: (id: string, banned: boolean) => api.patch(`/admin/users/${id}/ban`, { banned }),
}

export const statsApi = {
  get: (period: 'week' | 'month') =>
    api.get<Stats>('/stats', { params: { period } }).then((r) => r.data),
}

export const reviewApi = {
  due: (folder: FolderSelection = '') =>
    api.get<{ cards: DueCard[] }>('/review/due', { params: { folder_id: folder || undefined } }).then((r) => r.data.cards),
  answer: (id: string, correct: boolean) =>
    api.post<Progress>(`/review/${id}/answer`, { correct }).then((r) => r.data),
}

export const cardsApi = {
  list: () => api.get<Page<WordCard>>('/word-cards', { params: { limit: 100 } }).then((r) => r.data.items),
  regenerateAudio: (id: string) => api.post<WordCard>(`/word-cards/${id}/audio`).then((r) => r.data),
  remove: (id: string) => api.delete(`/word-cards/${id}`),
}

export interface CollectionQuery {
  status: CollectionStatus; period: CollectionPeriod; sort: CollectionSort; q: string
  folder?: FolderSelection
  limit?: number; offset?: number
}

// Filtering/sorting happen on the backend (SQL), one page at a time.
export const collectionApi = {
  list: (f: CollectionQuery) =>
    api
      .get<{ items: CollectionCard[]; total: number }>('/collection', {
        params: {
          status: f.status, period: f.period, sort: f.sort, q: f.q || undefined,
          folder_id: f.folder || undefined, limit: f.limit ?? 48, offset: f.offset ?? 0,
        },
      })
      .then((r) => r.data),
}
