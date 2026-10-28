import { AxiosError, type AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { errorMessage, isRateLimited } from './client'

const fail = (status: number, data: unknown) =>
  new AxiosError('x', String(status), undefined, undefined, { status, data, headers: {}, statusText: '', config: {} as never } as AxiosResponse)

beforeEach(async () => { await i18n.changeLanguage('en') })

describe('feature errors', () => {
  it('a daily_limit 429 is not a rate limit and says how much you get tomorrow', () => {
    const err = fail(429, { error: 'daily limit reached', code: 'daily_limit', limit: 4 })
    expect(isRateLimited(err)).toBe(false)
    expect(errorMessage(err)).toBe("Today's limit is used up — tomorrow you get 4 again.")
    expect(errorMessage(err)).not.toMatch(/seconds|Too many/i)
  })

  it('a plain 429 is still a rate limit', () => {
    expect(isRateLimited(fail(429, { error: 'rate limited' }))).toBe(true)
  })

  it('feature_disabled gets its own text', () => {
    expect(errorMessage(fail(403, { error: 'x', code: 'feature_disabled' }))).toBe('This feature is turned off for your account.')
  })
})
