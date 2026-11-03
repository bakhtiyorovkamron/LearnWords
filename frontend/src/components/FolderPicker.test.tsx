import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { foldersApi } from '../api/endpoints'
import { FolderPicker } from './FolderPicker'

vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, foldersApi: { ...mod.foldersApi, list: vi.fn() } }
})

// jsdom has no PointerEvent: without one fireEvent.pointer* sends a plain Event with no coordinates.
class TestPointerEvent extends MouseEvent {
  pointerId: number
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
  }
}

const folder = (id: string, name: string) => ({
  id, name, color: 'sky', created_at: '', total: 1, new_count: 0, learning_count: 0, learned_count: 0, due_today: 0,
})

function picker() {
  const onClose = vi.fn()
  const onPick = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FolderPicker title="Move to folder" current="" onPick={onPick} onClose={onClose} />
    </QueryClientProvider>,
  )
  return { onClose, onPick }
}

let prevPointerEvent: unknown
beforeEach(async () => {
  await i18n.changeLanguage('en')
  const many = Array.from({ length: 30 }, (_, i) => folder(`f${i}`, `Folder ${i}`))
  vi.mocked(foldersApi.list).mockResolvedValue({ all: { total: 30, new_count: 0, learning_count: 0, learned_count: 0, due_today: 0 }, folders: many } as never)
  const win = document.defaultView as unknown as { PointerEvent?: unknown }
  prevPointerEvent = win.PointerEvent
  win.PointerEvent = TestPointerEvent
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  ;(document.defaultView as unknown as { PointerEvent?: unknown }).PointerEvent = prevPointerEvent
})

describe('FolderPicker: closing', () => {
  it('the X in the header closes the picker', async () => {
    const { onClose } = picker()
    expect(await screen.findByText('Folder 29')).toBeTruthy() // many folders loaded
    const x = screen.getByRole('button', { name: 'Close' })
    expect(x.closest('[data-testid="picker-header"]')).not.toBeNull()
    fireEvent.click(x)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a click on the scrim closes it; a click inside does not', () => {
    const { onClose } = picker()
    fireEvent.click(screen.getByRole('dialog'))
    fireEvent.click(screen.getByRole('heading', { name: 'Move to folder' }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('picker-scrim'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a press that starts inside and ends on the scrim does not close it', () => {
    const { onClose } = picker()
    fireEvent.pointerDown(screen.getByRole('dialog'))
    fireEvent.click(screen.getByTestId('picker-scrim'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Esc closes it', () => {
    const { onClose } = picker()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('dragging the header down more than 80px closes it; a short drag does not', () => {
    const { onClose } = picker()
    const header = screen.getByTestId('picker-header')
    fireEvent.pointerDown(header, { clientY: 100 })
    fireEvent.pointerMove(header, { clientY: 160 })
    fireEvent.pointerUp(header, { clientY: 160 })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(header, { clientY: 100 })
    fireEvent.pointerMove(header, { clientY: 181 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the sheet leaves a band of scrim above it on phones', () => {
    picker()
    expect(screen.getByRole('dialog').className).toContain('max-h-[85dvh]')
  })
})

describe('FolderPicker: «New folder»', () => {
  it('renders exactly one plus: the icon, no "+" in the text', async () => {
    picker()
    const button = await screen.findByRole('button', { name: 'New folder' })
    expect(button.textContent).toBe('New folder')
    expect(button.querySelectorAll('svg')).toHaveLength(1)
    expect(button.querySelector('svg')!.getAttribute('class')).toContain('lucide-plus')
  })
})
