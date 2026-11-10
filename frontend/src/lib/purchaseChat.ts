import { useMemo } from 'react'
import { adminChatApi, buyerChatApi, type ChatApi, type PurchaseRequest } from '../api/endpoints'
import { useChatThread, type ChatSide } from './chatThread'

export { CHAT_MAX_BODY, CHAT_MAX_IMAGE, CHAT_PAGE, CHAT_POLL_MS, type ChatSide } from './chatThread'

export const chatKey = (side: ChatSide, id: string) => ['purchase-chat', side, id] as const
const apiOf = (side: ChatSide): ChatApi => (side === 'admin' ? adminChatApi : buyerChatApi)

/** New messages are allowed unless the request was cancelled or rejected. */
export const chatOpen = (status: string | undefined) => status !== 'cancelled' && status !== 'rejected'

const pending = (r: PurchaseRequest) => r.status === 'pending'

/** The request with the viewer's read marker (the newest message they have read). */
export type PurchaseChatMeta = PurchaseRequest & { readMarker: number }

/**
 * One purchase request's chat, for its buyer or an admin. Polled every 30 s (while visible) as long
 * as the request is pending; stops once it is paid or cancelled.
 */
export function usePurchaseChat(side: ChatSide, id: string) {
  const api = apiOf(side)
  const source = useMemo(() => ({
    fetch: async (after: number) => {
      const page = await api.messages(id, after)
      return { meta: { ...page.request, readMarker: page.read_message_id } as PurchaseChatMeta, messages: page.messages }
    },
    post: (draft: Parameters<ChatApi['post']>[1]) => api.post(id, draft),
  }), [api, id])
  return { ...useChatThread(chatKey(side, id), source, pending), api }
}
