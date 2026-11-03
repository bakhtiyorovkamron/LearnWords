import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { meApi, type FeatureName } from '../api/endpoints'
import { useFeatures } from './features'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, meApi: { get: vi.fn() } }
})

function features() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children)
  return renderHook(() => useFeatures(), { wrapper }).result
}
const all: FeatureName[] = ['photo_import', 'daily_story', 'word_search', 'story_autotranslate', 'theme_picker']
const state = (enabled: boolean) => ({ enabled, daily_limit: null, remaining: null })

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('useFeatures().isOn', () => {
  it('while /me is loading: the catalog default — daily_story off, the rest on', () => {
    vi.mocked(meApi.get).mockReturnValue(new Promise(() => undefined))
    const f = features()
    expect(all.filter((n) => f.current.isOn(n))).toEqual(['photo_import', 'word_search', 'story_autotranslate', 'theme_picker'])
  })

  it('once /me is there, the server decides (an admin can turn daily_story on)', async () => {
    vi.mocked(meApi.get).mockResolvedValue({
      id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de',
      features: { photo_import: state(false), daily_story: state(true), word_search: state(true), story_autotranslate: state(true), theme_picker: state(true) },
    })
    const f = features()
    await waitFor(() => expect(f.current.isOn('photo_import')).toBe(false)) // /me has arrived
    expect(f.current.isOn('daily_story')).toBe(true)
  })
})
