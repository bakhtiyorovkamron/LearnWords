import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, type UseMutationResult } from '@tanstack/react-query'
import { ArrowLeft, Check, CheckCheck, ChevronDown, ImagePlus, SendHorizontal, ShieldAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatDraft, ChatMessage } from '../api/endpoints'
import { apiErrorInfo, errorMessage } from '../api/client'
import { CHAT_MAX_BODY, CHAT_MAX_IMAGE, type ChatSide } from '../lib/chatThread'
import { buildChatItems, dayLabel, firstUnreadId, media } from '../lib/chatLayout'
import { usePageVisible } from '../lib/pageVisible'
import { UnreadBadge } from './UnreadBadge'

/** Within this many pixels of the bottom counts as "at the bottom": new messages scroll into view. */
export const NEAR_BOTTOM_PX = 80
/** The newest message must stay in view this long before it is reported as seen. */
export const SEEN_DEBOUNCE_MS = 500

/** The texts that differ between the chats (support / purchase). */
export interface ChatTexts {
  placeholder: string
  empty: string
  hint: string // a small pill at the top of the log: no card numbers
  hiddenCard: string // the author's own hidden message
  rateLimited: string
  closed: string // no composer: why
}

/** The chat's own header: who is on the other side. avatar sits in a round accent circle. */
export interface ChatHeader {
  title: string
  subtitle?: string
  avatar: ReactNode
  /** A back button (phones only). */
  onBack?: () => void
}

