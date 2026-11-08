import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useQuery, type UseMutationResult } from '@tanstack/react-query'
import { ImagePlus, SendHorizontal, ShieldAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatDraft, ChatMessage } from '../api/endpoints'
import { apiErrorInfo, errorMessage } from '../api/client'
import { CHAT_MAX_BODY, CHAT_MAX_IMAGE, type ChatSide } from '../lib/chatThread'

/** The texts that differ between the chats (support / purchase). */
export interface ChatTexts {
  placeholder: string
  empty: string
  hint: string // above the composer: no card numbers
  hiddenCard: string // the author's own hidden message
  rateLimited: string
  closed: string // no composer: why
}

/**
 * A chat thread with the admins, shared by support and the purchase chats: the messages (newest at
 * the bottom, scrolled to on every new one) and, while open, the composer — text and/or one photo,
 * sending disabled while both are empty. A hidden message (card-like text) is the warning for its
 * author and a badge with "Show" for the admins.
 */
export function ChatThreadView({ side, messages, send, open, texts, otherLabel, photo, systemText }: {
  side: ChatSide
  messages: ChatMessage[]
  send: UseMutationResult<ChatMessage, Error, ChatDraft>
  open: boolean
  texts: ChatTexts
  /** Who the other side is, above their messages ("Support", "Buyer", "User"). */
  otherLabel: string
  /** How to load a message's photo (it needs the login header), and its cache key. */
  photo: { key: readonly unknown[]; load: (messageId: number) => Promise<Blob> }
  /** A system line in the user's language (else its stored text). */
  systemText?: (m: ChatMessage) => string | null
}) {
  const { t } = useTranslation()
  const end = useRef<HTMLDivElement>(null)
  // Every new message brings the newest into view (also the first load).
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [messages.length])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div role="log" aria-label={t('chat.title')} className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-2xl bg-surface-2/40 p-3">
        {messages.length === 0 && <p data-testid="chat-empty" className="py-6 text-center text-sm text-muted">{texts.empty}</p>}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} side={side} otherLabel={otherLabel} hiddenCard={texts.hiddenCard} photo={photo}
            system={m.author === 'system' ? (systemText?.(m) ?? m.body) : null} />
        ))}
        <div ref={end} />
      </div>
      {open
        ? <Composer send={send} texts={texts} />
        : <p role="status" className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">{texts.closed}</p>}
    </div>
  )
}

function Bubble({ m, side, otherLabel, hiddenCard, photo, system }: {
  m: ChatMessage; side: ChatSide; otherLabel: string; hiddenCard: string
  photo: { key: readonly unknown[]; load: (messageId: number) => Promise<Blob> }; system: string | null
}) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(false)

  if (m.author === 'system') {
    return <p data-testid="chat-system" className="py-1 text-center text-xs font-semibold text-muted">{system}</p>
  }

  const time = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const align = m.mine ? 'ml-auto items-end' : 'mr-auto items-start'

  // The user's own hidden message: only the warning (the server does not send the text back).
  if (m.hidden && side === 'user') {
    return (
      <div className={`flex max-w-[85%] flex-col ${align}`}>
        <div data-testid="chat-hidden" role="note" className="flex items-start gap-2 rounded-2xl border border-danger/40 bg-surface px-3 py-2 text-sm text-danger">
          <ShieldAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{hiddenCard}</span>
        </div>
        <span className="mt-0.5 text-[11px] text-faint">{time}</span>
      </div>
    )
  }

  const veiled = m.hidden && !shown // an admin sees a hidden message behind "Show"
  return (
    <div className={`flex max-w-[85%] flex-col ${align}`} data-testid={`chat-msg-${m.id}`}>
      {!m.mine && <span className="mb-0.5 text-[11px] font-semibold text-muted">{otherLabel}</span>}
      <div className={`space-y-2 rounded-2xl px-3 py-2 text-sm ${m.mine ? 'bg-accent text-on-accent' : 'bg-surface text-fg'}`}>
        {m.hidden && (
          <div className="flex flex-wrap items-center gap-2">
            <span data-testid="chat-hidden-badge" className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2 py-0.5 text-[11px] font-semibold text-danger">
              <ShieldAlert size={12} aria-hidden="true" />{t('chat.hiddenBadge')}
            </span>
            {!shown && (
              <button type="button" onClick={() => setShown(true)} className="text-xs font-semibold underline underline-offset-2">
                {t('chat.adminShow')}
              </button>
            )}
          </div>
        )}
        {!veiled && m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
        {!veiled && m.has_image && <ChatPhoto messageId={m.id} photo={photo} />}
      </div>
      <span className="mt-0.5 text-[11px] text-faint">{time}</span>
    </div>
  )
}

