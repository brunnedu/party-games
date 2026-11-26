import { useEffect, useState } from 'react'
import { DiceFace } from './DiceFace'
import { s } from './strings.de'

/** Your own dice: hidden until tapped, and again when the app goes away. */
export function OwnDice({ dice }: { dice: number[] }) {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === 'hidden') setShown(false)
    }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [])

  return (
    <button
      type="button"
      className="card own-dice"
      aria-pressed={shown}
      onClick={() => setShown(!shown)}
    >
      <span className="own-dice-row" aria-live="polite">
        {dice.map((value, i) =>
          shown ? (
            <DiceFace key={i} value={value} />
          ) : (
            <span key={i} className="dice-back" aria-hidden>
              ?
            </span>
          ),
        )}
      </span>
      {!shown && <span className="muted">{s.hidden}</span>}
      <strong>{shown ? s.hideDice : s.showDice}</strong>
    </button>
  )
}