/** A round accent avatar (a letter or an icon). */
export function ChatAvatar({ children, className = 'h-10 w-10 text-base' }: { children: ReactNode; className?: string }) {
  return <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full bg-accent font-bold text-on-accent ${className}`}>{children}</span>
}

type Photo = { key: readonly unknown[]; load: (messageId: number) => Promise<Blob> }

const smooth = (): ScrollBehavior => (media('(prefers-reduced-motion: reduce)') ? 'auto' : 'smooth')

export interface ChatThreadViewProps {

  side: ChatSide
  messages: ChatMessage[]
  send: UseMutationResult<ChatMessage, Error, ChatDraft>
  open: boolean
  texts: ChatTexts
  /** Who the other side is: the aria-label of their message groups (the header shows the name). */
  otherLabel: string
  /** How to load a message's photo (it needs the login header), and its cache key. */
  photo: Photo
  /** A system line in the user's language (else its stored text). */
  systemText?: (m: ChatMessage) => string | null
  onSeen?: (upToId: number) => void
  header?: ChatHeader
  readMarker?: number
  otherReadMarker?: number
}

/**
 * A chat thread with the admins, shared by support and the purchase chats: an optional header, the
 * log (day pills, the "new messages" divider, grouped bubbles with read ticks, a card-number hint)
 * and, while open, the composer — text and/or one photo. New messages scroll into view when the
 * reader is at the bottom already (or wrote the newest one); further up, a "jump to latest" button
 * counts what came meanwhile. A hidden message (card-like text) is the warning for its author and a
 * badge with "Show" for the admins.
 *
 * readMarker / otherReadMarker: the newest message each side has read. The divider goes before the
 * first unread message of the other side, taken once when the thread is first shown; sending a
 * message removes it. onSeen(upToId): the reader has the newest message in view — the screen is
 * open, the page visible and the list at the bottom — for 500 ms; once per id, not for messages up
 * to readMarker.
 */
export function ChatThreadView({ side, messages, send, open, texts, otherLabel, photo, systemText, onSeen, header,
  readMarker = 0, otherReadMarker = 0 }: ChatThreadViewProps) {
  const { t, i18n } = useTranslation()
  const box = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const dividerEl = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const shown = useRef(0)
  const visible = usePageVisible()
  const [bottom, setBottom] = useState(true)
  const [missed, setMissed] = useState(0)
  const [dividerId, setDividerId] = useState(() => firstUnreadId(messages, readMarker))

  function onScroll() {
    const el = box.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
    setBottom(atBottom.current)
    if (atBottom.current) setMissed(0)
  }

  const newest = messages.reduce((n, m) => Math.max(n, m.id), 0)
  const seen = useRef(0) // the last id reported
  const onSeenRef = useRef(onSeen)
  onSeenRef.current = onSeen
  useEffect(() => {
    if (!onSeenRef.current || !visible || !bottom || newest <= readMarker || newest === seen.current) return
    const timer = setTimeout(() => {
      seen.current = newest
      onSeenRef.current?.(newest)
    }, SEEN_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [newest, visible, bottom, readMarker])

  useEffect(() => {
    const first = shown.current === 0
    const fresh = messages.slice(shown.current)
    shown.current = messages.length
    if (fresh.length === 0) return
    if (first && dividerEl.current && box.current) { // the first unread message near the top
      box.current.scrollTop = Math.max(0, dividerEl.current.offsetTop - 12)
      onScroll()
      return
    }
    if (first || atBottom.current || messages.at(-1)?.mine) end.current?.scrollIntoView?.({ block: 'end', behavior: first ? 'auto' : smooth() })
    else setMissed((n) => n + fresh.filter((m) => !m.mine).length)
  }, [messages])

  function jump() {
    end.current?.scrollIntoView?.({ block: 'end', behavior: smooth() })
    setMissed(0)
  }

  const items = useMemo(() => buildChatItems(messages, dividerId), [messages, dividerId])
  const locale = i18n.language

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {header && <ThreadHeader header={header} />}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={box} onScroll={onScroll} role="log" aria-label={t('chat.title')}
          className="relative flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto rounded-2xl bg-surface-2/40 p-3">
          {texts.hint && (
            <p data-testid="chat-hint" className="mx-auto inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs text-muted">
              <ShieldAlert size={12} aria-hidden="true" className="shrink-0" /><span>{texts.hint}</span>
            </p>
          )}
          {messages.length === 0 && <p data-testid="chat-empty" className="py-6 text-center text-sm text-muted">{texts.empty}</p>}
          {items.map((item) => {
            if (item.kind === 'day') {
              return <Pill key={`d${item.key}`} testId="chat-day">{dayLabel(item.date, t, locale)}</Pill>
            }
            if (item.kind === 'divider') {
              return (
                <div key="divider" ref={dividerEl} data-testid="chat-new-divider" className="flex items-center gap-3 text-xs font-semibold text-accent-text">
                  <span aria-hidden="true" className="h-px flex-1 bg-line" />{t('chat.newMessages')}<span aria-hidden="true" className="h-px flex-1 bg-line" />
                </div>
              )
            }
            if (item.kind === 'system') {
              return <Pill key={item.message.id} testId="chat-system">{systemText?.(item.message) ?? item.message.body}</Pill>
            }
            return (
              <div key={item.key} role={item.mine ? undefined : 'group'} aria-label={item.mine ? undefined : otherLabel}
                className={`flex max-w-[85%] flex-col gap-[3px] ${item.mine ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
                {item.messages.map((m, i) => (
                  <Bubble key={m.id} m={m} side={side} last={i === item.messages.length - 1} read={m.id <= otherReadMarker}
                    hiddenCard={texts.hiddenCard} photo={photo} />
                ))}
              </div>
            )
          })}
          <div ref={end} />
        </div>
        {!bottom && (
          <button type="button" onClick={jump} aria-label={t('chat.toBottom')} title={t('chat.toBottom')}
            className="absolute bottom-3 right-3 grid h-10 w-10 place-items-center rounded-full border border-line bg-surface text-fg shadow-[var(--shadow-card)] transition hover:bg-surface-2">
            <ChevronDown size={20} aria-hidden="true" />
            <UnreadBadge count={missed} testId="chat-missed" className="absolute -right-1.5 -top-1.5" />
          </button>
        )}
      </div>
      {open
        ? <Composer send={send} texts={texts} onSent={() => setDividerId(null)} />
        : <p role="status" className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">{texts.closed}</p>}
    </div>
  )
}

