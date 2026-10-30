import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { meApi, storiesApi, type DailyStory } from '../api/endpoints'
import * as toaster from '../components/Toaster'
import { StoryPage } from './StoryPage'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return {
    ...mod,
    meApi: { get: vi.fn() },
    storiesApi: { today: vi.fn(), list: vi.fn(), byId: vi.fn(), generate: vi.fn(), createOwn: vi.fn(), updateOwn: vi.fn(), deleteOwn: vi.fn() },
  }
})

const todayStr = new Date().toISOString().slice(0, 10)
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
const longAgo = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10)

const story = (over: Partial<DailyStory>): DailyStory => ({
  id: 'x', date: todayStr, genre: 'сказка', title: 'T', story_de: 'Ein Text für die Geschichte.',
  story_translation: 'Текст', language: 'en', words_used: [], created_at: '', source: 'ai', translation_source: 'ai', ...over,
})

// Newest first, like the server: today's own story, today's AI story (shown above, not in the
// archive), yesterday's AI story, an older own story.
const ownToday = story({ id: 'own-today', title: 'Mein Tag heute im Park', source: 'user', genre: '' })
const aiToday = story({ id: 'ai-today', title: 'KI heute' })
const aiYesterday = story({ id: 'ai-yesterday', date: yesterday, title: 'KI gestern' })
const ownOld = story({ id: 'own-old', date: longAgo, title: 'Alte eigene', source: 'user', genre: '' })
const everything = [ownToday, aiToday, aiYesterday, ownOld]

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><StoryPage /></QueryClientProvider>)
  return qc
}

let toast: ReturnType<typeof vi.spyOn>
beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(meApi.get).mockResolvedValue({ id: 'u', email: 'a@b.co', role: 'user', learning_language: 'de' })
  vi.mocked(storiesApi.today).mockResolvedValue({ story: aiToday, words_today: [], genres: [] })
  vi.mocked(storiesApi.list).mockResolvedValue(everything.map((s) => ({ ...s, story_de: '' })))
  vi.mocked(storiesApi.byId).mockImplementation(async (id) => everything.find((s) => s.id === id)!)
  vi.mocked(storiesApi.deleteOwn).mockResolvedValue({} as never)
  toast = vi.spyOn(toaster, 'toast').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const archive = () => screen.getByText('Story archive').closest('section') as HTMLElement
const chip = (name: RegExp | string) => within(archive()).getByRole('button', { name })

