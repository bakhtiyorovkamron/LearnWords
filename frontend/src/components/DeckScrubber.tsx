import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const KNOB_PX = 22
const HAPTIC_MS = 8

/** Where the knob's centre is for a value at `share` (0..1) of the track: the knob never leaves the input. */
const knobLeft = (share: number) => `calc(${share} * (100% - ${KNOB_PX}px) + ${KNOB_PX / 2}px)`

/**
 * The deck's scrubber: a native range over the WHOLE deck (1..total, loaded or not). It shows the deck
 * index and follows it; while dragging, a bubble above the knob names the card ("18 · das Bett", just
 * the number when that card is not loaded yet). Letting go jumps there (onJump gets the 0-based index);
 * while a jump is still loading pages, a spinner sits in the knob and new drags are ignored.
 */
export function DeckScrubber({ index, total, labelOf, onJump, busy }: {
  index: number // the deck's current card, 0-based
  total: number
  labelOf: (index: number) => string | undefined // the card's word, when it is loaded
  onJump: (index: number) => void
  busy: boolean
}) {
  const { t } = useTranslation()
  const [dragValue, setDragValue] = useState<number | null>(null) // 1-based, while the finger is on it
  const [pointer, setPointer] = useState(false)
  const value = dragValue ?? index + 1
  const share = total > 1 ? (value - 1) / (total - 1) : 0

  function commit(v: number | null) {
    setDragValue(null)
    setPointer(false)
    if (v === null || busy) return
    navigator.vibrate?.(HAPTIC_MS) // on release only
    if (v - 1 !== index) onJump(v - 1)
  }

  const label = dragValue !== null ? labelOf(dragValue - 1) : undefined
  return (
    <div data-testid="deck-scrubber" className="mx-auto flex w-full max-w-[500px] shrink-0 items-center gap-3 px-1">
      <span className="text-[13px] tabular-nums text-faint">1</span>
      <div className="relative min-w-0 flex-1">
        {dragValue !== null && (
          <span data-testid="deck-scrubber-bubble" style={{ left: knobLeft(share) }}
            className="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-surface-2 px-3 py-1.5 text-sm font-semibold text-fg shadow-[var(--shadow-card)]">
            <span className="tabular-nums">{dragValue}</span>{label && <> · <span className="font-serif">{label}</span></>}
          </span>
        )}
        <input type="range" min={1} max={total} step={1} value={value}
          aria-label={t('cards.jump')} aria-valuetext={t('cards.position', { n: value, total })} aria-busy={busy || undefined}
          className="deck-range block w-full" style={{ '--fill': `${share * 100}%` } as React.CSSProperties}
          onPointerDown={() => { if (!busy) setPointer(true) }}
          onChange={(e) => {
            if (busy) return
            const v = Number(e.target.value)
            if (pointer) setDragValue(v)
            else commit(v) // the keyboard: every step is a release
          }}
          onPointerUp={() => commit(dragValue)}
          onPointerCancel={() => { setDragValue(null); setPointer(false) }}
          onBlur={() => { if (dragValue !== null) commit(dragValue) }}
        />
        {busy && (
          <span data-testid="deck-scrubber-spinner" aria-hidden="true" style={{ left: knobLeft(share) }}
            className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 animate-spin rounded-full border-2 border-on-accent border-t-transparent" />
        )}
      </div>
      <span className="text-[13px] tabular-nums text-faint">{total}</span>
    </div>
  )
}