function ThreadHeader({ header }: { header: ChatHeader }) {
  const { t } = useTranslation()
  return (
    <header data-testid="chat-thread-header" className="flex items-center gap-3">
      {header.onBack && (
        <button type="button" onClick={header.onBack} aria-label={t('support.back')} title={t('support.back')}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg md:hidden">
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
      )}
      <ChatAvatar>{header.avatar}</ChatAvatar>
      <div className="min-w-0">
        <h2 className="truncate text-base font-bold text-fg">{header.title}</h2>
        {header.subtitle && <p className="truncate text-xs text-muted">{header.subtitle}</p>}
      </div>
    </header>
  )
}

/** A centered pill: a day, or a system line. */
function Pill({ children, testId }: { children: ReactNode; testId: string }) {
  return <p data-testid={testId} className="mx-auto rounded-full bg-surface px-3 py-1 text-center text-xs font-semibold text-muted">{children}</p>
}

function Bubble({ m, side, last, read, hiddenCard, photo }: {
  m: ChatMessage; side: ChatSide; last: boolean; read: boolean; hiddenCard: string; photo: Photo
}) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(false)

  const time = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const corner = last ? (m.mine ? 'rounded-br-[6px]' : 'rounded-bl-[6px]') : ''
  const base = `flex flex-col rounded-[18px] px-3 py-2 text-sm ${corner}`
  const stamp = (
    <span className="mt-1 flex items-center justify-end gap-1 self-end text-[11px] tabular-nums opacity-70">
      <time dateTime={m.created_at}>{time}</time>
      {m.mine && (
        <span role="img" aria-label={read ? t('chat.read') : t('chat.sent')} className="inline-flex">
          {read ? <CheckCheck size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
        </span>
      )}
    </span>
  )

  // The user's own hidden message: only the warning (the server does not send the text back).
  if (m.hidden && side === 'user') {
    return (
      <div data-testid="chat-hidden" role="note" className={`${base} gap-2 border border-danger/40 bg-surface text-danger`}>
        <span className="flex items-start gap-2">
          <ShieldAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{hiddenCard}</span>
        </span>
        {stamp}
      </div>
    )
  }

  const veiled = m.hidden && !shown // an admin sees a hidden message behind "Show"
  return (
    <div data-testid={`chat-msg-${m.id}`} className={`${base} space-y-2 ${m.mine ? 'self-end bg-accent text-on-accent' : 'self-start bg-surface text-fg'}`}>
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
      {stamp}
    </div>
  )
}

/** A chat photo: loaded with the login header (as a Blob), shown from an object URL; a tap opens it full screen. */
function ChatPhoto({ messageId, photo }: { messageId: number; photo: Photo }) {
  const { t } = useTranslation()
  const blob = useQuery({ queryKey: [...photo.key, messageId], queryFn: () => photo.load(messageId), staleTime: Infinity })
  const url = useMemo(() => (blob.data && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob.data) : null), [blob.data])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  const [viewing, setViewing] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  if (!url) return <div className="h-32 w-48 animate-pulse rounded-xl bg-surface-2" />
  return (
    <>
      <button ref={opener} type="button" onClick={() => setViewing(true)} className="block rounded-xl">
        <img src={url} alt={t('chat.photo')} className="max-h-64 max-w-full rounded-xl object-contain" />
      </button>
      {viewing && <PhotoViewer url={url} onClose={() => { setViewing(false); opener.current?.focus() }} />}
    </>
  )
}

