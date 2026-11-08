import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import type { ChatDraft, ChatMessage } from '../api/endpoints'
import { apiErrorInfo } from '../api/client'
import { usePageVisible } from './pageVisible'

/** Whose screen a chat is on: the user's own side or an admin's. */
export type ChatSide = 'user' | 'admin'

/** An open chat is re-read every 30 s by default, and only while the page is on screen. */
export const CHAT_POLL_MS = 30_000
/** The server's page size: a full page means there may be more right after it. */
export const CHAT_PAGE = 50
/** The server's limits, checked before sending. */
export const CHAT_MAX_BODY = 1000
export const CHAT_MAX_IMAGE = 5 * 1024 * 1024

export interface Thread<M> {
  meta: M
  /** Every message read so far, by id; the next read asks for what came after the largest. */
  messages: ChatMessage[]
}

/** Where a chat's messages come from: a page after an id (with the thread's own data), and sending. */
export interface ChatSource<M> {
  fetch: (after: number) => Promise<{ meta: M; messages: ChatMessage[] }>
  post: (draft: ChatDraft) => Promise<ChatMessage>
}

export interface ChatPolling {
  /** How often an open, visible chat is re-read (default 30 s). */
  intervalMs?: number
  /** Also re-read when the window gets the focus back. */
  refetchOnFocus?: boolean
}

/** Adds b to a by id: nothing twice, oldest first. The list only ever grows. */
export function mergeMessages(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  if (b.length === 0) return a
  const byId = new Map(a.map((m) => [m.id, m]))
  for (const m of b) byId.set(m.id, m)
  return [...byId.values()].sort((x, y) => x.id - y.id)
}

/** The cursor: the largest id in the list (0 when empty). */
export const maxId = (ms: ChatMessage[]) => ms.reduce((n, m) => Math.max(n, m.id), 0)

const pageVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'

/**
 * One chat thread (support or purchase). Each read asks for the messages after the largest id
 * already in the list (page after page while pages are full) and merges them in by id. While
 * `poll(meta)` holds it is repeated every `intervalMs` — only while the page is visible; coming
 * back to the page (and, with refetchOnFocus, to the window) reads at once. A sent message shows
 * at once and the thread is re-read, so a reply that came meanwhile shows too.
 */
export function useChatThread<M>(key: QueryKey, source: ChatSource<M>, poll: (meta: M) => boolean, polling: ChatPolling = {}) {
  const { intervalMs = CHAT_POLL_MS, refetchOnFocus = false } = polling
  const qc = useQueryClient()
  const visible = usePageVisible()
  const keyRef = useRef(key)
  keyRef.current = key

  const thread = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Thread<M>> => {
      let messages = qc.getQueryData<Thread<M>>(key)?.messages ?? []
      for (;;) {
        const page = await source.fetch(maxId(messages))
        messages = mergeMessages(messages, page.messages)
        if (page.messages.length < CHAT_PAGE) return { meta: page.meta, messages }
      }
    },
    staleTime: 0,
    refetchInterval: (q) => (visible && q.state.data && poll(q.state.data.meta) ? intervalMs : false),
    refetchIntervalInBackground: false,
    retry: (failures, err) => apiErrorInfo(err).status !== 404 && failures < 2,
  })

  // Read now (joining a read already on its way rather than cancelling it).
  const readNow = () => { void qc.refetchQueries({ queryKey: keyRef.current, exact: true, type: 'active' }, { cancelRefetch: false }) }

  // Back on the page after it was hidden: catch up now instead of at the next tick.
  const wasVisible = useRef(visible)
  useEffect(() => {
    if (visible && !wasVisible.current && thread.data && poll(thread.data.meta)) readNow()
    wasVisible.current = visible
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps -- only on the change of visibility

  useEffect(() => {
    if (!refetchOnFocus) return
    const onFocus = () => { if (pageVisible()) readNow() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refetchOnFocus]) // eslint-disable-line react-hooks/exhaustive-deps -- readNow reads the key from a ref

  // What was sent shows at once, until a read brings it (kept apart, so the cursor never jumps
  // past messages not read yet).
  const [sent, setSent] = useState<ChatMessage[]>([])
  const fetched = thread.data?.messages
  useEffect(() => {
    if (fetched && sent.length) setSent((s) => s.filter((m) => !fetched.some((f) => f.id === m.id)))
  }, [fetched]) // eslint-disable-line react-hooks/exhaustive-deps -- only when a read brings new data

  const send = useMutation({
    mutationFn: source.post,
    onSuccess: (m) => {
      setSent((s) => mergeMessages(s, [m]))
      void qc.invalidateQueries({ queryKey: key, exact: true })
    },
    onError: (e) => { if (apiErrorInfo(e).code === 'chat_closed') void qc.invalidateQueries({ queryKey: key, exact: true }) },
  })

  const messages = useMemo(() => mergeMessages(fetched ?? [], sent), [fetched, sent])
  return { thread, send, messages }
}
