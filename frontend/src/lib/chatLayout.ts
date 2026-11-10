import type { ChatMessage } from '../api/endpoints'

/** Messages of one author less than this far apart (and on one day) share a group. */
export const GROUP_GAP_MS = 5 * 60_000

export type ChatItem =
  | { kind: 'day'; key: string; date: Date }
  | { kind: 'divider' }
  | { kind: 'system'; message: ChatMessage }
  | { kind: 'group'; key: string; mine: boolean; author: ChatMessage['author']; messages: ChatMessage[] }

/** The local calendar day of a date, as a key. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

/**
 * The log as items: a day pill before the first message of each day, the "new messages" divider
 * before message `dividerId`, system lines on their own, and the other messages in groups
 * (consecutive, one author, one day, < 5 minutes apart).
 */
export function buildChatItems(messages: ChatMessage[], dividerId: number | null): ChatItem[] {
  const items: ChatItem[] = []
  let day = ''
  let group: Extract<ChatItem, { kind: 'group' }> | null = null
  let last = 0
  for (const m of messages) {
    const at = new Date(m.created_at)
    const key = dayKey(at)
    if (key !== day) {
      day = key
      group = null
      items.push({ kind: 'day', key, date: at })
    }
    if (m.id === dividerId) {
      group = null
      items.push({ kind: 'divider' })
    }
    if (m.author === 'system') {
      group = null
      items.push({ kind: 'system', message: m })
      continue
    }
    if (group && group.author === m.author && group.mine === m.mine && at.getTime() - last < GROUP_GAP_MS) {
      group.messages.push(m)
    } else {
      group = { kind: 'group', key: `g${m.id}`, mine: m.mine, author: m.author, messages: [m] }
      items.push(group)
    }
    last = at.getTime()
  }
  return items
}

/** The first message of the other side (not a system line) after the reader's marker; null = none. */
export function firstUnreadId(messages: ChatMessage[], readMarker: number): number | null {
  return messages.find((m) => !m.mine && m.author !== 'system' && m.id > readMarker)?.id ?? null
}

type Translate = (key: string) => string

/** "Today", "Yesterday", else "8 November". */
export function dayLabel(date: Date, t: Translate, locale: string, now = new Date()): string {
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (dayKey(date) === dayKey(now)) return t('chat.today')
  if (dayKey(date) === dayKey(yesterday)) return t('chat.yesterday')
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(date)
}

/** A thread list's time: HH:MM today, "Yesterday", else day + short month. */
export function shortTime(iso: string, t: Translate, locale: string, now = new Date()): string {
  const date = new Date(iso)
  const label = dayLabel(date, t, locale, now)
  if (label === t('chat.today')) return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  if (label === t('chat.yesterday')) return label
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date)
}

/** Does the media query match? false where matchMedia does not exist. */
export function media(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
}
