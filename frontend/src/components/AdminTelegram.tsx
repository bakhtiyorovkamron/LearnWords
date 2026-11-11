import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, Send, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { adminApi, telegramBroadcastApi, telegramRulesApi, type BroadcastTarget, type TelegramBroadcast, type TelegramRule } from '../api/endpoints'
import { apiErrorInfo, errorMessage } from '../api/client'
import { dateLocale } from '../i18n'

export const BROADCAST_TEXT_MAX = 1000
export const BROADCAST_BUTTON_MAX = 40
export const BROADCAST_MAX_USERS = 200
export const BROADCAST_POLL_MS = 2000
export const DEFAULT_BUTTON_URL = 'https://yodla.fun'

export const BROADCASTS_KEY = ['admin', 'telegram', 'broadcasts'] as const
export const AUDIENCE_KEY = ['admin', 'telegram', 'audience'] as const
export const RULES_KEY = ['admin', 'telegram', 'rules'] as const

/** The daily rules' time: 08:00 to 21:59 (nothing goes out at night). */
export const RULE_TIME_MIN = '08:00'
export const RULE_TIME_MAX = '21:59'

const active = (b: TelegramBroadcast | undefined) => b?.status === 'queued' || b?.status === 'running'

/** Is this an https link (what the bot's button accepts)? */
export const isHttpsUrl = (s: string) => {
  try {
    const u = new URL(s.trim())
    return u.protocol === 'https:' && u.host !== ''
  } catch {
    return false
  }
}

/** Does the user match the search by name, email or phone (case-insensitive)? */
function matches(u: { email: string; full_name?: string | null; phone?: string | null }, q: string) {
  const s = q.trim().toLowerCase()
  if (!s) return true
  const digits = s.replace(/\D/g, '')
  return u.email.toLowerCase().includes(s) || (u.full_name ?? '').toLowerCase().includes(s) || (u.phone ?? '').toLowerCase().includes(s) ||
    (digits !== '' && (u.phone ?? '').replace(/\D/g, '').includes(digits))
}

/**
 * The Telegram tab of the admin page: how many people can get a message, the send form (to me, to
 * everyone, to chosen users), the progress of the broadcast just sent and the history. Without a bot
 * (503 telegram_unavailable) only a notice shows. `preselect`: a user the card sent here, selected
 * under "chosen users".
 */
export function AdminTelegram({ preselect, onPreselected }: { preselect?: string | null; onPreselected?: () => void }) {
  const { t } = useTranslation()
  const audience = useQuery({ queryKey: AUDIENCE_KEY, queryFn: telegramBroadcastApi.audience, retry: false })
  if (audience.error && apiErrorInfo(audience.error).code === 'telegram_unavailable') {
    return <section className="glass p-6"><p role="status" data-testid="telegram-unavailable" className="text-muted">{t('admin.telegram.unavailable')}</p></section>
  }
  return (
    <div className="space-y-6">
      <section className="glass space-y-4 p-6">
        <h2 className="text-lg font-bold text-fg">{t('admin.telegram.title')}</h2>
        {audience.error ? <p role="alert" className="text-sm text-danger">{errorMessage(audience.error)}</p>
          : audience.data ? (
            <p data-testid="telegram-audience" className="text-sm text-muted">
              {t('admin.telegram.audience', { linked: audience.data.linked, reachable: audience.data.reachable, optedOut: audience.data.opted_out, blocked: audience.data.blocked })}
            </p>
          ) : <div className="h-5 w-2/3 animate-pulse rounded bg-surface-2" />}
        <BroadcastForm reachable={audience.data?.reachable ?? 0} preselect={preselect} onPreselected={onPreselected} />
      </section>
      <AutoRules />
      <History />
    </div>
  )
}

