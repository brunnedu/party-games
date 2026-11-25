import type { Slot } from './cardSlots'
import { s } from './strings.de'

// A symbol as well as a color, for people who can't tell the colors apart.
const SYMBOLS: Record<Slot, string> = {
  correct: '✓',
  wrong: '✗',
  lost: '✗',
  pass: '–',
  current: '',
  open: '',
}

export function CardProgress({ slots }: { slots: Slot[] }) {
  const label = slots.map((slot, i) => `${i + 1}: ${s.slots[slot]}`).join(', ')
  return (
    <div className="pips" role="img" aria-label={label}>
      {slots.map((slot, i) => (
        <span key={i} className={`pip ${slot}`}>
          {SYMBOLS[slot]}
        </span>
      ))}
    </div>
  )
}
