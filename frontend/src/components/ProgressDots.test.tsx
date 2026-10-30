import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { ProgressDots } from './ProgressDots'
import { ReviewResult } from './ReviewResult'

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

afterEach(cleanup)
beforeEach(async () => { await i18n.changeLanguage('ru') })

describe('ProgressDots box tooltip', () => {
  it('explains the box on tap: box, next review, what happens on a right/wrong answer', () => {
    render(<ProgressDots boxLevel={3} isLearned={false} schedule={{ nextReviewAt: inDays(4), reviewedToday: false }} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button'))
    const tip = screen.getByRole('dialog')
    expect(tip.textContent).toContain('Коробка 3 из 5')
    expect(tip.textContent).toContain('Следующее повторение: через 4 дн.')
    expect(tip.textContent).toContain('перейдёт в коробку 4')
    expect(tip.textContent).toContain('вернётся в коробку 1')
    expect(tip.textContent).not.toContain('Сегодня уже повторено')
  })

  it('learned word: "learned, we will check it again …"', () => {
    render(<ProgressDots boxLevel={5} isLearned schedule={{ nextReviewAt: inDays(14), reviewedToday: false }} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('dialog').textContent).toContain('Слово выучено. Проверим его ещё раз через 14 дн.')
  })

  it('reviewed today: ✓ next to the dots and a line in the tooltip; tomorrow wording', () => {
    render(<ProgressDots boxLevel={2} isLearned={false} schedule={{ nextReviewAt: inDays(1), reviewedToday: true }} />)
    expect(screen.getByLabelText('Сегодня уже повторено')).toBeTruthy()
    fireEvent.click(screen.getByRole('button'))
    const tip = screen.getByRole('dialog').textContent
    expect(tip).toContain('Сегодня уже повторено')
    expect(tip).toContain('Следующее повторение: завтра')
  })

  it('closes on Escape and on a tap outside; no button without a schedule', () => {
    const { rerender } = render(<ProgressDots boxLevel={1} isLearned={false} schedule={{ nextReviewAt: inDays(0), reviewedToday: false }} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('dialog').textContent).toContain('Следующее повторение: сегодня')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button'))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(<ProgressDots boxLevel={1} isLearned={false} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('ProgressDots compact', () => {
  const sched = { nextReviewAt: inDays(2), reviewedToday: false }
  const filled = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-testid="box-bars"] span')).map((s) => s.getAttribute('data-filled'))

  it('5 bars filled up to box_level, no status text', () => {
    const { container } = render(<ProgressDots compact boxLevel={3} isLearned={false} schedule={sched} />)
    expect(filled(container)).toEqual(['true', 'true', 'true', 'false', 'false'])
    expect(container.textContent).toBe('')
  })
  it('all filled when learned', () => {
    const { container } = render(<ProgressDots compact boxLevel={2} isLearned schedule={sched} />)
    expect(filled(container)).toEqual(['true', 'true', 'true', 'true', 'true'])
  })
  it('still opens the box explanation', () => {
    render(<ProgressDots compact boxLevel={3} isLearned={false} schedule={sched} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('dialog').textContent).toContain('Коробка 3 из 5')
  })
})

describe('ReviewResult box line', () => {
  const noop = vi.fn()
  const renderResult = (boxes: 'practice' | { movedUp: number }) =>
    render(<MemoryRouter><ReviewResult correct={3} total={4} onRestart={noop} boxes={boxes} /></MemoryRouter>)

  it('review: how many words moved up a box', () => {
    renderResult({ movedUp: 3 })
    expect(screen.getByText('Перешли в следующую коробку: 3')).toBeTruthy()
  })
  it('practice: boxes do not change', () => {
    renderResult('practice')
    expect(screen.getByText('Коробки не меняются: это дополнительная тренировка')).toBeTruthy()
  })
})