describe('StoryPage: the archive', () => {
  it("today's own story is in the archive with a ✍️ chip; today's AI story is not (it is shown above)", async () => {
    renderPage()
    expect(await within(archive()).findByRole('button', { name: /✍️ Mein Tag heute im Park/ })).toBeTruthy()
    expect(chip(/✍️ Alte eigene/)).toBeTruthy()
    // AI chips are dates: yesterday's is there, today's is not.
    const labels = within(archive()).getAllByRole('button').map((b) => b.textContent)
    expect(labels.filter((l) => !l?.startsWith('✍️') && l !== 'All' && !/Generated|Mine/.test(l ?? ''))).toHaveLength(1)
    // the newest is selected by default (the story is fetched a tick after the chips appear)
    await waitFor(() => expect(storiesApi.byId).toHaveBeenCalledWith('own-today'))
  })

  it('a long own title is cut to 24 characters in the chip', async () => {
    vi.mocked(storiesApi.list).mockResolvedValue([{ ...ownOld, title: 'X'.repeat(40), story_de: '' }])
    renderPage()
    expect(await within(archive()).findByRole('button', { name: '✍️ ' + 'X'.repeat(23) + '…' })).toBeTruthy()
  })

  it('edit and delete exist only on own stories', async () => {
    renderPage()
    await within(archive()).findByRole('button', { name: /✍️ Mein Tag/ })
    expect(await screen.findByRole('button', { name: '✏️ Edit' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '🗑 Delete' })).toBeTruthy()
    expect(within(archive()).getByText(/✍️ Own story/)).toBeTruthy() // "date · badge" instead of the genre

    // An AI story from the archive: neither button.
    const aiChip = within(archive()).getAllByRole('button').find((b) => /\d/.test(b.textContent ?? '') && !b.textContent?.startsWith('✍️'))!
    fireEvent.click(aiChip)
    await waitFor(() => expect(storiesApi.byId).toHaveBeenCalledWith('ai-yesterday'))
    await waitFor(() => expect(screen.queryByRole('button', { name: '✏️ Edit' })).toBeNull())
    expect(screen.queryByRole('button', { name: '🗑 Delete' })).toBeNull()
    // Today's AI story above the archive has none either.
    expect(screen.getByRole('heading', { name: 'KI heute' })).toBeTruthy()
  })

  it('filter pills appear only with own stories, and narrow the archive', async () => {
    renderPage()
    await within(archive()).findByRole('button', { name: /✍️ Mein Tag/ })
    fireEvent.click(screen.getByRole('button', { name: '✨ Generated' }))
    await waitFor(() => expect(within(archive()).queryByRole('button', { name: /✍️ Mein Tag/ })).toBeNull())
    await waitFor(() => expect(storiesApi.byId).toHaveBeenCalledWith('ai-yesterday')) // the selection stays valid
    fireEvent.click(screen.getByRole('button', { name: '✍️ Mine' }))
    expect(await within(archive()).findByRole('button', { name: /✍️ Alte eigene/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(within(archive()).getByRole('button', { name: /✍️ Mein Tag/ })).toBeTruthy()
  })

  it('no pills when there are no own stories', async () => {
    vi.mocked(storiesApi.list).mockResolvedValue([{ ...aiYesterday, story_de: '' }])
    renderPage()
    await waitFor(() => expect(storiesApi.byId).toHaveBeenCalledWith('ai-yesterday'))
    expect(screen.queryByRole('button', { name: '✍️ Mine' })).toBeNull()
    expect(screen.queryByRole('button', { name: '✨ Generated' })).toBeNull()
  })

  it('the date input selects the first story of that date; no story → the "no story" note', async () => {
    renderPage()
    await within(archive()).findByRole('button', { name: /✍️ Mein Tag/ })
    const input = archive().querySelector('input[type=date]') as HTMLInputElement
    fireEvent.change(input, { target: { value: longAgo } })
    await waitFor(() => expect(storiesApi.byId).toHaveBeenCalledWith('own-old'))
    fireEvent.change(input, { target: { value: '2020-01-01' } })
    expect(await within(archive()).findByText('No story for this date.')).toBeTruthy()
  })
})

describe('StoryPage: adding, deleting', () => {
  it('after creating: the filter goes back to "All", the new story is selected and in the archive at once', async () => {
    const fresh = story({ id: 'own-new', title: 'Frisch geschrieben', source: 'user', genre: '' })
    // Like the server: once created, the story is in the list the refetch returns.
    vi.mocked(storiesApi.createOwn).mockImplementation(async () => {
      vi.mocked(storiesApi.list).mockResolvedValue([fresh, ...everything].map((x) => ({ ...x, story_de: '' })))
      return fresh
    })
    vi.mocked(storiesApi.byId).mockImplementation(async (id) => [fresh, ...everything].find((s) => s.id === id)!)
    renderPage()
    await within(archive()).findByRole('button', { name: /✍️ Mein Tag/ })
    fireEvent.click(screen.getByRole('button', { name: '✨ Generated' })) // a narrowing filter is on

    fireEvent.click(screen.getByRole('button', { name: '✍️ Your own story' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/German text/), { target: { value: 'Der Hund läuft durch den Park.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(storiesApi.createOwn).toHaveBeenCalledTimes(1))
    expect(await within(archive()).findByRole('button', { name: /✍️ Frisch geschrieben/ })).toBeTruthy()
    await waitFor(() => expect(storiesApi.byId).toHaveBeenCalledWith('own-new'))
    expect(within(archive()).getByRole('button', { name: /✍️ Alte eigene/ })).toBeTruthy() // filter is "All" again
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('the "Your own story" button opens the form', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '✍️ Your own story' }))
    expect(await screen.findByRole('dialog', { name: /Your own story/ })).toBeTruthy()
  })

  it('delete: confirm → deleteOwn(id) → toast, and the next story gets selected', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '🗑 Delete' }))
    expect(confirm).toHaveBeenCalledWith('Delete the story “Mein Tag heute im Park”?')
    await waitFor(() => expect(storiesApi.deleteOwn).toHaveBeenCalledWith('own-today'))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Story deleted'))
    await waitFor(() => expect(storiesApi.byId).toHaveBeenCalledWith('ai-yesterday')) // the next one
  })

  it('delete is not sent when the user cancels the confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '🗑 Delete' }))
    expect(storiesApi.deleteOwn).not.toHaveBeenCalled()
  })

  it('an own story without a translation: a note and "Add a translation" (opens the form in manual mode)', async () => {
    const bare = { ...ownToday, story_translation: '', translation_source: '' as const }
    vi.mocked(storiesApi.list).mockResolvedValue([{ ...bare, story_de: '' }])
    vi.mocked(storiesApi.byId).mockResolvedValue(bare)
    renderPage()
    expect(await screen.findByText('No translation yet.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '✏️ Add a translation' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: /My own translation/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('says who wrote the translation of an own story', async () => {
    renderPage()
    await within(archive()).findByRole('button', { name: /✍️ Mein Tag/ })
    fireEvent.click(await within(archive()).findByRole('button', { name: 'Show translation' }))
    expect(await within(archive()).findByText('Translation: automatic')).toBeTruthy()
  })

  it('a user translation is labelled "yours"; AI stories have no such note', async () => {
    const mine = { ...ownToday, translation_source: 'user' as const }
    vi.mocked(storiesApi.byId).mockImplementation(async (id) => (id === 'own-today' ? mine : everything.find((s) => s.id === id)!))
    renderPage()
    await within(archive()).findByRole('button', { name: /✍️ Mein Tag/ })
    fireEvent.click(await within(archive()).findByRole('button', { name: 'Show translation' }))
    expect(await within(archive()).findByText('Translation: yours')).toBeTruthy()
    // Today's AI story above the archive: its translation carries no such caption.
    fireEvent.click(screen.getAllByRole('button', { name: 'Show translation' }).find((b) => !archive().contains(b))!)
    expect(screen.queryAllByText(/^Translation: /)).toHaveLength(1)
  })
})

describe('StoryPage: daily_story switched off', () => {
  const withFeatures = (daily: boolean) => ({
    id: 'u', email: 'a@b.co', role: 'user' as const, learning_language: 'de' as const,
    features: {
      photo_import: { enabled: true, daily_limit: null, remaining: null },
      daily_story: { enabled: daily, daily_limit: null, remaining: null },
      word_search: { enabled: true, daily_limit: null, remaining: null },
      story_autotranslate: { enabled: true, daily_limit: null, remaining: null },
    },
  })
  const words = [{ word: 'Hund', translation: 'собака' }] as never

  it('shows the generate block while on', async () => {
    vi.mocked(meApi.get).mockResolvedValue(withFeatures(true))
    vi.mocked(storiesApi.today).mockResolvedValue({ story: null, words_today: words, genres: [] })
    renderPage()
    expect(await screen.findByRole('button', { name: '✨ Generate story' })).toBeTruthy()
  })

  it('hides the generate block when off; the archive and own stories stay', async () => {
    vi.mocked(meApi.get).mockResolvedValue(withFeatures(false))
    vi.mocked(storiesApi.today).mockResolvedValue({ story: null, words_today: words, genres: [] })
    renderPage()
    expect(await within(archive()).findByRole('button', { name: /✍️ Mein Tag heute im Park/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '✨ Generate story' })).toBeNull()
    expect(screen.getByRole('button', { name: /Your own story/ })).toBeTruthy()
  })
})
