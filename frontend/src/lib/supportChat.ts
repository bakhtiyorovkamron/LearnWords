import { useMemo } from 'react'
import { adminSupportApi, supportApi, type ChatDraft, type SupportThread } from '../api/endpoints'
import { useChatThread } from './chatThread'

export const SUPPORT_THREADS_KEY = ['admin', 'support', 'threads'] as const

const always = () => true

/** The caller's own support thread (made by the server on the first read). Polled while open and visible. */
export function useSupportChat() {
  const source = useMemo(() => ({
    fetch: async (after: number) => {
      const page = await supportApi.messages(after)
      return { meta: { threadId: page.thread_id }, messages: page.messages }
    },
    post: (draft: ChatDraft) => supportApi.post(draft),
  }), [])
  return useChatThread(['support-chat'], source, always)
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
