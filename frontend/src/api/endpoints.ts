import { api, tokenStore } from './client'
import type { AuthResponse, Context, ContextWithCards, DueCard, Page, Progress, Stats, WordCard } from './types'

export interface Credentials {
  email: string
  password: string
}

export const authApi = {
  async login(c: Credentials) {
    const { data } = await api.post<AuthResponse>('/auth/login', c)
    tokenStore.set(data.access_token)
    return data
  },
  async register(c: Credentials) {
    const { data } = await api.post<AuthResponse>('/auth/register', c)
    tokenStore.set(data.access_token)
    return data
  },
  async logout() {
    await api.post('/auth/logout').catch(() => undefined)
    tokenStore.set(null)
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
    exampleSentence?: string; exampleTranslation?: string
  }) {
    const fd = new FormData()
    fd.append('text', input.text)
    fd.append('meaning', input.meaning ?? '')
    fd.append('pronunciation', input.pronunciation ?? '')
    fd.append('example_sentence', input.exampleSentence ?? '')
    fd.append('example_translation', input.exampleTranslation ?? '')
    fd.append('language', input.language ?? 'de')
    if (input.photo) fd.append('photo', input.photo)
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
}

export const statsApi = {
  get: (period: 'week' | 'month') =>
    api.get<Stats>('/stats', { params: { period } }).then((r) => r.data),
}

export const reviewApi = {
  due: () => api.get<{ cards: DueCard[] }>('/review/due').then((r) => r.data.cards),
  answer: (id: string, correct: boolean) =>
    api.post<Progress>(`/review/${id}/answer`, { correct }).then((r) => r.data),
}

export const cardsApi = {
  list: () => api.get<Page<WordCard>>('/word-cards', { params: { limit: 100 } }).then((r) => r.data.items),
  regenerateAudio: (id: string) => api.post<WordCard>(`/word-cards/${id}/audio`).then((r) => r.data),
  remove: (id: string) => api.delete(`/word-cards/${id}`),
}