function BroadcastForm({ reachable, preselect, onPreselected }: { reachable: number; preselect?: string | null; onPreselected?: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: adminApi.users, staleTime: 30_000 }) // shared with the users table
  const [mode, setMode] = useState<BroadcastTarget>(preselect ? 'users' : 'me')
  const [selected, setSelected] = useState<string[]>(preselect ? [preselect] : [])
  const [search, setSearch] = useState('')
  const [ru, setRu] = useState('')
  const [uz, setUz] = useState('')
  const [en, setEn] = useState('')
  const [langs, setLangs] = useState(false)
  const [btnText, setBtnText] = useState('')
  const [btnUrl, setBtnUrl] = useState(DEFAULT_BUTTON_URL)
  const [confirming, setConfirming] = useState(false)
  const [sentId, setSentId] = useState<number | null>(null)
  const [skipped, setSkipped] = useState(0)

  useEffect(() => {
    if (!preselect) return
    setMode('users')
    setSelected((s) => (s.includes(preselect) ? s : [...s, preselect]))
    onPreselected?.()
  }, [preselect, onPreselected])

  const linked = useMemo(() => (users.data ?? []).filter((u) => u.telegram?.connected), [users.data])
  const byId = useMemo(() => new Map(linked.map((u) => [u.id, u])), [linked])
  const shown = useMemo(() => linked.filter((u) => matches(u, search)), [linked, search])

  const hasButton = btnText.trim() !== ''
  const buttonOk = !hasButton || (btnText.trim().length <= BROADCAST_BUTTON_MAX && isHttpsUrl(btnUrl))
  const textOk = ru.trim().length > 0 && ru.length <= BROADCAST_TEXT_MAX
  const formOk = textOk && buttonOk

  const progress = useQuery({
    queryKey: ['admin', 'telegram', 'broadcast', sentId],
    queryFn: () => telegramBroadcastApi.get(sentId!),
    enabled: sentId !== null,
    refetchInterval: (q) => (active(q.state.data) ? BROADCAST_POLL_MS : false),
  })
  const b = progress.data
  const finished = b !== undefined && !active(b)
  useEffect(() => {
    if (!finished) return
    void qc.invalidateQueries({ queryKey: BROADCASTS_KEY })
    void qc.invalidateQueries({ queryKey: AUDIENCE_KEY })
  }, [finished, qc])

  const send = useMutation({
    mutationFn: (target: BroadcastTarget) => telegramBroadcastApi.create({
      target, ...(target === 'users' && { user_ids: selected }),
      text: { ru: ru.trim(), ...(uz.trim() && { uz: uz.trim() }), ...(en.trim() && { en: en.trim() }) },
      ...(hasButton && { button: { text: btnText.trim(), url: btnUrl.trim() } }),
    }),
    onSuccess: (r, target) => {
      setSentId(r.broadcast.id)
      setSkipped(r.skipped)
      setConfirming(false)
      if (target !== 'me') { setRu(''); setUz(''); setEn(''); setSelected([]) } // a test keeps the text for the real send
      void qc.invalidateQueries({ queryKey: BROADCASTS_KEY })
    },
    onError: () => setConfirming(false),
  })

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const usersOk = mode !== 'users' || (selected.length > 0 && selected.length <= BROADCAST_MAX_USERS)
  const canSend = formOk && usersOk && !send.isPending

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSend) return
    if (mode === 'all') { setConfirming(true); return }
    send.mutate(mode)
  }

  const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-faint'
  const radio = (value: BroadcastTarget, text: string) => (
    <label className="flex items-center gap-2">
      <input type="radio" name="telegram-target" checked={mode === value} onChange={() => { setMode(value); setConfirming(false) }} className="accent-[var(--accent)]" />{text}
    </label>
  )
  const err = send.error ? sendError(send.error, t) : null

  return (
    <form onSubmit={submit} className="space-y-3">
      <div role="radiogroup" aria-label={t('admin.telegram.target')} className="flex flex-wrap gap-4 text-sm text-fg">
        {radio('me', t('admin.telegram.toMe'))}
        {radio('all', t('admin.telegram.toAll'))}
        {radio('users', t('admin.telegram.toSelected'))}
      </div>

      {mode === 'users' && (
        <div className="space-y-2">
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2" data-testid="telegram-chips">
              {selected.map((id) => (
                <button key={id} type="button" onClick={() => toggle(id)}
                  className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1 text-xs text-fg hover:opacity-80">
                  {byId.get(id)?.full_name || byId.get(id)?.email || id}<X size={12} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
          <p className="text-sm text-muted">{t('admin.telegram.selectedCount', { n: selected.length })}</p>
          {users.data && linked.length === 0 ? <p className="text-sm text-muted">{t('admin.telegram.noLinked')}</p> : (
            <>
              <input className="field text-base" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={t('admin.telegram.searchUser')} aria-label={t('admin.telegram.searchUser')} />
              <ul data-testid="telegram-picker" className="max-h-64 divide-y divide-divider overflow-y-auto rounded-2xl border border-line">
                {shown.map((u) => (
                  <li key={u.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-2">
                      <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} className="h-4 w-4 accent-[var(--accent)]" />
                      <span className="min-w-0 flex-1 truncate">{u.full_name || u.email}</span>
                      {u.telegram?.blocked ? <span className="shrink-0 text-xs text-danger">{t('admin.telegram.blockedBot')}</span>
                        : u.telegram?.notifications === false ? <span className="shrink-0 text-xs text-muted">{t('admin.telegram.optedOut')}</span> : null}
                    </label>
                  </li>
                ))}
                {users.data && shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">{t('admin.nothingFound')}</li>}
              </ul>
            </>
          )}
        </div>
      )}

      <div>
        <label className={label} htmlFor="tg-ru">{t('admin.telegram.fieldRu')}</label>
        <textarea id="tg-ru" rows={4} className="field text-base" value={ru} onChange={(e) => setRu(e.target.value.slice(0, BROADCAST_TEXT_MAX))} />
        <span data-testid="telegram-counter" className="text-xs text-faint">{t('admin.telegram.counter', { n: ru.length, max: BROADCAST_TEXT_MAX })}</span>
      </div>

      <div>
        <button type="button" aria-expanded={langs} onClick={() => setLangs((v) => !v)} className="text-sm font-semibold text-accent-text hover:underline">
          {t('admin.telegram.otherLangs')}
        </button>
        {langs && (
          <div className="mt-2 space-y-3">
            <div>
              <label className={label} htmlFor="tg-uz">{t('admin.telegram.fieldUz')}</label>
              <textarea id="tg-uz" rows={3} className="field text-base" value={uz} onChange={(e) => setUz(e.target.value.slice(0, BROADCAST_TEXT_MAX))} />
            </div>
            <div>
              <label className={label} htmlFor="tg-en">{t('admin.telegram.fieldEn')}</label>
              <textarea id="tg-en" rows={3} className="field text-base" value={en} onChange={(e) => setEn(e.target.value.slice(0, BROADCAST_TEXT_MAX))} />
            </div>
            <p className="text-xs text-faint">{t('admin.telegram.fallbackHint')}</p>
          </div>
        )}
      </div>

      <fieldset className="space-y-2 rounded-2xl border border-line p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-faint">{t('admin.telegram.button')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="tg-btn-text">{t('admin.telegram.buttonLabel')}</label>
            <input id="tg-btn-text" className="field text-base" value={btnText} maxLength={BROADCAST_BUTTON_MAX} onChange={(e) => setBtnText(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="tg-btn-url">{t('admin.telegram.buttonUrl')}</label>
            <input id="tg-btn-url" className="field text-base" type="url" inputMode="url" value={btnUrl} onChange={(e) => setBtnUrl(e.target.value)}
              aria-invalid={hasButton && !isHttpsUrl(btnUrl) ? true : undefined} />
          </div>
        </div>
        {hasButton && !isHttpsUrl(btnUrl) && <p role="alert" data-testid="telegram-button-error" className="text-sm text-danger">{t('admin.telegram.buttonUrlInvalid')}</p>}
      </fieldset>

      {confirming ? (
        <div role="alertdialog" aria-label={t('admin.telegram.confirmTitle')} data-testid="telegram-confirm" className="space-y-3 rounded-2xl border border-line bg-surface-2 p-4">
          <p className="font-semibold text-fg">{t('admin.telegram.confirm', { count: reachable })}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>{t('admin.telegram.cancel')}</button>
            <button type="button" className="btn-primary" disabled={send.isPending} onClick={() => send.mutate('all')}>
              <Send size={16} aria-hidden="true" />{t('admin.telegram.confirmSend')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary" disabled={!canSend}><Send size={16} aria-hidden="true" />{t('admin.telegram.send')}</button>
          <button type="button" className="btn-ghost" disabled={!formOk || send.isPending} onClick={() => send.mutate('me')}>{t('admin.telegram.sendMe')}</button>
        </div>
      )}
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      {skipped > 0 && sentId !== null && <p role="status" className="text-sm text-muted">{t('admin.telegram.skipped', { count: skipped })}</p>}
      {b && <ProgressRow b={b} />}
    </form>
  )
}

function sendError(err: unknown, t: (k: string) => string): string {
  const { code } = apiErrorInfo(err)
  if (code === 'telegram_not_linked') return t('admin.telegram.errNotLinked')
  if (code === 'broadcast_running') return t('admin.telegram.errRunning')
  return errorMessage(err)
}

function ProgressRow({ b }: { b: TelegramBroadcast }) {
  const { t } = useTranslation()
  return (
    <div data-testid="telegram-progress" role="status" className="space-y-1 rounded-2xl bg-surface-2 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-fg tabular-nums">{t('admin.telegram.progress', { sent: b.sent, total: b.total })}</span>
        <span className="text-muted">{t(`admin.telegram.status.${b.status}`)}</span>
      </div>
      <div className="text-muted tabular-nums">{t('admin.telegram.progressDetail', { failed: b.failed, blocked: b.blocked })}</div>
      <progress className="h-1.5 w-full" max={Math.max(b.total, 1)} value={b.sent + b.failed + b.blocked} aria-label={t('admin.telegram.progress', { sent: b.sent, total: b.total })} />
    </div>
  )
}

function History() {
  const { t } = useTranslation()
  const list = useQuery({ queryKey: BROADCASTS_KEY, queryFn: telegramBroadcastApi.list, retry: false })
  const rows = list.data ?? []
  return (
    <section className="glass space-y-3 p-6" aria-labelledby="tg-history-title">
      <h2 id="tg-history-title" className="text-lg font-bold text-fg">{t('admin.telegram.history')}</h2>
      {list.error && <p role="alert" className="text-sm text-danger">{errorMessage(list.error)}</p>}
      {list.data && rows.length === 0 && <p className="text-sm text-muted">{t('admin.telegram.historyEmpty')}</p>}
      <ul className="divide-y divide-divider">
        {rows.map((b) => (
          <li key={b.id} data-testid={`broadcast-${b.id}`} className="space-y-0.5 py-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs text-faint tabular-nums">
                {new Date(b.created_at).toLocaleString(dateLocale())} · {b.kind.startsWith('auto:')
                  ? <span data-testid={`broadcast-rule-${b.id}`}>{t('admin.telegram.rules.autoLabel', { rule: t(`admin.telegram.rules.items.${b.kind.slice(5)}.title`) })}</span>
                  : t(`admin.telegram.target_${b.target}`)}
              </span>
              <span className="text-xs text-muted">{t(`admin.telegram.status.${b.status}`)}</span>
            </div>
            <p className="break-words text-fg">{b.text.ru.length > 80 ? `${b.text.ru.slice(0, 80)}…` : b.text.ru}</p>
            <p className="text-xs tabular-nums text-muted">{t('admin.telegram.counters', { sent: b.sent, total: b.total, failed: b.failed, blocked: b.blocked })}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

type RuleField = 'ru' | 'uz' | 'en'

/** "Automatic": one card per rule — switch, time, texts with placeholder chips, button, save and a sample. */
function AutoRules() {
  const { t } = useTranslation()
  const rules = useQuery({ queryKey: RULES_KEY, queryFn: telegramRulesApi.list, retry: false })
  return (
    <section className="glass space-y-4 p-6" aria-labelledby="tg-rules-title">
      <div>
        <h2 id="tg-rules-title" className="text-lg font-bold text-fg">{t('admin.telegram.rules.title')}</h2>
        <p className="text-sm text-muted">{t('admin.telegram.rules.intro')}</p>
      </div>
      {rules.error && <p role="alert" className="text-sm text-danger">{errorMessage(rules.error)}</p>}
      {!rules.data && !rules.error && <div className="h-24 animate-pulse rounded-2xl bg-surface-2" />}
      <div className="space-y-4">
        {rules.data?.map((rule) => <RuleCard key={rule.key} rule={rule} />)}
      </div>
    </section>
  )
}

function RuleCard({ rule }: { rule: TelegramRule }) {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const daily = rule.send_at !== null
  const [enabled, setEnabled] = useState(rule.enabled)
  const [at, setAt] = useState(rule.send_at ?? '')
  const [text, setText] = useState({ ru: rule.text.ru, uz: rule.text.uz ?? '', en: rule.text.en ?? '' })
  const [langs, setLangs] = useState(false)
  const [btnText, setBtnText] = useState(rule.button?.text ?? '')
  const [btnUrl, setBtnUrl] = useState(rule.button?.url ?? DEFAULT_BUTTON_URL)
  const [errors, setErrors] = useState<Partial<Record<RuleField | 'send_at' | 'button' | 'form', string>>>({})
  const [saved, setSaved] = useState(false)
  const [testSent, setTestSent] = useState(false)
  const area = useRef<Record<RuleField, HTMLTextAreaElement | null>>({ ru: null, uz: null, en: null })
  const active = useRef<RuleField>('ru')
  const cursor = useRef<{ field: RuleField; at: number } | null>(null)

  useEffect(() => { // after a chip was inserted: the cursor goes behind it
    const c = cursor.current
    const el = c && area.current[c.field]
    if (c && el) { el.focus(); el.setSelectionRange(c.at, c.at); cursor.current = null }
  }, [text])

  const preview = useQuery({
    queryKey: [...RULES_KEY, 'preview', rule.key], queryFn: () => telegramRulesApi.preview(rule.key), enabled: daily, retry: false,
  })

  const hasButton = btnText.trim() !== ''
  const timeOk = !daily || (at >= RULE_TIME_MIN && at <= RULE_TIME_MAX)
  const buttonOk = !hasButton || (btnText.trim().length <= BROADCAST_BUTTON_MAX && isHttpsUrl(btnUrl))
  const valid = text.ru.trim() !== '' && timeOk && buttonOk

  const save = useMutation({
    mutationFn: () => telegramRulesApi.update(rule.key, {
      enabled, ...(daily && { send_at: at }),
      text: { ru: text.ru.trim(), ...(text.uz.trim() && { uz: text.uz.trim() }), ...(text.en.trim() && { en: text.en.trim() }) },
      ...(hasButton && { button: { text: btnText.trim(), url: btnUrl.trim() } }),
    }),
    onMutate: () => { setErrors({}); setSaved(false) },
    onSuccess: () => { setSaved(true); void qc.invalidateQueries({ queryKey: RULES_KEY }) },
    onError: (e) => {
      const { code, field } = apiErrorInfo(e)
      const allowed = rule.placeholders.map((p) => `{${p}}`).join(' ')
      if (code === 'invalid_placeholder' && (field === 'ru' || field === 'uz' || field === 'en')) {
        setErrors({ [field]: t('admin.telegram.rules.err.invalid_placeholder', { allowed }) })
        if (field !== 'ru') setLangs(true)
      } else if (code === 'invalid_send_at') setErrors({ send_at: t('admin.telegram.rules.err.invalid_send_at', { from: RULE_TIME_MIN, to: RULE_TIME_MAX }) })
      else if (code === 'invalid_text' && (field === 'ru' || field === 'uz' || field === 'en')) {
        setErrors({ [field]: t('admin.telegram.rules.err.invalid_text', { max: BROADCAST_TEXT_MAX }) })
        if (field !== 'ru') setLangs(true)
      } else if (code === 'invalid_button') setErrors({ button: t('admin.telegram.buttonUrlInvalid') })
      else setErrors({ form: errorMessage(e) })
    },
  })
  const test = useMutation({
    mutationFn: () => telegramRulesApi.test(rule.key),
    onMutate: () => { setErrors({}); setTestSent(false) },
    onSuccess: () => setTestSent(true),
    onError: (e) => setErrors({ form: apiErrorInfo(e).code === 'telegram_not_linked' ? t('admin.telegram.errNotLinked') : errorMessage(e) }),
  })

  function setField(f: RuleField, v: string) {
    setText((x) => ({ ...x, [f]: v.slice(0, BROADCAST_TEXT_MAX) }))
    setSaved(false)
    setErrors((e) => ({ ...e, [f]: undefined }))
  }
  function insert(name: string) {
    const f: RuleField = langs || active.current === 'ru' ? active.current : 'ru'
    const el = area.current[f]
    const value = text[f]
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const token = `{${name}}`
    cursor.current = { field: f, at: start + token.length }
    setField(f, value.slice(0, start) + token + value.slice(end))
  }

  const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-faint'
  const fieldArea = (f: RuleField, id: string, text_: string, rows: number) => (
    <div>
      <label className={label} htmlFor={id}>{text_}</label>
      <textarea id={id} rows={rows} className="field text-base" value={text[f]} ref={(el) => { area.current[f] = el }}
        onFocus={() => { active.current = f }} onChange={(e) => setField(f, e.target.value)} aria-invalid={errors[f] ? true : undefined} />
      {errors[f] && <p role="alert" data-testid={`rule-error-${rule.key}-${f}`} className="mt-1 text-sm text-danger">{errors[f]}</p>}
    </div>
  )
  const lastRun = rule.last_run_on
    ? t('admin.telegram.rules.lastRun', {
        date: new Intl.DateTimeFormat(dateLocale(), { day: 'numeric', month: 'long' }).format(new Date(`${rule.last_run_on}T12:00:00`)),
        sent: rule.last_sent ?? 0,
      })
    : t('admin.telegram.rules.neverRun')

  return (
    <article data-testid={`rule-${rule.key}`} className="space-y-3 rounded-2xl border border-line p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-fg">{t(`admin.telegram.rules.items.${rule.key}.title`)}</h3>
          <p className="text-sm text-muted">{t(`admin.telegram.rules.items.${rule.key}.desc`)}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm text-fg">
          <span>{t('admin.telegram.rules.enabled')}</span>
          <input type="checkbox" role="switch" checked={enabled} aria-label={`${t('admin.telegram.rules.enabled')}: ${t(`admin.telegram.rules.items.${rule.key}.title`)}`}
            onChange={(e) => { setEnabled(e.target.checked); setSaved(false) }} className="h-5 w-5 accent-[var(--accent)]" />
        </label>
      </header>

      {daily && (
        <div>
          <label className={label} htmlFor={`rule-time-${rule.key}`}>{t('admin.telegram.rules.sendAt')}</label>
          <input id={`rule-time-${rule.key}`} type="time" min={RULE_TIME_MIN} max={RULE_TIME_MAX} step={60} className="field w-auto text-base" value={at}
            onChange={(e) => { setAt(e.target.value); setSaved(false); setErrors((x) => ({ ...x, send_at: undefined })) }} aria-invalid={!timeOk || errors.send_at ? true : undefined} />
          <p className="mt-1 text-xs text-faint">{t('admin.telegram.rules.sendAtHint', { from: RULE_TIME_MIN, to: RULE_TIME_MAX })}</p>
          {(errors.send_at || !timeOk) && (
            <p role="alert" data-testid={`rule-error-${rule.key}-send_at`} className="mt-1 text-sm text-danger">
              {errors.send_at ?? t('admin.telegram.rules.err.invalid_send_at', { from: RULE_TIME_MIN, to: RULE_TIME_MAX })}
            </p>
          )}
        </div>
      )}

      {fieldArea('ru', `rule-ru-${rule.key}`, t('admin.telegram.fieldRu'), 3)}
      <div className="flex flex-wrap items-center gap-2" data-testid={`rule-chips-${rule.key}`}>
        <span className="text-xs text-faint">{t('admin.telegram.rules.placeholders')}</span>
        {rule.placeholders.map((p) => (
          <button key={p} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(p)}
            aria-label={t('admin.telegram.rules.insert', { name: `{${p}}` })}
            className="rounded-full bg-surface-2 px-2.5 py-0.5 font-mono text-xs text-fg hover:opacity-80">{`{${p}}`}</button>
        ))}
      </div>

      <div>
        <button type="button" aria-expanded={langs} onClick={() => setLangs((v) => !v)} className="text-sm font-semibold text-accent-text hover:underline">
          {t('admin.telegram.otherLangs')}
        </button>
        {langs && (
          <div className="mt-2 space-y-3">
            {fieldArea('uz', `rule-uz-${rule.key}`, t('admin.telegram.fieldUz'), 2)}
            {fieldArea('en', `rule-en-${rule.key}`, t('admin.telegram.fieldEn'), 2)}
          </div>
        )}
      </div>

      <fieldset className="space-y-2 rounded-xl border border-line p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-faint">{t('admin.telegram.button')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor={`rule-btn-text-${rule.key}`}>{t('admin.telegram.buttonLabel')}</label>
            <input id={`rule-btn-text-${rule.key}`} className="field text-base" value={btnText} maxLength={BROADCAST_BUTTON_MAX}
              onChange={(e) => { setBtnText(e.target.value); setSaved(false) }} />
          </div>
          <div>
            <label className={label} htmlFor={`rule-btn-url-${rule.key}`}>{t('admin.telegram.buttonUrl')}</label>
            <input id={`rule-btn-url-${rule.key}`} className="field text-base" type="url" inputMode="url" value={btnUrl}
              onChange={(e) => { setBtnUrl(e.target.value); setSaved(false) }} aria-invalid={hasButton && !isHttpsUrl(btnUrl) ? true : undefined} />
          </div>
        </div>
        {(errors.button || (hasButton && !isHttpsUrl(btnUrl))) && (
          <p role="alert" data-testid={`rule-error-${rule.key}-button`} className="text-sm text-danger">{t('admin.telegram.buttonUrlInvalid')}</p>
        )}
      </fieldset>

      {daily && (
        <div className="space-y-0.5 text-sm text-muted">
          <p data-testid={`rule-preview-${rule.key}`}>{preview.data !== undefined ? t('admin.telegram.rules.preview', { count: preview.data }) : '…'}</p>
          <p data-testid={`rule-last-${rule.key}`}>{lastRun}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          <Save size={16} aria-hidden="true" />{t('admin.telegram.rules.save')}
        </button>
        <button type="button" className="btn-ghost" disabled={test.isPending} onClick={() => test.mutate()}>{t('admin.telegram.rules.testMe')}</button>
        {saved && <span role="status" className="text-sm text-muted">{t('admin.telegram.rules.saved')}</span>}
        {testSent && <span role="status" className="text-sm text-muted">{t('admin.telegram.rules.testSent')}</span>}
      </div>
      {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
    </article>
  )
}
