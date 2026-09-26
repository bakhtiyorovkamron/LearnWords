import { api, tokenStore } from './client'
import type { AuthResponse, Context, ContextWithCards, Page, Photo, WordCard } from './types'

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
  photos: (id: string, q?: string) =>
    api.get<Page<Photo>>(`/contexts/${id}/photos`, { params: q ? { q } : {} }).then((r) => r.data.items),
  setPhoto: (id: string, photo: Photo) =>
    api.put(`/contexts/${id}/photo`, { url: photo.url, credit: photo.credit }),
  create(input: { text: string; language?: string }) {
    return api
      .post<ContextWithCards>('/contexts', { text: input.text, language: input.language ?? 'de' })
      .then((r) => r.data)
  },
}

export const cardsApi = {
  list: () => api.get<Page<WordCard>>('/word-cards', { params: { limit: 100 } }).then((r) => r.data.items),
  regenerateAudio: (id: string) => api.post<WordCard>(`/word-cards/${id}/audio`).then((r) => r.data),
}
