import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GoalRing } from './GoalRing'

afterEach(cleanup)

describe('GoalRing', () => {
  it('default: 76px, stroke 8, "done/target" inside', () => {
    render(<GoalRing done={8} target={20} met={false} />)
    const ring = screen.getByTestId('goal-ring')
    expect(ring.style.width).toBe('76px')
    expect(ring.textContent).toBe('8/20')
    expect(ring.querySelector('circle')!.getAttribute('stroke-width')).toBe('8')
  })

  it('size, stroke and a label (a percent on a folder page) replace the defaults', () => {
    render(<GoalRing size={64} stroke={7} done={2} target={8} met={false} label="25%" />)
    const ring = screen.getByTestId('goal-ring')
    expect(ring.style.width).toBe('64px')
    expect(ring.style.height).toBe('64px')
    expect(ring.textContent).toBe('25%')
    expect(ring.querySelector('circle')!.getAttribute('stroke-width')).toBe('7')
    expect(ring.querySelector('circle')!.getAttribute('r')).toBe('28.5') // (64 − 7) / 2
  })

  it('the arc follows done/target; met = full circle with the check mark, the label is not shown', () => {
    const { rerender } = render(<GoalRing size={64} stroke={7} done={2} target={8} met={false} label="25%" />)
    const arc = screen.getByTestId('goal-arc')
    const length = Number(arc.getAttribute('stroke-dasharray'))
    expect(Number(arc.getAttribute('stroke-dashoffset'))).toBeCloseTo(length * 0.75)
    rerender(<GoalRing size={64} stroke={7} done={8} target={8} met label="100%" />)
    expect(Number(screen.getByTestId('goal-arc').getAttribute('stroke-dashoffset'))).toBe(0)
    expect(screen.getByTestId('goal-ring').textContent).toBe('')
    expect(screen.getByTestId('goal-ring').querySelectorAll('svg')).toHaveLength(2) // the ring and the check
  })
})
