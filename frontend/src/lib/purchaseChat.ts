import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminChatApi, buyerChatApi, type ChatApi, type ChatDraft, type ChatMessage, type PurchaseRequest } from '../api/endpoints'
import { apiErrorInfo } from '../api/client'

export type ChatSide = 'buyer' | 'admin'

/** While the request waits for payment, the chat is re-read every 30 s (only while visible). */
export const CHAT_POLL_MS = 30_000
/** The server's page size: a full page means there may be more right after it. */
export const CHAT_PAGE = 50
/** The server's limits, checked before sending. */
export const CHAT_MAX_BODY = 1000
export const CHAT_MAX_IMAGE = 5 * 1024 * 1024

export interface Thread {
  request: PurchaseRequest
  messages: ChatMessage[]
  /** The newest id a read returned: the next read asks for what came after it. */
  cursor: number
}

export const chatKey = (side: ChatSide, id: string) => ['purchase-chat', side, id] as const
const apiOf = (side: ChatSide): ChatApi => (side === 'admin' ? adminChatApi : buyerChatApi)

/** New messages are allowed unless the request was cancelled or rejected. */
export const chatOpen = (status: string | undefined) => status !== 'cancelled' && status !== 'rejected'

function merge(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const byId = new Map(a.map((m) => [m.id, m]))
  for (const m of b) byId.set(m.id, m)
  return [...byId.values()].sort((x, y) => x.id - y.id)
}

/**
 * One purchase request's chat. Each read asks only for the messages after the last one it got
 * (page after page while pages are full) and adds them; it is repeated every 30 s while the request
 * is pending and stops once it is paid or cancelled. A sent message shows at once.
 */
export function usePurchaseChat(side: ChatSide, id: string) {
  const qc = useQueryClient()
  const key = chatKey(side, id)
  const api = apiOf(side)

  const thread = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Thread> => {
      const prev = qc.getQueryData<Thread>(key)
      let messages = prev?.messages ?? []
      let cursor = prev?.cursor ?? 0
      for (;;) {
        const page = await api.messages(id, cursor)
        messages = merge(messages, page.messages)
        cursor = page.messages.at(-1)?.id ?? cursor
        if (page.messages.length < CHAT_PAGE) return { request: page.request, messages, cursor }
      }
    },
    staleTime: 0,
    refetchInterval: (q) => (q.state.data?.request.status === 'pending' ? CHAT_POLL_MS : false),
    refetchIntervalInBackground: false,
    retry: (failures, err) => apiErrorInfo(err).status !== 404 && failures < 2,
  })

  const send = useMutation({
    mutationFn: (draft: ChatDraft) => api.post(id, draft),
    onSuccess: (m) => {
      // Shown now; the cursor stays, so the next read still brings what came in before it.
      qc.setQueryData<Thread>(key, (t) => (t ? { ...t, messages: merge(t.messages, [m]) } : t))
      void thread.refetch()
    },
    onError: (e) => { if (apiErrorInfo(e).code === 'chat_closed') void thread.refetch() },
  })

  return { thread, send, api }
}
