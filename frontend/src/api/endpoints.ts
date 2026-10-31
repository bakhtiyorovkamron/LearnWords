import { api, tokenStore } from './client'
import type {
  AuthResponse, CollectionCard, CollectionPeriod, CollectionSort, CollectionStatus,
  ContextWithCards, DueCard, Folder, FolderList, FolderSelection, Page, Progress, SharedFolder, Stats, WordCard,
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

export type PartOfSpeech = 'noun' | 'verb' | 'adjective' | 'adverb' | 'phrase' | 'other'

// Grammar the user agreed to (word check "ok", or "corrected" → "Use this"). Saved next to the text.
export interface WordGrammar {
  lemma: string; article: string | null; plural: string | null; part_of_speech: PartOfSpeech
}

export interface WordCheck {
  status: 'ok' | 'corrected' | 'unknown' | 'error' // 'error': the check itself failed — no warning
  input: string
  lemma: string
  article: 'der' | 'die' | 'das' | null
  plural: string | null
  part_of_speech: PartOfSpeech
  translation: string
  reason: string
}

function appendGrammar(fd: FormData, g?: WordGrammar | null) {
  if (!g) return
  fd.append('lemma', g.lemma)
  fd.append('article', g.article ?? '')
  fd.append('plural', g.plural ?? '')
  fd.append('part_of_speech', g.part_of_speech)
}

export const wordCheckApi = {
  // German only. 503 = AI not configured → callers just save without a check.
  check: (text: string, nativeLanguage: string, signal?: AbortSignal) =>
    api.post<WordCheck>('/words/check', { text, native_language: nativeLanguage }, { signal, timeout: 45_000 })
      .then((r) => r.data),
}

// Suggestions from the admin job "check existing words"; nothing changes until accepted.
export interface WordFix {
  id: string; word_id: string
  original_word: string; suggested_word: string
  lemma: string; article: string | null; plural: string | null; part_of_speech: PartOfSpeech
  reason: string; translation: string; created_at: string
}

export const wordFixesApi = {
  list: () => api.get<{ items: WordFix[] }>('/word-fixes').then((r) => r.data.items),
  accept: (id: string) => api.post(`/word-fixes/${id}/accept`),
  reject: (id: string) => api.post(`/word-fixes/${id}/reject`),
}

export const contextsApi = {
  create(input: {
    text: string; meaning?: string; pronunciation?: string; language?: string
    exampleSentence?: string; exampleTranslation?: string; folderId?: string
    grammar?: WordGrammar | null
  }) {
    const fd = new FormData()
    fd.append('text', input.text)
    fd.append('meaning', input.meaning ?? '')
    fd.append('pronunciation', input.pronunciation ?? '')
    fd.append('example_sentence', input.exampleSentence ?? '')
    fd.append('example_translation', input.exampleTranslation ?? '')
    if (input.language) fd.append('language', input.language) // backend uses the account language
    if (input.folderId) fd.append('folder_id', input.folderId)
    appendGrammar(fd, input.grammar)
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
  update: (id: string, u: WordUpdate) => api.patch<CollectionCard>(`/words/${id}`, u).then((r) => r.data),
  // One word or many (≤ 500) into a folder (null = no folder). Only the folder changes; the answer
  // has every word's previous folder for "Undo".
  move: (wordIds: string[], folderId: string | null) =>
    api.post<MoveResult>('/words/move', { word_ids: wordIds, folder_id: folderId }).then((r) => r.data),
}

export interface MoveResult {
  moved: number
  previous: { word_id: string; folder_id: string | null }[]
}

export interface WordUpdate {
  word?: string; translation?: string; transcription?: string
  example_sentence?: string; example_translation?: string
  folder_id?: string // '' = remove from folder
}

// Folders are optional grouping only; progress/stories/stats don't depend on them.
export const foldersApi = {
  list: () => api.get<FolderList>('/folders').then((r) => r.data),
  create: (name: string, color: string) => api.post<Folder>('/folders', { name, color }).then((r) => r.data),
  update: (id: string, u: { name?: string; color?: string }) => api.patch<Folder>(`/folders/${id}`, u).then((r) => r.data),
  remove: (id: string) => api.delete(`/folders/${id}`),
  // Public link: enable (or get the existing one) / new token (the old link stops) / turn off.
  share: (id: string) => api.post<ShareInfo>(`/folders/${id}/share`).then((r) => r.data),
  regenerateShare: (id: string) => api.post<ShareInfo>(`/folders/${id}/share/regenerate`).then((r) => r.data),
  disableShare: (id: string) => api.delete(`/folders/${id}/share`),
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
  alternatives?: string[]
  query_language?: string
  translation_language?: string
  already_added: boolean
}

export const searchApi = {
  // AI call with retries on the backend → generous timeout.
  // native_language = UI language (ru/en/uz): the query is most likely in it; translations come back in it.
  search: (query: string, nativeLanguage: string) =>
    api.post<WordInfo>('/search-word', { query, native_language: nativeLanguage }, { timeout: 120_000 })
      .then((r) => r.data),
  add: (w: {
    word: string; translation: string; pronunciation: string
    example_sentence: string; example_translation: string; folder_id?: string
    translation_language?: string // the language `translation` is written in (info.translation_language)
  } & Partial<WordGrammar>) => api.post<ContextWithCards>('/search-word/add', w).then((r) => r.data),
}

export interface PhotoWord {
  word: string; article: string | null; word_type: PartOfSpeech; translation: string
  full_word: string // "der Hund" for nouns, otherwise the word — what is saved
  already_added: boolean
}
export interface PhotoImportResult { words: PhotoWord[]; remaining: number | null }

export const photoApi = {
  // Vision AI call → generous timeout. Costs one unit of the daily photo quota; nothing is saved.
  import: (image: Blob) => {
    const form = new FormData()
    form.append('image', image, 'photo.jpg')
    return api.post<PhotoImportResult>('/photo-import', form, { timeout: 120_000 }).then((r) => r.data)
  },
}

export interface StoryWord {
  word: string; translation: string
  // From the word check (may be absent for older words) — used to find the word in the text.
  lemma?: string; article?: string; part_of_speech?: string
  forms?: string[] // spellings the word has in the story ("kommt" for "kommen"), from proofreading
}
export interface DailyStory {
  id: string; date: string; genre: string; title: string
  story_de: string
  // Translation of story_de and each word's gloss, in `language` (= translation_lang) — resolved (generated + cached
  // on the FIRST view) for the native_language of that request. Empty if translation generation
  // is unavailable or failed — never a guess in the wrong language.
  story_translation: string; language: string
  words_used: StoryWord[]; created_at: string
  source: 'ai' | 'user' // generated from the day's words, or written / pasted by the user
  translation_source: 'ai' | 'user' | '' // who wrote story_translation ('' = there is none yet)
  // The one language this story is translated into (fixed by its first open); '' while not fixed yet.
  translation_lang?: string
}

/** Body of creating / editing an own story. `translation` only counts for translation_mode 'manual'. */
export interface OwnStoryInput {
  title: string; text: string
  translation_mode: 'auto' | 'manual'; translation: string
}

// native_language = the UI language (ru/en/uz): the story's translation and word glosses come
// back in it, generated once and cached server-side.
export const storiesApi = {
  today: (nativeLanguage: string) =>
    api
      .get<{ story: DailyStory | null; words_today: StoryWord[]; genres: string[] }>('/stories/today', {
        params: { native_language: nativeLanguage },
      })
      .then((r) => r.data),
  // Archive list: metadata + learning-language text only (no translation — resolving it for
  // the whole archive up front could mean hundreds of AI calls). Open one story via byId().
  list: () => api.get<{ stories: DailyStory[] }>('/stories').then((r) => r.data.stories),
  // The backend retries the AI call up to 3 times, so allow several minutes.
  generate: (genre: string, nativeLanguage: string) =>
    api
      .post<DailyStory>('/stories/generate', { genre, native_language: nativeLanguage }, { timeout: 420_000 })
      .then((r) => r.data),
  // One story (AI or own) with its text; the translation comes in the interface language
  // (X-Native-Language header).
  byId: (id: string) => api.get<DailyStory>(`/stories/by-id/${id}`).then((r) => r.data),
  // Automatic translation can take a while (the server retries), so the timeout is generous.
  createOwn: (body: OwnStoryInput) =>
    api.post<DailyStory>('/stories/own', body, { timeout: 200_000 }).then((r) => r.data),
  updateOwn: (id: string, body: OwnStoryInput) =>
    api.put<DailyStory>(`/stories/own/${id}`, body, { timeout: 200_000 }).then((r) => r.data),
  deleteOwn: (id: string) => api.delete(`/stories/own/${id}`),
}

// Training-session size: how many due words one "Review" round asks at once. Persisted on
// the server (per user, follows across devices) with a localStorage fallback — see
// lib/reviewSessionSize.ts.
export const SESSION_SIZES = ['10', '20', '50', 'all'] as const
export type SessionSize = (typeof SESSION_SIZES)[number]
export const isSessionSize = (v: unknown): v is SessionSize =>
  typeof v === 'string' && (SESSION_SIZES as readonly string[]).includes(v)

export interface UserSettings {
  interface_language: string; review_session_size: string; theme: string
  daily_goal?: number // words a day: 10 | 20 | 30 | 50 (20 when an old server sends none)
}

export const DAILY_GOALS = [10, 20, 30, 50] as const
export type DailyGoal = (typeof DAILY_GOALS)[number]

export const settingsApi = {
  get: () =>
    api.get<UserSettings>('/me/settings').then((r) => r.data),
  setLanguage: (lang: string) => api.put('/me/settings', { interface_language: lang }),
  setReviewSessionSize: (size: SessionSize) => api.put('/me/settings', { review_session_size: size }),
  /** auto | night | light | graphite | sand | navy */
  setTheme: (theme: string) => api.put('/me/settings', { theme }),
  setDailyGoal: (goal: DailyGoal) => api.put<UserSettings>('/me/settings', { daily_goal: goal }).then((r) => r.data),
}

export type FeatureName = 'photo_import' | 'daily_story' | 'word_search' | 'story_autotranslate' | 'theme_picker'

/** A feature as the admin sees it for one user. daily_limit is the effective limit (null = unlimited). */
export interface FeatureState {
  feature: FeatureName
  enabled: boolean
  daily_limit: number | null
  default_limit: number | null
  limit_override: number | null
  used_today: number
  remaining: number | null
}

export type MeFeatures = Record<FeatureName, { enabled: boolean; daily_limit: number | null; remaining: number | null }>

export interface Me {
  id: string; email: string; role: 'user' | 'admin'; learning_language?: LearningLang
  features?: MeFeatures
  ask_feedback?: boolean // ask for a rating once (account ≥ 2 days old, not answered yet)
}

export const meApi = {
  get: () => api.get<Me>('/me').then((r) => r.data),
}

export interface HeroPhrase { de: string; translation: string }
export type HeroMoodApi = 'idle' | 'sleepy' | 'happy' | 'sad'

export interface Hero {
  stage: number // 1-6 (drawn as 0-5, see lib/heroStages.ts)
  stage_name: string
  learned_count: number
  almost_count: number // words one Leitner box below "learned"
  words_to_next_stage: number
  born_at: string
  age_days: number
  birthday_today: boolean
  mood: HeroMoodApi
  phrase: HeroPhrase
  stage_up: boolean // grew and the congratulation wasn't seen yet → POST /hero/stage-seen
  intro: boolean // the one-time «Meet your German hero!» wasn't seen yet → POST /hero/intro-seen
}

// Open to everyone who learns German, unless the server switches it off (FEATURE_HERO_ENABLED).
// A 404 means "no hero", not an error: callers just show nothing.
export const heroApi = {
  get: (nativeLanguage: string) =>
    api.get<Hero>('/hero', { params: { native_language: nativeLanguage } }).then((r) => r.data),
  stageSeen: () => api.post('/hero/stage-seen'),
  introSeen: () => api.post('/hero/intro-seen'),
}

export interface AdminUser {
  id: string; email: string; role: 'user' | 'admin'; is_banned: boolean
  created_at: string; words_count: number; last_activity_at: string | null
  rating?: number | null // the user's feedback rating
  push_devices?: number // browsers/devices subscribed to Web Push
}

export interface FeedbackItem { email: string; rating: number; comment: string; created_at: string }
export interface FeedbackSummary { average: number; count: number; items: FeedbackItem[] }

export interface PushResult { sent: number; failed: number; removed: number; users: number }

// Web Push: the browser subscribes with the server's VAPID public key; the server remembers the device.
export const pushApi = {
  publicKey: () => api.get<{ key: string }>('/push/public-key').then((r) => r.data.key),
  subscribe: (sub: PushSubscriptionJSON) => api.post('/push/subscribe', sub),
  unsubscribe: (endpoint: string) => api.delete('/push/subscribe', { data: { endpoint } }),
}

export const feedbackApi = {
  // Only the first answer counts on the server.
  submit: (rating: number, comment: string) => api.post('/feedback', { rating, comment }),
  dismiss: () => api.post('/feedback/dismiss'),
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
  feedback: () => api.get<FeedbackSummary>('/admin/feedback').then((r) => r.data),
  pushStats: () => api.get<{ devices: number; users: number }>('/admin/push').then((r) => r.data),
  /** "me" = the calling admin, "all" = every device, "users" = the devices of user_ids. A tap always opens /cards. */
  sendPush: (body: { target: 'me' | 'all' | 'users'; user_ids?: string[]; title: string; body: string }) =>
    api.post<PushResult>('/admin/push', body).then((r) => r.data),
  remove: (id: string) => api.delete(`/admin/users/${id}`),
  setBanned: (id: string, banned: boolean) => api.patch(`/admin/users/${id}/ban`, { banned }),
  userFeatures: (id: string) =>
    api.get<{ features: FeatureState[] }>(`/admin/users/${id}/features`).then((r) => r.data.features),
  setUserFeature: (id: string, feature: FeatureName, body: { enabled: boolean; daily_limit: number | null }) =>
    api.put<FeatureState>(`/admin/users/${id}/features/${feature}`, body).then((r) => r.data),
  wordCheckStatus: () => api.get<WordCheckJob>('/admin/word-check').then((r) => r.data),
  // 202 started, 409 already running — both return the current status.
  startWordCheck: () =>
    api.post<WordCheckJob>('/admin/word-check', null, { validateStatus: (s) => s === 202 || s === 409 })
      .then((r) => r.data),
}

export interface WordCheckJob {
  running: boolean; total: number; processed: number
  suggestions: number; confirmed: number; unknown: number; failed: number
  started_at: string | null; finished_at: string | null; error?: string
}

export const statsApi = {
  get: (period: 'week' | 'month') =>
    api.get<Stats>('/stats', { params: { period } }).then((r) => r.data),
}

export const reviewApi = {
  // total = the real number of due words today, uncapped; cards.length <= the requested limit.
  due: (folder: FolderSelection = '', limit: SessionSize = '20') =>
    api
      .get<{ cards: DueCard[]; total: number }>('/review/due', { params: { folder_id: folder || undefined, limit } })
      .then((r) => r.data),
  answer: (id: string, correct: boolean) =>
    api.post<Progress>(`/review/${id}/answer`, { correct }).then((r) => r.data),
}

// Extra practice: for when there's nothing left due, or just to drill more. Answers here never
// touch the Leitner schedule — enforced on the backend (separate endpoint, separate code path),
// not by anything the client sends.
export const PRACTICE_MODES = ['hard', 'random', 'recent'] as const
export type PracticeMode = (typeof PRACTICE_MODES)[number]

export const practiceApi = {
  words: (mode: PracticeMode, limit: SessionSize, folder: FolderSelection = '') =>
    api
      .get<{ cards: DueCard[] }>('/practice/words', { params: { mode, limit, folder_id: folder || undefined } })
      .then((r) => r.data.cards),
  answer: (id: string, correct: boolean) => api.post(`/practice/${id}/answer`, { correct }),
}

export const cardsApi = {
  list: () => api.get<Page<WordCard>>('/word-cards', { params: { limit: 100 } }).then((r) => r.data.items),
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
  // Ids of every word matching the filters (≤ 500) — "select all" across pages.
  ids: (f: Omit<CollectionQuery, 'limit' | 'offset'>) =>
    api
      .get<{ ids: string[]; total: number }>('/collection/ids', {
        params: { status: f.status, period: f.period, sort: f.sort, q: f.q || undefined, folder_id: f.folder || undefined },
      })
      .then((r) => r.data),
}

export interface ShareInfo { token: string; url: string }
export interface ImportResult { folder_id: string; added: number; skipped: number }

// Shared folders. The preview is public (works logged out); importing needs a login.
export const sharedApi = {
  get: (token: string, lang: string) =>
    api.get<SharedFolder>(`/shared/${token}`, { params: { lang } }).then((r) => r.data),
  import: (token: string) => api.post<ImportResult>(`/shared/${token}/import`).then((r) => r.data),
}
