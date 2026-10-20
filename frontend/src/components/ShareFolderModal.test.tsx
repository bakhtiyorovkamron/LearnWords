import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { foldersApi } from '../api/endpoints'
import type { Folder } from '../api/types'
import { ShareFolderModal } from './ShareFolderModal'
import * as toaster from './Toaster'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, foldersApi: { share: vi.fn(), regenerateShare: vi.fn(), disableShare: vi.fn(), list: vi.fn() } }
})

const folder = { id: 'f1', name: 'Tiere', color: 'amber', import_count: 3 } as Folder
const URL1 = 'https://yodla.fun/s/aB3dE5gH7k'

function setup() {
  const onClose = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><ShareFolderModal folder={folder} onClose={onClose} /></QueryClientProvider>)
  return { onClose }
}

let toast: ReturnType<typeof vi.spyOn>
beforeEach(async () => {
  await i18n.changeLanguage('en')
  toast = vi.spyOn(toaster, 'toast').mockImplementation(() => undefined)
  vi.mocked(foldersApi.share).mockResolvedValue({ token: 'aB3dE5gH7k', url: URL1 })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('ShareFolderModal', () => {
  it('turns the link on when opened and shows it, the Telegram link and the import count', async () => {
    setup()
    const field = (await screen.findByDisplayValue(URL1)) as HTMLInputElement
    expect(field.readOnly).toBe(true)
    expect(foldersApi.share).toHaveBeenCalledWith('f1')
    const tg = screen.getByText(/Send via Telegram/).closest('a')!
    expect(tg.getAttribute('href')).toBe(
      `https://t.me/share/url?url=${encodeURIComponent(URL1)}&text=${encodeURIComponent('I\'m learning German on yodla.fun — here are my words “Tiere”')}`)
    expect(screen.getByText('Added by: 3')).toBeTruthy()
  })

  it('Copy puts the link on the clipboard and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    setup()
    await screen.findByDisplayValue(URL1)
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL1))
    expect(toast).toHaveBeenCalledWith('Link copied')
    vi.unstubAllGlobals()
  })

  it('"Create a new link" swaps the link; "Turn off link" disables, says so and closes', async () => {
    vi.mocked(foldersApi.regenerateShare).mockResolvedValue({ token: 'Zz9yX8wV7u', url: 'https://yodla.fun/s/Zz9yX8wV7u' })
    vi.mocked(foldersApi.disableShare).mockResolvedValue({} as never)
    const { onClose } = setup()
    await screen.findByDisplayValue(URL1)

    fireEvent.click(screen.getByText(/Create a new link/))
    expect(await screen.findByDisplayValue('https://yodla.fun/s/Zz9yX8wV7u')).toBeTruthy()
    expect(screen.queryByDisplayValue(URL1)).toBeNull()

    fireEvent.click(screen.getByText(/Turn off link/))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(foldersApi.disableShare).toHaveBeenCalledWith('f1')
    expect(toast).toHaveBeenCalledWith('Link turned off')
  })
})
