import { useEffect, useId, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Loader2, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { purchasesApi, type Pack, type PaymentInfo, type PurchaseOverview, type PurchaseRequest } from '../api/endpoints'
import { apiErrorInfo, errorMessage } from '../api/client'
import { EXTERNAL_LINK } from '../lib/contact'
import { formatUZS } from '../lib/money'
import { PURCHASES_KEY, isPaymentsUnavailable, pendingRequest, usePurchaseOverview } from '../lib/purchases'
import { Sheet } from './Sheet'

export type BuyMode = 'limit' | 'voluntary' // opened by a used-up daily limit, or by the user's own choice

const COPIED_MS = 2000

/** "8600123412341234" → "8600 1234 1234 1234" (what is copied is the digits only). */
export const groupCard = (card: string) => card.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ')

/** The pack with the lowest price per photo; none when there is nothing to compare. */
function bestPack(packs: Pack[]): Pack | null {
  if (packs.length < 2) return null
  return packs.reduce((a, b) => (b.price_uzs / b.amount < a.price_uzs / a.amount ? b : a))
}

/**
 * Buying photos, paid manually. Step A: choose a pack (creates a request). Step B: how to pay —
 * the card and the request's code for the transfer comment; or, when the server has no card, the
 * code to send in Telegram, where the payment is arranged. A user with an unpaid request opens
 * straight at step B for it. Payment data only comes from the server.
 */
export function BuySheet({ mode, limit, onClose }: { mode: BuyMode; limit: number | null; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const overview = usePurchaseOverview()
  // null: follow the overview (its pending request, else the packs); 'packs' after a cancel.
  const [view, setView] = useState<PurchaseRequest | 'packs' | null>(null)
  const pending = pendingRequest(overview.data)
  const request = view === 'packs' ? null : view ?? pending
  // Keep showing the request we opened with, so its fate below can be followed.
  useEffect(() => { if (view === null && pending) setView(pending) }, [view, pending])
  // Decided while the sheet is open (the 30 s poll): paid → close (the page announces the photos);
  // rejected or cancelled elsewhere → back to the packs.
  const live = request ? overview.data?.requests.find((r) => r.id === request.id)?.status : undefined
  useEffect(() => {
    if (!live || live === 'pending') return
    if (live === 'paid') onClose()
    else setView('packs')
  }, [live, onClose])

  const setRequests = (f: (rs: PurchaseRequest[]) => PurchaseRequest[]) =>
    qc.setQueryData<PurchaseOverview>(PURCHASES_KEY, (o) => (o ? { ...o, requests: f(o.requests) } : o))

  const create = useMutation({
    mutationFn: (packId: string) => purchasesApi.create(packId),
    onSuccess: (r) => {
      setRequests((rs) => [r, ...rs.filter((x) => x.id !== r.id)])
      setView(r)
    },
    // 3 unpaid requests already (maybe made on another device): re-read them.
    onError: (e) => { if (apiErrorInfo(e).code === 'too_many_pending') void qc.invalidateQueries({ queryKey: PURCHASES_KEY }) },
  })
  const cancel = useMutation({
    mutationFn: (id: string) => purchasesApi.cancel(id),
    onSuccess: (_, id) => {
      setRequests((rs) => rs.map((x) => (x.id === id ? { ...x, status: 'cancelled' } : x)))
      void qc.invalidateQueries({ queryKey: PURCHASES_KEY })
      create.reset()
      setView('packs')
    },
  })

  const byCard = Boolean(overview.data?.payment.card_number)
  const title = request ? t(byCard ? 'buy.payTitle' : 'buy.payTitleTg')
    : mode === 'limit' ? t('buy.title') : t('buy.titleVoluntary')
  const failure = overview.error ?? create.error ?? cancel.error
  const failureText = !failure ? null
    : isPaymentsUnavailable(failure) ? t('buy.unavailable')
    : apiErrorInfo(failure).code === 'too_many_pending' ? t('buy.tooMany')
    : errorMessage(failure)

  return (
    <Sheet label={title} onClose={onClose}>
      <h2 className="text-lg font-bold text-fg">{title}</h2>
      {!request && limit !== null && <p className="mt-1 text-sm text-muted">{t('buy.subtitle', { limit })}</p>}

      <div className="mt-4 space-y-4">
        {overview.isLoading && <div className="h-40 animate-pulse rounded-2xl bg-surface-2" />}

        {overview.data && !request && (
          <ul className="space-y-3">
            {overview.data.packs.map((p) => (
              <li key={p.id}>
                <PackCard pack={p} best={bestPack(overview.data!.packs)?.id === p.id} lang={i18n.language}
                  busy={create.isPending && create.variables === p.id} disabled={create.isPending}
                  onChoose={() => create.mutate(p.id)} />
              </li>
            ))}
          </ul>
        )}

        {overview.data && request && (
          <PayStep request={request} payment={overview.data.payment} lang={i18n.language}
            cancelling={cancel.isPending} onCancel={() => cancel.mutate(request.id)} onDone={onClose} />
        )}

        {failureText && <p role="alert" className="rounded-xl border border-danger bg-surface-2 px-4 py-2 text-sm text-danger">{failureText}</p>}
      </div>
    </Sheet>
  )
}

function PackCard({ pack, best, busy, disabled, lang, onChoose }: {
  pack: Pack; best: boolean; busy: boolean; disabled: boolean; lang: string; onChoose: () => void
}) {
  const { t } = useTranslation()
  return (
    <button type="button" data-testid={`pack-${pack.id}`} aria-busy={busy} disabled={disabled} onClick={onChoose}
      className={`flex min-h-20 w-full items-center justify-between gap-3 rounded-2xl border bg-surface-2 p-4 text-left transition hover:border-accent disabled:cursor-wait ${
        best ? 'border-accent' : 'border-line'} ${disabled && !busy ? 'opacity-60' : ''}`}>
      <span className="min-w-0">
        <span className="block text-2xl font-bold leading-tight text-fg">{t('buy.pack', { n: pack.amount })}</span>
        <span className="block text-sm text-muted">{t('buy.perPhoto', { price: formatUZS(Math.round(pack.price_uzs / pack.amount), lang) })}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {best && <span data-testid="best-badge" className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-on-accent">{t('buy.best')}</span>}
        <span className="flex items-center gap-2 text-lg font-semibold tabular-nums text-fg">
          {busy && <Loader2 size={16} aria-hidden="true" className="animate-spin text-accent-text" />}
          {formatUZS(pack.price_uzs, lang)}
        </span>
      </span>
    </button>
  )
}

/** Step B. With a card: transfer to it, the code in the comment. Without one: send the code in Telegram. */
function PayStep({ request, payment, lang, cancelling, onCancel, onDone }: {
  request: PurchaseRequest; payment: PaymentInfo; lang: string; cancelling: boolean; onCancel: () => void; onDone: () => void
}) {
  const { t } = useTranslation()
  const cardId = useId()
  const codeId = useId()
  const telegram = payment.telegram.replace(/^@/, '')
  const amount = formatUZS(request.price_uzs, lang)
  const byCard = payment.card_number !== ''

  const codeBox = (
    <div className="flex items-center justify-between gap-2 rounded-2xl bg-surface-2 p-3">
      <span id={codeId} data-testid="buy-code" className="select-all font-mono text-2xl font-bold tracking-wider text-fg">{request.code}</span>
      <CopyButton value={request.code} describedBy={codeId} />
    </div>
  )
  const steps = byCard ? [
    <>
      <p className="text-fg">{t('buy.step1', { amount })}</p>
      <div className="rounded-2xl bg-surface-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span id={cardId} data-testid="buy-card" className="select-all whitespace-nowrap font-mono text-xl font-semibold tabular-nums tracking-wide text-fg">
            {groupCard(payment.card_number)}
          </span>
          <CopyButton value={payment.card_number.replace(/\D/g, '')} describedBy={cardId} />
        </div>
        {payment.card_holder && <p data-testid="buy-holder" className="mt-1 text-sm text-muted">{payment.card_holder}</p>}
      </div>
    </>,
    <><p className="text-fg">{t('buy.step2', { code: request.code })}</p>{codeBox}</>,
    <p className="text-fg">{t('buy.step3')}</p>,
  ] : [
    <p className="text-fg">{t('buy.tgStep1')}</p>,
    <><p className="text-fg">{t('buy.tgStep2', { code: request.code })}</p>{codeBox}</>,
    <p className="text-fg">{t('buy.tgStep3', { amount })}</p>,
  ]

  return (
    <div className="space-y-5">
      <ol className="space-y-4">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-on-accent">{i + 1}</span>
            <div className="min-w-0 flex-1 space-y-2">{step}</div>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2">
        {telegram && (
          <a href={`https://t.me/${encodeURIComponent(telegram)}`} {...EXTERNAL_LINK} className="btn-primary">
            <Send size={18} aria-hidden="true" />{t('buy.openTelegram')}
          </a>
        )}
        <button type="button" className={telegram ? 'btn-ghost !py-3' : 'btn-primary'} onClick={onDone}>{t('buy.done')}</button>
        <button type="button" disabled={cancelling} onClick={onCancel}
          className="self-center rounded-lg px-3 py-2 text-sm font-semibold text-muted transition hover:text-danger disabled:opacity-60">
          {t('buy.cancel')}
        </button>
      </div>
    </div>
  )
}

/** Copies value; says "Copied" for 2 s. Without clipboard access the text stays selectable (select-all). */
function CopyButton({ value, describedBy }: { value: string; describedBy: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const timer = useRef<number>()
  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      return // no permission / insecure context
    }
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS)
  }

  const Icon = copied ? Check : Copy
  return (
    <button type="button" onClick={() => void copy()} aria-describedby={describedBy}
      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-semibold text-fg transition hover:bg-surface">
      <Icon size={16} aria-hidden="true" className="text-accent-text" />{copied ? t('buy.copied') : t('buy.copy')}
    </button>
  )
}
