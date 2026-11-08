import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { purchasesApi, type PurchaseOverview, type PurchaseRequest } from '../api/endpoints'
import { formatUZS } from '../lib/money'
import { BuySheet, groupCard, type BuyMode } from './BuySheet'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, purchasesApi: { overview: vi.fn(), create: vi.fn(), cancel: vi.fn() } }
})

// An obviously fake card: real card data only ever comes from the server.
const CARD = '0000111122223333'
const overview = (requests: PurchaseRequest[] = [], telegram = 'yodla_help'): PurchaseOverview => ({
  packs: [
    { id: 'photo_35', feature: 'photo_import', amount: 35, price_uzs: 25000 },
    { id: 'photo_100', feature: 'photo_import', amount: 100, price_uzs: 59000 },
  ],
  payment: { card_number: CARD, card_holder: 'TEST HOLDER', telegram },
  requests,
})
const request = (over: Partial<PurchaseRequest> = {}): PurchaseRequest => ({
  id: 'r1', code: 'YD-1234', pack_id: 'photo_35', amount: 35, price_uzs: 25000, status: 'pending', created_at: '2026-11-08T10:00:00Z', ...over,
})
const fail = (status: number, data: unknown) =>
  new AxiosError('x', String(status), undefined, undefined, { status, data, headers: {}, statusText: '', config: {} as never } as AxiosResponse)
/** Text with the no-break spaces of prices turned into plain ones. */
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s/g, ' ')

function renderSheet(mode: BuyMode = 'limit', onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><BuySheet mode={mode} limit={5} onClose={onClose} /></QueryClientProvider>)
  return { onClose, qc }
}

const writeText = vi.fn()
beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(purchasesApi.overview).mockResolvedValue(overview())
  vi.mocked(purchasesApi.create).mockResolvedValue(request())
  vi.mocked(purchasesApi.cancel).mockResolvedValue({} as never)
  writeText.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('formatUZS / groupCard', () => {
  it('formats sum per interface language, with no-break spaces', () => {
    expect(formatUZS(25000, 'ru')).toBe('25 000 сум')
    expect(formatUZS(25000, 'en')).toBe('25,000 UZS')
    expect(formatUZS(59000, 'uz')).toBe('59 000 so‘m')
  })
  it('groups a card number by 4 digits', () => {
    expect(groupCard('0000111122223333')).toBe('0000 1111 2222 3333')
    expect(groupCard('0000 1111-2222 3333')).toBe('0000 1111 2222 3333')
  })
})

describe('BuySheet: packs', () => {
  it('"limit" mode: the used-up title, the subtitle with the daily limit, a card per pack', async () => {
    renderSheet('limit')
    const sheet = screen.getByRole('dialog', { name: "Today's free photos are used up" })
    expect(sheet.textContent).toContain('You get 5 free photos every day.')
    const small = await screen.findByTestId('pack-photo_35')
    expect(text(small)).toContain('35 photos')
    expect(text(small)).toContain('25,000 UZS')
    expect(text(small)).toContain('714 UZS per photo') // 25 000 / 35, rounded
    expect(text(screen.getByTestId('pack-photo_100'))).toContain('590 UZS per photo')
    // the lower price per photo gets the badge, and only that one
    expect(screen.getAllByTestId('best-badge')).toHaveLength(1)
    expect(within(screen.getByTestId('pack-photo_100')).getByTestId('best-badge').textContent).toBe('Best value')
  })

  it('"voluntary" mode has its own title', async () => {
    renderSheet('voluntary')
    expect(screen.getByRole('dialog', { name: 'Buy photos' })).toBeTruthy()
    await screen.findByTestId('pack-photo_35')
  })

  it('prices follow the interface language', async () => {
    await i18n.changeLanguage('ru')
    renderSheet()
    expect(text(await screen.findByTestId('pack-photo_100'))).toContain('59 000 сум')
  })
})