/** The full-screen photo: a dark overlay, the image contained; Esc, the button or a tap outside closes it. */
function PhotoViewer({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useTranslation()
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    close.current?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t('chat.photo')} data-testid="chat-photo-viewer" onClick={onClose}
      className="fixed inset-0 z-[70] grid place-items-center bg-black/90 p-4">
      <img src={url} alt={t('chat.photo')} onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full object-contain" />
      <button ref={close} type="button" onClick={onClose} aria-label={t('chat.closePhoto')} title={t('chat.closePhoto')}
        className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] grid h-11 w-11 place-items-center rounded-full bg-surface text-fg">
        <X size={20} aria-hidden="true" />
      </button>
    </div>,
    document.body,
  )
}

function Composer({ send, texts, onSent }: { send: UseMutationResult<ChatMessage, Error, ChatDraft>; texts: ChatTexts; onSent: () => void }) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [image, setImage] = useState<File | null>(null)
  const [tooLarge, setTooLarge] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const empty = text.trim() === '' && !image

  // The thumbnail's object URL lives as long as the photo is attached.
  const thumb = useMemo(() => (image && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(image) : null), [image])
  useEffect(() => () => { if (thumb) URL.revokeObjectURL(thumb) }, [thumb])

  // Grows with the text up to 4 lines, then scrolls.
  useEffect(() => {
    const el = area.current
    if (!el || !el.scrollHeight) return
    const line = parseFloat(getComputedStyle(el).lineHeight) || 24
    const pad = parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom) || 0
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, line * 4 + pad)}px`
  }, [text])

  function pick(f: File | undefined) {
    if (!f) return
    send.reset()
    setTooLarge(f.size > CHAT_MAX_IMAGE)
    setImage(f.size > CHAT_MAX_IMAGE ? null : f)
  }
  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (empty || send.isPending) return
    send.mutate({ body: text.trim(), image }, { onSuccess: () => { setText(''); setImage(null); onSent() } })
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return // not while composing (IME)
    if (e.ctrlKey || e.metaKey) return submit()
    if (!e.shiftKey && media('(pointer: fine)')) { e.preventDefault(); submit() } // on touch Enter is a new line
  }

  const error = tooLarge ? t('chat.imageTooLarge') : send.error ? chatError(send.error, t, texts) : null
  return (
    <form onSubmit={submit} className="space-y-2">
      {image && (
        <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-1.5 text-sm text-fg">
          {thumb
            ? <img src={thumb} alt={t('chat.photoAttached')} className="h-11 w-11 shrink-0 rounded-lg object-cover" />
            : <ImagePlus size={14} aria-hidden="true" className="shrink-0 text-accent-text" />}
          <span className="min-w-0 flex-1 truncate text-xs text-muted">{t('chat.photoAttached')}</span>
          <span data-testid="chat-attached" className="sr-only">{image.name}</span>
          <button type="button" aria-label={t('chat.removePhoto')} title={t('chat.removePhoto')} onClick={() => setImage(null)}
            className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-surface"><X size={14} aria-hidden="true" /></button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 items-end gap-1 rounded-[24px] border border-line bg-surface p-1 transition focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/25">
          <button type="button" aria-label={t('chat.attach')} title={t('chat.attach')} onClick={() => file.current?.click()}
            className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-fg">
            <ImagePlus size={20} aria-hidden="true" />
          </button>
          <input ref={file} type="file" accept="image/*" hidden data-testid="chat-file"
            onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
          <textarea ref={area} rows={1} maxLength={CHAT_MAX_BODY}
            className="max-h-32 min-h-[38px] min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-base leading-6 text-fg outline-none placeholder:text-faint"
            placeholder={texts.placeholder} aria-label={texts.placeholder} value={text}
            onChange={(e) => { setText(e.target.value); send.reset() }} onKeyDown={onKeyDown} />
        </div>
        <button type="submit" disabled={empty || send.isPending}
          className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full bg-accent text-on-accent transition hover:opacity-90 disabled:bg-surface-2 disabled:text-faint disabled:hover:opacity-100">
          <SendHorizontal size={20} aria-hidden="true" /><span className="sr-only">{t('chat.send')}</span>
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
