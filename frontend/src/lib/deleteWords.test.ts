import { act, cleanup, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Trash2, type LucideIcon } from 'lucide-react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { wordsApi } from '../api/endpoints'
import { UNDO_MS, resetDeleteWords, useDeleteWords, useHiddenWordIds } from './deleteWords'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, wordsApi: { ...mod.wordsApi, remove: vi.fn() } }
})

type Toast = { text: string; icon?: LucideIcon; action?: { label: string; onClick: () => void } }
let toasts: Toast[] = []
const onToast = (e: Event) => { toasts.push((e as CustomEvent<Toast>).detail) }

function setup() {
  const qc = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children)
  const hook = renderHook(() => ({ del: useDeleteWords(), hidden: useHiddenWordIds() }), { wrapper })
  return { qc, del: hook.result.current.del, hidden: () => [...hook.result.current.hidden] }
}
const words = (...ids: string[]) => ids.map((id) => ({ id, word: `w-${id}` }))
const tick = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms))

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.useFakeTimers()
  vi.mocked(wordsApi.remove).mockResolvedValue({ deleted: 1 })
  toasts = []
  window.addEventListener('app-toast', onToast)
})
afterEach(() => {
  cleanup()
  resetDeleteWords()
  window.removeEventListener('app-toast', onToast)
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('useDeleteWords', () => {
  it('hides the ids at once, sends them after 6 s, shows them again only after the refetch', async () => {
    const { qc, del, hidden } = setup()
    let release!: () => void
    const refetch = new Promise<void>((r) => { release = r })
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockReturnValue(refetch)

    act(() => del(words('a', 'b')))
    expect(hidden()).toEqual(['a', 'b'])
    await tick(UNDO_MS - 1)
    expect(wordsApi.remove).not.toHaveBeenCalled()
    await tick(1)
    expect(wordsApi.remove).toHaveBeenCalledTimes(1)
    expect(wordsApi.remove).toHaveBeenCalledWith(['a', 'b'])
    await tick()
    expect(invalidate.mock.calls.map((c) => c[0]?.queryKey)).toEqual([['collection'], ['folders'], ['review-due'], ['cards']])
    expect(hidden()).toEqual(['a', 'b']) // the lists have not come back yet

    await act(async () => { release(); await refetch })
    expect(hidden()).toEqual([])
  })

  it('Undo: nothing is ever sent and the ids are visible again', async () => {
    const { del, hidden } = setup()
    act(() => del(words('a')))
    act(() => toasts[0].action!.onClick())
    expect(hidden()).toEqual([])
    await tick(UNDO_MS * 2)
    expect(wordsApi.remove).not.toHaveBeenCalled()
  })

  it('two deletes are two batches: Undo on the second keeps the first, which is sent at 6 s', async () => {
    const { del, hidden } = setup()
    act(() => del(words('a')))
    act(() => del(words('b', 'c')))
    expect(toasts).toHaveLength(2)
    act(() => toasts[1].action!.onClick())
    expect(hidden()).toEqual(['a'])
    await tick(UNDO_MS)
    expect(wordsApi.remove).toHaveBeenCalledTimes(1)
    expect(wordsApi.remove).toHaveBeenCalledWith(['a'])
    await tick()
    expect(hidden()).toEqual([])
  })

  it('the page becoming hidden sends every pending batch at once', async () => {
    const { del } = setup()
    act(() => del(words('a')))
    act(() => del(words('b')))
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    try {
      document.dispatchEvent(new Event('visibilitychange'))
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState
    }
    expect(wordsApi.remove).toHaveBeenCalledTimes(2)
    expect(vi.mocked(wordsApi.remove).mock.calls).toEqual([[['a']], [['b']]])
    await tick(UNDO_MS)
    expect(wordsApi.remove).toHaveBeenCalledTimes(2) // the timers were cancelled
  })

  it('an API error: the deleteFailed toast, and the words come back', async () => {
    vi.mocked(wordsApi.remove).mockRejectedValue(new Error('boom'))
    const { del, hidden } = setup()
    act(() => del(words('a')))
    await tick(UNDO_MS)
    await tick()
    expect(toasts.at(-1)!.text).toMatch(/^Could not delete: /)
    expect(hidden()).toEqual([])
  })

  it('the toast: the word for one, the count for many; Undo and the trash icon', () => {
    const { del } = setup()
    act(() => del([{ id: 'a', word: 'Hund' }]))
    act(() => del(words('b', 'c', 'd')))
    expect(toasts.map((x) => x.text)).toEqual(['Deleted “Hund”', 'Deleted 3 words'])
    expect(toasts[0].action!.label).toBe('Undo')
    expect(toasts[0].icon).toBe(Trash2)
  })
})