describe('BuySheet: paying', () => {
  it('choosing a pack creates a request and shows the card, its holder, the code and the steps', async () => {
    let resolve!: (r: PurchaseRequest) => void
    vi.mocked(purchasesApi.create).mockReturnValue(new Promise((r) => { resolve = r }))
    renderSheet()
    const pack = await screen.findByTestId('pack-photo_35')
    fireEvent.click(pack)
    // the tapped card shows it is working, and no second request can be started
    await waitFor(() => expect(pack.getAttribute('aria-busy')).toBe('true'))
    expect((screen.getByTestId('pack-photo_100') as HTMLButtonElement).disabled).toBe(true)
    expect(purchasesApi.create).toHaveBeenCalledWith('photo_35')
    resolve(request())

    await screen.findByRole('dialog', { name: 'How to pay' })
    expect(screen.getByTestId('buy-card').textContent).toBe('0000 1111 2222 3333')
    expect(screen.getByTestId('buy-holder').textContent).toBe('TEST HOLDER')
    expect(screen.getByTestId('buy-code').textContent).toBe('YD-1234')
    const steps = screen.getAllByRole('listitem').map(text)
    expect(steps[0]).toContain('Transfer 25,000 UZS to this card:')
    expect(steps[1]).toContain('Write this code in the transfer comment:')
    expect(steps[2]).toContain('As soon as the transfer arrives')
  })

  it('the copy buttons put the card digits and the code on the clipboard, and say "Copied" for 2 s', async () => {
    vi.mocked(purchasesApi.overview).mockResolvedValue(overview([request()]))
    renderSheet()
    await screen.findByTestId('buy-code')
    const [copyCard, copyCode] = screen.getAllByRole('button', { name: 'Copy' })
    expect(copyCard.getAttribute('aria-describedby')).toBe(screen.getByTestId('buy-card').id)

    vi.useFakeTimers()
    fireEvent.click(copyCard)
    await act(async () => { await Promise.resolve() })
    expect(writeText).toHaveBeenLastCalledWith(CARD) // the digits, without the spaces
    expect(copyCard.textContent).toBe('Copied')
    fireEvent.click(copyCode)
    await act(async () => { await Promise.resolve() })
    expect(writeText).toHaveBeenLastCalledWith('YD-1234')
    act(() => { vi.advanceTimersByTime(2000) })
    expect(copyCard.textContent).toBe('Copy')
    expect(copyCode.textContent).toBe('Copy')
  })

  it('without clipboard access nothing claims to be copied', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    vi.mocked(purchasesApi.overview).mockResolvedValue(overview([request()]))
    renderSheet()
    await screen.findByTestId('buy-code')
    const [copyCard] = screen.getAllByRole('button', { name: 'Copy' })
    fireEvent.click(copyCard)
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(copyCard.textContent).toBe('Copy')
  })

  it('Telegram opens t.me/<username> in a new tab; "Done" closes the sheet', async () => {
    vi.mocked(purchasesApi.overview).mockResolvedValue(overview([request()]))
    const { onClose } = renderSheet()
    const tg = await screen.findByRole('link', { name: 'Message us on Telegram' })
    expect(tg.getAttribute('href')).toBe('https://t.me/yodla_help')
    expect(tg.getAttribute('target')).toBe('_blank')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('no Telegram configured: no link, and "Done" is the main button', async () => {
    vi.mocked(purchasesApi.overview).mockResolvedValue(overview([request()], ''))
    renderSheet()
    const done = await screen.findByRole('button', { name: 'Done' })
    expect(screen.queryByRole('link', { name: 'Message us on Telegram' })).toBeNull()
    expect(done.className).toContain('btn-primary')
  })
})

describe('BuySheet: an unpaid request', () => {
  it('opens straight at its payment steps; cancelling goes back to the packs', async () => {
    vi.mocked(purchasesApi.overview).mockResolvedValue(overview([request({ id: 'r9', code: 'YD-0042', amount: 100, price_uzs: 59000 })]))
    renderSheet()
    expect(await screen.findByRole('dialog', { name: 'How to pay' })).toBeTruthy()
    expect(screen.getByTestId('buy-code').textContent).toBe('YD-0042')
    expect(text(screen.getAllByRole('listitem')[0])).toContain('Transfer 59,000 UZS')
    expect(screen.queryByTestId('pack-photo_35')).toBeNull()

    vi.mocked(purchasesApi.overview).mockResolvedValue(overview([request({ id: 'r9', status: 'cancelled' })]))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }))
    await waitFor(() => expect(purchasesApi.cancel).toHaveBeenCalledWith('r9'))
    expect(await screen.findByTestId('pack-photo_35')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: "Today's free photos are used up" })).toBeTruthy()
    expect(purchasesApi.create).not.toHaveBeenCalled()
  })
})

describe('BuySheet: the request is decided while the sheet is open', () => {
  it('paid → the sheet closes (the page announces the photos)', async () => {
    vi.mocked(purchasesApi.overview).mockResolvedValue(overview([request()]))
    const { onClose, qc } = renderSheet()
    await screen.findByTestId('buy-code')
    vi.mocked(purchasesApi.overview).mockResolvedValue(overview([request({ status: 'paid' })]))
    await qc.invalidateQueries({ queryKey: ['purchases'] })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('rejected → back to the packs', async () => {
    vi.mocked(purchasesApi.overview).mockResolvedValue(overview([request()]))
    const { onClose, qc } = renderSheet()
    await screen.findByTestId('buy-code')
    vi.mocked(purchasesApi.overview).mockResolvedValue(overview([request({ status: 'rejected' })]))
    await qc.invalidateQueries({ queryKey: ['purchases'] })
    expect(await screen.findByTestId('pack-photo_35')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('BuySheet: errors', () => {
  it('503 payments_unavailable: buying is not available', async () => {
    vi.mocked(purchasesApi.overview).mockRejectedValue(fail(503, { error: 'payments are not configured', code: 'payments_unavailable' }))
    renderSheet()
    expect((await screen.findByRole('alert')).textContent).toBe('Buying photos is not available right now.')
    expect(screen.queryByTestId('pack-photo_35')).toBeNull()
  })

  it('409 too_many_pending on create: the "unpaid requests" message, and the requests are re-read', async () => {
    vi.mocked(purchasesApi.create).mockRejectedValue(fail(409, { error: 'too many', code: 'too_many_pending' }))
    renderSheet()
    fireEvent.click(await screen.findByTestId('pack-photo_35'))
    expect((await screen.findByRole('alert')).textContent).toBe('You already have unpaid requests — pay or cancel them first.')
    await waitFor(() => expect(purchasesApi.overview).toHaveBeenCalledTimes(2))
  })

  it('503 on create (buying switched off meanwhile)', async () => {
    vi.mocked(purchasesApi.create).mockRejectedValue(fail(503, { code: 'payments_unavailable' }))
    renderSheet()
    fireEvent.click(await screen.findByTestId('pack-photo_35'))
    expect((await screen.findByRole('alert')).textContent).toBe('Buying photos is not available right now.')
  })
})
