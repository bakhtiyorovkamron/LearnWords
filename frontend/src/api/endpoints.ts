import { api, tokenStore } from './client'
import type { AuthResponse, Context, ContextWithCards, Page, WordCard } from './types'

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
  create(input: { text?: string; image?: File; language?: string }) {
    if (input.image) {
      const fd = new FormData()
      fd.append('image', input.image)
      if (input.text) fd.append('text', input.text)
      fd.append('language', input.language ?? 'de')
      return api.post<ContextWithCards>('/contexts', fd).then((r) => r.data)
    }
    return api
      .post<ContextWithCards>('/contexts', { text: input.text, language: input.language ?? 'de' })
      .then((r) => r.data)
  },
}

export const cardsApi = {
  list: () => api.get<Page<WordCard>>('/word-cards', { params: { limit: 100 } }).then((r) => r.data.items),
  regenerateAudio: (id: string) => api.post<WordCard>(`/word-cards/${id}/audio`).then((r) => r.data),
}
