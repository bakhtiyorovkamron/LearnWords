import { describe, expect, it } from 'vitest'
import { formatPhoneInput, phoneForApi } from './phone'

describe('formatPhoneInput', () => {
  it.each([
    ['', ''],
    ['9', '+998 9'],
    ['90', '+998 90'],
    ['901', '+998 90 1'],
    ['90123', '+998 90 123'],
    ['901234', '+998 90 123 4'],
    ['90123456', '+998 90 123 45 6'],
    ['901234567', '+998 90 123 45 67'],
  ])('local digits %j → %j', (raw, want) => expect(formatPhoneInput(raw)).toBe(want))

  it('a pasted full number is formatted whatever its shape', () => {
    for (const raw of ['+998901234567', '998901234567', '+998 90 123 45 67', '+998-90-123-45-67', '(998) 90 123-45-67']) {
      expect(formatPhoneInput(raw)).toBe('+998 90 123 45 67')
    }
  })

  it('more than 9 digits after +998 are cut', () => {
    expect(formatPhoneInput('+99890123456789')).toBe('+998 90 123 45 67')
  })

  it('letters are dropped', () => {
    expect(formatPhoneInput('+998 9a0')).toBe('+998 90')
  })

  it('typing the country code by hand does not turn it into local digits', () => {
    expect(formatPhoneInput('+')).toBe('+')
    expect(formatPhoneInput('+9')).toBe('+9')
    expect(formatPhoneInput('+99')).toBe('+99')
    expect(formatPhoneInput('+998')).toBe('+998')
  })

  it('backspace walks back through the formatted value without getting stuck', () => {
    let value = formatPhoneInput('901234567')
    const seen = [value]
    while (value) {
      value = formatPhoneInput(value.slice(0, -1))
      seen.push(value)
      if (seen.length > 30) throw new Error('stuck')
    }
    expect(seen[1]).toBe('+998 90 123 45 6')
    expect(seen).toContain('+998 9')
    expect(seen.at(-1)).toBe('')
  })

  it('is idempotent', () => {
    for (const raw of ['9', '90 123', '+998 90 123 45 67', '+99']) {
      expect(formatPhoneInput(formatPhoneInput(raw))).toBe(formatPhoneInput(raw))
    }
  })
})

describe('phoneForApi', () => {
  it('sends +998XXXXXXXXX without spaces', () => {
    expect(phoneForApi('+998 90 123 45 67')).toBe('+998901234567')
    expect(phoneForApi('901234567')).toBe('+998901234567')
  })

  it('an empty field, or just the prefix, sends nothing (the phone is optional)', () => {
    expect(phoneForApi('')).toBe('')
    expect(phoneForApi('+998')).toBe('')
    expect(phoneForApi('+')).toBe('')
  })

  it('an incomplete number is sent as it is: the server answers invalid_phone', () => {
    expect(phoneForApi('+998 90 123')).toBe('+99890123')
  })
})
