import { useQuery } from '@tanstack/react-query'
import { purchasesApi, type PurchaseOverview, type PurchaseRequest } from '../api/endpoints'
import { apiErrorInfo } from '../api/client'

export const PURCHASES_KEY = ['purchases'] as const

/** How often an unpaid request is re-checked, so the photos show up once the admin approves it. */
export const PENDING_POLL_MS = 30_000

/**
 * The "buy photos" data: packs, where to pay, the user's requests. While a request waits for payment
 * it is re-read every 30 s, only while the tab is visible. A 503 means buying is off on this server:
 * it is not retried, and callers hide the buy links.
 */
export function usePurchaseOverview(enabled = true) {
  return useQuery({
    queryKey: PURCHASES_KEY,
    queryFn: purchasesApi.overview,
    enabled,
    staleTime: 60_000,
    retry: (failures, err) => apiErrorInfo(err).status !== 503 && failures < 2,
    refetchInterval: (q) => (pendingRequest(q.state.data) ? PENDING_POLL_MS : false),
    refetchIntervalInBackground: false,
  })
}

/** The request that waits for payment (the newest, if there are several). */
export function pendingRequest(o: PurchaseOverview | undefined): PurchaseRequest | null {
  return o?.requests.find((r) => r.status === 'pending') ?? null
}

/** Buying is switched off on the server (no card configured). */
export function isPaymentsUnavailable(err: unknown): boolean {
  const { status, code } = apiErrorInfo(err)
  return code === 'payments_unavailable' || status === 503
}
