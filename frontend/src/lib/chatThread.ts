import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import type { ChatDraft, ChatMessage } from '../api/endpoints'
import { apiErrorInfo } from '../api/client'
import { usePageVisible } from './pageVisible'

/** Whose screen a chat is on: the user's own side or an admin's. */
export type ChatSide = 'user' | 'admin'

/** An open chat is re-read every 30 s, and only while the page is on screen. */
export const CHAT_POLL_MS = 30_000
/** The server's page size: a full page means there may be more right after it. */
export const CHAT_PAGE = 50
/** The server's limits, checked before sending. */
export const CHAT_MAX_BODY = 1000
export const CHAT_MAX_IMAGE = 5 * 1024 * 1024

export interface Thread<M> {
  meta: M
  messages: ChatMessage[]
  /** The newest id a read returned: the next read asks for what came after it. */
  cursor: number
}

/** Where a chat's messages come from: a page after an id (with the thread's own data), and sending. */
export interface ChatSource<M> {
  fetch: (after: number) => Promise<{ meta: M; messages: ChatMessage[] }>
  post: (draft: ChatDraft) => Promise<ChatMessage>
}

function merge(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const byId = new Map(a.map((m) => [m.id, m]))
  for (const m of b) byId.set(m.id, m)
  return [...byId.values()].sort((x, y) => x.id - y.id)
}

/**
 * One chat thread (support or purchase). Each read asks only for the messages after the last one
 * it got (page after page while pages are full) and adds them. While `poll(meta)` holds it is
 * repeated every 30 s — only while the page is visible; coming back to the page reads at once. A
 * sent message shows immediately.
 */
export function useChatThread<M>(key: QueryKey, source: ChatSource<M>, poll: (meta: M) => boolean) {
  const qc = useQueryClient()
  const visible = usePageVisible()

  const thread = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Thread<M>> => {
      const prev = qc.getQueryData<Thread<M>>(key)
      let messages = prev?.messages ?? []
      let cursor = prev?.cursor ?? 0
      for (;;) {
        const page = await source.fetch(cursor)
        messages = merge(messages, page.messages)
        cursor = page.messages.at(-1)?.id ?? cursor
        if (page.messages.length < CHAT_PAGE) return { meta: page.meta, messages, cursor }
      }
    },
    staleTime: 0,
    refetchInterval: (q) => (visible && q.state.data && poll(q.state.data.meta) ? CHAT_POLL_MS : false),
    refetchIntervalInBackground: false,
    retry: (failures, err) => apiErrorInfo(err).status !== 404 && failures < 2,
  })

  // Back on the page after it was hidden: catch up now instead of at the next tick.
  const wasVisible = useRef(visible)
  useEffect(() => {
    if (visible && !wasVisible.current && thread.data && poll(thread.data.meta)) void thread.refetch()
    wasVisible.current = visible
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps -- only on the change of visibility

  const send = useMutation({
    mutationFn: source.post,
    onSuccess: (m) => {
      // Shown now; the cursor stays, so the next read still brings what came in before it.
      qc.setQueryData<Thread<M>>(key, (t) => (t ? { ...t, messages: merge(t.messages, [m]) } : t))
      void thread.refetch()
    },
    onError: (e) => { if (apiErrorInfo(e).code === 'chat_closed') void thread.refetch() },
  })

  return { thread, send }
}
