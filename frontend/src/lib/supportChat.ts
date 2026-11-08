import { useMemo } from 'react'
import { adminSupportApi, supportApi, type ChatDraft, type SupportThread } from '../api/endpoints'
import { useChatThread } from './chatThread'

export const SUPPORT_THREADS_KEY = ['admin', 'support', 'threads'] as const
export const SUPPORT_CHAT_KEY = ['support-chat'] as const

/** The user's support screen is re-read every 5 s while it is open and visible: replies show quickly. */
export const SUPPORT_POLL_MS = 5_000

const always = () => true

/**
 * The caller's own support thread (made by the server on the first read): re-read every 5 s while
 * the screen is open and visible, and again when the page or the window comes back.
 */
export function useSupportChat() {
  const source = useMemo(() => ({
    fetch: async (after: number) => {
      const page = await supportApi.messages(after)
      return { meta: { threadId: page.thread_id }, messages: page.messages }
    },
    post: (draft: ChatDraft) => supportApi.post(draft),
  }), [])
  return useChatThread(SUPPORT_CHAT_KEY, source, always, { intervalMs: SUPPORT_POLL_MS, refetchOnFocus: true })
}

/** A support thread as an admin sees it. Polled while open and visible. */
export function useAdminSupportThread(id: number) {
  const source = useMemo(() => ({
    fetch: async (after: number) => {
      const page = await adminSupportApi.messages(id, after)
      return { meta: page.thread as SupportThread, messages: page.messages }
    },
    post: (draft: ChatDraft) => adminSupportApi.post(id, draft),
  }), [id])
  return useChatThread(['admin-support-chat', id], source, always)
}
