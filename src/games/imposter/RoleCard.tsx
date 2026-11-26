import { useHold } from '../../core/ui/useHold'
import type { Snapshot } from './api'
import { s } from './strings.de'
import { WordGrid } from './WordGrid'

/**
 * The role is only on screen while the card is held down. Hidden, it looks the
 * same for the imposter and everyone else.
 */
export function SecretArea({ snapshot: { game, role } }: { snapshot: Snapshot }) {
  const { held, holdProps } = useHold()
  const shown = held && role !== null

  return (
    <>
      {role && (
        <button type="button" className="card center secret role-card hold-button" {...holdProps}>
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
