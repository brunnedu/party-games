import { useEffect, useState, type KeyboardEvent } from 'react'
import type { Snapshot } from './api'
import { s } from './strings.de'
import { WordGrid } from './WordGrid'

/**
 * The role is only on screen while the card is held down. Hidden, it looks the
 * same for the imposter and everyone else.
 */
export function SecretArea({ snapshot: { game, role } }: { snapshot: Snapshot }) {
  const [held, setHeld] = useState(false)
  const shown = held && role !== null

  // Never stay open when the app goes to the background.
  useEffect(() => {
    const hide = () => setHeld(false)
    window.addEventListener('blur', hide)
    document.addEventListener('visibilitychange', hide)
    return () => {
      window.removeEventListener('blur', hide)
      document.removeEventListener('visibilitychange', hide)
    }
  }, [])

  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return
    e.preventDefault()
    setHeld(down)
  }

  return (
    <>
      {role && (
        <button
          type="button"
          className="card center secret role-card"
          onPointerDown={() => setHeld(true)}
          onPointerUp={() => setHeld(false)}
          onPointerLeave={() => setHeld(false)}
          onPointerCancel={() => setHeld(false)}
          onKeyDown={onKey(true)}
          onKeyUp={onKey(false)}
          onBlur={() => setHeld(false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          {!shown ? (
            <>
              <span className="role-card-icon" aria-hidden>
                🤫
              </span>
              <strong>{s.holdToReveal}</strong>
              <span className="muted">{s.holdWarning}</span>
            </>
          ) : role.is_imposter ? (
            <>
              <span className="role-card-word imposter">{s.youAreImposter}</span>
              <span className="muted">{s.imposterHint}</span>
            </>
          ) : (
            <>
              <span className="muted">{s.theWord}</span>
              <span className="role-card-word">{role.word}</span>
            </>
          )}
        </button>
      )}
      <WordGrid game={game} highlight={shown ? role.word : null} />
    </>
  )
}