/** A chat photo: loaded with the login header (as a Blob), shown from an object URL. */
function ChatPhoto({ messageId, photo }: { messageId: number; photo: { key: readonly unknown[]; load: (messageId: number) => Promise<Blob> } }) {
  const { t } = useTranslation()
  const blob = useQuery({ queryKey: [...photo.key, messageId], queryFn: () => photo.load(messageId), staleTime: Infinity })
  const url = useMemo(() => (blob.data && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob.data) : null), [blob.data])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  if (!url) return <div className="h-32 w-48 animate-pulse rounded-xl bg-surface-2" />
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block">
      <img src={url} alt={t('chat.photo')} className="max-h-64 max-w-full rounded-xl object-contain" />
    </a>
  )
}

function Composer({ send, texts }: { send: UseMutationResult<ChatMessage, Error, ChatDraft>; texts: ChatTexts }) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [image, setImage] = useState<File | null>(null)
  const [tooLarge, setTooLarge] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const empty = text.trim() === '' && !image

  function pick(f: File | undefined) {
    if (!f) return
    send.reset()
    setTooLarge(f.size > CHAT_MAX_IMAGE)
    setImage(f.size > CHAT_MAX_IMAGE ? null : f)
  }
  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (empty || send.isPending) return
    send.mutate({ body: text.trim(), image }, { onSuccess: () => { setText(''); setImage(null) } })
  }

  const error = tooLarge ? t('chat.imageTooLarge') : send.error ? chatError(send.error, t, texts) : null
  return (
    <form onSubmit={submit} className="space-y-2">
      <p className="text-xs text-muted">{texts.hint}</p>
      {image && (
        <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-1.5 text-sm text-fg">
          <ImagePlus size={14} aria-hidden="true" className="shrink-0 text-accent-text" />
          <span data-testid="chat-attached" className="min-w-0 flex-1 truncate">{image.name}</span>
          <button type="button" aria-label={t('chat.removePhoto')} title={t('chat.removePhoto')} onClick={() => setImage(null)}
            className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-surface"><X size={14} aria-hidden="true" /></button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <button type="button" aria-label={t('chat.attach')} title={t('chat.attach')} onClick={() => file.current?.click()}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line text-muted transition hover:bg-surface-2 hover:text-fg">
          <ImagePlus size={20} aria-hidden="true" />
        </button>
        <input ref={file} type="file" accept="image/*" hidden data-testid="chat-file"
          onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
        <textarea rows={1} className="field max-h-32 min-h-11 flex-1 resize-none" maxLength={CHAT_MAX_BODY}
          placeholder={texts.placeholder} aria-label={texts.placeholder} value={text}
          onChange={(e) => { setText(e.target.value); send.reset() }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit() }} />
        <button type="submit" className="btn-primary h-11 shrink-0 !px-4" disabled={empty || send.isPending}>
          <SendHorizontal size={18} aria-hidden="true" /><span className="max-sm:sr-only">{t('chat.send')}</span>
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </form>
  )
}

function chatError(err: unknown, t: (k: string) => string, texts: ChatTexts): string {
  const { status, code } = apiErrorInfo(err)
  if (status === 429) return texts.rateLimited
  if (status === 413) return t('chat.imageTooLarge')
  if (code === 'chat_closed') return texts.closed
  return errorMessage(err)
}
