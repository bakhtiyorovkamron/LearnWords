import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { api } from './client'

// Every request tells the server the interface language: new translations are written in it.
describe('X-Native-Language', () => {
  it.each(['ru', 'en', 'uz'])('is sent with the interface language %s', async (lng) => {
    await i18n.changeLanguage(lng)
    let sent: unknown
    await api.get('/ping', {
      adapter: async (config) => {
        sent = config.headers.get('X-Native-Language')
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config }
      },
    })
    expect(sent).toBe(lng)
  })
})
